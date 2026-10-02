import { supabase } from "../lib/supabaseClient.js";

// Warn once the database is this full. Read-only mode is what actually stops
// the app, and on the free plan it can land a little above the documented limit
// rather than exactly on it, so this leaves room to act first.
export const DATABASE_WARN_PERCENT = 80;
export const DATABASE_CRITICAL_PERCENT = 95;

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached = null;
let cachedAt = 0;

// The database gates this behind a single account, so every other user gets a
// null back and there is nothing to hide in the client. The cache keeps it to
// one call per five minutes of app use rather than one per navigation.
export async function getAdminDatabaseUsage({ force = false } = {}) {
  if (!supabase) return null;
  if (!force && cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached;

  const { data, error } = await supabase.rpc("admin_database_usage");
  if (error || !data) return null;

  const usage = {
    usedBytes: Number(data.usedBytes) || 0,
    limitBytes: Number(data.limitBytes) || 0,
    percentUsed: Number(data.percentUsed) || 0,
    reviewerCount: Number(data.reviewerCount) || 0,
    avgReviewerKb: Number(data.avgReviewerKb) || 0,
    maxReviewerKb: Number(data.maxReviewerKb) || 0,
    reviewerTableBytes: Number(data.reviewerTableBytes) || 0
  };

  cached = usage;
  cachedAt = Date.now();
  return usage;
}

// The plan allowance is stored in the database rather than compiled in, so this
// is a one time call after upgrading instead of a change to this file.
export async function setAdminDatabaseLimit(limitBytes) {
  if (!supabase) return { limitBytes: null, error: null };

  const { data, error } = await supabase.rpc("admin_set_database_limit", {
    p_limit_bytes: Math.round(limitBytes)
  });
  if (error) return { limitBytes: null, error };

  cached = null;
  cachedAt = 0;

  return { limitBytes: Number(data) || null, error: null };
}

export function formatDatabaseSize(bytes) {
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1024) return `${(megabytes / 1024).toFixed(2)} GB`;
  return `${megabytes.toFixed(0)} MB`;
}