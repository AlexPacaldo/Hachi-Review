import { isSupabaseConfigured } from "../lib/supabaseClient.js";
import {
  clearCloudAttempts,
  clearCloudProgress,
  deleteCloudProgress,
  listCloudAttempts,
  listCloudProgress,
  pruneOldCloudAttempts,
  upsertCloudAttempt,
  upsertCloudProgress
} from "./cloudProgress.js";
import { listCloudReviewersByIds, listMyCloudReviewers, upsertCloudReviewer } from "./cloudReviewers.js";
import { listCloudStudyDays, markCloudStudyDays } from "./cloudStudyDays.js";
import {
  getAttemptHistory,
  getCloudReviewerCache,
  getLastUserId,
  getLocalReviewers,
  getAllProgress,
  getPendingDeletesForUser,
  getPendingStudyDays,
  getProgressTimestamp,
  getSyncQueue,
  cacheCloudReviewer,
  clearPendingStudyDays,
  mergeCloudAttempts,
  mergeCloudProgress,
  mergeCloudStudyDays,
  dropProgressOlderThanAttempts,
  dropConflictingQueueItems,
  queuePendingDelete,
  queueSyncItem,
  removePendingDelete,
  removeSyncItem,
  saveCloudReviewerCache,
  setLastUserId
} from "../utils/storageUtils.js";

const PROGRESS_DEBOUNCE_MS = 4000;
const STUDY_DAY_DEBOUNCE_MS = 8000;
const DELETE_TYPES = new Set(["delete-progress", "clear-progress", "clear-attempts"]);

let activeUserId = null;
let studyDayTimer = null;
const pendingProgress = new Map();

export function setSyncUser(userId) {
  activeUserId = userId || null;
  if (activeUserId) setLastUserId(activeUserId);
}

function canWrite() {
  return isSupabaseConfigured && Boolean(activeUserId);
}

async function runOrQueue({ type, reviewerId, payload, write }) {
  if (!canWrite()) {
    // Deletes still have to reach the account, but there is no user id to write
    // under while signed out, so record a tombstone for the last known account.
    const ownerId = DELETE_TYPES.has(type) ? getLastUserId() : null;
    if (ownerId) queuePendingDelete({ userId: ownerId, type, reviewerId });
    return { queued: Boolean(ownerId), error: null };
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    queueSyncItem({ userId: activeUserId, type, reviewerId, payload });
    return { queued: true, error: null };
  }

  const { error } = await write();
  if (error) queueSyncItem({ userId: activeUserId, type, reviewerId, payload });
  return { queued: Boolean(error), error };
}

export async function pushProgressToCloud(session) {
  if (!session?.reviewerId) return { queued: false, error: null };
  return runOrQueue({
    type: "upsert-progress",
    reviewerId: session.reviewerId,
    payload: session,
    write: () => upsertCloudProgress(activeUserId, session)
  });
}

function toStorableReviewer(reviewer) {
  const { source, storageStatus, validation, ...rest } = reviewer;
  return rest;
}

export async function saveReviewerToAccount(userId, reviewer) {
  if (!reviewer?.reviewerId) {
    return { data: null, error: new Error("This reviewer is missing a reviewer ID.") };
  }

  if (!isSupabaseConfigured || !userId) {
    return { data: null, error: new Error("Sign in to save this reviewer to your account.") };
  }

  // A reviewer is private until it is explicitly shared, and an existing group
  // share stays a group share. Settling the scope here keeps the upsert from
  // having to read the row back to avoid widening the audience.
  const payload = {
    ...toStorableReviewer(reviewer),
    visibility: reviewer.visibility
      || (Array.isArray(reviewer.sharedGroups) && reviewer.sharedGroups.length ? "group" : "private")
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    queueSyncItem({ userId, type: "upsert-reviewer", reviewerId: payload.reviewerId, payload });
    return { data: null, error: null, queued: true };
  }

  return upsertCloudReviewer(userId, payload);
}

