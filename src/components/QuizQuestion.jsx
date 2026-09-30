import AnswerChoice from "./AnswerChoice.jsx";
import { getChoiceLetter, isTypedQuestion } from "../utils/quizUtils.js";

export default function QuizQuestion({ question, selectedAnswer, revealed, locked, onSelect }) {
  const typed = isTypedQuestion(question);

  return (
    <section className="question-panel">
      <div className="question-prompt">
        <p className="topic-label">{question.topic}</p>
        <h1>{question.question}</h1>
      </div>

      {typed ? (
        <label className="typed-answer-box">
          <span>Your Answer</span>
          <textarea
            value={selectedAnswer || ""}
            onChange={(event) => onSelect(event.target.value)}
            disabled={locked}
            placeholder={question.type === "flashcard" ? "Type what you remember from the back of the card." : "Type your answer."}
          />
        </label>
      ) : (
        <div className="answers-grid">
          {question.choices.map((choice, index) => (
            <AnswerChoice
              key={choice.value}
              choice={choice}
              letter={getChoiceLetter(index)}
              selected={selectedAnswer === choice.value}
              revealed={revealed}
              correct={question.correctAnswer === choice.value}
              disabled={locked}
              onSelect={() => onSelect(choice.value)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
