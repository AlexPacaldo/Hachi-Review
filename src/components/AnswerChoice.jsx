export default function AnswerChoice({ choice, letter, selected, revealed, correct, disabled, onSelect }) {
  const statusClass = revealed && correct ? " correct" : revealed && selected && !correct ? " incorrect" : "";

  return (
    <button
      type="button"
      className={`answer-choice${selected ? " selected" : ""}${statusClass}`}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
    >
      <span className="choice-content">
        <strong className="choice-letter">{letter}</strong>
        <span>{choice.label}</span>
      </span>
      {revealed && correct ? <span className="status-text">Correct answer</span> : null}
      {revealed && selected && !correct ? <span className="status-text">Your answer</span> : null}
    </button>
  );
}
