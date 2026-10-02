import { supabase } from "../lib/supabaseClient.js";
import { toCompactQuizRecord } from "../utils/quizUtils.js";

const PROGRESS_TABLE = "reviewer_progress";
const ATTEMPTS_TABLE = "reviewer_attempts";
const MAX_SYNCED_ATTEMPTS = 500;
const ATTEMPT_RETENTION_DAYS = 14;

// The row's own updated_at is returned separately rather than folded into the
// session. It is only needed to decide whether a local session is newer than
// what the account already holds, and merging it in would persist a field the
// rest of the app has no use for and push straight back to the server.
export async function listCloudProgress(userId) {
  if (!supabase || !userId) return { data: [], updatedAtByReviewerId: {}, error: null };

  const { data, error } = await supabase
    .from(PROGRESS_TABLE)
    .select("reviewer_id, data, updated_at")
    .eq("owner_id", userId);

  if (error) return { data: [], updatedAtByReviewerId: {}, error };

  const updatedAtByReviewerId = {};

  return {
    data: (data || []).map((row) => {
      if (row?.reviewer_id) updatedAtByReviewerId[row.reviewer_id] = row.updated_at;
      return { ...row.data, reviewerId: row.reviewer_id };
    }),
    updatedAtByReviewerId,
    error: null
  };
}

export async function upsertCloudProgress(userId, session) {
  if (!supabase || !userId) {
    return { data: null, error: new Error("Supabase is not configured.") };
  }

  if (!session?.reviewerId) return { data: null, error: new Error("A progress session needs a reviewerId.") };

  const payload = {
    owner_id: userId,
    reviewer_id: session.reviewerId,
    // The questions are stored once on the reviewer, so the session keeps only
    // the ordered ids it used. syncEngine restores them on the way back down.
    data: toCompactQuizRecord(session),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(PROGRESS_TABLE)
    .upsert(payload, { onConflict: "owner_id,reviewer_id" })
    .select()
    .single();

  return { data, error };
}

export async function deleteCloudProgress(userId, reviewerId) {
  if (!supabase || !userId) return { error: new Error("Supabase is not configured.") };

  const { error } = await supabase
    .from(PROGRESS_TABLE)
    .delete()
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId);

  return { error };
}

export async function listCloudAttempts(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from(ATTEMPTS_TABLE)
    .select("attempt_id, data, completed_at, created_at")
    .eq("owner_id", userId)
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(MAX_SYNCED_ATTEMPTS);

  if (error) return { data: [], error };

  return { data: data || [], error: null };
}

export async function upsertCloudAttempt(userId, attempt) {
  if (!supabase || !userId) {
    return { data: null, error: new Error("Supabase is not configured.") };
  }

  if (!attempt?.attemptId || !attempt?.reviewerId) {
    return { data: null, error: new Error("An attempt needs an attemptId and a reviewerId.") };
  }

  const payload = {
    owner_id: userId,
    attempt_id: attempt.attemptId,
    reviewer_id: attempt.reviewerId,
    data: toCompactQuizRecord(attempt),
    completed_at: attempt.date || new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(ATTEMPTS_TABLE)
    .upsert(payload, { onConflict: "owner_id,attempt_id" })
    .select()
    .single();

  return { data, error };
}

// Attempt rows are never pruned on their own, so without this one heavy quiz
// history grows without bound and eats the whole database quota. Each user trims
// their own old rows during sync, which keeps it to a single indexed delete and
// needs no scheduled job.
export async function pruneOldCloudAttempts(userId, days = ATTEMPT_RETENTION_DAYS) {
  if (!supabase || !userId || !(Number(days) > 0)) return { deleted: 0, error: null };

  const { data, error } = await supabase.rpc("prune_reviewer_attempts", {
    p_owner: userId,
    p_older_than_days: Math.round(Number(days))
  });

  return { deleted: Number(data) || 0, error };
}

export async function clearCloudProgress(userId) {
  if (!supabase || !userId) return { error: new Error("Supabase is not configured.") };

  const { error } = await supabase
    .from(PROGRESS_TABLE)
    .delete()
    .eq("owner_id", userId);

  return { error };
}

export async function clearCloudAttempts(userId) {
  if (!supabase || !userId) return { error: new Error("Supabase is not configured.") };

  const { error } = await supabase
    .from(ATTEMPTS_TABLE)
    .delete()
    .eq("owner_id", userId);

  return { error };
}
