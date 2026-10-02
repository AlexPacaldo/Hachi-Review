import { getCloudReviewerCache, getLocalReviewers } from "../utils/storageUtils.js";

const REQUIRED_CHOICE_KEYS = ["A", "B", "C", "D"];
const QUESTION_TYPES = ["multiple_choice", "identification", "true_false", "flashcard"];

function getQuestionType(reviewer, question) {
  const type = question?.type || reviewer?.questionType || "multiple_choice";
  return QUESTION_TYPES.includes(type) ? type : "multiple_choice";
}

export function validateReviewer(reviewer) {
  const errors = [];

  if (!reviewer?.reviewerId) errors.push("Missing reviewerId.");
  if (!reviewer?.title) errors.push("Missing title.");
  if (!reviewer?.subject) errors.push("Missing subject.");
  if (!Array.isArray(reviewer?.questions)) errors.push("Questions must be an array.");
  if (Array.isArray(reviewer?.questions) && reviewer.questionCount !== reviewer.questions.length) {
    errors.push("questionCount must match the number of questions.");
  }

  reviewer?.questions?.forEach((question, index) => {
    const label = `Question ${index + 1}`;
    const questionType = getQuestionType(reviewer, question);
    ["id", "topic", "question", "correctAnswer", "answerText", "explanation"].forEach((field) => {
      if (question[field] === undefined || question[field] === "") {
        errors.push(`${label} is missing ${field}.`);
      }
    });

    if (questionType === "multiple_choice" || questionType === "true_false") {
      const choiceKeys = Object.keys(question.choices || {});
      const requiredKeys = questionType === "true_false" ? ["A", "B"] : REQUIRED_CHOICE_KEYS;
      if (!requiredKeys.every((key) => choiceKeys.includes(key) && question.choices[key])) {
        errors.push(`${label} must contain valid choices.`);
      }

      if (question.correctAnswer && !requiredKeys.includes(question.correctAnswer)) {
        errors.push(`${label} has an invalid correctAnswer.`);
      }

      if (question.answerText !== undefined && question.choices?.[question.correctAnswer] !== question.answerText) {
        errors.push(`${label} answerText must match choices[correctAnswer].`);
      }
    } else if (question.correctAnswer !== "TEXT") {
      errors.push(`${label} typed-answer questions must use correctAnswer TEXT.`);
    }
  });

  return { isValid: errors.length === 0, errors };
}

export const reviewers = [].map((reviewer) => ({
  ...reviewer,
  source: "built-in",
  storageStatus: "built-in",
  validation: validateReviewer(reviewer)
}));

// The reviewer list is loaded as a summary with no questions, which is enough
// to draw a card but not enough to validate or quiz. These are distinguished
// from a broken reviewer so the list does not report every cloud reviewer as
// invalid while its questions are still only one fetch away.
export function isReviewerSummary(reviewer) {
  return Boolean(reviewer?.reviewerId) && !Array.isArray(reviewer.questions);
}

function withValidation(reviewer, source, storageStatus = source) {
  // Scoped to the cloud source on purpose. A local reviewer that arrived without
  // questions is a broken import and should still say so.
  if (source === "cloud" && isReviewerSummary(reviewer)) {
    return {
      ...reviewer,
      isSummary: true,
      source,
      storageStatus,
      validation: { isValid: true, errors: [], isSummary: true }
    };
  }

  return {
    ...reviewer,
    source,
    storageStatus,
    validation: validateReviewer(reviewer)
  };
}

export function getAllReviewers() {
  const cloudReviewers = getCloudReviewerCache().map((reviewer) => withValidation(reviewer, "cloud"));
  const localReviewers = getLocalReviewers().map((reviewer) => withValidation(reviewer, "local"));
  const mergedReviewers = new Map();

  [...reviewers, ...cloudReviewers, ...localReviewers].forEach((reviewer) => {
    const existing = mergedReviewers.get(reviewer.reviewerId);

    if (existing?.source === "cloud" && reviewer.source === "local") {
      mergedReviewers.set(reviewer.reviewerId, {
        ...existing,
        ...reviewer,
        storageStatus: "both",
        validation: validateReviewer(reviewer)
      });
      return;
    }

    mergedReviewers.set(reviewer.reviewerId, reviewer);
  });

  return [...mergedReviewers.values()];
}

export function getReviewerById(reviewerId) {
  return getAllReviewers().find((reviewer) => reviewer.reviewerId === reviewerId);
}
