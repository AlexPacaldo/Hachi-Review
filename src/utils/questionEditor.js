// Editing a question by hand, as opposed to generating one. Everything here is
// pure so the editor component holds no rules of its own, and so the two
// invariants that keep a hand-edited reviewer openable can be checked directly:
//
//   * answerText is exactly the correct choice, because validateReviewer refuses
//     a reviewer whose two disagree, and
//   * the choices match the type, because it asks for A-D on a multiple choice and
//     only A-B on a true/false.
//
// Both are invisible when they break: the reviewer is written, cached, and then
// the page refuses to open it.

import { CHOICE_LETTERS } from "./quizUtils.js";

export const QUESTION_TYPE_OPTIONS = [
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "true_false", label: "True / False" },
  { value: "identification", label: "Identification" },
  { value: "flashcard", label: "Flashcard" }
];

export const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" }
];

// Identification and flashcard questions have nothing to pick from, so the answer
// is free text and the choice fields are not part of their shape at all.
export function isTypedQuestion(type) {
  return type === "identification" || type === "flashcard";
}

// Which choices a type actually carries. This mirrors the normaliser in
// api/generate-reviewer.js on purpose, so switching type in the editor leaves the
// question in the shape the rest of the app already expects.
export function choiceLettersFor(type) {
  return type === "true_false" ? ["A", "B"] : CHOICE_LETTERS;
}

export function normalizeQuestionType(question, nextType) {
  const next = { ...question, type: nextType };

  if (isTypedQuestion(nextType)) {
    next.correctAnswer = "TEXT";
    return next;
  }

  const letters = choiceLettersFor(nextType);
  const choices = {};
  CHOICE_LETTERS.forEach((letter) => {
    choices[letter] = String(question?.choices?.[letter] || "");
  });

  if (nextType === "true_false") {
    // Reset rather than carried across. The old text was written as options to a
    // different question, and "Demographic"/"Behavioral" left sitting under a
    // true/false question is not a pair the owner can make sense of. They are
    // visible in the form afterwards, so the swap is not hidden from them.
    choices.A = "True";
    choices.B = "False";
    choices.C = "";
    choices.D = "";
  }

  next.choices = choices;

  const previousAnswer = String(question?.correctAnswer || "").toUpperCase();
  next.correctAnswer = letters.includes(previousAnswer) ? previousAnswer : letters[0];
  next.answerText = choices[next.correctAnswer] ?? "";

  return next;
}

// Typing into a choice. answerText is mirrored rather than asked for separately,
// so the owner cannot leave the two disagreeing by editing one of them.
export function setChoiceValue(question, letter, value) {
  const choices = { ...question.choices, [letter]: value };
  const correctAnswer = String(question.correctAnswer || "").toUpperCase();

  return {
    ...question,
    choices,
    answerText: correctAnswer === letter ? value : question.answerText
  };
}

export function setCorrectAnswer(question, letter) {
  return {
    ...question,
    correctAnswer: letter,
    answerText: question.choices?.[letter] ?? ""
  };
}

// Trimmed as a set rather than field by field, so answerText and the choice it
// mirrors cannot drift apart on the way in.
export function normalizeQuestionForSave(question) {
  const next = { ...question };
  next.topic = String(next.topic || "").trim();
  next.question = String(next.question || "").trim();
  next.explanation = String(next.explanation || "").trim();
  next.answerText = String(next.answerText || "").trim();

  if (!isTypedQuestion(next.type)) {
    const choices = {};
    choiceLettersFor(next.type).forEach((letter) => {
      choices[letter] = String(next.choices?.[letter] || "").trim();
    });
    next.choices = choices;
    next.answerText = choices[next.correctAnswer] ?? "";
  }

  return next;
}

// What would stop this reviewer opening, in the words an owner can act on. The
// conditions are validateReviewer's, not the editor's own: it reports the same
// failures in its own wording, and the editor uses that rather than inventing a
// second opinion that could pass something the page would then reject.
export function questionProblems(question) {
  const problems = [];

  if (!String(question?.topic || "").trim()) problems.push("Topic is empty.");
  if (!String(question?.question || "").trim()) problems.push("Question text is empty.");
  if (!String(question?.explanation || "").trim()) problems.push("Explanation is empty.");

  if (isTypedQuestion(question?.type)) {
    if (!String(question?.answerText || "").trim()) problems.push("Answer is empty.");
    return problems;
  }

  const letters = choiceLettersFor(question?.type);
  const seen = [];

  letters.forEach((letter) => {
    const text = String(question?.choices?.[letter] || "").trim();
    if (!text) {
      problems.push(`Choice ${letter} is empty.`);
      return;
    }
    // getChoiceBalanceIssue deliberately stands down on a duplicated choice,
    // because a length tell cannot be read off one. A duplicate is still a broken
    // question, so it is reported here instead.
    if (seen.includes(text.toLowerCase())) problems.push(`Choice ${letter} repeats another choice.`);
    else seen.push(text.toLowerCase());
  });

  const answer = String(question?.correctAnswer || "").toUpperCase();
  if (!letters.includes(answer)) problems.push("Choose which choice is correct.");

  return problems;
}