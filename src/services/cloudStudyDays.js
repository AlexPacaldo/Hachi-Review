import { supabase } from "../lib/supabaseClient.js";

const STREAK_TABLE = "reviewer_study_streak";

// The day arithmetic is done by mark_study_day in the schema, not here. Two
// devices can report the same day at the same moment, and letting each of them
// work out its own counters would let the two disagree or double count. The
// function holds the row while it writes and returns what it decided, so the
// client adopts the same answer.
export async function markCloudStudyDays(userId, days) {
  if (!supabase || !userId) return { streak: null, error: new Error("Supabase is not configured.") };

  const unique = [...new Set((days || []).map(String).filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort();
  if (!unique.length) return { streak: null, error: null };

  let streak = null;
  let lastError = null;

  // Oldest first, so a device catching up on several offline days walks the run
  // forward in order rather than jumping straight to the newest one. Each call
  // reports the record as it stands, so the last reply is the settled answer.
  for (const day of unique) {
    const { data, error } = await supabase.rpc("mark_study_day", { p_day: day });

    if (error) {
      lastError = error;
      continue;
    }

    if (data) streak = data;
  }

  return { streak, error: lastError };
}

export async function getCloudStudyStreak(userId) {
  if (!supabase || !userId) return { streak: null, error: null };

  const { data, error } = await supabase
    .from(STREAK_TABLE)
    .select("current_streak, longest_streak, total_days, last_study_day, recent_days")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) return { streak: null, error };
  if (!data) return { streak: null, error: null };

  return {
    streak: {
      currentStreak: data.current_streak,
      longestStreak: data.longest_streak,
      totalDays: data.total_days,
      lastStudyDay: data.last_study_day,
      recentDays: data.recent_days
    },
    error: null
  };
}
