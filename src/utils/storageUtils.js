import { restoreQuizQuestions } from "./quizUtils.js";
import { normalizeStudyDays, toStudyDayKey } from "./studyStats.js";

const KEYS = {
  progress: "reviewer_quiz_progress",
  history: "reviewer_attempt_history",
  theme: "reviewer_theme",
  lastAttempt: "reviewer_last_attempt",
  localReviewers: "reviewer_local_reviewers",
  cloudReviewerCache: "reviewer_cloud_reviewer_cache",
  generatorDraft: "reviewer_generator_draft",
  syncQueue: "reviewer_sync_queue",
  pendingDeletes: "reviewer_pending_deletes",
  lastUserId: "reviewer_last_user_id",
  studyDays: "reviewer_study_days",
  pendingStudyDays: "reviewer_study_days_pending",
  errorLog: "reviewer_error_log"
};

export const REVIEWER_DATA_CHANGED_EVENT = "reviewer-data-changed";
export const SOCIAL_DATA_CHANGED_EVENT = "social-data-changed";

function readJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function notifyReviewerDataChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(REVIEWER_DATA_CHANGED_EVENT));
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isReviewerLike(value) {
  return isObject(value) &&
    typeof value.reviewerId === "string" &&
    typeof value.title === "string" &&
    typeof value.subject === "string" &&
    Array.isArray(value.questions);
}

function assertBackupArray(name, value, { maxItems = 1000, itemCheck = null } = {}) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new Error(`Backup ${name} must be a list.`);
  }
  if (value.length > maxItems) {
    throw new Error(`Backup ${name} has too many items.`);
  }
  if (itemCheck && value.some((item) => !itemCheck(item))) {
    throw new Error(`Backup ${name} contains invalid data.`);
  }
}

function validateLocalDataSnapshot(snapshot) {
  if (!isObject(snapshot)) {
    throw new Error("Backup file must contain a local data object.");
  }

  const knownKeys = ["progress", "history", "lastAttempt", "localReviewers", "cloudReviewerCache", "generatorDraft", "syncQueue", "pendingDeletes", "errorLog", "theme", "exportedAt"];
  const hasKnownKey = knownKeys.some((key) => Object.prototype.hasOwnProperty.call(snapshot, key));

  if (!hasKnownKey) {
    throw new Error("Backup file does not look like a Hachi backup.");
  }

  assertBackupArray("history", snapshot.history, { maxItems: 2500 });
  assertBackupArray("localReviewers", snapshot.localReviewers, { maxItems: 250, itemCheck: isReviewerLike });
  assertBackupArray("cloudReviewerCache", snapshot.cloudReviewerCache, { maxItems: 250, itemCheck: isReviewerLike });
  assertBackupArray("syncQueue", snapshot.syncQueue, { maxItems: 250 });
  assertBackupArray("pendingDeletes", snapshot.pendingDeletes, { maxItems: 250 });
  assertBackupArray("errorLog", snapshot.errorLog, { maxItems: 25 });

  if (snapshot.progress !== undefined && !isObject(snapshot.progress)) {
    throw new Error("Backup progress must be an object.");
  }
  if (snapshot.lastAttempt !== undefined && !isObject(snapshot.lastAttempt)) {
    throw new Error("Backup last attempt data must be an object.");
  }
  if (snapshot.generatorDraft !== undefined && snapshot.generatorDraft !== null && !isObject(snapshot.generatorDraft)) {
    throw new Error("Backup generator draft must be an object.");
  }
}

export function getThemePreference() {
  return localStorage.getItem(KEYS.theme) || "light";
}

export function saveThemePreference(theme) {
  localStorage.setItem(KEYS.theme, theme);
}

export function getAllProgress() {
  return readJson(KEYS.progress, {});
}

export function clearAllQuizProgress() {
  writeJson(KEYS.progress, {});
  notifyReviewerDataChanged();
}

export function loadQuizProgress(reviewerId) {
  return getAllProgress()[reviewerId] || null;
}

