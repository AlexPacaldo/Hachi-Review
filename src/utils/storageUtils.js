import { restoreQuizQuestions } from "./quizUtils.js";
import { applyStudyDay, mergeStudyStreaks, normalizeDayKey, normalizeRecentDays, normalizeStudyStreak, toStudyDayKey } from "./studyStats.js";

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
  studyStreak: "reviewer_study_streak",
  pendingStudyDays: "reviewer_study_days_pending",
  errorLog: "reviewer_error_log",
  notifications: "hachi_notifications",
  socialNotificationState: "hachi_social_notification_state"
};

export const REVIEWER_DATA_CHANGED_EVENT = "reviewer-data-changed";
export const SOCIAL_DATA_CHANGED_EVENT = "social-data-changed";
export const SOCIAL_NOTIFICATION_STATE_KEY = KEYS.socialNotificationState;

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

// The stores that hold one account's reviewers, progress, history, streak,
// drafts and notifications. Each gets a slot per account, so two accounts used on
// the same browser each keep their own offline state instead of overwriting one
// another, and neither is ever handed the other's.
const ACCOUNT_DATA_KEYS = [
  KEYS.progress,
  KEYS.history,
  KEYS.lastAttempt,
  KEYS.localReviewers,
  KEYS.cloudReviewerCache,
  KEYS.studyStreak,
  KEYS.pendingStudyDays,
  KEYS.generatorDraft,
  KEYS.notifications
];

// Which account is signed in, or null once that is known to be signed out.
let accountDataOwnerId = null;
let accountDataOwnerKnown = false;

// Captured before anything can overwrite it. This is the account that used the
// device last, which is the only thing that can decide whether a store written
// before the slots existed may be moved into an account's slot.
const legacyDataOwnerId = localStorage.getItem(KEYS.lastUserId);

export const ACCOUNT_DATA_CHANGED_EVENT = "account-data-changed";

export function setAccountDataOwner(userId) {
  const nextOwnerId = userId || null;
  accountDataOwnerKnown = true;
  if (accountDataOwnerId === nextOwnerId) return;
  accountDataOwnerId = nextOwnerId;

  claimUnownedStores();

  // Views read these stores synchronously and hold the result in state, so a
  // change of account has to send them back to the store rather than leave the
  // last account's data on screen until their next fetch.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ACCOUNT_DATA_CHANGED_EVENT));
  }
  notifyReviewerDataChanged();
}

function hasStoredValue(key) {
  return localStorage.getItem(key) !== null;
}

// The suffix is the account id. `:device` is the slot for work done with no
// account signed in, which belongs to no account until one claims it.
function accountKey(key) {
  return accountDataOwnerId ? `${key}:${accountDataOwnerId}` : `${key}:device`;
}

// A store written before the slots existed was written by whichever account used
// the device last, or by nobody if no account ever has.
function canAdoptLegacy() {
  if (!accountDataOwnerId) return true;
  return !legacyDataOwnerId || legacyDataOwnerId === accountDataOwnerId;
}

// Moved rather than copied, so work with no account on it cannot be claimed twice
// and the account after this one does not inherit it.
function claimUnownedStores() {
  if (!accountDataOwnerId || !canAdoptLegacy()) return;

  ACCOUNT_DATA_KEYS.forEach((key) => {
    const target = accountKey(key);
    if (hasStoredValue(target)) return;

    const source = [deviceKey(key), key].find((candidate) => hasStoredValue(candidate));
    if (!source) return;

    const value = readJson(source, null);
    if (value === null || value === undefined) return;

    // A reviewer cache is the one store whose entries record who owns them, so a
    // cache from before the slots existed cannot be moved as a whole: the
    // reviewers another account's friends own are exactly what must not come
    // with it. An entry with no owner was made on this device, so it does.
    const claimable = source === key && key === KEYS.cloudReviewerCache && Array.isArray(value)
      ? value.filter((reviewer) => !reviewer?.ownerId || reviewer.ownerId === accountDataOwnerId)
      : value;

    writeJson(target, claimable);
    localStorage.removeItem(source);
  });
}

