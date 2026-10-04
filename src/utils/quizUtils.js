export function shuffleItems(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

export function normalizeChoices(choices) {
  return Object.entries(choices || {})
    .filter(([, label]) => String(label || "").trim())
    .map(([value, label]) => ({ value, label }));
}

export function getChoiceLetter(index) {
  return String.fromCharCode(65 + index);
}

export function getQuestionType(question) {
  return question?.type || question?.questionType || "multiple_choice";
}

export function getQuestionDifficulty(question) {
  return ["easy", "medium", "hard"].includes(question?.difficulty) ? question.difficulty : "medium";
}

// "Which among the following is NOT ...?" is the odd-one-out form that roughly a
// quarter of a real preliminary examination uses. It looks like plain recall
// because it opens with "Which of the following", but it still asks the learner
// to discriminate between close concepts, so it belongs in the exam-style pool
// and survives the Direct Questions Only filter out. Checked before the recall
// patterns below so a stem like "Which of the following is NOT true?" is never
// filed as a definition question. The [^?]* guard keeps the negation inside one
// question, in case a caller passes a stem that carries its answer text too.
const NEGATIVE_STEM_PATTERN = /^(?:which|what)\b[^?]*\b(?:not|never|except|least likely|cannot)\b/i;

// Reviewers created before the generator tagged question style, and hand-built
// ones, carry no style field. Their wording still says which kind of question it
// is, so the exam-style filter works on them without a regeneration. The API
// route imports this same helper, so both sides always agree on a question's
// style when the tag is missing.
const RECALL_QUESTION_PATTERN = /^(what\s+(is|are|was|were)\b|(which\s+(term|concept|type|kind|method|tool|step|stage|phase|principle|framework|model|standard|formula|value)\s+(is|are)\b)|(the\s+(correct answer|answer|term|definition|formula|value)\b)|(in\s+(the|this)\s+(material|lesson|module|chapter|text|handout)\b)|(define|name|state|list|identify|mention|enumerate)\b)/i;
// Deliberately has no room for an exam qualifier, so "Which of the following
// BEST describes X?" stays an application question while "Which of the following
// describes X?" stays a definition question.
const DEFINING_QUESTION_PATTERN = /\b(which|what)\s+(of the following\s+)?(defines?|stands for|means|refers to|describes?)\b/i;
const APPLICATION_MARKER_PATTERN = /\b(best|most appropriate|most likely|most correct|which concept is being|which principle is being|which approach is being|which requirement is being|what concept is being|what approach is being|what is being evaluated|what does this indicate|which benefit is|what business outcome|which technology best|which method best|which factor is|which type of)\b/i;

// "This is a component of a wireless network ...", "It defines standards for ...".
// A preliminary examination states a definition exactly this way, so it reads as
// conversational without being a flashcard, and it is the most common direct form
// in a real paper. Only a stem that asks nothing after the definition is direct on
// this evidence, so it has to be checked after hasNarrativeLead: "This is a serious
// flaw: any employee can approve their own expense claim. Which risk is
// demonstrated?" opens the same way but is an application item.
const DEMONSTRATIVE_DEFINITION_PATTERN = /^(?:this|that|these|those|it)\b/i;

// Opens a question outright. "In which of the following attacks does the attacker
// create a soft AP ...?" is recall even though it never names a term, because
// there is no situation described for the learner to interpret first.
const QUESTION_OPENER_PATTERN = /^(?:in\s+)?(?:which|what|who|whom|whose|when|where|why|how)\b/i;

// The discriminator between the two styles is not the opening word but whether
// the stem asserts anything before it asks. A scenario describes a situation and
// then asks the learner to map it onto a concept; a direct item hands the learner
// the concept, or asks about it from the first word. So the question is taken from
// the last sentence, and anything in front of it is a lead clause worth reading.
//
// This catches the scenarios that open with a named subject, which no opening-word
// rule can see: "Joan, a software developer, included a password in a comment ...
// Which of the following risks is demonstrated?". Reading the lead is also why the
// direct items stay direct. "In which of the following attacks do attackers exploit
// web page vulnerabilities to force a browser ...?" is recall, not a scenario,
// because the interrogative arrives before anything is described.
function hasNarrativeLead(text) {
  const boundary = Math.max(text.lastIndexOf(". "), text.lastIndexOf("! "), text.lastIndexOf("? "));

  if (boundary < 0) return false;

  return Boolean(text.slice(0, boundary).trim()) && QUESTION_OPENER_PATTERN.test(text.slice(boundary + 2));
}

export function inferQuestionStyle(questionText) {
  const text = String(questionText || "").trim();
  if (!text) return "direct";

  if (isNegativeStem(text)) return "scenario";

  if (RECALL_QUESTION_PATTERN.test(text) || DEFINING_QUESTION_PATTERN.test(text)) return "direct";

  if (hasNarrativeLead(text)) return "scenario";

  if (DEMONSTRATIVE_DEFINITION_PATTERN.test(text)) return "direct";

  if (QUESTION_OPENER_PATTERN.test(text)) return "direct";

  return APPLICATION_MARKER_PATTERN.test(text) ? "scenario" : "direct";
}

export function isNegativeStemQuestion(question) {
  return isNegativeStem(question?.question ?? question);
}

function isNegativeStem(questionText) {
  return NEGATIVE_STEM_PATTERN.test(String(questionText || "").trim());
}

export function countNegativeStemQuestions(questions) {
  return (questions || []).filter(isNegativeStemQuestion).length;
}

export const CHOICE_LETTERS = ["A", "B", "C", "D"];

// A learner's fastest tell is shape, not knowledge: whichever choice is longer,
// or the only one carrying two ideas, gets picked without reading. Prompt rules
// alone did not stop that, so the same check runs in code and hands the failures
// to a repair pass. These thresholds sit above ordinary wording variance so a
// genuinely shorter-but-correct answer is not flagged.
const BALANCE_LENGTH_RATIO = 1.5;
const BALANCE_MIN_WORD_GAP = 3;
const BALANCE_MAX_WORD_GAP = 4;
const BALANCE_MIN_SHORT_RATIO = 0.6;

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

// Commas and semicolons are the reliable signal that a choice packs in extra
// ideas. Counting "and"/"or" would misfire on ordinary phrases like
// "research and development".
function countClauses(text) {
  return (String(text || "").match(/[,;]/g) || []).length;
}

function getMedian(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

// A plausible wrong answer is one a learner who half-remembers the lesson would
// actually weigh. These are the words that turn a distractor into a claim nobody
// would seriously make, so the question gets decided on sight instead of by
// reading it. Real questions on the IT2511 paper manage this with sibling terms:
// "Association", "Access Point", "BSSID" against "Bandwidth".
const ABSURD_DISTRACTOR_PATTERN = /\b(guarantees?|guaranteed|absolutely|absolute|immune|risk[-\s]?free|impossible|never|always|forever|without any|solely|exclusively|ignores?|ignoring|replaces the need|no need to|unnecessary|pointless)\b/i;

// When every distractor opens the same way and the correct answer does not, the
// sentence frame alone gives it away. "It replaces the need...", "It allows
// startups to operate...", "It ensures that founders never..." against "Identifying
// real-world problems drives..." is decided on shape before the words are read.
// The correct answer must be the odd one out, otherwise an item where all four
// simply start with "It" says nothing.
function findOddOneOutByFrame(texts, correctIndex) {
  const firstWord = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9].*$/, "").trim();
  const distractorOpeners = texts.filter((_, index) => index !== correctIndex).map(firstWord);

  if (distractorOpeners.some((word) => !word)) return null;
  if (new Set(distractorOpeners).size !== 1) return null;

  return firstWord(texts[correctIndex]) === distractorOpeners[0] ? null : distractorOpeners[0];
}

