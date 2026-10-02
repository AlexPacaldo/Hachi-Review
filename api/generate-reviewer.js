import { createClient } from "@supabase/supabase-js";
import { CHOICE_LETTERS, findChoiceBalanceIssues, getChoiceBalanceIssue, inferQuestionStyle } from "../src/utils/quizUtils.js";

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";
const AI_PROVIDERS = [
  {
    name: "Gemini",
    kind: "gemini",
    endpoint: GEMINI_ENDPOINT,
    apiKeyEnv: "GEMINI_API_KEY",
    modelEnv: "GEMINI_MODEL",
    defaultModel: DEFAULT_GEMINI_MODEL
  },
  {
    name: "Groq",
    kind: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_MODEL",
    defaultModel: "llama-3.3-70b-versatile",
    supportsVision: false,
    supportsJsonMode: true,
    maxTokens: 8192,
    timeoutMs: 60000
  },
  {
    name: "Groq Vision",
    kind: "openai",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    apiKeyEnv: "GROQ_API_KEY",
    modelEnv: "GROQ_VISION_MODEL",
    defaultModel: "llama-3.2-90b-vision-instruct",
    supportsVision: true,
    supportsJsonMode: false,
    visionOnly: true,
    maxTokens: 8192,
    timeoutMs: 90000
  },
  {
    name: "OpenRouter",
    kind: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    apiKeyEnv: "OPENROUTER_API_KEY",
    modelEnv: "OPENROUTER_MODEL",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    supportsVision: false,
    supportsJsonMode: false,
    maxTokens: 16384,
    timeoutMs: 90000
  }
];
const MAX_SOURCE_LENGTH = 45000;
const MAX_FILE_BASE64_LENGTH = 4200000;
const MAX_COMPLETION_ATTEMPTS = 3;
const MAX_REQUEST_BODY_LENGTH = 5200000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const DEFAULT_PROVIDER_TIMEOUT_MS = 90000;
const rateLimitStore = globalThis.__hachiRateLimitStore || new Map();
globalThis.__hachiRateLimitStore = rateLimitStore;
const DIFFICULTY_INSTRUCTIONS = {
  easy: "Favor direct recall, simple definitions, and straightforward concept checks.",
  mixed: "Use a balanced mix of recall, concept, scenario, and application questions.",
  hard: "Favor deeper application, scenario analysis, tricky-but-fair distinctions, and synthesis across related ideas."
};
const QUESTION_STYLES = ["scenario", "direct"];
const DIFFICULTY_LEVELS = ["easy", "medium", "hard"];
// A generated reviewer is tagged across all three levels so that a learner who
// filters to Hard still gets a real exam-length set instead of a handful of
// items, while the remaining questions stay reachable under Easy and Medium.
const DIFFICULTY_MIX = { easy: 0.3, medium: 0.4, hard: 0.3 };
const SCENARIO_MIX = 0.65;
const EXAM_STYLE_INSTRUCTIONS = `EXAM QUESTION STYLE:
- Write questions the way a real college preliminary examination would, not like a flashcard list.
- Do not let the set collapse into simple definition questions such as "What is X?", "Which of the following defines X?", or "What does X stand for?".
- Prefer questions that ask how to APPLY a concept, principle, technology, process, framework, or term from the material.

APPLICATION OVER MEMORIZATION:
- For each major concept the material allows, prefer an application question over a recall question.
- For example, instead of "What is Problem-Solution Fit?", ask: "A team checks whether a proposed solution actually addresses the root cause of a customer's problem. What concept is being evaluated?"
- Not every question has to be scenario-based. Keep a deliberate mixture of scenario/application questions, concept identification, definitions, comparisons, numerical or factual questions, process and stage questions, terminology questions, and cause-and-effect questions.
- Tag each question with style "scenario" when it puts the concept in a situation and asks the learner to apply or identify it, or style "direct" when it asks for a fact, term, definition, or comparison straight from the material.

QUESTION STRUCTURE:
- Whenever appropriate, open with a short realistic scenario involving a student, technician, developer, programmer, system administrator, business owner, entrepreneur, startup team, user, organization, customer, company, or project team.
- Then ask which concept, solution, principle, technology, standard, framework, or approach BEST applies to the situation.
- Keep scenarios to 1-3 sentences. Do not turn every question into a long story.
- A scenario must give enough information to identify the answer without naming the concept outright.
- When the material contains easily confused concepts, write scenarios that force the learner to tell them apart (for example macro vs micro vs super-macro, B2C vs B2B vs B2G, buyer vs user, demographic vs psychographic vs behavioral vs geographic segmentation, feature vs benefit, problem identification vs solution validation, design thinking vs lean startup, persist vs refine vs pivot).

EXAM-LIKE WORDING:
- Use concise, formal phrasing such as "Which among the following is...", "Which of the following BEST...", "Which of these factors...", "Who among the following commonly deals with...", "What concept is being demonstrated?", "Which approach is being applied?", "Which requirement is being addressed?", "What does this situation indicate?", "Which factor is primarily responsible?", "Which type of ... is being used?", and "What outcome is demonstrated?"
- Prefer "Which among the following ..." over "Which of the following ...". It is the wording most real preliminary examinations use.
- Use words such as BEST, MOST appropriate, MOST likely, BEST explains, BEST resolves, and BEST describes, but only where they fit naturally. Do not force them into every question.
- Never use conversational wording such as "What do you think?", "What would you probably do?", or "Can you figure out...?".

DIFFICULTY LEVELS:
- easy: single fact, term, or definition stated directly in the material.
- medium: requires choosing the right concept, cause, process stage, or comparison from closely related alternatives.
- hard: requires applying the concept to an unfamiliar situation, resolving a tricky-but-fair distinction, or combining two or more ideas from the material.
- A hard question must still be answerable from the study material. Difficulty comes from the reasoning required, never from an unfair or missing detail.`;
// Roughly a quarter of a real preliminary examination is the odd-one-out form,
// "Which among the following is NOT a ...?", so the generator gets the form
// spelled out. It inverts the usual rule: three choices genuinely belong to the
// category and only one does not, which is the easiest way to ship three weak
// distractors without noticing.
const NEGATIVE_STEM_INSTRUCTIONS = `NEGATIVE-STEM QUESTIONS ("WHICH IS NOT"):
- Real exams lean on the odd-one-out form. Real examples: "Which among the following is NOT a business model in the software industry?", "Which among the following is NOT a common situation of deliberate deviations?", "Which among the following is NOT a coding error?", "Which among the following is NOT a subfactor of reliability?", "Which among the following is NOT a product revision factor?".
- Aim for roughly 20-25% of the multiple-choice questions to use this form, and spread them across the reviewer instead of clustering them in one section.
- Use the wordings examiners use: "Which among the following is NOT ...?", "Which of the following is NOT ...?", and "Which of the following is least likely to be ...?".
- Always tag a negative-stem question with style "scenario", never "direct". It discriminates between close concepts, so it belongs with the exam-style pool. A position the plan tags "scenario" is satisfied by a negative-stem question.

HOW TO BUILD A NEGATIVE-STEM QUESTION:
- Name one category, group, or list that the material actually teaches, then ask which choice does NOT belong to it.
- Exactly three choices must genuinely belong to that category and exactly one must not.
- Draw the three true choices from the same family the material names: sibling factors, sibling subfactors, sibling error types, sibling roles, sibling model components, sibling tasks. Never invent members to reach three.
- The single false choice must be a real concept from the same subject area that belongs to a different category. It must not be invented, absurd, or a term nobody would ever offer.
- A negative-stem question is not a positive question with NOT stamped on it. Rewriting "Which factor improves portability?" into "Which factor does NOT improve portability?" does not count.
- Never ask the same category twice, and never pair a negative-stem question with the positive version of that category.

CATEGORY NOUNS EXAMINERS USE:
- "a type of", "a kind of", "a factor", "a subfactor of", "a component of", "an element of", "a level", "an example of", "a task", "a role", "a stage or phase", "a model", "an error", "a deviation", "a culture", "a situational factor".

WORKED SHAPE:
- Question: "Which among the following is NOT a subfactor of reliability?"
- Correct answer: the one option that belongs to a different family, for example "Hardware failure recovery".
- The other three choices are genuine subfactors named in the material, for example "Learning and training ability", "System and application reliability", and "Failure recovery".
- The explanation must teach why each of the three real subfactors belongs to reliability and why the odd one out is a different concept.

NEGATIVE-STEM PITFALLS:
- The explanation must teach why the three true choices DO belong and why the odd one out does not. The usual "here is why the correct answer fits this question" wording fails a NOT question.
- Keep NOT honest. Never write a stem whose NOT reverses the meaning, such as "Which of the following is NOT recommended?" when the answer is a recommendation the material actually gives.
- Never use "None of the above", "All of the above", "Both A and B", or similar giveaways in a negative-stem question. Three of the four choices must be defensibly correct for the NOT reading to work.
- A negative-stem question is a discrimination task, so it is normally "medium" or "hard". Do not force one into an "easy" position unless the material makes the odd one out unmistakable.
- If the material cannot support three genuine members of a category, do not write the negative-stem question at all. Pick a different form instead of inventing members.
- Never repeat the stem's category inside the choices, and never let the three true choices read as obviously weaker or more vague than the odd one out.`;
const EXPLANATION_INSTRUCTIONS = `EXPLANATION QUALITY - CRITICAL:
- An explanation must TEACH the concept behind the answer. It must never simply repeat or paraphrase the correct answer.
- Every explanation should do at least 2-3 of the following: explain the underlying concept; explain why the correct answer fits this question; connect the concept to the scenario; explain the relationship between the ideas; clarify the distinction from a closely related concept; explain why the situation leads to this answer; give a simple example when useful.
- Do not rearrange or swap words from the correct choice into the explanation. If the explanation reads like the answer written out as a sentence, it has failed.
- This is the most common failure of all. Restating the correct choice with "The answer is", "This is defined as", or "X refers to" followed by the choice's own words adds nothing. A learner who has not seen the choices must still learn something from the explanation.

HOW TO WRITE EACH KIND OF EXPLANATION:
- Scenario question: connect the explanation to the situation. For "A startup divides customers according to age, income, and education level. Which segmentation method is being used?" the answer "Demographic segmentation" is explained by noting that age, income and education describe the population of a customer group, and that this differs from behavioral segmentation, which focuses on actions such as usage frequency or purchasing behavior.
- Concept question: explain the important idea rather than repeating the answer. For "Which technology enables secure digital transactions and smart contracts?" the answer "Blockchain" is explained by describing a distributed record of transactions that participants can share and verify, and how that structure supports secure transactions while programmable smart contracts execute agreed conditions.
- Factual question: when the material gives enough context, explain why the fact matters. For "What percentage of startup failures is attributed to no market need?" the answer "42%" is explained by noting that the material identifies no market need as a major cause, and what that implies about validating the problem before building a solution.
- Comparison question: use the explanation to clarify the distinction the question is testing. For "A customer purchases a product for an employee who will actually use it. Which distinction is demonstrated?" the answer "Buyer versus user" is explained by defining each role, noting they can be the same person, and pointing out that here they are different.
- Process question: explain why the selected stage comes at that point in the process, not just what the stage is called.

EXPLANATION LENGTH:
- Aim for 1-3 sentences on straightforward questions and 2-4 sentences on scenario and application questions.
- Add more only when the concept genuinely requires it. Do not pad explanations to look thorough.

EXPLANATION SOURCE ACCURACY:
- Every explanation must be supported by the provided study material. Do not introduce outside facts to make an explanation sound more impressive, and preserve the material's own terminology and concepts.
- If the source only supports limited information about a concept, keep the explanation limited to what the source supports.

EXPLANATION AUDIT, FOR EVERY QUESTION:
- Compare the explanation against the question, the correct answer, and the choices, then ask: "Does this explanation give the student information they did not already get by reading the correct answer?" If not, rewrite it.
- Then ask: "If I hide the answer choice, would this explanation still teach me something useful about the concept?" If not, rewrite it.
- The student must finish reading it able to answer "Why was this the answer?", not "What did the answer choice say?"`;
const QUESTION_TYPE_INSTRUCTIONS = {
  multiple_choice: {
    label: "multiple-choice",
    choicesPerQuestion: 4,
    allowNegativeStems: true,
    instructions: `MULTIPLE-CHOICE RULES:
- Every question must have exactly 4 choices: A, B, C, and D.
- Every question must have exactly one correct answer.

ANSWER CHOICE BALANCE - CRITICAL:
- Never make the correct answer noticeably longer, more detailed, more specific, or more technically sophisticated than the incorrect choices. The correct answer must NOT be identifiable because it contains more information.
- Keep all four choices reasonably similar in length, level of detail, specificity, grammatical structure, complexity, and number of ideas.
- The correct answer may be slightly longer when accuracy requires it, but there must NOT be a large or obvious difference. If the correct answer is substantially longer, rewrite the choices.
- Do not add unnecessary detail to the correct answer just to make it accurate. Match its information density to the distractors: if the correct answer carries three components, the distractors need a comparable level of detail.
- Every choice must be similar in topic and level of specificity. All four must be real concepts from the same subject area, so a learner who half-understood the lesson finds all four plausible.
- Never make the correct answer the only choice that uses technical terminology, the only professionally worded choice, or the only grammatically complete sentence when the others are fragments.
- Never repeat the correct choice's wording in the question stem, and never let the stem hint at which choice is right.

UNBALANCED EXAMPLE, DO NOT WRITE THIS:
- Question: "How do emerging technologies drive sustainability and social responsibility in modern business?"
- A. By increasing paper usage and expanding carbon footprints
- B. By optimizing energy use through IoT/AI, ensuring supply chain transparency via blockchain, and reducing paper via digital platforms
- C. By accelerating manual trial-and-error manufacturing processes
- D. By eliminating the need for remote work arrangements
- Choice B is guessable because it is far longer and carries several specific examples while the others are short and obviously negative.

BALANCED VERSION, WRITE SOMETHING LIKE THIS:
- A. By increasing resource consumption through traditional operations
- B. By improving efficiency, transparency, and resource management through digital technologies
- C. By expanding manual processes across business operations
- D. By replacing digital systems with conventional business practices
- Every choice now carries the same amount of information and looks equally plausible.

DISTRACTOR QUALITY:
- Every distractor must come from the SAME subject area as the question. Importing a distractor from an unrelated field is the most common way this section fails, and it gives the item away even when the lengths match.
- For a question about customer insights in technopreneurship, the other three choices must be other real concepts from technopreneurship or customer research. Never "software source code architectures", "government patent approvals", "corporate accounting", or anything from a different subject.
- Incorrect choices must be plausible enough that a student who does not fully understand the material could reasonably consider them.
- Avoid obviously negative or extreme wording such as "By eliminating all technology", "By doing nothing", "By always increasing costs", "By completely removing users", or "By never using digital systems", unless the source material specifically supports those concepts.
- Distractors should represent realistic misunderstandings, related concepts, alternative approaches, or other concepts from the same topic.
- Every distractor must be clearly incorrect according to the material, and wrong for a defensible reason rather than obviously out of scope.
- Never use absurd or joke distractors. A distractor must be something a confused learner would genuinely write.
- Never make the correct answer the only positive-sounding option while the distractors read as obviously negative.
- Never use "All of the above", "None of the above", "Both A and B", or similar giveaways unless those exact choices already exist in an original quiz.

DISTRACTOR LENGTH RULE, THE ONE THAT MATTERS MOST:
- Before returning, count the words in all four choices. If the correct choice is more than about two words longer than the others, rewrite the distractors until the four match.
- Do not shorten a correct answer that is naturally wordy just to make it fit. Lengthen the distractors to meet it, or reword all four so they carry one idea each.
- A correct answer may be one or two words longer. It must never be the clear outlier.

DISTRACTOR DESIGN EXAMPLE:
- If the answer is "Demographic segmentation", the other choices should be "Behavioral segmentation", "Psychographic segmentation", and "Geographic segmentation": four real methods from the same topic, only one of which fits the scenario.

ANSWER CHOICE AUDIT, FOR EVERY QUESTION:
- Ask: "Could a student guess the correct answer without knowing the material, just by picking the longest or most detailed option?" The answer must be NO.
- Rewrite the choices, keeping the same correct concept, if any of these are true: the correct answer is the longest; it is the most technical; it is the only positive-sounding option; the incorrect choices use obviously negative wording; the correct answer is the only grammatically complete sentence; it carries more examples than every other choice; it is the only choice that directly repeats terminology from the question.
- The student must understand the material to pick the answer, not read the formatting of the choices.

ANSWER POSITION RULES:
- correctAnswer must be only "A", "B", "C", or "D".
- answerText must exactly match choices[correctAnswer].
- If you are generating new questions from study material, randomize correct answer positions.
- Use A, B, C, and D throughout the reviewer.
- Distribute correct answers as evenly as reasonably possible.
- Do not make one letter the correct answer most of the time.
- Do not create an obvious repeating pattern such as A, B, C, D, A, B, C, D.
- Shuffle choices after deciding the correct answer, then update correctAnswer and answerText.
- If the material is already an existing quiz, preserve original A/B/C/D positions.`
  },
  identification: {
    label: "identification",
    choicesPerQuestion: 0,
    allowNegativeStems: false,
    instructions: `IDENTIFICATION RULES:
- Ask direct questions where the user types the answer.
- correctAnswer must be "TEXT".
- answerText must be the exact expected answer text.
- choices must still be present for the schema, but set A, B, C, and D to empty strings.
- Keep answers short enough to type, usually a term, name, date, concept, or short phrase.
- The explanation must teach the concept rather than restate the expected answer.`
  },
  true_false: {
    label: "true/false",
    choicesPerQuestion: 2,
    allowNegativeStems: false,
    instructions: `TRUE/FALSE RULES:
- Every question must be a statement that is clearly true or false from the material.
- choices must be A: "True", B: "False", C: "", and D: "".
- correctAnswer must be only "A" or "B".
- answerText must exactly match choices[correctAnswer].
- Avoid trick wording unless the selected difficulty is hard.
- The explanation must teach the concept and give the reason the statement holds or fails, rather than restating it.`
  },
  flashcard: {
    label: "flashcard",
    choicesPerQuestion: 0,
    allowNegativeStems: false,
    instructions: `FLASHCARD RULES:
- Write each question as the front of a flashcard.
- answerText must be the back of the flashcard.
- correctAnswer must be "TEXT".
- choices must still be present for the schema, but set A, B, C, and D to empty strings.
- Prefer concise answers with the key fact, term, definition, or process.
- The explanation must add context, reasoning, purpose, or application on the back of the card rather than restating the front.`
  }
};

