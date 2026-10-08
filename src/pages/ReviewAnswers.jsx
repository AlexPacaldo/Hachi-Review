import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import EmptyState from "../components/EmptyState.jsx";
import { useReviewer } from "../hooks/useReviewer.js";
import { createQuizSession, getQuestionResult } from "../utils/quizUtils.js";
import { getAttemptById, getLatestAttempt, saveQuizProgress } from "../utils/storageUtils.js";
import { scheduleProgressSync } from "../services/syncEngine.js";

export default function ReviewAnswers() {
  const { reviewerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const params = new URLSearchParams(location.search);
  const attemptId = params.get("attempt");
  const attempt = attemptId ? getAttemptById(attemptId) : getLatestAttempt(reviewerId);
  const { reviewer, hasQuestions } = useReviewer(reviewerId);

  const reviewedQuestions = useMemo(() => {
    if (!attempt) return [];
    // A practice attempt's answers map holds each question's last answer, which is
    // correct for every question the retry flow fixed. Its firstTryAnswers is what
    // the score, the topic bars and the review all describe.
    const answers = attempt.firstTryAnswers || attempt.answers;
    return attempt.questions
      .map((question, index) => {
        const result = getQuestionResult(question, answers[question.id]);
        return { ...question, index, ...result };
      })
      .filter((question) => filter === "all" || (filter === "correct" ? question.isCorrect : !question.isCorrect));
  }, [attempt, filter]);

  const filterCounts = useMemo(() => {
    if (!attempt) return { all: 0, correct: 0, incorrect: 0 };
    return {
      all: attempt.totalQuestions,
      correct: attempt.correctAnswers,
      incorrect: attempt.wrongAnswers
    };
  }, [attempt]);

  if (!attempt) {
    return (
      <div className="page review-page">
        <EmptyState title="No attempt found" message="There is no completed attempt to review." action={<Link className="button primary" to="/home">Back to Reviewers</Link>} />
      </div>
    );
  }

  // A retry rebuilds a session from the reviewer's questions, which a summary
  // does not carry, so it waits for the fetch rather than starting an empty quiz.
  function retryIncorrect() {
    if (!Array.isArray(reviewer?.questions) || !attempt.incorrectQuestionIds.length) return;
    const session = createQuizSession(
      reviewer,
      {
        questionCount: attempt.incorrectQuestionIds.length,
        questionOrder: "original",
        choiceOrder: attempt.settings.choiceOrder || "original",
        mode: attempt.settings.mode || "practice"
      },
      attempt.incorrectQuestionIds
    );
    saveQuizProgress(session);
    scheduleProgressSync(session);
    navigate(`/quiz/${reviewerId}`);
  }

  return (
    <div className="page review-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">Review Answers</p>
          <h1>{attempt.reviewerTitle}</h1>
          <p className="muted">Compare your answers with the correct answers and explanations.</p>
        </div>
        <div className="button-row">
          {attempt.incorrectQuestionIds.length ? <button className="button primary" type="button" onClick={retryIncorrect} disabled={!hasQuestions}>Retry Incorrect Questions</button> : null}
          <Link className="button subtle" to={`/results/${reviewerId}?attempt=${attempt.attemptId}`}>Back to Results</Link>
        </div>
      </section>

      <section className="review-toolbar">
        <div className="review-stats" aria-label="Attempt summary">
          <span><strong>{attempt.score} / {attempt.totalQuestions}</strong> Score</span>
          <span><strong>{attempt.percentage}%</strong> Percentage</span>
          <span><strong>{attempt.correctAnswers}</strong> Correct</span>
          <span><strong>{attempt.wrongAnswers}</strong> Incorrect</span>
        </div>

        <div className="segmented filters" aria-label="Answer filter">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <span>{filterCounts.all}</span></button>
          <button type="button" className={filter === "correct" ? "active" : ""} onClick={() => setFilter("correct")}>Correct <span>{filterCounts.correct}</span></button>
          <button type="button" className={filter === "incorrect" ? "active" : ""} onClick={() => setFilter("incorrect")}>Incorrect <span>{filterCounts.incorrect}</span></button>
        </div>
      </section>

      <div className="review-list">
        {reviewedQuestions.map((question) => (
          <article className={`review-item ${question.isCorrect ? "correct" : "incorrect"}`} key={question.id}>
            <div className="review-item-head">
              <div>
                <span className="review-number">Question {question.index + 1}</span>
                <p className="topic-label">{question.topic}</p>
              </div>
              <strong className={`result-badge ${question.isCorrect ? "correct" : "incorrect"}`}>
                {question.isCorrect ? "Correct" : "Incorrect"}
              </strong>
            </div>

            <h2>{question.question}</h2>

            <div className="answer-comparison">
              <div className={question.isCorrect ? "answer-box correct" : "answer-box incorrect"}>
                <span>Your Answer</span>
                <strong>{question.selectedText}</strong>
              </div>
              <div className="answer-box correct">
                <span>Correct Answer</span>
                <strong>{question.correctText}</strong>
              </div>
            </div>

            <div className="explanation-box">
              <span>Explanation</span>
              <p>{question.explanation}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