// Returns the distractor letters that no learner would seriously consider. Kept
// separate from the length check because it is a different fault with a different
// fix, and because it is the one that survives a perfectly balanced choice set.
function findImplausibleDistractors(question, correctIndex) {
  const texts = CHOICE_LETTERS.map((letter) => String(question?.choices?.[letter] || "").trim());
  const correct = texts[correctIndex];
  const stem = String(question?.question || "");

  // The same word in the correct answer or in the stem means it is the subject
  // matter rather than a tell, so a question about never giving up is exempt.
  if (ABSURD_DISTRACTOR_PATTERN.test(correct) || ABSURD_DISTRACTOR_PATTERN.test(stem)) return [];

  return CHOICE_LETTERS.filter(
    (_, index) => index !== correctIndex && ABSURD_DISTRACTOR_PATTERN.test(texts[index])
  );
}

// Returns null when the question is fine, or an object describing exactly what
// gives it away so a repair prompt can be told the specific problem.
export function getChoiceBalanceIssue(question) {
  const choices = question?.choices || {};
  const texts = CHOICE_LETTERS.map((letter) => String(choices[letter] || "").trim());

  // Typed and true/false reviewers reuse the schema with blank or fixed
  // choices, and a duplicated choice cannot be a length tell.
  if (texts.some((text) => !text)) return null;
  if (new Set(texts.map((text) => text.toLowerCase())).size !== texts.length) return null;

  const correctAnswer = String(question?.correctAnswer || "").trim().toUpperCase();
  const correctIndex = CHOICE_LETTERS.indexOf(correctAnswer);
  if (correctIndex === -1) return null;

  const wordCounts = texts.map(countWords);
  const clauseCounts = texts.map(countClauses);
  const correctWords = wordCounts[correctIndex];
  const distractorWords = wordCounts.filter((_, index) => index !== correctIndex);
  const medianDistractorWords = getMedian(distractorWords);
  if (!correctWords || !medianDistractorWords) return null;

  const reasons = [];
  const wordGap = correctWords - medianDistractorWords;
  const plural = (count) => `${count} ${count === 1 ? "word" : "words"}`;

  if (wordGap >= BALANCE_MIN_WORD_GAP && correctWords / medianDistractorWords >= BALANCE_LENGTH_RATIO) {
    reasons.push(`the correct answer is ${plural(correctWords)} while the other choices sit around ${plural(medianDistractorWords)}`);
  }

  if (wordGap <= -BALANCE_MAX_WORD_GAP && correctWords / medianDistractorWords <= BALANCE_MIN_SHORT_RATIO) {
    reasons.push(`the correct answer is ${plural(correctWords)} while the other choices sit around ${plural(medianDistractorWords)}, so it stands out as the short one`);
  }

  const maxDistractorClauses = Math.max(...clauseCounts.filter((_, index) => index !== correctIndex));
  if (clauseCounts[correctIndex] >= 2 && maxDistractorClauses < 2) {
    reasons.push(`the correct answer is the only choice that packs in more than one idea (${clauseCounts[correctIndex]} clauses against ${maxDistractorClauses})`);
  }

  const implausible = findImplausibleDistractors(question, correctIndex);
  if (implausible.length) {
    reasons.push(`the wrong choices ${implausible.join(", ")} make claims no learner would seriously consider, so they can be ruled out without reading them`);
  }

  const oddFrame = findOddOneOutByFrame(texts, correctIndex);
  if (oddFrame) {
    reasons.push(`all three wrong choices open with "${oddFrame}" and the correct answer does not, so its shape alone gives it away`);
  }

  if (!reasons.length) return null;

  return {
    id: question?.id,
    question: String(question?.question || "").trim(),
    choices: { ...choices },
    correctAnswer,
    answerText: String(question?.answerText || "").trim(),
    explanation: String(question?.explanation || "").trim(),
    correctWords,
    medianDistractorWords,
    reasons
  };
}