const reviewerSchema = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    subject: { type: "STRING" },
    coverage: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    questionCount: { type: "INTEGER" },
    questionType: { type: "STRING" },
    choicesPerQuestion: { type: "INTEGER" },
    instructions: { type: "STRING" },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "INTEGER" },
          type: { type: "STRING" },
          difficulty: { type: "STRING" },
          style: { type: "STRING" },
          topic: { type: "STRING" },
          question: { type: "STRING" },
          choices: {
            type: "OBJECT",
            properties: {
              A: { type: "STRING" },
              B: { type: "STRING" },
              C: { type: "STRING" },
              D: { type: "STRING" }
            },
            required: ["A", "B", "C", "D"]
          },
          correctAnswer: { type: "STRING" },
          answerText: { type: "STRING" },
          explanation: { type: "STRING" }
        },
        required: ["id", "type", "difficulty", "style", "topic", "question", "choices", "correctAnswer", "answerText", "explanation"]
      }
    }
  },
  required: ["title", "subject", "coverage", "questionCount", "questionType", "choicesPerQuestion", "instructions", "questions"]
};

const choiceRepairSchema = {
  type: "OBJECT",
  properties: {
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "INTEGER" },
          choices: {
            type: "OBJECT",
            properties: {
              A: { type: "STRING" },
              B: { type: "STRING" },
              C: { type: "STRING" },
              D: { type: "STRING" }
            },
            required: ["A", "B", "C", "D"]
          },
          correctAnswer: { type: "STRING" },
          answerText: { type: "STRING" },
          explanation: { type: "STRING" }
        },
        required: ["id", "choices", "correctAnswer", "answerText", "explanation"]
      }
    }
  },
  required: ["questions"]
};

