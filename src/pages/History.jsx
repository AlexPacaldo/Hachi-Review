import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import EmptyState from "../components/EmptyState.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { clearAttemptHistory, getAttemptHistory, REVIEWER_DATA_CHANGED_EVENT } from "../utils/storageUtils.js";
import { pushClearedHistoryToCloud } from "../services/syncEngine.js";
import { formatDuration } from "../utils/quizUtils.js";

export default function History() {
  const [history, setHistory] = useState(getAttemptHistory);
  const [confirmClear, setConfirmClear] = useState(false);

  // Attempts pulled down from the account arrive after this page has mounted, so
  // without this the list showed whatever the browser already had and needed a
  // second refresh to pick up a history synced from another device.
  useEffect(() => {
    const refresh = () => setHistory(getAttemptHistory());

    window.addEventListener(REVIEWER_DATA_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(REVIEWER_DATA_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return (
    <div className="page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">Account history</p>
          <h1>Quiz History</h1>
          <p className="muted">Your completed quizzes follow your account and show up on every device you sign in on.</p>
        </div>
        {history.length ? (
          <button className="button subtle danger-text" type="button" onClick={() => setConfirmClear(true)}>
            Clear History
          </button>
        ) : null}
      </section>

      {history.length ? (
        <div className="history-list">
          {history.map((attempt) => (
            <article className="history-card" key={attempt.attemptId}>
              <div>
                <h2>{attempt.reviewerTitle}</h2>
                <p className="muted">{new Date(attempt.date).toLocaleString()}</p>
              </div>
              <div className="history-stats">
                <span><strong>{attempt.score} / {attempt.totalQuestions}</strong> Score</span>
                <span><strong>{attempt.percentage}%</strong> Percentage</span>
                <span><strong>{formatDuration(attempt.timeTaken)}</strong> Time Taken</span>
              </div>
              <div className="button-row">
                <Link className="button primary" to={`/review/${attempt.reviewerId}?attempt=${attempt.attemptId}`}>Review Attempt</Link>
                <Link className="button subtle" to={`/reviewer/${attempt.reviewerId}`}>Retake Reviewer</Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="No quiz history" message="Completed quizzes will appear here." action={<Link className="button primary" to="/home">Choose a Reviewer</Link>} />
      )}

      <ConfirmModal
        open={confirmClear}
        title="Clear History?"
        message="This removes completed attempt history only. Unfinished quiz progress will stay saved."
        confirmLabel="Clear History"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          clearAttemptHistory();
          pushClearedHistoryToCloud();
          setHistory([]);
          setConfirmClear(false);
        }}
      />
    </div>
  );
}