function deviceKey(key) {
  return `${key}:device`;
}

function readAccountData(key, fallback) {
  const own = accountKey(key);
  if (hasStoredValue(own)) return readJson(own, fallback);

  // This account's slot is empty. Work done with no account signed in belongs to
  // no account rather than to another one, so it is available to whoever signs
  // in next. A page can reach this before the claim pass has run.
  if (accountDataOwnerId && hasStoredValue(deviceKey(key))) return readJson(deviceKey(key), fallback);

  // Nothing under the account's slot and nothing signed out on the device, so
  // this store predates the slots. It belongs to the account that used the device
  // last, and is left untouched for anyone else.
  if (hasStoredValue(key) && canAdoptLegacy()) return readJson(key, fallback);

  return fallback;
}

function writeAccountData(key, value) {
  // A page renders, and a mount effect writes, before the session has resolved.
  // Writing then would put this browser's empty value where another account's
  // belongs, so nothing is written until it is known whose the store is.
  if (!accountDataOwnerKnown) return;
  writeJson(accountKey(key), value === undefined ? null : value);
}

function clearAccountData(key) {
  localStorage.removeItem(accountKey(key));
}

// Everything the account slots add on top of the fixed names, so deleting the
// device data cannot leave one account's reviewers behind.
function removeAccountSlots() {
  const doomed = [];

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (ACCOUNT_DATA_KEYS.some((prefix) => key === prefix || key.startsWith(`${prefix}:`))) doomed.push(key);
  }

  doomed.forEach((key) => localStorage.removeItem(key));
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
  return readAccountData(KEYS.progress, {});
}

export function clearAllQuizProgress() {
  writeAccountData(KEYS.progress, {});
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
  writeAccountData(KEYS.progress, progress);
  notifyReviewerDataChanged();
}

export function clearQuizProgress(reviewerId) {
  const progress = getAllProgress();
  delete progress[reviewerId];
  writeAccountData(KEYS.progress, progress);
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
    writeAccountData(KEYS.progress, progress);
    notifyReviewerDataChanged();
  }

  return progress;
}

export function getAttemptHistory() {
  return readAccountData(KEYS.history, []);
}

export function saveAttempt(attempt) {
  const history = [attempt, ...getAttemptHistory()];
  writeAccountData(KEYS.history, history);
  writeAccountData(KEYS.lastAttempt, { [attempt.reviewerId]: attempt });
  notifyReviewerDataChanged();
  return history;
}

export function clearAttemptHistory() {
  writeAccountData(KEYS.history, []);
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

  writeAccountData(KEYS.history, merged);
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
    writeAccountData(KEYS.progress, progress);
    notifyReviewerDataChanged();
  }

  return progress;
}

export function getLocalReviewers() {
  return readAccountData(KEYS.localReviewers, []);
}

// could never be right for two reasons: only finished quizzes counted, and the
// attempt table prunes itself after 14 days, so any record of a longer run was
// deleted before it could be shown. The streak is now its own record of counters
// rather than a list of days: a streak is one number, so a day per row stored
// roughly 400 times more than the interface can ever use and grew forever.
export function getStudyStreak() {
  return normalizeStudyStreak(readAccountData(KEYS.studyStreak, null));
}

// Days recorded on this device that the account has not confirmed yet. Kept as a
// plain list so a day is never lost if the tab closes before the upload.
export function getPendingStudyDays() {
  return normalizeRecentDays(readAccountData(KEYS.pendingStudyDays, []));
}

// Recorded for today as soon as the learner does something, so a session that is
// started and abandoned still counts. The counters are advanced locally straight
// away, which is what keeps the interface correct while offline, and the day is
// queued for the account separately.
export function markStudyDay(day = toStudyDayKey(new Date())) {
  if (!normalizeDayKey(day)) return getStudyStreak();

  const next = applyStudyDay(getStudyStreak(), day);
  const pending = new Set(getPendingStudyDays());

  pending.add(day);
  writeAccountData(KEYS.studyStreak, next);
  writeAccountData(KEYS.pendingStudyDays, [...pending].sort());
  notifyReviewerDataChanged();
  return next;
}

