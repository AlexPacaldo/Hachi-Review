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
import {
  getAttemptHistory,
  getCloudReviewerCache,
  getLastUserId,
  getLocalReviewers,
  getAllProgress,
  getPendingDeletesForUser,
  getSyncQueue,
  mergeCloudAttempts,
  mergeCloudProgress,
  dropConflictingQueueItems,
  queuePendingDelete,
  queueSyncItem,
  removePendingDelete,
  removeSyncItem,
  saveCloudReviewerCache,
  setLastUserId
} from "../utils/storageUtils.js";

const PROGRESS_DEBOUNCE_MS = 4000;
const DELETE_TYPES = new Set(["delete-progress", "clear-progress", "clear-attempts"]);

let activeUserId = null;
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
    pushProgressToCloud(session);
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

  [...getCloudReviewerCache(), ...getLocalReviewers()].forEach((reviewer) => {
    if (reviewer?.reviewerId) byId.set(reviewer.reviewerId, reviewer);
  });

  const missing = [...new Set(reviewerIds.filter((id) => id && !byId.has(id)))];
  if (!missing.length) return byId;

  // A record synced from another device can turn up before its reviewer has ever
  // been opened here, so fetch the missing ones instead of dropping the record.
  const { data } = await listCloudReviewersByIds(missing);
  (data || []).forEach((row) => {
    if (!row?.reviewer_id) return;
    byId.set(row.reviewer_id, { ...row.data, reviewerId: row.reviewer_id });
  });

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

  // Prunes only what has already synced and fallen out of the history window, so
  // it is safe to fire and forget alongside the pull.
  pruneOldCloudAttempts(activeUserId);

  return { error: progressResult.error || attemptsResult.error || null };
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

  let progress = 0;
  for (const session of Object.values(getAllProgress())) {
    if (!session?.reviewerId || session.completed) continue;
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
  const pushed = await pushUnsyncedLocalData();
  const flushed = await flushSyncQueue();
  const hydrated = await hydrateFromCloud();

  return { ...deletes, ...pushed, ...flushed, error: hydrated.error };
}