// Repairs only the give-away items, so the prompt is a short work order instead
// of a second full generation. Rewriting in place is what makes this cheaper
// than the original call and what keeps every other question untouched.
function buildChoiceRepairPrompt(issues, sourceText) {
  const workOrder = issues.map((issue) => [
    `id ${issue.id}: ${issue.question}`,
    `- The current choices give it away because ${issue.reasons.join("; ")}.`,
    `- A: ${issue.choices.A}`,
    `- B: ${issue.choices.B}`,
    `- C: ${issue.choices.C}`,
    `- D: ${issue.choices.D}`,
    `- The correct answer is currently ${issue.correctAnswer}.`,
    `- The current explanation is: ${issue.explanation}`
  ].join("\n")).join("\n\n");

  return `The following multiple-choice questions were written so that the answer gives itself away by its shape. Rewrite just those questions.

${workOrder}

WHAT WENT WRONG:
- The correct choice is visibly longer, more detailed, or the only one carrying more than one idea, so a learner can pick it without knowing the subject.
- In these items the distractors are also drawn from unrelated subject areas, which makes them easy to rule out rather than hard to choose between.

REWRITE EACH QUESTION SO THAT:
- Keep the same concept as the correct answer. Do not change what the question is really asking, and do not change which answer is correct. Only the wording and the explanations get rewritten.
- Keep the same id, and return exactly the ${issues.length} question(s) listed above and nothing else.
- Match all four choices to each other on length, detail, and specificity. Count the words and aim for all four to land within about two words of each other.
- Keep all four choices in the same subject area as the question. A learner who half-understood the lesson must find all four plausible, so never import a distractor from an unrelated field.
- Never repeat the question's own wording inside the correct choice.
- No "All of the above", "None of the above", or "Both A and B".
- answerText must exactly equal choices[correctAnswer].
- Rewrite the explanation so it teaches the concept instead of restating the correct choice. A learner who has not read the choices should still learn something useful from it.

Study material for reference:
${(sourceText || "[The study material was not pasted as text.]").slice(0, 24000)}`;
}

function sendJson(response, statusCode, payload) {
  response.status(statusCode).json(payload);
}

function getRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getClientIpKey(request) {
  const forwardedFor = request.headers["x-forwarded-for"];
  const firstForwardedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0];
  return `ip:${firstForwardedIp?.trim() || request.socket?.remoteAddress || "unknown"}`;
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || request.headers.Authorization || "";
  const match = String(authorization).match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getRateLimitKey(request, requestId) {
  const token = getBearerToken(request);
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return getClientIpKey(request);
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    const { data, error } = await supabase.auth.getUser(token);

    if (!error && data?.user?.id) {
      return `user:${data.user.id}`;
    }
  } catch (error) {
    console.warn(`[${requestId}] Could not verify Supabase user for rate limit. Falling back to IP.`, error?.message || error);
  }

  return getClientIpKey(request);
}

function pruneRateLimitStore(now) {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(key);
    }
  }
}

function checkRateLimit(key) {
  const now = Date.now();
  const current = rateLimitStore.get(key);

  pruneRateLimitStore(now);

  if (!current || now - current.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetMs: RATE_LIMIT_WINDOW_MS };
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: RATE_LIMIT_WINDOW_MS - (now - current.windowStart)
    };
  }

  current.count += 1;
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - current.count,
    resetMs: RATE_LIMIT_WINDOW_MS - (now - current.windowStart)
  };
}