// Merged rather than overwritten. Two devices can each hold a partly advanced
// record, and neither is allowed to lower a number the other has already seen.
export function mergeCloudStudyStreak(cloudStreak) {
  const merged = mergeStudyStreaks(getStudyStreak(), cloudStreak);
  if (JSON.stringify(merged) === JSON.stringify(getStudyStreak())) return merged;

  writeAccountData(KEYS.studyStreak, merged);
  notifyReviewerDataChanged();
  return merged;
}

// Called once the account has accepted the days, so they are not re-uploaded on
// every sign-in. Only ever removes from the pending list.
export function clearPendingStudyDays(days) {
  const confirmed = new Set(normalizeRecentDays(days));
  if (!confirmed.size) return getPendingStudyDays();

  const pending = getPendingStudyDays().filter((day) => !confirmed.has(day));
  writeAccountData(KEYS.pendingStudyDays, pending);
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
  writeAccountData(KEYS.localReviewers, nextReviewers);
  notifyReviewerDataChanged();
  return nextReviewers;
}

export function deleteLocalReviewer(reviewerId) {
  const nextReviewers = getLocalReviewers().filter((reviewer) => reviewer.reviewerId !== reviewerId);
  writeAccountData(KEYS.localReviewers, nextReviewers);
  clearQuizProgress(reviewerId);
  notifyReviewerDataChanged();
  return nextReviewers;
}

export function clearLocalReviewers() {
  writeAccountData(KEYS.localReviewers, []);
  notifyReviewerDataChanged();
}

// Called when the account says a reviewer was deleted on another device. Both
// stores have to go: the offline copy, and the read cache that keeps rendering a
// card for a reviewer the cloud no longer has. The quiz session goes with it,
// because a session cannot be resumed without its questions.
export function forgetTombstonedReviewers(reviewerIds) {
  const ids = new Set((Array.isArray(reviewerIds) ? reviewerIds : []).filter(Boolean));

  if (!ids.size) return { local: 0, cached: 0, progress: 0 };

  const keptLocal = getLocalReviewers().filter((reviewer) => !ids.has(reviewer?.reviewerId));
  const keptCache = getCloudReviewerCache().filter((reviewer) => !ids.has(reviewer?.reviewerId));

  const local = getLocalReviewers().length - keptLocal.length;
  const cached = getCloudReviewerCache().length - keptCache.length;

  let progress = 0;
  const sessions = getAllProgress();

  ids.forEach((id) => {
    if (sessions[id]) {
      delete sessions[id];
      progress += 1;
    }
  });

  if (progress) writeAccountData(KEYS.progress, sessions);

  if (local) writeAccountData(KEYS.localReviewers, keptLocal);
  if (cached) writeAccountData(KEYS.cloudReviewerCache, keptCache);

  if (local || cached || progress) notifyReviewerDataChanged();

  return { local, cached, progress };
}

export function getCloudReviewerCache() {
  const stored = readAccountData(KEYS.cloudReviewerCache, []);
  return Array.isArray(stored) ? stored : [];
}

export function saveCloudReviewerCache(reviewers) {
  const nextReviewers = Array.isArray(reviewers) ? reviewers : [];
  writeAccountData(KEYS.cloudReviewerCache, nextReviewers);
  notifyReviewerDataChanged();
  return nextReviewers;
}

export function clearCloudReviewerCache() {
  clearAccountData(KEYS.cloudReviewerCache);
  notifyReviewerDataChanged();
}

// The list arrives as summaries, with no questions. Merging keeps the full
// reviewer already cached for anything that has been opened, so a summary can
// never strip questions a reviewer still needs offline. A reviewer owned by a
// friend or a group peer is kept as it arrives: whether it may be read is the
// account stamp's decision, not the owner's.
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
  writeAccountData(KEYS.cloudReviewerCache, next);
  notifyReviewerDataChanged();
  return next;
}