export function findChoiceBalanceIssues(questions) {
  return (questions || []).map((question) => getChoiceBalanceIssue(question)).filter(Boolean);
}

// The style tag the generator returns is a claim about the question. The wording
// is the question. When the two disagree the wording wins, because it is what the
// learner reads and what the Direct Questions Only filter acts on, and because the
// claim cannot be checked: a tag is whatever the model felt like writing, so a
// reviewer could report a mix it did not have and nothing would reveal it. The tag
// is still asked for and still stored, so stored reviewers keep the field and the
// model still reports its intent, but it is not what decides the bucket.
export function getQuestionStyle(question) {
  return inferQuestionStyle(question?.question);
}

export function getReviewerStyleCounts(questions) {
  return (questions || []).reduce(
    (counts, question) => {
      counts[getQuestionStyle(question)] += 1;
      return counts;
    },
    { scenario: 0, direct: 0 }
  );
}

function resolveDifficultyForSession(questions, difficulty) {
  if (!difficulty || difficulty === "mixed" || difficulty === "all") return questions;
  const filtered = questions.filter(
    (question) => !question?.difficulty || getQuestionDifficulty(question) === difficulty
  );
  return filtered.length ? filtered : questions;
}

function resolveStyleForSession(questions, includeScenario) {
  if (includeScenario !== false) return questions;
  const filtered = questions.filter((question) => getQuestionStyle(question) !== "scenario");
  return filtered.length ? filtered : questions;
}