export function saveQuizProgress(session) {
  const progress = getAllProgress();
  progress[session.reviewerId] = {
    ...session,
    updatedAt: session.updatedAt || Date.now()
  };
  writeJson(KEYS.progress, progress);
  notifyReviewerDataChanged();
}

export function clearQuizProgress(reviewerId) {
  const progress = getAllProgress();
  delete progress[reviewerId];
  writeJson(KEYS.progress, progress);
  notifyReviewerDataChanged();
}

export function getProgressTimestamp(session) {
  const value = Number(session?.updatedAt);
  if (Number.isFinite(value) && value > 0) return value;
  const started = Date.parse(session?.startedAt || "");
  return Number.isFinite(started) ? started : 0;
}

export function mergeCloudProgress(cloudSessions, reviewersById = new Map()) {
  const sessions = Array.isArray(cloudSessions) ? cloudSessions : [];
  if (!sessions.length) return getAllProgress();

  const progress = getAllProgress();
  let changed = false;

  sessions.forEach((session) => {
    if (!session?.reviewerId) return;
    const restored = restoreQuizQuestions(session, reviewersById.get(session.reviewerId));
    // A record whose reviewer is not on this device stays out rather than
    // replacing good local progress with a session that has no questions.
    if (!restored) return;
    const existing = progress[session.reviewerId];
    if (existing && getProgressTimestamp(existing) >= getProgressTimestamp(session)) return;
    progress[session.reviewerId] = restored;
    changed = true;
  });

  if (changed) {
    writeJson(KEYS.progress, progress);
    notifyReviewerDataChanged();
  }

  return progress;
}

export function getAttemptHistory() {
  return readJson(KEYS.history, []);
}

export function saveAttempt(attempt) {
  const history = [attempt, ...getAttemptHistory()];
  writeJson(KEYS.history, history);
  writeJson(KEYS.lastAttempt, { [attempt.reviewerId]: attempt });
  notifyReviewerDataChanged();
  return history;
}

export function clearAttemptHistory() {
  writeJson(KEYS.history, []);
  notifyReviewerDataChanged();
}

function getAttemptTimestamp(attempt) {
  const value = Date.parse(attempt?.date || "");
  if (Number.isFinite(value)) return value;
  return 0;
}

export function mergeCloudAttempts(cloudRows, reviewersById = new Map()) {
  const rows = Array.isArray(cloudRows) ? cloudRows : [];
  if (!rows.length) return getAttemptHistory();

  const byId = new Map();

  getAttemptHistory().forEach((attempt) => {
    if (attempt?.attemptId) byId.set(attempt.attemptId, attempt);
  });

  const before = byId.size;
  rows.forEach((row) => {
    const raw = row?.data || row;
    if (!raw?.attemptId) return;
    // Same rule as progress: an attempt is only merged once its questions can be
    // rebuilt, so ReviewAnswers never sees a record it cannot display.
    const attempt = restoreQuizQuestions(raw, reviewersById.get(raw.reviewerId));
    if (!attempt) return;
    const existing = byId.get(attempt.attemptId);
    if (existing && getAttemptTimestamp(existing) >= getAttemptTimestamp(attempt)) return;
    byId.set(attempt.attemptId, attempt);
  });

  if (byId.size === before) return getAttemptHistory();

  const merged = [...byId.values()].sort((a, b) => getAttemptTimestamp(b) - getAttemptTimestamp(a));

  writeJson(KEYS.history, merged);
  notifyReviewerDataChanged();
  return merged;
}

export function getAttemptById(attemptId) {
  return getAttemptHistory().find((attempt) => attempt.attemptId === attemptId) || null;
}

export function getLatestAttempt(reviewerId) {
  return getAttemptHistory().find((attempt) => attempt.reviewerId === reviewerId) || null;
}

