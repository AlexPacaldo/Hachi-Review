// Practice Mode's adaptive retry. One continuous quiz: a missed question goes
// into a pending pool, reappears a few questions later, and only leaves once it
// has been answered correctly. It never becomes a second round.

const MIN_RETRY_GAP = 3; // questions later the retry becomes due
const MAX_RETRY_GAP = 5;

export function createPracticeTracker() {
  return { stats: {}, pending: [], totalRetries: 0 };
}

function ensureStat(tracker, questionId, topic) {
  if (!tracker.stats[questionId]) {
    tracker.stats[questionId] = {
      incorrectCount: 0,
      correctCount: 0,
      retryCount: 0,
      mastered: false,
      resolved: false,
      everMissed: false,
      topic: topic || "General"
    };
  }

  if (topic && tracker.stats[questionId].topic === "General") {
    tracker.stats[questionId].topic = topic;
  }

  return tracker.stats[questionId];
}

function bumpStat(tracker, questionId, topic, patch) {
  const stats = { ...tracker.stats, [questionId]: { ...ensureStat(tracker, questionId, topic), ...patch } };
  return { ...tracker, stats };
}

// Recorded the moment an answer is checked, so a correct answer on the first
// try counts as resolved, and a correct retry counts as mastered.
export function recordPracticeOutcome(tracker, question, isCorrect, isRetry, currentIndex) {
  const questionId = question?.id;
  if (!questionId) return tracker;

  const stat = ensureStat(tracker, questionId, question.topic);

  if (isCorrect) {
    return bumpStat(tracker, questionId, question.topic, {
      correctCount: stat.correctCount + 1,
      resolved: true,
      mastered: stat.mastered || isRetry,
      ...(isRetry ? {} : { firstTryCorrect: true })
    });
  }

  const incorrectCount = stat.incorrectCount + 1;
  const withoutThis = tracker.pending.filter((entry) => entry.id !== questionId);
  const gap = MIN_RETRY_GAP + Math.floor(Math.random() * (MAX_RETRY_GAP - MIN_RETRY_GAP + 1));

  return {
    ...bumpStat(
      { ...tracker, pending: withoutThis },
      questionId,
      question.topic,
      { incorrectCount, everMissed: true, ...(isRetry ? {} : { firstTryCorrect: false }) }
    ),
    pending: [...withoutThis, { id: questionId, incorrectCount, eligibleAt: currentIndex + gap }]
  };
}

function byPriority(left, right) {
  return right.incorrectCount - left.incorrectCount || left.eligibleAt - right.eligibleAt;
}

// The retry due at or before nextIndex, if any. Repeated mistakes win, so the
// question the learner keeps failing is what comes back next.
export function getDueRetry(tracker, nextIndex) {
  const due = (tracker?.pending || []).filter((entry) => entry.eligibleAt <= nextIndex);
  return due.length ? [...due].sort(byPriority)[0] : null;
}

// When the original list runs out, pending retries still have to surface,
// otherwise the quiz could end with the learner's mistakes stranded.
export function getMostUrgentRetry(tracker) {
  const pending = tracker?.pending || [];
  return pending.length ? [...pending].sort(byPriority)[0] : null;
}

// One entry per question: a worse mistake re-times the existing entry rather
// than stacking a second one for the same question.
export function markRetryServed(tracker, questionId, topic) {
  const stat = ensureStat(tracker, questionId, topic);

  return {
    ...bumpStat(tracker, questionId, topic, { retryCount: stat.retryCount + 1 }),
    pending: tracker.pending.filter((entry) => entry.id !== questionId),
    totalRetries: tracker.totalRetries + 1
  };
}

// A new question has just been inserted into the flow at nextIndex, so every
// later retry slides back by one slot and keeps its spacing.
export function shiftPendingEligibility(tracker, nextIndex) {
  return {
    ...tracker,
    pending: tracker.pending.map((entry) =>
      entry.eligibleAt >= nextIndex ? { ...entry, eligibleAt: entry.eligibleAt + 1 } : entry
    )
  };
}

export function countResolved(tracker) {
  return Object.values(tracker?.stats || {}).filter((stat) => stat.resolved).length;
}

export function summarizePractice(tracker) {
  const stats = Object.values(tracker?.stats || {});
  const difficult = stats
    .filter((stat) => stat.incorrectCount > 0)
    .sort((left, right) => right.incorrectCount - left.incorrectCount)[0];

  const total = stats.length;
  const firstTryCorrect = stats.filter((stat) => stat.firstTryCorrect === true).length;
  const initiallyMissed = stats.filter((stat) => stat.everMissed).length;
  const masteredAfterRetry = stats.filter((stat) => stat.mastered && stat.everMissed).length;

  return {
    total,
    firstTryCorrect,
    firstTryRate: total ? Math.round((firstTryCorrect / total) * 100) : 0,
    initiallyMissed,
    masteredAfterRetry,
    unresolved: stats.filter((stat) => !stat.resolved).length,
    totalRetries: tracker?.totalRetries || 0,
    mostDifficultTopic: difficult ? difficult.topic : null
  };
}
