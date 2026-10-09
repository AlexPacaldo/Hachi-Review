import { createPracticeTracker } from "./practiceRetry.js";

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
// packs in the only list, repeats the question back, overstates, or is the only one
// written in a hopeful tone gets picked without reading. Prompt rules alone did not
// stop that, so the same checks run in code and hand the failures to a repair pass.
//
// Every rule below is measured against the options that are actually in front of the
// learner rather than against a fixed idea of what a good question looks like, because
// the alternatives were tested against the option sets of a real preliminary
// examination and the rules that survived are the ones that leave those items alone.
const BALANCE_MIN_OUTLIER_GAP = 2;
const BALANCE_MIN_OUTLIER_SPREAD = 4;
// One repeated word is ordinary, because a scenario legitimately names the thing its
// answer names ("two-factor authentication" answered with "Insecure Authentication").
// Two of them, while the distractors share none, means the answer is the only choice
// written in the question's own words.
const ECHO_MIN_SHARED_WORDS = 2;
// Three distractors that are all restrictive, prohibitive or dismissive is a tone
// tell: the correct answer is then the only option that recommends anything.
const POLARITY_MIN_DISTRACTORS = 3;
// Two choices that share two content words are one option written twice, which leaves
// the item holding two defensible answers instead of one.
const NEAR_DUPLICATE_MIN_SHARED_WORDS = 2;

// Function words plus the vocabulary an examination stem itself is built from. Kept
// deliberately short: every entry here is a word that can no longer contribute to an
// echo or a near-duplicate, so the list is where false negatives come from.
const CHOICE_STOP_WORDS = new Set([
  "a", "about", "above", "across", "after", "again", "against", "all", "also", "among",
  "an", "and", "another", "any", "applied", "approach", "are", "answer", "applies",
  "apply", "as", "at", "be", "because", "been", "before", "being", "below", "best",
  "better", "between", "both", "but", "by", "can", "concept", "correct", "described",
  "describes", "describe", "did", "do", "does", "doing", "during", "each", "either",
  "else", "enough", "explain", "explains", "factor", "first", "for", "form", "from",
  "further", "given", "has", "have", "having", "her", "here", "hers", "him", "his",
  "how", "idea", "if", "in", "indicate", "indicates", "into", "is", "it", "its",
  "itself", "just", "kind", "least", "less", "let", "like", "list", "made", "make",
  "makes", "many", "may", "me", "might", "more", "most", "much", "must", "name",
  "need", "neither", "never", "next", "no", "nor", "not", "now", "of", "off", "on",
  "once", "one", "only", "option", "or", "order", "other", "others", "ought", "our",
  "out", "over", "own", "part", "per", "phrase", "pick", "question", "rather",
  "reason", "right", "same", "see", "sentence", "set", "several", "she", "should",
  "show", "shows", "since", "so", "some", "something", "state", "states", "still",
  "such", "take", "than", "that", "the", "their", "them", "then", "there", "these",
  "they", "thing", "things", "this", "those", "through", "to", "too", "type", "under",
  "until", "up", "upon", "us", "use", "used", "using", "very", "via", "was", "way",
  "we", "well", "were", "what", "whatever", "when", "where", "whether", "which",
  "while", "who", "whom", "whose", "why", "will", "with", "within", "without", "would",
  "you", "your"
]);

// A content word is an alphabetic token of three letters or more that is not a stop
// word. Digits and part numbers are dropped on purpose, because "802.11e", "802.11g",
// "802.11n" and "802.11d" are four sibling labels in a real paper and treating their
// digits as shared wording would report that item as four identical options.
const CONTENT_WORD_PATTERN = /^[a-z]{3,}$/;
// Runs of capitals are acronyms and product codes (GCMP-256, HMAC-SHA-384, OWASP,
// GPS). A stem that names one is handing over a fingerprint to match, which is how a
// real paper forces a choice, so these are not read as the stem echoing itself.
const ACRONYM_PATTERN = /[A-Z]{2,}/;
// A hyphenated prefix that only carries grammar, not topic. Without this,
// "Non-pairable Mode" and "Non-discoverable Mode" share both "non" and "mode" and the
// item is reported as having two answers when it plainly has one. Splitting the
// compound is what makes these visible at all, so they are dropped here rather than by
// keeping hyphens inside the token, which would cost every other compound word.
const GRAMMATICAL_PREFIXES = new Set([
  "anti", "dis", "inter", "intra", "mis", "multi", "non", "out", "over", "post",
  "pre", "semi", "sub", "super", "under"
]);