// Finishing a quiz clears progress, but that clear only reaches the device that
// finished it. Without this, a second device kept showing "In progress" forever
// and kept pushing that stale session back to the account, which is what made two
// signed-in devices disagree about a reviewer's status. An attempt for a reviewer
// is proof the quiz was completed, so any progress older than the newest such
// attempt has already been superseded.
export function dropProgressOlderThanAttempts(attempts = getAttemptHistory()) {
  const newestAttemptAt = new Map();

  (Array.isArray(attempts) ? attempts : []).forEach((attempt) => {
    if (!attempt?.reviewerId) return;
    const at = getAttemptTimestamp(attempt);
    if (at > (newestAttemptAt.get(attempt.reviewerId) || 0)) {
      newestAttemptAt.set(attempt.reviewerId, at);
    }
  });

  if (!newestAttemptAt.size) return getAllProgress();

  const progress = getAllProgress();
  let changed = false;

  Object.keys(progress).forEach((reviewerId) => {
    const completedAt = newestAttemptAt.get(reviewerId);
    if (!completedAt) return;
    if (getProgressTimestamp(progress[reviewerId]) >= completedAt) return;
    delete progress[reviewerId];
    changed = true;
  });

  if (changed) {
    writeJson(KEYS.progress, progress);
    notifyReviewerDataChanged();
  }

  return progress;
}

export function getLocalReviewers() {
  return readJson(KEYS.localReviewers, []);
}

// The study streak used to be worked out from the attempt history, which meant it
// could never be right for two reasons: only finished quizzes counted, and the
// attempt table prunes itself after 14 days, so any record of a longer run was
// deleted before it could be shown. These are the days the learner actually
// studied, kept as plain day keys in a ledger of their own.
export function getStudyDays() {
  return normalizeStudyDays(readJson(KEYS.studyDays, []));
}

export function getPendingStudyDays() {
  return normalizeStudyDays(readJson(KEYS.pendingStudyDays, []));
}

// Recorded for today as soon as the learner actually does something, so a session
// that is started and abandoned still counts. Written locally straight away and
// queued for the account separately, so the streak is never lost because the
// upload had not happened yet.
export function markStudyDay(day = toStudyDayKey(new Date())) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return getStudyDays();

  const days = new Set(getStudyDays());
  if (days.has(day)) return [...days].sort();
  days.add(day);

  const pending = new Set(getPendingStudyDays());
  pending.add(day);

  const next = [...days].sort();
  writeJson(KEYS.studyDays, next);
  writeJson(KEYS.pendingStudyDays, [...pending].sort());
  notifyReviewerDataChanged();
  return next;
}

// Additive on purpose. A studied day is a habit record rather than answer data,
// so it is never removed here, and clearing quiz history leaves the streak alone.
export function mergeCloudStudyDays(cloudDays) {
  const days = new Set(getStudyDays());
  let changed = false;

  normalizeStudyDays(cloudDays).forEach((day) => {
    if (days.has(day)) return;
    days.add(day);
    changed = true;
  });

  if (!changed) return getStudyDays();

  const next = [...days].sort();
  writeJson(KEYS.studyDays, next);
  notifyReviewerDataChanged();
  return next;
}

// Called once the account has accepted the days, so they are not re-uploaded on
// every sign-in. Only ever removes from the pending list.
export function clearPendingStudyDays(days) {
  const confirmed = new Set(normalizeStudyDays(days));
  if (!confirmed.size) return getPendingStudyDays();

  const pending = getPendingStudyDays().filter((day) => !confirmed.has(day));
  writeJson(KEYS.pendingStudyDays, pending);
  return pending;
}

export function saveLocalReviewer(reviewer) {
  const existing = getLocalReviewers().filter((item) => item.reviewerId !== reviewer.reviewerId);
  const nextReviewers = [
    {
      ...reviewer,
      savedAt: new Date().toISOString()
    },
    ...existing
  ];
  writeJson(KEYS.localReviewers, nextReviewers);
  notifyReviewerDataChanged();
  return nextReviewers;
}

export function deleteLocalReviewer(reviewerId) {
  const nextReviewers = getLocalReviewers().filter((reviewer) => reviewer.reviewerId !== reviewerId);
  writeJson(KEYS.localReviewers, nextReviewers);
  clearQuizProgress(reviewerId);
  notifyReviewerDataChanged();
  return nextReviewers;
}