export function isTypedQuestion(question) {
  return ["identification", "flashcard"].includes(getQuestionType(question));
}

const QUESTION_TYPE_ORDER = ["multiple_choice", "true_false", "identification", "flashcard"];

export function getStoredQuestionTypes(reviewer) {
  const types = new Set((reviewer?.questions || []).map((question) => getQuestionType(question)));
  return QUESTION_TYPE_ORDER.filter((type) => types.has(type));
}

export function getQuestionTypeOptions(reviewer) {
  const available = new Set(getStoredQuestionTypes(reviewer));

  if (getStoredQuestionTypes(reviewer).length) {
    available.add("identification");
    available.add("flashcard");
  }

  return QUESTION_TYPE_ORDER.filter((type) => available.has(type));
}

function resolveQuestionTypesForSession(questions, questionTypes) {
  const selected = Array.isArray(questionTypes) && questionTypes.length ? [...questionTypes] : null;
  if (!selected) return questions;

  if (selected.includes("flashcard")) {
    return questions.map((question) => ({ ...question, type: "flashcard" }));
  }

  const selectedSet = new Set(selected);

  if (selected.length === 1) {
    const type = selected[0];
    return questions.map((question) => ({ ...question, type }));
  }

  return questions.filter((question) => selectedSet.has(getQuestionType(question)));
}