export async function pushAttemptToCloud(attempt) {
  if (!attempt?.attemptId) return { queued: false, error: null };
  return runOrQueue({
    type: "upsert-attempt",
    reviewerId: attempt.reviewerId,
    payload: attempt,
    write: () => upsertCloudAttempt(activeUserId, attempt)
  });
}

export async function pushRemovedProgressToCloud(reviewerId) {
  return runOrQueue({
    type: "delete-progress",
    reviewerId,
    payload: null,
    write: () => deleteCloudProgress(activeUserId, reviewerId)
  });
}

export async function pushClearedProgressToCloud() {
  return runOrQueue({
    type: "clear-progress",
    reviewerId: null,
    payload: null,
    write: () => clearCloudProgress(activeUserId)
  });
}

export async function pushClearedHistoryToCloud() {
  return runOrQueue({
    type: "clear-attempts",
    reviewerId: null,
    payload: null,
    write: () => clearCloudAttempts(activeUserId)
  });
}

// Study days are uploaded on their own rather than riding along with progress, so
// the streak is never lost when a session is cleared or a quiz is finished. A
// failure leaves them pending, so they are retried on the next sync instead of
// being dropped.
export async function pushStudyDaysToCloud() {
  if (!canWrite()) return { studyDays: 0, error: null };

  const pending = getPendingStudyDays();
  if (!pending.length) return { studyDays: 0, error: null };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { studyDays: 0, queued: true, error: null };
  }

  const { error } = await markCloudStudyDays(activeUserId, pending);
  if (error) return { studyDays: 0, error };

  clearPendingStudyDays(pending);
  return { studyDays: pending.length, error: null };
}

// The pending list is durable in local storage, so a day is never lost even if
// this never fires. Debounced anyway so the streak reaches the other devices
// during a session instead of waiting for the next sign-in, and skipped
// entirely when there is nothing new to send.
export function scheduleStudyDaySync() {
  if (!canWrite()) return;
  if (!getPendingStudyDays().length) return;

  if (studyDayTimer) window.clearTimeout(studyDayTimer);
  studyDayTimer = window.setTimeout(() => {
    studyDayTimer = null;
    pushStudyDaysToCloud();
  }, STUDY_DAY_DEBOUNCE_MS);
}

export function flushPendingStudyDays() {
  if (studyDayTimer) {
    window.clearTimeout(studyDayTimer);
    studyDayTimer = null;
  }

  if (!getPendingStudyDays().length) return;
  pushStudyDaysToCloud();
}

export function scheduleProgressSync(session) {
  if (!session?.reviewerId) return;

  const existing = pendingProgress.get(session.reviewerId);
  if (existing) window.clearTimeout(existing.timer);

  const timer = window.setTimeout(() => {
    pendingProgress.delete(session.reviewerId);
    pushProgressToCloud(session);
  }, PROGRESS_DEBOUNCE_MS);

  pendingProgress.set(session.reviewerId, { timer, session });
}

export function cancelProgressSync(reviewerId) {
  const existing = pendingProgress.get(reviewerId);
  if (!existing) return;
  window.clearTimeout(existing.timer);
  pendingProgress.delete(reviewerId);
}

export function flushPendingProgress() {
  if (!pendingProgress.size) return;

  const entries = [...pendingProgress.entries()];
  pendingProgress.clear();

  entries.forEach(([, { timer, session }]) => {
    window.clearTimeout(timer);

    // Recorded in the durable queue before the request goes out. This runs on
    // pagehide, where an in-flight fetch is simply killed when the tab closes,
    // so anything not already sent was being lost outright and never even queued.
    // queueSyncItem keeps one entry per reviewer, so this cannot pile up.
    const queued = canWrite() && Boolean(activeUserId);
    if (queued) {
      queueSyncItem({ userId: activeUserId, type: "upsert-progress", reviewerId: session.reviewerId, payload: session });
    }

    pushProgressToCloud(session).then((result) => {
      // Only drop the safety net once the account has actually accepted it.
      if (queued && !result?.queued) {
        removeSyncItem(activeUserId, "upsert-progress", session.reviewerId);
      }
    });
  });
}