export function clearLocalReviewers() {
  writeJson(KEYS.localReviewers, []);
  notifyReviewerDataChanged();
}

export function getCloudReviewerCache() {
  return readJson(KEYS.cloudReviewerCache, []);
}

export function saveCloudReviewerCache(reviewers) {
  const nextReviewers = Array.isArray(reviewers) ? reviewers : [];
  writeJson(KEYS.cloudReviewerCache, nextReviewers);
  notifyReviewerDataChanged();
  return nextReviewers;
}

export function clearCloudReviewerCache() {
  localStorage.removeItem(KEYS.cloudReviewerCache);
  notifyReviewerDataChanged();
}

// The list arrives as summaries, with no questions. Merging keeps the full
// reviewer already cached for anything that has been opened, so a summary can
// never strip questions a reviewer still needs offline.
export function mergeCloudReviewerCache(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return getCloudReviewerCache();

  const byId = new Map(getCloudReviewerCache().map((reviewer) => [reviewer.reviewerId, reviewer]));

  list.forEach((entry) => {
    const id = entry?.reviewerId;
    if (!id) return;

    const existing = byId.get(id);
    const keepsQuestions = Array.isArray(existing?.questions) && !Array.isArray(entry.questions);

    byId.set(id, keepsQuestions ? { ...existing, ...entry, questions: existing.questions } : entry);
  });

  const next = [...byId.values()];
  writeJson(KEYS.cloudReviewerCache, next);
  notifyReviewerDataChanged();
  return next;
}

// Called once a reviewer has been fetched in full, so reopening it works offline.
export function cacheCloudReviewer(reviewer) {
  if (!reviewer?.reviewerId) return getCloudReviewerCache();
  return mergeCloudReviewerCache([reviewer]);
}

export function getGeneratorDraft() {
  return readJson(KEYS.generatorDraft, null);
}

export function saveGeneratorDraft(draft) {
  writeJson(KEYS.generatorDraft, {
    ...draft,
    savedAt: new Date().toISOString()
  });
}

export function clearGeneratorDraft() {
  localStorage.removeItem(KEYS.generatorDraft);
}

export function clearAllDeviceData() {
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
  notifyReviewerDataChanged();
}

export function getAllQueuedItems() {
  return readJson(KEYS.syncQueue, []);
}

export function getSyncQueue(userId) {
  const items = getAllQueuedItems();
  if (!userId) return [];
  return items.filter((item) => item.userId === userId);
}

export function getLastUserId() {
  return localStorage.getItem(KEYS.lastUserId) || null;
}

export function setLastUserId(userId) {
  if (userId) localStorage.setItem(KEYS.lastUserId, userId);
}

export function getPendingDeletes() {
  return readJson(KEYS.pendingDeletes, []);
}

export function getPendingDeletesForUser(userId) {
  if (!userId) return [];
  return getPendingDeletes().filter((item) => item.userId === userId);
}

export function queuePendingDelete({ userId, type, reviewerId = null }) {
  if (!userId || !type) return getPendingDeletes();

  const existing = getPendingDeletes().filter((item) => !itemMatches(item, { userId, type, reviewerId }));
  const nextQueue = [
    ...existing,
    {
      userId,
      type,
      reviewerId,
      deletedAt: new Date().toISOString()
    }
  ];

  writeJson(KEYS.pendingDeletes, nextQueue);
  return nextQueue;
}

export function removePendingDelete(userId, type, reviewerId = undefined) {
  const nextQueue = getPendingDeletes().filter((item) => !itemMatches(item, { userId, type, reviewerId }));
  writeJson(KEYS.pendingDeletes, nextQueue);
  return nextQueue;
}

function writeQueue(items) {
  writeJson(KEYS.syncQueue, items);
  notifyReviewerDataChanged();
}

function itemMatches(item, { userId, type, reviewerId }) {
  return item.userId === userId &&
    item.type === type &&
    (reviewerId === undefined || item.reviewerId === reviewerId);
}