function getCandidateText(data) {
  return data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
}

async function fetchWithTimeout(url, options, timeoutMs, providerName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const seconds = timeoutMs >= 10000
        ? String(Math.round(timeoutMs / 1000))
        : (timeoutMs / 1000).toFixed(1).replace(/\.0$/, "");
      const timeoutError = new Error(`${providerName} did not respond within ${seconds}s. Trying the next AI provider.`);
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getQuestionCountInstruction(questionCount) {
  if (questionCount === "comprehensive") {
    return "Create enough questions to comprehensively cover the important material. Do not create repetitive filler questions.";
  }

  return `Create exactly ${questionCount} questions. Returning fewer than ${questionCount} questions is only acceptable when the source is an existing quiz with fewer readable questions. If the material is a handout, module, slide deck, PDF, or lecture file, generate the full ${questionCount} questions by covering different facts, concepts, examples, and applications from across the material.`;
}

function getDifficultyInstruction(difficulty) {
  return DIFFICULTY_INSTRUCTIONS[difficulty] || DIFFICULTY_INSTRUCTIONS.mixed;
}

function getQuestionTypeConfig(questionType) {
  return QUESTION_TYPE_INSTRUCTIONS[questionType] || QUESTION_TYPE_INSTRUCTIONS.multiple_choice;
}

// "Which among the following is NOT ...?" only has a home in a four-choice
// question, so true/false, identification, and flashcard reviewers never see
// these rules and cannot be pushed into an odd-one-out item they cannot support.
function getNegativeStemInstruction(questionType) {
  return getQuestionTypeConfig(questionType).allowNegativeStems ? NEGATIVE_STEM_INSTRUCTIONS : "";
}

// Kept beside the rules it audits so the two stay in step, and scoped the same
// way so a true/false or typed reviewer is never told to hunt for odd-one-out
// choices it cannot contain.
function getNegativeStemAudit(questionType, isCompletion = false) {
  if (!getQuestionTypeConfig(questionType).allowNegativeStems) return "";
  const duplicateGuard = isCompletion
    ? " Do not reuse a category an existing question already asks about."
    : "";
  return `- NEGATIVE-STEM AUDIT: for every question whose stem contains "NOT" or "least likely", confirm that exactly one choice fails the stem and the other three genuinely satisfy it, that those three are real members of one category named in the material rather than invented to balance the item, that the odd one out is a real concept from the same subject area, and that the explanation teaches why the three belong and why the odd one out does not. If any of that fails, rewrite the question as a positive stem instead.${duplicateGuard}`;
}

// The model reliably writes good questions but not reliably the number of hard
// ones asked for, so the prompt now carries an explicit per-position plan. A
// small seeded shuffle keeps the levels interleaved instead of a block of easy
// items followed by a block of hard ones, which makes the reviewer feel varied
// when it is read top to bottom.
function createSeededRandom(seed) {
  let state = (seed * 1103515245 + 12345) % 2147483648;
  return () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
}

function getDifficultyCounts(count) {
  const easy = Math.round(count * DIFFICULTY_MIX.easy);
  const hard = Math.round(count * DIFFICULTY_MIX.hard);
  return { easy, medium: Math.max(0, count - easy - hard), hard };
}

function buildQuestionPlan(count) {
  const total = Math.max(1, Math.min(150, Math.round(Number(count) || 0)));
  const { easy, medium, hard } = getDifficultyCounts(total);
  const scenario = Math.round(total * SCENARIO_MIX);
  const difficulties = shuffleWithRandom(
    [...Array(easy).fill("easy"), ...Array(medium).fill("medium"), ...Array(hard).fill("hard")],
    createSeededRandom(total)
  );
  const styles = shuffleWithRandom(
    [...Array(scenario).fill("scenario"), ...Array(total - scenario).fill("direct")],
    createSeededRandom(total + 7)
  );

  return difficulties.map((difficulty, index) => ({ position: index + 1, difficulty, style: styles[index] }));
}

function shuffleWithRandom(items, random) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function formatQuestionPlan(plan) {
  if (!plan?.length) return "";
  const lines = plan.map((entry) => `${entry.position}. difficulty "${entry.difficulty}" | style "${entry.style}"`);
  return `NUMBERING AND MIX PLAN (follow it exactly, one line per question, in order):
${lines.join("\n")}`;
}

function getQuestionPlanInstruction(count) {
  const target = Math.max(1, Math.min(150, Math.round(Number(count) || 0)));
  return `DIFFICULTY AND STYLE MIX:
- Roughly ${Math.round(DIFFICULTY_MIX.easy * 100)}% of the questions must be tagged "easy", ${Math.round(DIFFICULTY_MIX.medium * 100)}% "medium", and ${Math.round(DIFFICULTY_MIX.hard * 100)}% "hard", so a learner who filters to Hard still gets a full set.
- Roughly ${Math.round(SCENARIO_MIX * 100)}% of the questions must be tagged style "scenario" (application or situation based) and the rest style "direct" (definition, fact, terminology, comparison, process, number).
- The plan below is authoritative. Apply the difficulty and style listed for each question position instead of guessing, and keep the levels spread across the whole reviewer rather than clustered.`;
}

// Reviewers that predate the style tag, and hand-written ones, have nothing to
// read, so the scenario wording itself decides the bucket.
function resolveQuestionStyle(question) {
  const raw = String(question?.style || "").trim().toLowerCase();
  if (QUESTION_STYLES.includes(raw)) return raw;
  return inferQuestionStyle(question?.question);
}

function buildPrompt({ sourceText, title, subject, instructions, questionCount, difficulty, questionType, fileName }) {
  const questionCountInstruction = getQuestionCountInstruction(questionCount);
  const difficultyInstruction = getDifficultyInstruction(difficulty);
  const questionTypeConfig = getQuestionTypeConfig(questionType);
  const plan = buildQuestionPlan(questionCount);
  const planInstruction = getQuestionPlanInstruction(questionCount);
  const negativeStemInstruction = getNegativeStemInstruction(questionType);
  const negativeStemAudit = getNegativeStemAudit(questionType);

  return `Create a complete ${questionTypeConfig.label} reviewer from ONLY the study material below.

SOURCE RULES:
- Use the uploaded file and pasted study material as the only source of truth.
- Read the whole file before creating questions.
- Preserve terminology used in the material.
- Do not add facts from general knowledge.
- Do not use the internet.
- If something is not supported by the material, do not make it a question.
- Cover important material throughout the file, not only the first pages.
- Include definitions, examples, lists, comparisons, people, dates, frameworks, processes, stages, technologies, terminology, and important numbers when relevant.
- Avoid creating several questions that test the exact same fact.

IF THE MATERIAL IS ALREADY A QUIZ:
- Convert all readable multiple-choice questions into the JSON format.
- Preserve original question wording as closely as possible.
- Preserve original answer choices and A/B/C/D positions unless there is a clear formatting issue.
- If answers are visibly marked, record those answers.
- Do not invent unreadable or missing text.

IF THE MATERIAL IS A HANDOUT, MODULE, OR STUDY MATERIAL:
- Create a useful exam reviewer, not copied sentences.
- ${questionCountInstruction}
- Do not stop after a short sample. Produce the complete questions array requested by the selected question count whenever the material supports it.
- If the selected question count is a number, treat that number as the required final size of the questions array.
- Only create fewer questions when the source is truly too short or unreadable, and never invent facts.

${EXAM_STYLE_INSTRUCTIONS}

${negativeStemInstruction}

${planInstruction}
${formatQuestionPlan(plan)}

DIFFICULTY:
- ${difficultyInstruction}
- Set each question's difficulty to exactly the value listed for its position in the plan above.
- Set each question's style to exactly "scenario" or "direct" as listed for its position in the plan above.
- Never leave difficulty or style empty, and never use any value other than "easy", "medium", "hard", "scenario", or "direct".
- Keep every question fair and answerable from the study material.

QUESTION TYPE RULES:
- Set reviewer.questionType to "${questionType || "multiple_choice"}".
- Set each question.type to "${questionType || "multiple_choice"}".
${questionTypeConfig.instructions}

${EXPLANATION_INSTRUCTIONS}

JSON RULES:
- Return valid JSON only.
- Do not wrap the answer in markdown.
- Follow the exact schema requested by the API.
- reviewerId must be lowercase, URL-friendly, and use hyphens.
- questionCount must exactly equal questions.length.
- Question IDs must start at 1 and be sequential.
- coverage must list major topics covered by the material.
- topic must be useful for every question.

FINAL SELF-CHECK BEFORE RETURNING JSON:
- Valid JSON syntax.
- questionCount matches the number of questions.
- IDs are sequential with no duplicates.
- Every question includes difficulty ("easy", "medium", or "hard") and style ("scenario" or "direct") matching its position in the plan.
- Every question follows the selected question type rules.
- For multiple-choice and true/false questions, every answerText exactly equals choices[correctAnswer].
- For identification and flashcard questions, correctAnswer is "TEXT" and answerText is not empty.
- Every question has a topic and explanation.
- No obvious duplicate questions.
- For generated questions, correct-answer positions are reasonably balanced and not patterned.
- No question gives the answer away in its own wording.
- CHOICE AUDIT: for every multiple-choice question, ask whether a student could pick the correct answer without knowing the material, just by choosing the longest or most detailed option. The answer must be no. If the correct answer is the longest, the most technical, the only positive-sounding option, the only complete sentence, or the only one carrying more examples than the rest, rewrite the choices and keep the same correct concept.
${negativeStemAudit}
- EXPLANATION AUDIT: for every question, hide the correct choice and read the explanation on its own. If it no longer teaches anything useful about the concept, rewrite it. An explanation that only rearranges the answer choice's own words has failed.
- EXPLANATION SUPPORT: no explanation introduces a fact that the study material does not contain.

Reviewer details:
- Title: ${title || "Generated Reviewer"}
- Subject: ${subject || "Generated"}
- Instructions: ${instructions || "Select the best answer for each question."}
- Difficulty: ${difficulty || "mixed"}
- Question type: ${questionType || "multiple_choice"}
${fileName ? `- Uploaded file: ${fileName}` : ""}

Study material:
${sourceText || "[Use the uploaded file as the study material.]"}`;
}

function buildCompletionPrompt({ sourceText, title, subject, instructions, difficulty, questionType, requestedCount, missingCount, existingQuestions, fileName }) {
  const existingSummary = existingQuestions
    .map((question) => `${question.id}. ${question.topic}: ${question.question}`)
    .join("\n")
    .slice(0, 16000);
  const difficultyInstruction = getDifficultyInstruction(difficulty);
  const questionTypeConfig = getQuestionTypeConfig(questionType);
  const plan = buildQuestionPlan(missingCount);
  const planInstruction = getQuestionPlanInstruction(missingCount);
  const negativeStemInstruction = getNegativeStemInstruction(questionType);
  const completionNegativeStemAudit = getNegativeStemAudit(questionType, true);

  return `You are completing a ${questionTypeConfig.label} reviewer that came back with too few questions.

Create exactly ${missingCount} NEW additional ${questionTypeConfig.label} questions so the final reviewer reaches exactly ${requestedCount} questions.

SOURCE RULES:
- Use ONLY the same study material below and the uploaded file if present.
- Do not use the internet or outside knowledge.
- Cover parts of the material that are not already represented.
- Do not duplicate or rephrase the existing questions listed below.
- Every new question must be source-supported.

${EXAM_STYLE_INSTRUCTIONS}

${negativeStemInstruction}

${planInstruction}
${formatQuestionPlan(plan)}

DIFFICULTY:
- ${difficultyInstruction}
- Set each question's difficulty to exactly the value listed for its position in the plan above.
- Set each question's style to exactly "scenario" or "direct" as listed for its position in the plan above.
- Never leave difficulty or style empty, and never use any value other than "easy", "medium", "hard", "scenario", or "direct".
- Keep every question fair and answerable from the study material.

QUESTION TYPE RULES:
- Set reviewer.questionType to "${questionType || "multiple_choice"}".
- Set each question.type to "${questionType || "multiple_choice"}".
${questionTypeConfig.instructions}

${EXPLANATION_INSTRUCTIONS}

JSON RULES:
- Return a complete reviewer JSON object using the API schema.
- The returned questions array must contain exactly ${missingCount} new questions.
- Use question IDs starting at 1 inside this completion response.
- questionCount must equal ${missingCount}.
- For every multiple-choice question, run the answer choice audit and rewrite the choices if the correct answer is the longest, the most technical, the only positive-sounding option, or the only one carrying more examples than the rest.
${completionNegativeStemAudit}
- For every question, run the explanation audit. Hide the correct choice and read the explanation alone; if it teaches nothing beyond the answer's own wording, rewrite it.

Reviewer details:
- Title: ${title || "Generated Reviewer"}
- Subject: ${subject || "Generated"}
- Instructions: ${instructions || "Select the best answer for each question."}
- Difficulty: ${difficulty || "mixed"}
- Question type: ${questionType || "multiple_choice"}
${fileName ? `- Uploaded file: ${fileName}` : ""}

Existing questions to avoid:
${existingSummary || "[No existing questions listed.]"}

Study material:
${sourceText || "[Use the uploaded file as the study material.]"}`;
}

function getNumericTarget(questionCount) {
  if (questionCount === "comprehensive") return null;
  const count = Number(questionCount);
  if (!Number.isFinite(count)) return null;
  return Math.max(1, Math.min(150, Math.round(count)));
}

function normalizeGeneratedReviewer(reviewer, fallback = {}) {
  const questions = Array.isArray(reviewer?.questions) ? reviewer.questions : [];
  const reviewerQuestionType = QUESTION_TYPE_INSTRUCTIONS[reviewer?.questionType]
    ? reviewer.questionType
    : fallback.questionType || "multiple_choice";
  const questionTypeConfig = getQuestionTypeConfig(reviewerQuestionType);
  const normalizedQuestions = questions.map((question, index) => {
    const choices = question?.choices || {};
    const type = QUESTION_TYPE_INSTRUCTIONS[question?.type] ? question.type : reviewerQuestionType;
    const validAnswers = type === "true_false" ? ["A", "B"] : type === "multiple_choice" ? ["A", "B", "C", "D"] : ["TEXT"];
    const rawCorrectAnswer = String(question?.correctAnswer || (type === "identification" || type === "flashcard" ? "TEXT" : "A")).toUpperCase();
    const correctAnswer = validAnswers.includes(rawCorrectAnswer) ? rawCorrectAnswer : validAnswers[0];
    const normalizedChoices = type === "true_false"
      ? {
          A: String(choices.A || "True").trim(),
          B: String(choices.B || "False").trim(),
          C: "",
          D: ""
        }
      : {
          A: String(choices.A || "").trim(),
          B: String(choices.B || "").trim(),
          C: String(choices.C || "").trim(),
          D: String(choices.D || "").trim()
        };

    return {
      id: index + 1,
      type,
      difficulty: DIFFICULTY_LEVELS.includes(question?.difficulty) ? String(question.difficulty).trim() : "medium",
      style: resolveQuestionStyle(question),
      topic: String(question?.topic || fallback.subject || "Generated Reviewer").trim(),
      question: String(question?.question || "").trim(),
      choices: normalizedChoices,
      correctAnswer,
      answerText: String(question?.answerText || normalizedChoices[correctAnswer] || "").trim(),
      explanation: String(question?.explanation || "").trim()
    };
  });
  const coverage = Array.isArray(reviewer?.coverage) && reviewer.coverage.length
    ? reviewer.coverage
    : [...new Set(normalizedQuestions.map((question) => question.topic).filter(Boolean))];

  return {
    ...reviewer,
    title: reviewer?.title || fallback.title || "Generated Reviewer",
    subject: reviewer?.subject || fallback.subject || "Generated",
    coverage,
    questionCount: normalizedQuestions.length,
    questionType: reviewerQuestionType,
    choicesPerQuestion: questionTypeConfig.choicesPerQuestion,
    instructions: reviewer?.instructions || fallback.instructions || "Select the best answer for each question.",
    questions: normalizedQuestions
  };
}

function mergeReviewers(baseReviewer, additionalReviewer, requestedCount) {
  const mergedQuestions = [
    ...(baseReviewer.questions || []),
    ...(additionalReviewer.questions || [])
  ].slice(0, requestedCount).map((question, index) => ({
    ...question,
    id: index + 1
  }));
  const coverage = [...new Set([
    ...(baseReviewer.coverage || []),
    ...(additionalReviewer.coverage || []),
    ...mergedQuestions.map((question) => question.topic)
  ].filter(Boolean))];

  return {
    ...baseReviewer,
    coverage,
    questionCount: mergedQuestions.length,
    questions: mergedQuestions
  };
}

function getDifficultyMix(questions) {
  const mix = { easy: 0, medium: 0, hard: 0, scenario: 0, direct: 0 };

  (questions || []).forEach((question) => {
    const difficulty = DIFFICULTY_LEVELS.includes(question?.difficulty) ? question.difficulty : "medium";
    mix[difficulty] += 1;
    mix[resolveQuestionStyle(question)] += 1;
  });

  return mix;
}

// A reviewer that lands far off the planned mix is still usable, but the
// learner will hit an empty Hard filter later, so say so instead of failing.
function getDifficultyMixWarning(reviewer) {
  const total = reviewer?.questions?.length || 0;

  if (total < 10) return null;

  const mix = getDifficultyMix(reviewer.questions);
  const sparse = DIFFICULTY_LEVELS.filter((level) => mix[level] / total < DIFFICULTY_MIX[level] * 0.5);

  if (!sparse.length) return null;

  return `Difficulty mix came back thin (${sparse.map((level) => `${mix[level]} ${level}`).join(", ")} out of ${total}). Filtering to ${sparse.join(" or ")} in the reviewer will return fewer questions than expected.`;
}

// One repair call has to stay cheap, so only the worst offenders go back to the
// model. Anything past this is still reported to the learner as a warning.
const MAX_CHOICE_REPAIR_QUESTIONS = 12;

// A repair is only accepted if it actually fixed the item. The model sometimes
// returns choices that are still lopsided, or answers pointing at a blank, and
// keeping the original is always better than shipping a half-finished rewrite.
function applyChoiceRepairs(reviewer, rawRepair, issues) {
  const repairsById = new Map(
    (Array.isArray(rawRepair?.questions) ? rawRepair.questions : [])
      .filter((repair) => repair && Number.isFinite(Number(repair.id)))
      .map((repair) => [Number(repair.id), repair])
  );
  let repairedCount = 0;

  const questions = (reviewer?.questions || []).map((question) => {
    const repair = repairsById.get(Number(question?.id));
    if (!repair) return question;

    const choices = {
      A: String(repair?.choices?.A || "").trim(),
      B: String(repair?.choices?.B || "").trim(),
      C: String(repair?.choices?.C || "").trim(),
      D: String(repair?.choices?.D || "").trim()
    };
    if (CHOICE_LETTERS.some((letter) => !choices[letter])) return question;

    const correctAnswer = String(repair?.correctAnswer || "").trim().toUpperCase();
    if (!CHOICE_LETTERS.includes(correctAnswer)) return question;

    const candidate = {
      ...question,
      choices,
      correctAnswer,
      answerText: choices[correctAnswer],
      explanation: String(repair?.explanation || question.explanation || "").trim()
    };

    if (getChoiceBalanceIssue(candidate)) return question;

    repairedCount += 1;
    return candidate;
  });

  return { reviewer: { ...reviewer, questions }, repairedCount, attemptedCount: issues.length };
}

// Prompt rules for balanced choices demonstrably leak, so the finished reviewer
// is measured instead and only the give-away items are sent back for a rewrite.
// Best effort by design: a reviewer with one long distractor beats a failed
// request, so any error here returns the reviewer untouched.
async function rebalanceReviewerChoices({ reviewer, sourceText, requestId }) {
  const issues = findChoiceBalanceIssues(reviewer?.questions);
  if (!issues.length) return { reviewer, repairedCount: 0, unresolvedCount: 0 };

  const repairable = issues.slice(0, MAX_CHOICE_REPAIR_QUESTIONS);

  try {
    const { reviewer: rawRepair } = await requestReviewerWithFallback({
      parts: [{ text: buildChoiceRepairPrompt(repairable, sourceText) }],
      hasReadableMaterial: true,
      requestId
    });
    const result = applyChoiceRepairs(reviewer, rawRepair, repairable);

    if (result.repairedCount) {
      console.warn(`[${requestId}] Rewrote ${result.repairedCount} of ${issues.length} give-away choices.`);
    }

    return {
      reviewer: result.reviewer,
      repairedCount: result.repairedCount,
      unresolvedCount: issues.length - result.repairedCount
    };
  } catch (error) {
    console.warn(`[${requestId}] Could not rebalance give-away choices: ${error?.message || "Unknown error"}`);
    return { reviewer, repairedCount: 0, unresolvedCount: issues.length };
  }
}

// A give-away choice that survived the repair pass is still a flaw in the
// reviewer, so say how many rather than shipping it silently.
function getChoiceBalanceWarning(repairedCount, unresolvedCount) {
  if (!unresolvedCount) return null;

  const repaired = repairedCount
    ? `${repairedCount} give-away ${repairedCount === 1 ? "question was" : "questions were"} rewritten, `
    : "";

  return `${repaired}but ${unresolvedCount} still ${unresolvedCount === 1 ? "has" : "have"} an answer that stands out by its length or detail. Regenerate if that bothers you.`;
}

async function requestReviewerFromGemini({ apiKey, model, parts, timeoutMs, schema }) {
  const geminiResponse = await fetchWithTimeout(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts
        }
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 32768,
        response_mime_type: "application/json",
        response_schema: schema || reviewerSchema
      }
    })
  }, timeoutMs, "Gemini");

  const data = await geminiResponse.json();

  if (!geminiResponse.ok) {
    const message = data?.error?.message || "Gemini could not generate a reviewer.";
    const error = new Error(message);
    error.statusCode = geminiResponse.status;
    throw error;
  }

  const text = getCandidateText(data);
  if (!text) {
    const error = new Error("Gemini returned an empty response.");
    error.statusCode = 502;
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("Gemini returned invalid JSON.");
    error.statusCode = 502;
    error.rawText = text;
    throw error;
  }
}