async function writeQueuedItem(item) {
  switch (item.type) {
    case "upsert-reviewer":
      return upsertCloudReviewer(item.userId, item.payload);
    case "upsert-progress":
      return upsertCloudProgress(item.userId, item.payload);
    case "delete-progress":
      return deleteCloudProgress(item.userId, item.reviewerId);
    case "upsert-attempt":
      return upsertCloudAttempt(item.userId, item.payload);
    case "clear-progress":
      return clearCloudProgress(item.userId);
    case "clear-attempts":
      return clearCloudAttempts(item.userId);
    default:
      return { error: new Error(`Unknown sync action: ${item.type}`) };
  }
}

export async function flushSyncQueue() {
  if (!canWrite()) return { synced: 0, failed: 0, results: [] };

  const items = getSyncQueue(activeUserId);
  if (!items.length) return { synced: 0, failed: 0, results: [] };

  const results = [];

  for (const item of items) {
    const { error } = await writeQueuedItem(item);

    if (error) {
      results.push({ item, error });
      continue;
    }

    removeSyncItem(item.userId, item.type, item.reviewerId);
    results.push({ item, error: null });
  }

  return {
    synced: results.filter((result) => !result.error).length,
    failed: results.filter((result) => result.error).length,
    results
  };
}

// Progress and attempts arrive without their questions, so every reviewer they
// point at has to be in hand before they can be merged into local storage.
async function resolveReviewerMap(reviewerIds) {
  const byId = new Map();
  const hasQuestions = (reviewer) => Array.isArray(reviewer?.questions);

  [...getCloudReviewerCache(), ...getLocalReviewers()].forEach((reviewer) => {
    if (!reviewer?.reviewerId) return;
    // The reviewer list stores a summary for anything this device has not opened
    // yet, and a summary cannot rebuild a progress or attempt record. Only a
    // cached copy that actually carries its questions counts as usable.
    const existing = byId.get(reviewer.reviewerId);
    if (!hasQuestions(existing) || hasQuestions(reviewer)) byId.set(reviewer.reviewerId, reviewer);
  });

  // Testing presence rather than completeness here is what stopped progress from
  // ever reaching a second device: the summary made the reviewer look present, no
  // fetch happened, and the record was then dropped further down for having no
  // questions to restore from.
  const missing = [...new Set(reviewerIds.filter((id) => id && !hasQuestions(byId.get(id))))];
  if (!missing.length) return byId;

  // A record synced from another device can turn up before its reviewer has ever
  // been opened here, so fetch the missing ones instead of dropping the record.
  const { data } = await listCloudReviewersByIds(missing);
  const fetched = (data || [])
    .filter((row) => row?.reviewer_id)
    .map((row) => ({ ...row.data, reviewerId: row.reviewer_id }));

  fetched.forEach((reviewer) => byId.set(reviewer.reviewerId, reviewer));

  // Cached so the next hydrate finds them complete and does not fetch the same
  // reviewers again. This runs on a timer, so without this a long history would
  // be re-downloaded every minute for reviewers the device never opens.
  if (fetched.length) cacheCloudReviewer(fetched);

  return byId;
}

export async function hydrateFromCloud() {
  if (!canWrite()) return { error: null };

  const [progressResult, attemptsResult] = await Promise.all([
    listCloudProgress(activeUserId),
    listCloudAttempts(activeUserId)
  ]);

  const reviewersById = await resolveReviewerMap([
    ...progressResult.data.map((session) => session?.reviewerId),
    ...attemptsResult.data.map((row) => row?.data?.reviewerId || row?.reviewerId)
  ]);

  if (progressResult.data.length) mergeCloudProgress(progressResult.data, reviewersById);
  if (attemptsResult.data.length) mergeCloudAttempts(attemptsResult.data, reviewersById);

  // Runs after both merges so it can compare against the attempts that just
  // arrived, and before anything pushes, so a session this device already
  // finished on another one is not sent back up again.
  dropProgressOlderThanAttempts();

  // Pulled separately from progress and attempts. An account that has not had the
  // study days table created yet simply reports an error here, which the caller
  // already tolerates, and the local ledger keeps the streak working meanwhile.
  const studyDaysResult = await listCloudStudyDays(activeUserId);
  if (studyDaysResult.data.length) mergeCloudStudyDays(studyDaysResult.data);

  // Prunes only what has already synced and fallen out of the history window, so
  // it is safe to fire and forget alongside the pull.
  pruneOldCloudAttempts(activeUserId);

  return { error: progressResult.error || attemptsResult.error || studyDaysResult.error || null };
}