// Same merge as above, but the visible list is the authority: a cached
// reviewer the cloud no longer returns (a friend deleted it, a share was
// revoked, the owner removed it from their account) is dropped here instead
// of lingering on Home forever. Explicit offline saves live in the local
// reviewer store and are untouched by this. Unlike the additive merge, an
// empty list really does clear the cache.
export function reconcileCloudReviewerCache(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const visibleIds = new Set(list.map((entry) => entry?.reviewerId).filter(Boolean));
  const merged = mergeCloudReviewerCache(list);
  const next = merged.filter((reviewer) => visibleIds.has(reviewer?.reviewerId));
  const pruned = merged.length - next.length;

  if (pruned > 0 || !list.length) {
    writeAccountData(KEYS.cloudReviewerCache, next);
    notifyReviewerDataChanged();
  }

  return next;
}

// Called once a reviewer has been fetched in full, so reopening it works offline.
export function cacheCloudReviewer(reviewer) {
  if (!reviewer?.reviewerId) return getCloudReviewerCache();
  return mergeCloudReviewerCache([reviewer]);
}

export function getGeneratorDraft() {
  return readAccountData(KEYS.generatorDraft, null);
}

export function saveGeneratorDraft(draft) {
  writeAccountData(KEYS.generatorDraft, {
    ...draft,
    savedAt: new Date().toISOString()
  });
}

export function clearGeneratorDraft() {
  clearAccountData(KEYS.generatorDraft);
}

// The toast history names friends and reviewers, so it is held per account for
// the same reason as the stores above.
export function getNotificationHistory() {
  const stored = readAccountData(KEYS.notifications, []);
  return Array.isArray(stored) ? stored : [];
}

export function saveNotificationHistory(notifications) {
  writeAccountData(KEYS.notifications, Array.isArray(notifications) ? notifications : []);
}

export function clearAllDeviceData() {
  // The fixed names first, then every account slot, which is suffixed with the
  // account id. Removing a store only ever took the signed-in account's copy, so
  // the names in KEYS alone would leave the other accounts on this device behind.
  removeAccountSlots();
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

  // Restoring is a deliberate import of a file the browser owner chose, so the
  // values land under whichever account is signed in. The account stores are
  // stamped by the writer, which is what stops the import being read back by
  // another account later.
  writeAccountData(KEYS.progress, isObject(snapshot.progress) ? snapshot.progress : {});
  writeAccountData(KEYS.history, Array.isArray(snapshot.history) ? snapshot.history : []);
  writeAccountData(KEYS.lastAttempt, isObject(snapshot.lastAttempt) ? snapshot.lastAttempt : {});
  writeAccountData(KEYS.localReviewers, Array.isArray(snapshot.localReviewers) ? snapshot.localReviewers : []);
  writeAccountData(KEYS.cloudReviewerCache, Array.isArray(snapshot.cloudReviewerCache) ? snapshot.cloudReviewerCache : []);
  writeJson(KEYS.syncQueue, Array.isArray(snapshot.syncQueue) ? snapshot.syncQueue : []);
  writeJson(KEYS.pendingDeletes, Array.isArray(snapshot.pendingDeletes) ? snapshot.pendingDeletes : []);
  writeJson(KEYS.errorLog, Array.isArray(snapshot.errorLog) ? snapshot.errorLog.slice(0, 25) : []);

  if (isObject(snapshot.generatorDraft)) {
    writeAccountData(KEYS.generatorDraft, snapshot.generatorDraft);
  } else {
    clearAccountData(KEYS.generatorDraft);
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
    lastAttempt: readAccountData(KEYS.lastAttempt, {}),
    localReviewers: getLocalReviewers(),
    cloudReviewerCache: getCloudReviewerCache(),
    generatorDraft: getGeneratorDraft(),
    syncQueue: getAllQueuedItems(),
    pendingDeletes: getPendingDeletes(),
    errorLog: readJson(KEYS.errorLog, []),
    theme: getThemePreference()
  };
}