function getProviderModel(provider) {
  return process.env[provider.modelEnv] || provider.defaultModel;
}

function getProviderTimeoutMs(provider) {
  const override = Number(process.env.AI_PROVIDER_TIMEOUT_MS);
  if (Number.isFinite(override) && override > 0) return override;
  return provider.timeoutMs || DEFAULT_PROVIDER_TIMEOUT_MS;
}

function hasConfiguredProvider() {
  return AI_PROVIDERS.some((provider) => Boolean(process.env[provider.apiKeyEnv]));
}

function getConfiguredProviders({ hasFileData = false, hasReadableMaterial = true } = {}) {
  // Vision-only models are slower and usually weaker at strict JSON, so they are
  // held back until a text provider has been tried. They are only reachable when
  // the request actually depends on reading an attached file.
  const needsVision = hasFileData && !hasReadableMaterial;

  return AI_PROVIDERS.filter((provider) => {
    if (!process.env[provider.apiKeyEnv]) return false;
    if (provider.visionOnly && !needsVision) return false;
    return true;
  });
}

function getAttachedFileMimeType(parts) {
  for (const part of parts || []) {
    if (part?.inline_data?.mime_type) return String(part.inline_data.mime_type);
  }
  return "";
}

function describeFileType(mimeType) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.includes("pdf")) return "PDF";
  if (mimeType.startsWith("text/")) return "text file";
  return "file";
}

