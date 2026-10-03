import { supabase } from "../lib/supabaseClient.js";

// Aggregates only. The database returns null to anyone who is not the owner, so
// there is nothing here to hide from other accounts: the page renders its empty
// state instead. No email address and no per-user row is ever fetched.
export async function getAdminUserStats() {
  if (!supabase) return { stats: null, series: [], error: null };

  const [statsResult, seriesResult] = await Promise.all([
    supabase.rpc("admin_user_stats"),
    supabase.rpc("admin_signup_series", { p_days: 30 })
  ]);

  const error = statsResult.error || seriesResult.error || null;
  if (error) return { stats: null, series: [], error };

  const data = statsResult.data;
  if (!data) return { stats: null, series: [], error: null };

  const series = (seriesResult.data || [])
    .map((row) => ({ day: row.day, signups: Number(row.signups) || 0 }))
    .filter((row) => row.day);

  return {
    stats: {
      totalUsers: Number(data.totalUsers) || 0,
      newUsers7d: Number(data.newUsers7d) || 0,
      newUsers30d: Number(data.newUsers30d) || 0,
      activeUsers7d: Number(data.activeUsers7d) || 0,
      activeUsers30d: Number(data.activeUsers30d) || 0,
      confirmedUsers: Number(data.confirmedUsers) || 0,
      onlineNow: Number(data.onlineNow) || 0,
      reviewerCount: Number(data.reviewerCount) || 0,
      attemptCount: Number(data.attemptCount) || 0,
      attempts7d: Number(data.attempts7d) || 0,
      avgAttemptsPerUser: Number(data.avgAttemptsPerUser) || 0,
      friendshipCount: Number(data.friendshipCount) || 0,
      groupCount: Number(data.groupCount) || 0,
      shareCount: Number(data.shareCount) || 0
    },
    series,
    error: null
  };
}

// Shown next to each figure. A percentage needs a denominator, and a denominator
// of zero has no meaningful percentage, so it is reported as a dash instead of
// an infinity or a NaN.
export function formatPercent(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 100);
}

export function formatDelta(current, previous) {
  if (!previous) return null;
  const change = ((current - previous) / previous) * 100;
  return Math.round(change);
}