function normalizeAnswerText(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isAnswerCorrect(question, selectedAnswer) {
  if (selectedAnswer === "__correct") return true;
  if (selectedAnswer === "__incorrect") return false;

  if (isTypedQuestion(question)) {
    return normalizeAnswerText(selectedAnswer) === normalizeAnswerText(question.answerText);
  }

  return selectedAnswer === question.correctAnswer;
}

function toSessionQuestion(question, settings) {
  return {
    id: question.id,
    type: question.type || "multiple_choice",
    difficulty: getQuestionDifficulty(question),
    style: getQuestionStyle(question),
    topic: question.topic,
    question: question.question,
    correctAnswer: question.correctAnswer,
    answerText: question.answerText || question.choices?.[question.correctAnswer],
    explanation: question.explanation,
    choices:
      settings.choiceOrder === "shuffle"
        ? shuffleItems(normalizeChoices(question.choices))
        : normalizeChoices(question.choices)
  };
}

function applyChoiceOrder(choices, order) {
  return [...choices].sort((a, b) => {
    const rankA = order.indexOf(a.value);
    const rankB = order.indexOf(b.value);
    return (rankA === -1 ? order.length : rankA) - (rankB === -1 ? order.length : rankB);
  });
}

export function buildSessionQuestions(questions, settings, retryQuestionIds = null) {
  let pool = retryQuestionIds?.length
    ? questions.filter((question) => retryQuestionIds.includes(question.id))
    : [...questions];

  pool = resolveDifficultyForSession(pool, settings.difficulty);
  pool = resolveStyleForSession(pool, settings.includeScenarioQuestions);
  pool = resolveQuestionTypesForSession(pool, settings.questionTypes);

  if (settings.questionOrder === "random") pool = shuffleItems(pool);
  pool = pool.slice(0, settings.questionCount);

  return pool.map((question) => toSessionQuestion(question, settings));
}

export function createQuizSession(reviewer, settings, retryQuestionIds = null) {
  const questions = buildSessionQuestions(reviewer.questions, settings, retryQuestionIds);
  const now = Date.now();

  return {
    sessionId: crypto.randomUUID(),
    reviewerId: reviewer.reviewerId,
    reviewerTitle: reviewer.title,
    subject: reviewer.subject,
    settings: {
      ...settings,
      questionCount: questions.length,
      retryQuestionIds: retryQuestionIds || []
    },
    questions,
    answers: {},
    submittedQuestions: {},
    currentIndex: 0,
    startedAt: null,
    elapsedBeforePause: 0,
    updatedAt: now,
    completed: false
  };
}

// elapsedBeforePause holds the time banked by earlier visits and startedAt is
// the start of the visit that is on screen. Only the second one moves, so the
// hours between two visits are never added to the total. startedAt is a number
// everywhere it is written, but an older cloud record can hold a date string.
function toTimestamp(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : 0;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getSessionElapsed(session, now = Date.now()) {
  const banked = Math.max(0, Number(session?.elapsedBeforePause) || 0);
  const segmentStart = toTimestamp(session?.startedAt);
  if (!segmentStart) return banked;
  return banked + Math.max(0, now - segmentStart);
}

// Banks the running segment when the quiz leaves the screen, so time spent away
// stops counting.
export function pauseQuizSession(session, now = Date.now()) {
  if (!session) return session;
  return { ...session, elapsedBeforePause: getSessionElapsed(session, now), startedAt: null };
}

// Opens the clock for a visit. A segment found in storage belongs to a visit
// that has already ended, so it is replaced rather than credited: the time it
// held is unknown, and guessing is what produced day-long totals.
export function resumeQuizSession(session, now = Date.now()) {
  if (!session) return session;
  return { ...session, startedAt: now };
}

export function calculateScore(session) {
  return session.questions.reduce((score, question) => {
    return score + (isAnswerCorrect(question, session.answers[question.id]) ? 1 : 0);
  }, 0);
}

export function calculatePercentage(score, total) {
  return total ? Math.round((score / total) * 100) : 0;
}

export function getIncorrectQuestions(session) {
  return session.questions.filter((question) => !isAnswerCorrect(question, session.answers[question.id]));
}

export function getTopicStats(session) {
  const stats = new Map();

  session.questions.forEach((question) => {
    const topic = question.topic || "General";
    const current = stats.get(topic) || { topic, total: 0, correct: 0, incorrect: 0, percentage: 0 };
    const correct = isAnswerCorrect(question, session.answers[question.id]);
    current.total += 1;
    current.correct += correct ? 1 : 0;
    current.incorrect += correct ? 0 : 1;
    current.percentage = calculatePercentage(current.correct, current.total);
    stats.set(topic, current);
  });

  return [...stats.values()].sort((a, b) => a.percentage - b.percentage || b.total - a.total);
}

export function getQuestionResult(question, selectedAnswer) {
  if (selectedAnswer === "__correct" || selectedAnswer === "__incorrect") {
    return {
      isCorrect: selectedAnswer === "__correct",
      selectedText: selectedAnswer === "__correct" ? "Got it" : "Missed",
      correctText: question.answerText
    };
  }

  if (isTypedQuestion(question)) {
    return {
      isCorrect: isAnswerCorrect(question, selectedAnswer),
      selectedText: selectedAnswer || "No answer",
      correctText: question.answerText
    };
  }

  const selectedChoice = question.choices.find((choice) => choice.value === selectedAnswer);
  const correctChoice = question.choices.find((choice) => choice.value === question.correctAnswer);

  return {
    isCorrect: isAnswerCorrect(question, selectedAnswer),
    selectedText: selectedChoice?.label || "No answer",
    correctText: correctChoice?.label || question.answerText
  };
}

export function formatDuration(milliseconds = 0) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const displayMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}:${String(displayMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${displayMinutes}:${String(seconds).padStart(2, "0")}`;
}

export function createAttemptFromSession(session) {
  const score = calculateScore(session);
  const totalQuestions = session.questions.length;
  const incorrectQuestions = getIncorrectQuestions(session);
  const topicStats = getTopicStats(session);

  return {
    attemptId: crypto.randomUUID(),
    reviewerId: session.reviewerId,
    reviewerTitle: session.reviewerTitle,
    subject: session.subject,
    score,
    totalQuestions,
    percentage: calculatePercentage(score, totalQuestions),
    correctAnswers: score,
    wrongAnswers: incorrectQuestions.length,
    incorrectQuestionIds: incorrectQuestions.map((question) => question.id),
    timeTaken: getSessionElapsed(session),
    date: new Date().toISOString(),
    settings: session.settings,
    topicStats,
    weakTopics: topicStats.filter((topic) => topic.percentage < 70).map((topic) => topic.topic),
    questions: session.questions,
    answers: session.answers
  };
}

// A session and an attempt both carry the whole question list they were built
// from, which is the single biggest thing stored in a user's account. Those
// questions already live in the reviewer the record points at, so a cloud record
// only needs the ordered ids, plus the choice order when it was shuffled, to put
// the exact same list back together. Everything else about the record is kept.
export function toCompactQuizRecord(record) {
  const questions = record?.questions;
  if (!Array.isArray(questions)) return record;

  const choiceOrders = record.settings?.choiceOrder === "shuffle"
    ? questions.map((question) => (question.choices || []).map((choice) => choice.value))
    : null;

  const { questions: _questions, ...rest } = record;

  return {
    ...rest,
    questionIds: questions.map((question) => question.id),
    ...(choiceOrders ? { choiceOrders } : {})
  };
}

// Rebuilds the questions a compact record was written with. Returns null when the
// record still carries its own questions, and also when the reviewer cannot
// supply every one of them, so a caller can skip the record instead of storing a
// session that would mis-score or break on resume.
export function restoreQuizQuestions(record, reviewer) {
  if (!record || Array.isArray(record.questions)) return record || null;

  const ids = Array.isArray(record.questionIds) ? record.questionIds : null;
  if (!ids?.length || !Array.isArray(reviewer?.questions)) return null;

  const byId = new Map(reviewer.questions.map((question) => [question.id, question]));
  const ordered = [];

  for (const id of ids) {
    const source = byId.get(id);
    if (!source) return null;
    ordered.push(source);
  }

  const settings = record.settings || {};
  // The settings decide a session question's type, sometimes overriding what the
  // reviewer stored, so the same pass has to run again here. Skipping it would
  // grade a flashcard question as multiple choice on the next device.
  const typed = resolveQuestionTypesForSession(ordered, settings.questionTypes);
  if (typed.length !== ordered.length) return null;

  const orders = Array.isArray(record.choiceOrders) ? record.choiceOrders : null;
  const questions = typed.map((source, index) => {
    const built = toSessionQuestion(source, { ...settings, choiceOrder: "as-stored" });
    const order = orders?.[index];
    return order?.length ? { ...built, choices: applyChoiceOrder(built.choices, order) } : built;
  });

  const { questionIds: _ids, choiceOrders: _orders, ...rest } = record;
  return { ...rest, questions };
}

export function getPerformanceMessage(percentage) {
  if (percentage >= 90) return "Excellent! You really know this topic.";
  if (percentage >= 80) return "Great job! You're almost there.";
  if (percentage >= 70) return "Good work. Review a few more topics.";
  return "Keep reviewing. You can improve this.";
}
