import { supabase } from "../lib/supabaseClient.js";

const PROGRESS_TABLE = "reviewer_progress";
const ATTEMPTS_TABLE = "reviewer_attempts";
const MAX_SYNCED_ATTEMPTS = 500;

export async function listCloudProgress(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from(PROGRESS_TABLE)
    .select("reviewer_id, data, updated_at")
    .eq("owner_id", userId);

  if (error) return { data: [], error };

  return {
    data: (data || []).map((row) => ({ ...row.data, reviewerId: row.reviewer_id })),
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
    data: session,
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
    data: attempt,
    completed_at: attempt.date || new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(ATTEMPTS_TABLE)
    .upsert(payload, { onConflict: "owner_id,attempt_id" })
    .select()
    .single();

  return { data, error };
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
