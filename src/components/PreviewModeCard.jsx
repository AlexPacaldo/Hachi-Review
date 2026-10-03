import { ArrowLeft, ArrowRight, Grid3X3 } from "lucide-react";
import ProgressBar from "./ProgressBar.jsx";
import QuizQuestion from "./QuizQuestion.jsx";

/**
 * A static reproduction of the real quiz screen, one per quiz mode.
 *
 * The markup is assembled from the same components and the same class names the
 * live quiz uses in src/pages/Quiz.jsx, so this cannot quietly drift away from
 * what a learner actually sees.
 *
 * `inert` is the one departure. These are real buttons and real AnswerChoice
 * buttons, and a preview is not an interactive quiz, so the subtree is marked
 * inert to keep it out of the tab order and unresponsive to clicks. The carousel
 * still gets those clicks because they land on its own card, an ancestor.
 */

const QUESTION = {
  id: "preview-cardiovascular",
  type: "multiple_choice",
  topic: "Cardiovascular system",
  question: "Which chamber of the heart pumps oxygenated blood into the systemic circulation?",
  choices: [
    { value: "right-atrium", label: "Right atrium" },
    { value: "left-ventricle", label: "Left ventricle" },
    { value: "right-ventricle", label: "Right ventricle" },
    { value: "left-atrium", label: "Left atrium" }
  ],
  correctAnswer: "left-ventricle",
  answerText: "Left ventricle",
  explanation:
    "The left ventricle has the thickest myocardium of the four chambers because it pumps oxygenated blood through the aorta into the systemic circulation."
};

const SUBJECT = "BIO 201 · Human Anatomy";
const QUESTION_INDEX = 4;
const QUESTION_TOTAL = 12;
const ANSWERED_COUNT = 4;

const CORRECT_VALUE = QUESTION.correctAnswer;
const WRONG_VALUE = "right-ventricle";

const MODES = [
  {
    key: "practice",
    label: "Practice Mode",
    blurb: "Shows if your answer is correct immediately, displays the correct answer and explanation, then lets you continue.",
    state: "correct",
    action: "Next Question",
    timer: null
  },
  {
    key: "exam",
    label: "Exam Mode",
    blurb: "Lets you answer, go back, and change choices. Correct answers and explanations appear only after final submission.",
    state: "selected",
    action: "Next",
    timer: "03:18"
  },
  {
    key: "timed",
    label: "Timed Mode",
    blurb: "Runs like exam mode with a countdown timer and submits automatically when time runs out.",
    state: "selected",
    action: "Next",
    timer: "07:42"
  },
  {
    key: "mistakes",
    label: "Mistakes-Only Mode",
    blurb: "Reviews only the questions missed in your most recent completed attempt.",
    state: "incorrect",
    action: "Next Question",
    timer: null
  },
  {
    key: "flashcard",
    label: "Flashcard Mode",
    blurb: "Shows the prompt first, then reveals the answer so you can mark whether you remembered it.",
    state: "flashcard",
    action: null,
    timer: null
  }
];

function labelFor(value) {
  return QUESTION.choices.find((choice) => choice.value === value)?.label ?? "";
}

function PreviewModeCard({ mode }) {
  const isFlashcard = mode.state === "flashcard";
  const revealed = mode.state === "correct" || mode.state === "incorrect";
  const selectedValue = mode.state === "incorrect" ? WRONG_VALUE : CORRECT_VALUE;
  const isCorrect = mode.state === "correct";

  return (
    <article className="preview-mode" inert>
      <section className="quiz-topbar">
        <div>
          <p className="eyebrow">{SUBJECT}</p>
          <h1>
            Question {QUESTION_INDEX} of {QUESTION_TOTAL}
          </h1>
        </div>
        <div className="quiz-meta">
          {mode.timer ? <span className="timer">{mode.timer}</span> : null}
          <button className="button subtle" type="button">
            <Grid3X3 size={17} aria-hidden="true" />
            Questions
          </button>
          <button className="button subtle" type="button">
            Leave
          </button>
        </div>
      </section>

      <ProgressBar value={QUESTION_INDEX} max={QUESTION_TOTAL} label="Quiz progress" />

      {isFlashcard ? (
        <section className="question-panel flashcard-panel">
          <div className="question-prompt">
            <p className="topic-label">{QUESTION.topic}</p>
            <h1>{QUESTION.question}</h1>
          </div>
          <div className="flashcard-answer">
            <span>Answer</span>
            <strong>{QUESTION.answerText}</strong>
            <p>{QUESTION.explanation}</p>
          </div>
        </section>
      ) : (
        <QuizQuestion
          question={QUESTION}
          selectedAnswer={selectedValue}
          revealed={revealed}
          locked={false}
          onSelect={() => {}}
        />
      )}

      {revealed ? (
        <section className={`feedback-panel ${isCorrect ? "success" : "danger"}`}>
          <h2>{isCorrect ? "Correct!" : "Incorrect"}</h2>
          <p>
            Your answer: <strong>{labelFor(selectedValue)}</strong>
          </p>
          <p>
            Correct answer: <strong>{QUESTION.answerText}</strong>
          </p>
          <p>
            <strong>Explanation:</strong> {QUESTION.explanation}
          </p>
        </section>
      ) : null}

      <section className="quiz-actions">
        <button className="button subtle" type="button">
          <ArrowLeft size={17} aria-hidden="true" />
          Previous
        </button>

        <span className="answered-count">{ANSWERED_COUNT} answered</span>

        {isFlashcard ? (
          <>
            <button className="button subtle" type="button">
              Missed
            </button>
            <button className="button primary" type="button">
              Got It
            </button>
          </>
        ) : (
          <button className="button primary" type="button">
            {mode.action}
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        )}
      </section>
    </article>
  );
}

/**
 * Module level so the array identity is stable across renders. The carousel
 * memoises on `items`, and a fresh array each render would restart its
 * autoplay timer on every parent update.
 */
export const PREVIEW_MODE_ITEMS = MODES.map((mode, index) => ({
  id: mode.key,
  mode,
  content: <PreviewModeCard mode={mode} />,
  ariaLabel: mode.label,
  blurb: mode.blurb,
  index
}));

export default PreviewModeCard;