function tokenize(text) {
  return String(text || "").split(/[^A-Za-z0-9]+/).filter(Boolean);
}

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

function getContentWords(text, { skipAcronyms = false } = {}) {
  const words = new Set();

  for (const token of tokenize(text)) {
    if (skipAcronyms && ACRONYM_PATTERN.test(token)) continue;
    const word = token.toLowerCase();
    if (GRAMMATICAL_PREFIXES.has(word)) continue;
    if (CONTENT_WORD_PATTERN.test(word) && !CHOICE_STOP_WORDS.has(word)) words.add(word);
  }

  return words;
}

function getSharedWords(left, right) {
  const shared = [];
  for (const word of left) if (right.has(word)) shared.push(word);
  return shared;
}

function getChoiceIndices(index) {
  return CHOICE_LETTERS.map((_, choiceIndex) => choiceIndex).filter((choiceIndex) => choiceIndex !== index);
}

// Both marker lists are matched through getMarkerStem below, which strips the endings
// that turn a base into an adverb, a gerund or a past participle. Spelling out
// "exclusive", "exclusively", "limit", "limited", "limiting", "ignore" and "ignoring"
// as separate entries is how "exclusively" went missing once already, and a forgotten
// entry is a give-away the detector silently stops seeing. Every list here is written
// the way the word is actually used and stemmed on the way in, so any of those
// spellings would have worked.
const RESTRICTIVE_MARKER_LIST = [
  "abandon", "absent", "ancient", "avoid", "ban", "bar", "block", "cannot", "cease",
  "chiefly", "completely", "concentrate", "decrease", "deny", "deprecated", "dismiss",
  "disqualify", "disregard", "drop", "eliminate", "entirely", "exclude", "exclusive",
  "excessive", "expired", "fail", "failure", "forego", "forgo", "forbid", "halt",
  "harder", "ignore", "impossible", "incorrect", "ineffective", "invalid", "lack",
  "lacking", "least", "limit", "mainly", "merely", "minimal", "minor", "missing",
  "narrow", "neglect", "never", "nobody", "nothing", "nowhere", "obsolete", "omit",
  "only", "outdated", "overlook", "pause", "pointless", "primarily", "prevent",
  "prohibit", "reduce", "refuse", "reject", "remove", "restrict", "skip", "solely",
  "strictly", "suppress", "unable", "unnecessary", "useless", "veto", "waste",
  "worst", "wrong"
];

// A choice that is the only one making an absolute claim is not answering the stem, it
// is standing out. Real members of a list and real recommendations are not stated as
// universals, so this is what usually gives away the odd one out in a "which is NOT"
// item, where length and tone both look ordinary.
const ABSOLUTIST_MARKER_LIST = [
  "absolutely", "all", "always", "any", "anyone", "anymore", "completely", "entirely",
  "every", "everyone", "everything", "forever", "guarantee", "impossible", "never",
  "nobody", "none", "nothing", "nowhere", "only", "permanent", "totally",
  "unconditional", "whatever", "whenever"
];

// A marker list kept as base forms, matched after stripping the endings that turn a
// base into an adverb, a gerund or a past participle. The trailing "e" comes off last
// and off both sides, because "ignoring" stems to "ignor" while "ignore" only stems to
// "ignor" once its own "e" is gone.
const MARKER_SUFFIXES = ["ly", "ing", "ed", "es", "s"];

