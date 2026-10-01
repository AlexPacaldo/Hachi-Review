import { Check, X } from "lucide-react";

/**
 * Static marketing reproductions of the real quiz screen, one per quiz mode.
 *
 * Everything here mirrors `src/pages/Quiz.jsx` and `src/components/AnswerChoice.jsx`:
 * the A/B/C/D choice letters, the "Correct answer" / "Your answer" status text
 * instead of tick icons, and the "Correct!" / "Incorrect" feedback panel with
 * its Your answer / Correct answer / Explanation lines.
 */

const CHOICES = [
  { letter: "A", label: "Right atrium" },
  { letter: "B", label: "Left ventricle" },
  { letter: "C", label: "Right ventricle" },
  { letter: "D", label: "Left atrium" }
];

const CORRECT_INDEX = 1;

const EXPLANATION =
  "The left ventricle has the thickest myocardium of the four chambers because it pumps oxygenated blood through the aorta into the systemic circulation.";

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
    timer: null
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

function Choice({ letter, label, status }) {
  return (
    <span className={`preview-choice${status ? ` is-${status}` : ""}`}>
      <span className="preview-choice-key">{letter}</span>
      <span className="preview-choice-label">{label}</span>
      {status ? <span className="preview-choice-status">{status === "correct" ? "Correct answer" : "Your answer"}</span> : null}
    </span>
  );
}

function PreviewModeCard({ mode }) {
  const revealed = mode.state === "correct" || mode.state === "incorrect";
  const answeredIndex = mode.state === "incorrect" ? 2 : CORRECT_INDEX;

  return (
    <article className="preview-mode">
      <header className="preview-mode-top">
        <span className="preview-mode-subject">BIO 201 · Human Anatomy</span>
        {mode.timer ? <span className="preview-mode-timer">{mode.timer}</span> : null}
      </header>

      <p className="preview-mode-count">Question 4 of 12</p>

      <div className="preview-mode-bar" aria-hidden="true">
        <span style={{ width: "33%" }} />
      </div>

      <p className="preview-mode-topic">Cardiovascular system</p>
      <p className="preview-mode-question">
        Which chamber of the heart pumps oxygenated blood into the systemic circulation?
      </p>

      {mode.state === "flashcard" ? (
        <div className="preview-mode-reveal">
          <p className="preview-mode-reveal-label">Answer</p>
          <p className="preview-mode-reveal-text">Left ventricle</p>
        </div>
      ) : (
        <div className="preview-mode-choices">
          {CHOICES.map((choice, index) => {
            let status = null;
            if (revealed && index === CORRECT_INDEX) status = "correct";
            else if (revealed && index === answeredIndex) status = "incorrect";
            else if (!revealed && index === CORRECT_INDEX) status = "selected";
            return <Choice key={choice.letter} letter={choice.letter} label={choice.label} status={status} />;
          })}
        </div>
      )}

      {revealed ? (
        <div className={`preview-mode-feedback ${mode.state === "correct" ? "is-success" : "is-danger"}`}>
          <p className="preview-mode-verdict">
            {mode.state === "correct" ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
            {mode.state === "correct" ? "Correct!" : "Incorrect"}
          </p>
          <p>
            Your answer: <strong>{CHOICES[answeredIndex].label}</strong>
          </p>
          <p>
            Correct answer: <strong>{CHOICES[CORRECT_INDEX].label}</strong>
          </p>
          <p className="preview-mode-explanation">
            <strong>Explanation:</strong> {EXPLANATION}
          </p>
        </div>
      ) : null}

      <footer className="preview-mode-actions">
        <span className="preview-mode-prev">Previous</span>
        {mode.state === "flashcard" ? (
          <>
            <span className="preview-mode-graded">Missed</span>
            <span className="preview-mode-next">Got It</span>
          </>
        ) : (
          <>
            <span className="preview-mode-answered">4 answered</span>
            <span className="preview-mode-next">{mode.action}</span>
          </>
        )}
      </footer>
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
