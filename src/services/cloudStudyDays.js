import { supabase } from "../lib/supabaseClient.js";

const STUDY_DAYS_TABLE = "reviewer_study_days";
// Upserts are sent in small groups because a first sign-in on a new device can
// carry a whole history of days at once.
const MARK_BATCH_SIZE = 90;

export async function listCloudStudyDays(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from(STUDY_DAYS_TABLE)
    .select("day")
    .eq("owner_id", userId);

  if (error) return { data: [], error };

  // Postgres hands dates back as YYYY-MM-DD, which is already the shape the
  // client stores, but a configured client can be asked for a different format.
  const days = (data || [])
    .map((row) => String(row?.day || "").slice(0, 10))
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day));

  return { data: days, error: null };
}

export async function markCloudStudyDays(userId, days) {
  if (!supabase || !userId) return { error: new Error("Supabase is not configured.") };

  const unique = [...new Set((days || []).map(String).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))];
  if (!unique.length) return { error: null };

  let lastError = null;

  for (let index = 0; index < unique.length; index += MARK_BATCH_SIZE) {
    const batch = unique.slice(index, index + MARK_BATCH_SIZE);

    // ignoreDuplicates keeps this a no-op for a day the account already has, so
    // re-uploading a history is safe and needs no read first.
    const { error } = await supabase
      .from(STUDY_DAYS_TABLE)
      .upsert(
        batch.map((day) => ({ owner_id: userId, day })),
        { onConflict: "owner_id,day", ignoreDuplicates: true }
      );

    if (error) lastError = error;
  }

  return { error: lastError };
}