function getMarkerStem(word) {
  let stem = word;

  for (const suffix of MARKER_SUFFIXES) {
    if (stem.length > suffix.length + 2 && stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }

  return stem.endsWith("e") ? stem.slice(0, -1) : stem;
}

// Both sides of every comparison go through getMarkerStem, so a list may be written in
// whichever form reads best without one entry quietly failing to match.
const RESTRICTIVE_MARKERS = new Set(RESTRICTIVE_MARKER_LIST.map(getMarkerStem));
const ABSOLUTIST_MARKERS = new Set(ABSOLUTIST_MARKER_LIST.map(getMarkerStem));

// Returns the tokens that matched, as the learner sees them, so a repair prompt can
// quote the word that gave the item away rather than its stem.
function getMarkerHits(text, markers) {
  return [...new Set(tokenize(text)
    .map((token) => token.toLowerCase())
    .filter((token) => markers.has(getMarkerStem(token))))];
}

// A near-duplicate is the one failure that is a broken question rather than a guessable
// one: the learner can read every option, understand every option, and still be unable
// to choose. So it outranks everything else when the repair pass can only take a fixed
// number of items, and it is the one failure a learner cannot be warned about.
const NEAR_DUPLICATE_SEVERITY = 3;

// The topic heading is printed above the stem, so a choice that spells it out is
// quoting the question to the learner.
function getTopicPhrase(topic) {
  const phrase = String(topic || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (!phrase || getContentWords(phrase).size < 2) return "";
  return phrase;
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
  if (!correctWords) return null;

  const distractorIndices = getChoiceIndices(correctIndex);
  const plural = (count) => `${count} ${count === 1 ? "word" : "words"}`;
  const kinds = [];
  const reasons = [];
  const report = (kind, reason) => {
    kinds.push(kind);
    reasons.push(reason);
  };

  // Ranked descending, so the comparison that matters is the correct answer against the
  // option it has to be mistaken for. A median is the wrong statistic here: it ignores
  // the runner-up, so a correct answer of twelve words sitting next to one of eleven
  // reads as an outlier when the learner cannot see anything odd about it. Comparing
  // against the runner-up also exempts ties for free, which is what a set of sibling
  // labels the same length looks like.
  const ranked = [...wordCounts].sort((a, b) => b - a);
  const [longest, runnerUpLongest] = ranked;
  const [shortest, runnerUpShortest] = [...ranked].reverse();

  if (correctWords >= longest
    && correctWords - runnerUpLongest >= BALANCE_MIN_OUTLIER_GAP
    && correctWords - shortest >= BALANCE_MIN_OUTLIER_SPREAD) {
    report("overlong", `the correct answer is ${plural(correctWords)} while the next longest choice is ${plural(runnerUpLongest)} and the shortest is ${plural(shortest)}, so it is the one that reads as a different shape`);
  }

  if (correctWords <= shortest
    && runnerUpShortest - correctWords >= BALANCE_MIN_OUTLIER_GAP
    && longest - correctWords >= BALANCE_MIN_OUTLIER_SPREAD) {
    report("overshort", `the correct answer is ${plural(correctWords)} while the next shortest choice is ${plural(runnerUpShortest)} and the longest is ${plural(longest)}, so it stands out as the short one`);
  }

  const maxDistractorClauses = Math.max(...distractorIndices.map((index) => clauseCounts[index]));
  if (clauseCounts[correctIndex] >= 2 && maxDistractorClauses < 2) {
    report("clause", `the correct answer is the only choice that packs in more than one idea (${clauseCounts[correctIndex]} clauses against ${maxDistractorClauses})`);
  }

  // The topic heading is part of what the learner reads, so it counts as question
  // wording when deciding whether the correct answer is the only choice that echoes.
  const stemWords = getContentWords(
    `${String(question?.question || "")} ${String(question?.topic || "")}`,
    { skipAcronyms: true }
  );
  const sharedWithStem = texts.map((text) => getSharedWords(getContentWords(text), stemWords));
  const maxDistractorEcho = Math.max(...distractorIndices.map((index) => sharedWithStem[index].length));

  if (sharedWithStem[correctIndex].length >= ECHO_MIN_SHARED_WORDS
    && sharedWithStem[correctIndex].length > maxDistractorEcho) {
    report("echo", `the correct answer is the only choice written in the question's own words (${sharedWithStem[correctIndex].join(", ")})`);
  }

  const topicPhrase = getTopicPhrase(question?.topic);
  if (topicPhrase && texts[correctIndex].toLowerCase().includes(topicPhrase)) {
    report("topic-restatement", `the correct answer restates the topic heading "${String(question?.topic).trim()}" back to the learner`);
  }

  const restrictives = texts.map((text) => getMarkerHits(text, RESTRICTIVE_MARKERS).length);
  const markedDistractors = distractorIndices.filter((index) => restrictives[index] > 0);
  if (markedDistractors.length === POLARITY_MIN_DISTRACTORS && restrictives[correctIndex] === 0) {
    report("polarity", "all three distractors tell the learner not to do something while the correct answer is the only choice that recommends anything, so its tone gives it away");
  }

  const absolutes = texts.map((text) => getMarkerHits(text, ABSOLUTIST_MARKERS));
  if (absolutes[correctIndex].length && !distractorIndices.some((index) => absolutes[index].length)) {
    report("absolutist", `the correct answer is the only choice claiming something absolute (${absolutes[correctIndex].join(", ")}), and the real options it sits beside are not stated that way`);
  }

  const correctChoiceWords = getContentWords(texts[correctIndex]);
  const nearDuplicate = distractorIndices.find((index) => (
    getSharedWords(correctChoiceWords, getContentWords(texts[index])).length >= NEAR_DUPLICATE_MIN_SHARED_WORDS
  ));
  if (nearDuplicate !== undefined) {
    const overlapping = getSharedWords(correctChoiceWords, getContentWords(texts[nearDuplicate]));
    report("near-duplicate", `the correct answer and choice ${CHOICE_LETTERS[nearDuplicate]} overlap on ${overlapping.join(" and ")}, so both read as defensible and the item has two possible answers`);
  }

  if (!reasons.length) return null;

  return {
    id: question?.id,
    question: String(question?.question || "").trim(),
    topic: String(question?.topic || "").trim(),
    choices: { ...choices },
    correctAnswer,
    answerText: String(question?.answerText || "").trim(),
    explanation: String(question?.explanation || "").trim(),
    correctWords,
    medianDistractorWords: getMedian(distractorIndices.map((index) => wordCounts[index])),
    kinds,
    reasons,
    severity: kinds.reduce((total, kind) => total + (kind === "near-duplicate" ? NEAR_DUPLICATE_SEVERITY : 1), 0)
  };
}

// Worst first, because the repair pass can only take a fixed number of items and an
// item with two defensible answers costs the learner more than one that merely looks
// long. Array.prototype.sort is stable, so items of equal severity keep the order the
// reviewer already had them in and the work order stays reproducible.
export function findChoiceBalanceIssues(questions) {
  return (questions || [])
    .map((question) => getChoiceBalanceIssue(question))
    .filter(Boolean)
    .sort((a, b) => b.severity - a.severity);
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

  // A saved retry list pointing at questions that are no longer in the reviewer
  // (regenerated review, stale attempt) would produce an empty session, so fall
  // back to the whole set instead of starting a quiz with no questions.
  if (retryQuestionIds?.length && !pool.length) pool = [...questions];

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
    completed: false,
    ...(settings.mode === "practice"
      ? {
          practice: createPracticeTracker(),
          entryMeta: questions.map(() => ({ retry: false })),
          originalQuestionCount: questions.length
        }
      : {})
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

// A session carries its own copy of each question, answer key included, and that
// copy is what grades it. So an owner who corrects a wrong answer while somebody
// has the reviewer in progress leaves that session marking a key the owner has
// already replaced. This re-reads the key off the current reviewer, keeping the
// session's own choices, order and answers: a question the learner has already
// answered keeps its answer and is simply re-marked against the corrected key,
// and a question that no longer exists in the reviewer is left alone rather than
// dropped out from under an attempt in progress.
//
// The same session object comes back when nothing moved, so a caller can hand
// this straight to setState without looping on a re-render.
export function refreshSessionAnswerKey(session, reviewer) {
  if (!session || !Array.isArray(session.questions)) return session;
  if (!Array.isArray(reviewer?.questions)) return session;

  const byId = new Map(reviewer.questions.map((question) => [question.id, question]));
  let changed = false;

  const questions = session.questions.map((question) => {
    const source = byId.get(question?.id);
    if (!source) return question;

    const answerText = source.answerText || source.choices?.[source.correctAnswer] || question.answerText;
    if (source.correctAnswer === question.correctAnswer && answerText === question.answerText) {
      return question;
    }

    changed = true;
    // The session's own choices are kept rather than the reviewer's, because they
    // are the ones the learner was shown and may already have picked from, and
    // their order is this session's shuffle.
    return { ...question, correctAnswer: source.correctAnswer, answerText };
  });

  return changed ? { ...session, questions } : session;
}

export function getPerformanceMessage(percentage) {
  if (percentage >= 90) return "Excellent! You really know this topic.";
  if (percentage >= 80) return "Great job! You're almost there.";
  if (percentage >= 70) return "Good work. Review a few more topics.";
  return "Keep reviewing. You can improve this.";
}
