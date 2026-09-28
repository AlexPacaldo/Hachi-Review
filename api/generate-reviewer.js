import { createClient } from "@supabase/supabase-js";

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
    maxTokens: 8192
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
    maxTokens: 16384
  }
];
const MAX_SOURCE_LENGTH = 45000;
const MAX_FILE_BASE64_LENGTH = 4200000;
const MAX_COMPLETION_ATTEMPTS = 3;
const MAX_REQUEST_BODY_LENGTH = 5200000;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const rateLimitStore = globalThis.__hachiRateLimitStore || new Map();
globalThis.__hachiRateLimitStore = rateLimitStore;
const DIFFICULTY_INSTRUCTIONS = {
  easy: "Favor direct recall, simple definitions, and straightforward concept checks.",
  mixed: "Use a balanced mix of recall, concept, scenario, and application questions.",
  hard: "Favor deeper application, scenario analysis, tricky-but-fair distinctions, and synthesis across related ideas."
};
const QUESTION_TYPE_INSTRUCTIONS = {
  multiple_choice: {
    label: "multiple-choice",
    choicesPerQuestion: 4,
    instructions: `MULTIPLE-CHOICE RULES:
- Every question must have exactly 4 choices: A, B, C, and D.
- Every question must have exactly one correct answer.
- Wrong answers must be believable, related to the same topic, and clearly incorrect according to the material.
- Do not use "All of the above", "None of the above", or "Both A and B" unless those exact choices already exist in an original quiz.
- correctAnswer must be only "A", "B", "C", or "D".
- answerText must exactly match choices[correctAnswer].
- Include a short, source-supported explanation for every question.

ANSWER POSITION RULES:
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
    instructions: `IDENTIFICATION RULES:
- Ask direct questions where the user types the answer.
- correctAnswer must be "TEXT".
- answerText must be the exact expected answer text.
- choices must still be present for the schema, but set A, B, C, and D to empty strings.
- Keep answers short enough to type, usually a term, name, date, concept, or short phrase.
- Include a short, source-supported explanation for every question.`
  },
  true_false: {
    label: "true/false",
    choicesPerQuestion: 2,
    instructions: `TRUE/FALSE RULES:
- Every question must be a statement that is clearly true or false from the material.
- choices must be A: "True", B: "False", C: "", and D: "".
- correctAnswer must be only "A" or "B".
- answerText must exactly match choices[correctAnswer].
- Avoid trick wording unless the selected difficulty is hard.
- Include a short, source-supported explanation for every question.`
  },
  flashcard: {
    label: "flashcard",
    choicesPerQuestion: 0,
    instructions: `FLASHCARD RULES:
- Write each question as the front of a flashcard.
- answerText must be the back of the flashcard.
- correctAnswer must be "TEXT".
- choices must still be present for the schema, but set A, B, C, and D to empty strings.
- Prefer concise answers with the key fact, term, definition, or process.
- Include a short source-supported explanation that reinforces the answer.`
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
        required: ["id", "type", "difficulty", "topic", "question", "choices", "correctAnswer", "answerText", "explanation"]
      }
    }
  },
  required: ["title", "subject", "coverage", "questionCount", "questionType", "choicesPerQuestion", "instructions", "questions"]
};

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

function buildPrompt({ sourceText, title, subject, instructions, questionCount, difficulty, questionType, fileName }) {
  const questionCountInstruction = getQuestionCountInstruction(questionCount);
  const difficultyInstruction = getDifficultyInstruction(difficulty);
  const questionTypeConfig = getQuestionTypeConfig(questionType);

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
- Include a mixture of definitions, concepts, comparisons, scenarios, applications, processes, stages, examples, frameworks, important numbers, people, dates, technologies, and terminology.
- ${questionCountInstruction}
- Do not stop after a short sample. Produce the complete questions array requested by the selected question count whenever the material supports it.
- If the selected question count is a number, treat that number as the required final size of the questions array.
- Only create fewer questions when the source is truly too short or unreadable, and never invent facts.

DIFFICULTY:
- ${difficultyInstruction}
- Tag every question with a difficulty value from exactly "easy", "medium", or "hard".
- For a mixed reviewer, aim for roughly 50% easy, 30% medium, and 20% hard questions spread across the whole reviewer.
- Keep every question fair and answerable from the study material.

QUESTION TYPE RULES:
- Set reviewer.questionType to "${questionType || "multiple_choice"}".
- Set each question.type to "${questionType || "multiple_choice"}".
${questionTypeConfig.instructions}

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
- Every question includes a valid difficulty value ("easy", "medium", or "hard").
- Every question follows the selected question type rules.
- For multiple-choice and true/false questions, every answerText exactly equals choices[correctAnswer].
- For identification and flashcard questions, correctAnswer is "TEXT" and answerText is not empty.
- Every question has a topic and explanation.
- No obvious duplicate questions.
- For generated questions, correct-answer positions are reasonably balanced and not patterned.

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

  return `You are completing a ${questionTypeConfig.label} reviewer that came back with too few questions.

Create exactly ${missingCount} NEW additional ${questionTypeConfig.label} questions so the final reviewer reaches exactly ${requestedCount} questions.

SOURCE RULES:
- Use ONLY the same study material below and the uploaded file if present.
- Do not use the internet or outside knowledge.
- Cover parts of the material that are not already represented.
- Do not duplicate or rephrase the existing questions listed below.
- Every new question must be source-supported.

DIFFICULTY:
- ${difficultyInstruction}
- Tag every question with a difficulty value from exactly "easy", "medium", or "hard".
- For a mixed reviewer, aim for roughly 50% easy, 30% medium, and 20% hard questions spread across the whole reviewer.
- Keep every question fair and answerable from the study material.

QUESTION TYPE RULES:
- Set reviewer.questionType to "${questionType || "multiple_choice"}".
- Set each question.type to "${questionType || "multiple_choice"}".
${questionTypeConfig.instructions}

JSON RULES:
- Return a complete reviewer JSON object using the API schema.
- The returned questions array must contain exactly ${missingCount} new questions.
- Use question IDs starting at 1 inside this completion response.
- questionCount must equal ${missingCount}.

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
      difficulty: ["easy", "medium", "hard"].includes(question?.difficulty) ? String(question.difficulty).trim() : "medium",
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

async function requestReviewerFromGemini({ apiKey, model, parts }) {
  const geminiResponse = await fetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
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
        response_schema: reviewerSchema
      }
    })
  });

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

  function getProviderModel(provider) {
    return process.env[provider.modelEnv] || provider.defaultModel;
  }

  function getConfiguredProviders() {
    return AI_PROVIDERS.filter((provider) => Boolean(process.env[provider.apiKeyEnv]));
  }

  function extractTextFromBase64(data) {
    try {
      const decoded = String(data).replace(/[^ -~]/g, "");
      return decoded.length > 8000 ? decoded.substring(0, 8000) : decoded;
    } catch (error) {
      throw new Error("Failed to decode base64 text");
    }
  }

  async function requestReviewerWithFallback({ parts, hasReadableMaterial, requestId }) {

function getProviderModel(provider) {
  return process.env[provider.modelEnv] || provider.defaultModel;
}

function getConfiguredProviders() {
  return AI_PROVIDERS.filter((provider) => Boolean(process.env[provider.apiKeyEnv]));
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

async function requestReviewerFromOpenAi({ provider, apiKey, model, parts, hasReadableMaterial }) {
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
    aiResponse = await fetch(provider.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
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

async function requestReviewerWithFallback({ parts, hasReadableMaterial, requestId }) {
  const providers = getConfiguredProviders();

  if (!providers.length) {
    const error = new Error("No AI provider is configured. Add GEMINI_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY.");
    error.statusCode = 500;
    throw error;
  }

  let lastError = null;

  for (const provider of providers) {
    try {
      const apiKey = process.env[provider.apiKeyEnv];
      const model = getProviderModel(provider);
      const reviewer = provider.kind === "gemini"
        ? await requestReviewerFromGemini({ apiKey, model, parts })
        : await requestReviewerFromOpenAi({ provider, apiKey, model, parts, hasReadableMaterial });

      return { reviewer, provider: provider.name };
    } catch (error) {
      lastError = error;
      console.warn(`[${requestId}] ${provider.name} failed (${error?.statusCode || "unknown"}): ${error?.message || "Unknown error"}`);
    }
  }

  throw lastError;
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

  if (!getConfiguredProviders().length) {
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

      return sendJson(response, 200, {
        reviewer,
        provider: servedProvider,
        requestedQuestionCount: requestedCount,
        generatedQuestionCount: reviewer.questions.length,
        addedQuestionCount: Math.max(0, reviewer.questions.length - baseReviewer.questions.length),
        warning: reviewer.questions.length < requestedCount
          ? `${servedProvider} added ${Math.max(0, reviewer.questions.length - baseReviewer.questions.length)} of ${requestedCount - baseReviewer.questions.length} requested new questions.`
          : null
      });
    } catch (error) {
      console.error(`[${requestId}] Gemini extension failed:`, {
        statusCode: error?.statusCode || 500,
        message: error?.message || "Unknown error"
      });
      return sendJson(response, error?.statusCode || 500, {
        error: error?.message || "Could not reach Gemini.",
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

  try {
    const firstAttempt = await requestReviewerWithFallback({
      parts,
      hasReadableMaterial: trimmedSourceText.length > 0,
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

      const completionAttempt = await requestReviewerWithFallback({
        parts: completionParts,
        hasReadableMaterial: trimmedSourceText.length > 0,
        requestId
      });
      servedProvider = completionAttempt.provider;
      const additionalReviewer = normalizeGeneratedReviewer(completionAttempt.reviewer, {
        title: reviewer.title,
        subject: reviewer.subject,
        instructions: reviewer.instructions
      });

      if (!additionalReviewer.questions.length) break;
      reviewer = mergeReviewers(reviewer, additionalReviewer, requestedCount);
    }

    const warning = requestedCount && reviewer.questions.length < requestedCount
      ? `${servedProvider} generated ${reviewer.questions.length} of ${requestedCount} requested questions after ${completionAttempts + 1} attempt${completionAttempts === 0 ? "" : "s"}. The source may be too short, unclear, or the model may have stopped early.`
      : null;

    return sendJson(response, 200, {
      reviewer,
      provider: servedProvider,
      requestedQuestionCount: requestedCount || "comprehensive",
      generatedQuestionCount: reviewer.questions.length,
      warning
    });
  } catch (error) {
    console.error(`[${requestId}] Gemini generation failed:`, {
      statusCode: error?.statusCode || 500,
      message: error?.message || "Unknown error"
    });
    return sendJson(response, error?.statusCode || 500, {
      error: error?.message || "Could not reach Gemini.",
      requestId,
      rawText: error?.rawText
    });
  }
}
