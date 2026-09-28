import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import ResultsSummary from "../components/ResultsSummary.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { getReviewerById } from "../data/reviewerRegistry.js";
import { createQuizSession } from "../utils/quizUtils.js";
import { getAttemptById, getLatestAttempt, saveQuizProgress } from "../utils/storageUtils.js";
import { scheduleProgressSync } from "../services/syncEngine.js";

export default function Results() {
  const { reviewerId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const attemptId = new URLSearchParams(location.search).get("attempt");
  const attempt = attemptId ? getAttemptById(attemptId) : getLatestAttempt(reviewerId);
  const reviewer = getReviewerById(reviewerId);

  if (!attempt) {
    return <EmptyState title="No results found" message="Complete a quiz to see results here." action={<Link className="button primary" to={`/reviewer/${reviewerId}`}>Start Reviewer</Link>} />;
  }

  function retryIncorrect() {
    if (!reviewer || !attempt.incorrectQuestionIds.length) return;
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

  function retryWeakTopics() {
    if (!reviewer || !attempt.weakTopics?.length) return;
    const weakQuestionIds = reviewer.questions
      .filter((question) => attempt.weakTopics.includes(question.topic))
      .map((question) => question.id);
    const session = createQuizSession(
      reviewer,
      {
        questionCount: weakQuestionIds.length,
        questionOrder: "original",
        choiceOrder: attempt.settings.choiceOrder || "original",
        mode: "practice"
      },
      weakQuestionIds
    );
    saveQuizProgress(session);
    scheduleProgressSync(session);
    navigate(`/quiz/${reviewerId}`);
  }

  return (
    <div className="page narrow">
      <ResultsSummary attempt={attempt} />
      {attempt.topicStats?.length ? (
        <section className="results-detail-panel">
          <h2>Progress by Topic</h2>
          <div className="topic-progress-list">
            {attempt.topicStats.map((topic) => (
              <div className="topic-progress-row" key={topic.topic}>
                <div>
                  <strong>{topic.topic}</strong>
                  <span>{topic.correct} / {topic.total} correct</span>
                </div>
                <div className="topic-progress-meter" aria-label={`${topic.topic} ${topic.percentage}%`}>
                  <span style={{ width: `${topic.percentage}%` }} />
                </div>
                <strong>{topic.percentage}%</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {attempt.weakTopics?.length ? (
        <section className="results-detail-panel">
          <h2>Weak Topics</h2>
          <div className="weak-topic-list">
            {attempt.weakTopics.map((topic) => (
              <span key={topic}>{topic}</span>
            ))}
          </div>
        </section>
      ) : null}

      <div className="button-grid">
        <Link className="button primary" to={`/review/${reviewerId}?attempt=${attempt.attemptId}`}>Review Answers</Link>
        {attempt.weakTopics?.length ? (
          <button className="button subtle" type="button" onClick={retryWeakTopics}>Review Weak Topics</button>
        ) : null}
        {attempt.incorrectQuestionIds.length ? (
          <button className="button subtle" type="button" onClick={retryIncorrect}>Retry Incorrect Questions</button>
        ) : null}
        <Link className="button subtle" to={`/reviewer/${reviewerId}`}>Retake Quiz</Link>
        <Link className="button subtle" to="/">Back to Reviewers</Link>
      </div>
    </div>
  );
}
