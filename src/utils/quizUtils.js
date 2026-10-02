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
const ARTICLE_SCENARIO_PATTERN = /^(?:a|an|the)\s+(?:[a-z][a-z'-]*\s+){0,4}[a-z][a-z'-]*\s+([a-z][a-z'-]*)\b/i;
const NON_VERB_CONNECTORS = new Set(["of", "in", "on", "for", "and", "or", "to", "with", "that", "which", "whose", "as", "at", "by", "from", "between", "when", "while", "than", "then", "into", "upon", "per"]);
const APPLICATION_MARKER_PATTERN = /\b(best|most appropriate|most likely|most correct|which concept is being|which principle is being|which approach is being|which requirement is being|what concept is being|what approach is being|what is being evaluated|what does this indicate|which benefit is|what business outcome|which technology best|which method best|which factor is|which type of)\b/i;

export function inferQuestionStyle(questionText) {
  const text = String(questionText || "").trim();
  if (!text) return "direct";

  if (RECALL_QUESTION_PATTERN.test(text) || DEFINING_QUESTION_PATTERN.test(text)) return "direct";

  const articleMatch = text.match(ARTICLE_SCENARIO_PATTERN);

  if (articleMatch && !NON_VERB_CONNECTORS.has(articleMatch[1].toLowerCase())) return "scenario";

  return APPLICATION_MARKER_PATTERN.test(text) ? "scenario" : "direct";
}

export function getQuestionStyle(question) {
  const raw = String(question?.style || "").trim().toLowerCase();
  return ["scenario", "direct"].includes(raw) ? raw : inferQuestionStyle(question?.question);
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

export function buildSessionQuestions(questions, settings, retryQuestionIds = null) {
  let pool = retryQuestionIds?.length
    ? questions.filter((question) => retryQuestionIds.includes(question.id))
    : [...questions];

  pool = resolveDifficultyForSession(pool, settings.difficulty);
  pool = resolveStyleForSession(pool, settings.includeScenarioQuestions);
  pool = resolveQuestionTypesForSession(pool, settings.questionTypes);

  if (settings.questionOrder === "random") pool = shuffleItems(pool);
  pool = pool.slice(0, settings.questionCount);

  return pool.map((question) => ({
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
  }));
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

export function getPerformanceMessage(percentage) {
  if (percentage >= 90) return "Excellent! You really know this topic.";
  if (percentage >= 80) return "Great job! You're almost there.";
  if (percentage >= 70) return "Good work. Review a few more topics.";
  return "Keep reviewing. You can improve this.";
}