export async function pushUnsyncedLocalData() {
  if (!canWrite()) return { reviewers: 0, progress: 0, attempts: 0 };

  const userId = activeUserId;
  const { data: cloudRows } = await listMyCloudReviewers(userId);
  const cloudReviewerIds = new Set((cloudRows || []).map((row) => row.reviewer_id));

  const uploaded = [];
  for (const reviewer of getLocalReviewers()) {
    if (cloudReviewerIds.has(reviewer.reviewerId)) continue;

    // Reviewers that only ever lived on this device were never explicitly
    // shared, so they land on the account as private until the owner shares them.
    const payload = { ...reviewer, visibility: reviewer.visibility || "private" };
    const { error } = await upsertCloudReviewer(userId, payload);
    if (!error) uploaded.push({ ...payload, ownerId: userId });
  }

  if (uploaded.length) {
    saveCloudReviewerCache([...uploaded, ...getCloudReviewerCache().filter(
      (item) => !uploaded.some((reviewer) => reviewer.reviewerId === item.reviewerId)
    )]);
  }

  // A sign-in push used to be unconditional, so whichever device signed in last
  // decided whose progress survived. A session older than the row the account
  // already holds is left alone, so this can only ever move progress forward.
  const { updatedAtByReviewerId } = await listCloudProgress(userId);

  let progress = 0;
  for (const session of Object.values(getAllProgress())) {
    if (!session?.reviewerId || session.completed) continue;
    const cloudUpdatedAt = Date.parse(updatedAtByReviewerId?.[session.reviewerId] || "") || 0;
    if (cloudUpdatedAt > getProgressTimestamp(session)) continue;
    const { error } = await upsertCloudProgress(userId, session);
    if (!error) progress += 1;
  }

  let attempts = 0;
  for (const attempt of getAttemptHistory()) {
    const { error } = await upsertCloudAttempt(userId, attempt);
    if (!error) attempts += 1;
  }

  return { reviewers: uploaded.length, progress, attempts };
}

export async function applyPendingDeletes(userId) {
  const items = getPendingDeletesForUser(userId);
  if (!items.length) return { deleted: 0, failed: 0 };

  let deleted = 0;
  let failed = 0;

  for (const item of items) {
    // An attempt queued before the delete would otherwise be replayed by the
    // queue flush straight after this tombstone lands.
    dropConflictingQueueItems(item.userId, item.type, item.reviewerId ?? undefined);

    const { error } = await writeQueuedItem({ ...item, payload: null });

    if (error) {
      failed += 1;
      continue;
    }

    removePendingDelete(item.userId, item.type, item.reviewerId);
    deleted += 1;
  }

  return { deleted, failed };
}

export async function syncAccount() {
  if (!canWrite()) return null;

  // Deletes run before the pull, otherwise a record deleted while signed out
  // would be pulled straight back down from the account.
  const deletes = await applyPendingDeletes(activeUserId);
  // The pull has to run before the push. Pushing first let a device holding
  // stale local progress overwrite whatever the account already had, which is
  // how two devices signed in to the same account ended up disagreeing for good.
  // After the merge, local holds the newer of the two records, so the push that
  // follows only ever carries real progress.
  const hydrated = await hydrateFromCloud();
  const pushed = await pushUnsyncedLocalData();
  const studyDays = await pushStudyDaysToCloud();
  const flushed = await flushSyncQueue();

  return { ...deletes, ...pushed, ...studyDays, ...flushed, error: hydrated.error };
}