export function queueSyncItem({ userId, type, reviewerId = null, payload = null }) {
  if (!userId || !type) return getAllQueuedItems();

  const existing = getAllQueuedItems().filter((item) => !itemMatches(item, { userId, type, reviewerId }));
  const nextQueue = [
    ...existing,
    {
      id: `${userId}:${type}:${reviewerId || "all"}`,
      userId,
      type,
      reviewerId,
      payload,
      queuedAt: new Date().toISOString()
    }
  ];

  writeQueue(nextQueue);
  return nextQueue;
}

export function queueReviewerForCloudSync(userId, reviewer) {
  if (!reviewer?.reviewerId) return getAllQueuedItems();
  return queueSyncItem({
    userId,
    type: "upsert-reviewer",
    reviewerId: reviewer.reviewerId,
    payload: reviewer
  });
}

export function removeSyncItem(userId, type, reviewerId = undefined) {
  const nextQueue = getAllQueuedItems().filter((item) => !itemMatches(item, { userId, type, reviewerId }));
  writeQueue(nextQueue);
  return nextQueue;
}

const QUEUE_CONFLICTS = {
  "clear-attempts": ["upsert-attempt"],
  "clear-progress": ["upsert-progress"],
  "delete-progress": ["upsert-progress"]
};

export function dropConflictingQueueItems(userId, type, reviewerId = undefined) {
  const conflictingTypes = QUEUE_CONFLICTS[type];
  if (!conflictingTypes) return getAllQueuedItems();

  const nextQueue = getAllQueuedItems().filter((item) => {
    if (item.userId !== userId) return true;
    if (!conflictingTypes.includes(item.type)) return true;
    return reviewerId !== undefined && item.reviewerId !== reviewerId;
  });

  writeQueue(nextQueue);
  return nextQueue;
}

export function clearSyncQueue(userId) {
  if (!userId) {
    localStorage.removeItem(KEYS.syncQueue);
    notifyReviewerDataChanged();
    return;
  }

  const nextQueue = getAllQueuedItems().filter((item) => item.userId !== userId);
  writeQueue(nextQueue);
}

export function restoreLocalDataSnapshot(snapshot) {
  validateLocalDataSnapshot(snapshot);

  writeJson(KEYS.progress, isObject(snapshot.progress) ? snapshot.progress : {});
  writeJson(KEYS.history, Array.isArray(snapshot.history) ? snapshot.history : []);
  writeJson(KEYS.lastAttempt, isObject(snapshot.lastAttempt) ? snapshot.lastAttempt : {});
  writeJson(KEYS.localReviewers, Array.isArray(snapshot.localReviewers) ? snapshot.localReviewers : []);
  writeJson(KEYS.cloudReviewerCache, Array.isArray(snapshot.cloudReviewerCache) ? snapshot.cloudReviewerCache : []);
  writeJson(KEYS.syncQueue, Array.isArray(snapshot.syncQueue) ? snapshot.syncQueue : []);
  writeJson(KEYS.pendingDeletes, Array.isArray(snapshot.pendingDeletes) ? snapshot.pendingDeletes : []);
  writeJson(KEYS.errorLog, Array.isArray(snapshot.errorLog) ? snapshot.errorLog.slice(0, 25) : []);

  if (isObject(snapshot.generatorDraft)) {
    writeJson(KEYS.generatorDraft, snapshot.generatorDraft);
  } else {
    localStorage.removeItem(KEYS.generatorDraft);
  }

  if (typeof snapshot.theme === "string") {
    saveThemePreference(snapshot.theme);
  }

  notifyReviewerDataChanged();
  return getLocalDataSnapshot();
}

export function getLocalDataSnapshot() {
  return {
    exportedAt: new Date().toISOString(),
    progress: getAllProgress(),
    history: getAttemptHistory(),
    lastAttempt: readJson(KEYS.lastAttempt, {}),
    localReviewers: getLocalReviewers(),
    cloudReviewerCache: getCloudReviewerCache(),
    generatorDraft: getGeneratorDraft(),
    syncQueue: getAllQueuedItems(),
    pendingDeletes: getPendingDeletes(),
    errorLog: readJson(KEYS.errorLog, []),
    theme: getThemePreference()
  };
}