function extractJsonFromText(text) {
  const trimmed = String(text).trim();
  let candidate = trimmed;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/i);
  if (fenced) candidate = fenced[1].trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(candidate);
}

async function requestReviewerFromOpenAi({ provider, apiKey, model, parts, hasReadableMaterial, timeoutMs }) {
  const content = [];

  for (const part of parts || []) {
    if (part?.text) {
      content.push({ type: "text", text: part.text });
      continue;
    }

    if (part?.inline_data) {
      const mimeType = String(part.inline_data.mime_type || "");
      if (provider.supportsVision && mimeType.startsWith("image/")) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${part.inline_data.data}` }
        });
      } else if (!hasReadableMaterial) {
        const error = new Error(
          `${provider.name} cannot read the uploaded file and there is no pasted text to fall back on. Paste the study material as text or try again when the primary AI is available.`
        );
        error.statusCode = 422;
        error.isUnreadableFile = true;
        throw error;
      } else {
        content.push({
          type: "text",
          text: `[The source also includes an attached file (${mimeType || "file"}) that could not be sent to this provider directly. Generate only from the study material and notes already provided.]`
        });
      }
    }
  }

  const body = {
    model,
    messages: [
      {
        role: "system",
        content: "You are a strict JSON generator. Respond with exactly one JSON object that follows the requested schema. Do not include markdown fences, prose, or any text outside the JSON object."
      },
      { role: "user", content }
    ],
    temperature: 0.35,
    max_tokens: provider.maxTokens || 8192
  };
  if (provider.supportsJsonMode) {
    body.response_format = { type: "json_object" };
  }

  let aiResponse;
  try {
    aiResponse = await fetchWithTimeout(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    }, timeoutMs, provider.name);
  } catch (error) {
    if (error?.statusCode) throw error;
    const wrapped = new Error(`${provider.name} request failed: ${error?.message || "network error"}`);
    wrapped.statusCode = 502;
    throw wrapped;
  }

  const data = await aiResponse.json().catch(() => ({}));

  if (!aiResponse.ok) {
    const message = data?.error?.message || `${provider.name} could not generate a reviewer.`;
    const error = new Error(message);
    error.statusCode = aiResponse.status;
    throw error;
  }

  const text = data?.choices?.[0]?.message?.content || "";
  if (!String(text).trim()) {
    const error = new Error(`${provider.name} returned an empty response.`);
    error.statusCode = 502;
    throw error;
  }

  try {
    return extractJsonFromText(text);
  } catch {
    const error = new Error(`${provider.name} returned invalid JSON.`);
    error.statusCode = 502;
    error.rawText = text;
    throw error;
  }
}

async function requestReviewerWithFallback({ parts, hasReadableMaterial, requestId, hasFileData = false, schema }) {
  const providers = getConfiguredProviders({ hasFileData, hasReadableMaterial });

  if (!providers.length) {
    const error = new Error("No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.");
    error.statusCode = 500;
    error.isNonRetryable = true;
    throw error;
  }

  const attempts = [];
  const attachedFileMimeType = getAttachedFileMimeType(parts);
  const dependsOnFile = hasFileData && !hasReadableMaterial;

  for (const [index, provider] of providers.entries()) {
    const timeoutMs = getProviderTimeoutMs(provider);

    try {
      const apiKey = process.env[provider.apiKeyEnv];
      const model = getProviderModel(provider);
      const reviewer = provider.kind === "gemini"
        ? await requestReviewerFromGemini({ apiKey, model, parts, timeoutMs, schema })
        : await requestReviewerFromOpenAi({ provider, apiKey, model, parts, hasReadableMaterial, timeoutMs });

      if (attempts.length) {
        console.warn(`[${requestId}] Recovered with ${provider.name} after ${attempts.length} earlier failure(s).`);
      }
      return { reviewer, provider: provider.name };
    } catch (error) {
      attempts.push({ provider: provider.name, error });
      console.warn(`[${requestId}] ${provider.name} failed (${error?.statusCode || "unknown"}): ${error?.message || "Unknown error"}`);

      if (error?.isUnreadableFile) {
        // Only give up once no remaining provider is able to read the attachment.
        const rescuable = dependsOnFile
          && attachedFileMimeType?.startsWith("image/")
          && providers.slice(index + 1).some((next) => next.supportsVision);

        if (!rescuable) {
          const finalError = new Error(
            dependsOnFile
              ? `The AI providers that can read this ${describeFileType(attachedFileMimeType)} are unavailable, and the file has no readable text to fall back on. Paste the study material as text to keep going.`
              : error.message
          );
          finalError.statusCode = 422;
          finalError.providerAttempts = attempts;
          throw finalError;
        }
      }

      if (error?.isNonRetryable) {
        error.providerAttempts = attempts;
        throw error;
      }
    }
  }

  // Report the primary provider's failure, which is the most representative, and
  // carry the full attempt list so the server log shows where the chain stopped.
  const primaryError = attempts[0]?.error;
  const error = primaryError || new Error("Every AI provider failed to generate a reviewer.");
  error.providerAttempts = attempts;
  throw error;
}

export default async function handler(request, response) {
  const requestId = getRequestId();
  response.setHeader("X-Request-Id", requestId);

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return sendJson(response, 405, { error: "Method not allowed." });
  }

  const rateLimitKey = await getRateLimitKey(request, requestId);
  const rateLimit = checkRateLimit(rateLimitKey);
  response.setHeader("X-RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
  response.setHeader("X-RateLimit-Remaining", String(rateLimit.remaining));
  response.setHeader("X-RateLimit-Reset", String(Math.ceil(rateLimit.resetMs / 1000)));
  response.setHeader("X-RateLimit-Scope", rateLimitKey.startsWith("user:") ? "user" : "ip");

  if (!rateLimit.allowed) {
    response.setHeader("Retry-After", String(Math.ceil(rateLimit.resetMs / 1000)));
    return sendJson(response, 429, {
      error: `Too many AI requests. Try again in ${Math.ceil(rateLimit.resetMs / 60000)} minute${rateLimit.resetMs > 60000 ? "s" : ""}.`,
      requestId
    });
  }

  if (!hasConfiguredProvider()) {
    console.error(`[${requestId}] No AI provider is configured.`);
    return sendJson(response, 500, { error: "No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.", requestId });
  }

  const approximateBodyLength = JSON.stringify(request.body || {}).length;
  if (approximateBodyLength > MAX_REQUEST_BODY_LENGTH) {
    return sendJson(response, 413, {
      error: "That request is too large for AI generation. Use a smaller file, extract text, or paste the most important notes.",
      requestId
    });
  }

  const {
    sourceText = "",
    file = null,
    title = "",
    subject = "",
    instructions = "Select the best answer for each question.",
    questionCount = 50,
    difficulty = "mixed",
    questionType = "multiple_choice",
    mode = "generate",
    existingReviewer = null,
    additionalCount = 20
  } = request.body || {};

  const trimmedSourceText = String(sourceText).trim();
  const hasFileData = Boolean(file?.data && file?.mimeType);
  const normalizedMode = mode === "extend" ? "extend" : "generate";
  const safeDifficulty = DIFFICULTY_INSTRUCTIONS[difficulty] ? difficulty : "mixed";
  const safeQuestionType = QUESTION_TYPE_INSTRUCTIONS[questionType] ? questionType : "multiple_choice";
  const existingQuestions = Array.isArray(existingReviewer?.questions) ? existingReviewer.questions : [];

  if (!hasFileData && trimmedSourceText.length < 100 && !existingQuestions.length) {
    return sendJson(response, 400, { error: "Add more study material before generating a reviewer.", requestId });
  }

  if (hasFileData && String(file.data).length > MAX_FILE_BASE64_LENGTH) {
    return sendJson(response, 413, { error: "That file is too large to send to the AI after browser encoding. Compress or split the PDF, or paste the important notes.", requestId });
  }

  const safeSourceText = trimmedSourceText.slice(0, MAX_SOURCE_LENGTH);
  const parsedAdditionalCount = Math.max(1, Math.min(75, Number(additionalCount) || 20));
  const parsedQuestionCount = questionCount === "comprehensive"
    ? "comprehensive"
    : Math.max(1, Math.min(150, Number(questionCount) || 50));

  if (normalizedMode === "extend") {
    if (!existingQuestions.length) {
      return sendJson(response, 400, { error: "Choose a generated reviewer before making more questions.", requestId });
    }

    const baseReviewer = normalizeGeneratedReviewer(existingReviewer, {
      title: String(title).trim(),
      subject: String(subject).trim(),
      instructions: String(instructions).trim(),
      questionType: existingReviewer.questionType || safeQuestionType
    });
    const extensionQuestionType = QUESTION_TYPE_INSTRUCTIONS[baseReviewer.questionType] ? baseReviewer.questionType : safeQuestionType;
    const requestedCount = Math.min(150, baseReviewer.questions.length + parsedAdditionalCount);
    const prompt = buildCompletionPrompt({
      sourceText: safeSourceText || JSON.stringify(baseReviewer.questions),
      title: baseReviewer.title,
      subject: baseReviewer.subject,
      instructions: baseReviewer.instructions,
      difficulty: safeDifficulty,
      questionType: extensionQuestionType,
      requestedCount,
      missingCount: requestedCount - baseReviewer.questions.length,
      existingQuestions: baseReviewer.questions,
      fileName: file?.name ? String(file.name).trim() : ""
    });
    const parts = [{ text: prompt }];

    if (hasFileData) {
      parts.push({
        inline_data: {
          mime_type: String(file.mimeType),
          data: String(file.data)
        }
      });
    }

    try {
      const { reviewer: rawAdditionalReviewer, provider: servedProvider } = await requestReviewerWithFallback({
        parts,
        hasReadableMaterial: true,
        hasFileData,
        requestId
      });
      const additionalReviewer = normalizeGeneratedReviewer(rawAdditionalReviewer, {
        title: baseReviewer.title,
        subject: baseReviewer.subject,
        instructions: baseReviewer.instructions,
        questionType: extensionQuestionType
      });
const reviewer = {
        ...mergeReviewers(baseReviewer, additionalReviewer, requestedCount),
        reviewerId: existingReviewer.reviewerId || baseReviewer.reviewerId
      };
      const { reviewer: rebalancedReviewer, repairedCount, unresolvedCount } = await rebalanceReviewerChoices({
        reviewer,
        sourceText: safeSourceText,
        requestId
      });

      return sendJson(response, 200, {
        reviewer: rebalancedReviewer,
        provider: servedProvider,
        requestedQuestionCount: requestedCount,
        generatedQuestionCount: rebalancedReviewer.questions.length,
        addedQuestionCount: Math.max(0, rebalancedReviewer.questions.length - baseReviewer.questions.length),
        difficultyMix: getDifficultyMix(rebalancedReviewer.questions),
        warning: [
          reviewer.questions.length < requestedCount
            ? `${servedProvider} added ${Math.max(0, reviewer.questions.length - baseReviewer.questions.length)} of ${requestedCount - reviewer.questions.length} requested new questions.`
            : null,
          getDifficultyMixWarning(rebalancedReviewer),
          getChoiceBalanceWarning(repairedCount, unresolvedCount)
        ].filter(Boolean).join(" ") || null
      });
    } catch (error) {
      console.error(`[${requestId}] Reviewer extension failed:`, {
        statusCode: error?.statusCode || 500,
        message: error?.message || "Unknown error",
        providerAttempts: (error?.providerAttempts || []).map((attempt) => `${attempt.provider}: ${attempt.error?.message}`)
      });
      return sendJson(response, error?.statusCode || 500, {
        error: error?.message || "Could not reach any AI provider.",
        requestId,
        rawText: error?.rawText
      });
    }
  }

  const prompt = buildPrompt({
    sourceText: safeSourceText,
    title: String(title).trim(),
    subject: String(subject).trim(),
    instructions: String(instructions).trim(),
    questionCount: parsedQuestionCount,
    difficulty: safeDifficulty,
    questionType: safeQuestionType,
    fileName: file?.name ? String(file.name).trim() : ""
  });
  const parts = [{ text: prompt }];

  if (hasFileData) {
    parts.push({
      inline_data: {
        mime_type: String(file.mimeType),
        data: String(file.data)
      }
    });
  }

  const hasReadableMaterial = trimmedSourceText.length > 0;

  try {
    const firstAttempt = await requestReviewerWithFallback({
      parts,
      hasReadableMaterial,
      hasFileData,
      requestId
    });
    let servedProvider = firstAttempt.provider;
    let reviewer = normalizeGeneratedReviewer(firstAttempt.reviewer, {
      title: String(title).trim(),
      subject: String(subject).trim(),
      instructions: String(instructions).trim()
    });

    const requestedCount = getNumericTarget(parsedQuestionCount);
    let completionAttempts = 0;

    while (requestedCount && reviewer.questions.length < requestedCount && completionAttempts < MAX_COMPLETION_ATTEMPTS) {
      completionAttempts += 1;
      const missingCount = requestedCount - reviewer.questions.length;
      const completionPrompt = buildCompletionPrompt({
        sourceText: safeSourceText,
        title: reviewer.title,
        subject: reviewer.subject,
        instructions: reviewer.instructions,
        difficulty: safeDifficulty,
        questionType: safeQuestionType,
        requestedCount,
        missingCount,
        existingQuestions: reviewer.questions,
        fileName: file?.name ? String(file.name).trim() : ""
      });
      const completionParts = [{ text: completionPrompt }];

      if (hasFileData) {
        completionParts.push({
          inline_data: {
            mime_type: String(file.mimeType),
            data: String(file.data)
          }
        });
      }

      // Topping up is a bonus. If the completion call fails, keep the reviewer we
      // already have rather than failing the whole request over a short result.
      let completionAttempt;

      try {
        completionAttempt = await requestReviewerWithFallback({
          parts: completionParts,
          hasReadableMaterial,
          hasFileData,
          requestId
        });
      } catch (error) {
        console.warn(`[${requestId}] Could not top up to ${requestedCount} questions: ${error?.message || "Unknown error"}`);
        break;
      }

      servedProvider = completionAttempt.provider;
      const additionalReviewer = normalizeGeneratedReviewer(completionAttempt.reviewer, {
        title: reviewer.title,
        subject: reviewer.subject,
        instructions: reviewer.instructions
      });

      if (!additionalReviewer.questions.length) break;
      reviewer = mergeReviewers(reviewer, additionalReviewer, requestedCount);
    }

    const { reviewer: rebalancedReviewer, repairedCount, unresolvedCount } = await rebalanceReviewerChoices({
      reviewer,
      sourceText: safeSourceText,
      requestId
    });

    const warning = [
      requestedCount && reviewer.questions.length < requestedCount
        ? `${servedProvider} generated ${reviewer.questions.length} of ${requestedCount} requested questions after ${completionAttempts + 1} attempt${completionAttempts === 0 ? "" : "s"}. The source may be too short, unclear, or the model may have stopped early.`
        : null,
      getDifficultyMixWarning(rebalancedReviewer),
      getChoiceBalanceWarning(repairedCount, unresolvedCount)
    ].filter(Boolean).join(" ") || null;

    return sendJson(response, 200, {
      reviewer: rebalancedReviewer,
      provider: servedProvider,
      requestedQuestionCount: requestedCount || "comprehensive",
      generatedQuestionCount: rebalancedReviewer.questions.length,
      difficultyMix: getDifficultyMix(rebalancedReviewer.questions),
      warning
    });
  } catch (error) {
    console.error(`[${requestId}] Reviewer generation failed:`, {
      statusCode: error?.statusCode || 500,
      message: error?.message || "Unknown error",
      providerAttempts: (error?.providerAttempts || []).map((attempt) => `${attempt.provider}: ${attempt.error?.message}`)
    });
    return sendJson(response, error?.statusCode || 500, {
      error: error?.message || "Could not reach any AI provider.",
      requestId,
      rawText: error?.rawText
    });
  }
}
