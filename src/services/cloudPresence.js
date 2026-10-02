import { supabase } from "../lib/supabaseClient.js";

// Landing page visitors used to be counted with a presence channel, which meant
// every open tab held a Realtime connection and the free tier capped the site at
// 200 people at once. A heartbeat row costs one short HTTP call instead, so the
// count no longer competes for connections at all.
const POLL_MS = 60_000;
const WINDOW_SECONDS = 150;

// One call records the visit and returns the current total, so the number stays
// live without a second round trip.
export async function touchPresence(key) {
  if (!supabase || !key) return { count: null, error: null };

  const { data, error } = await supabase.rpc("touch_presence", {
    p_key: key,
    p_window_seconds: WINDOW_SECONDS
  });

  if (error) return { count: null, error };
  return { count: typeof data === "number" ? data : null, error: null };
}

// Best effort, so navigating away from the landing page drops the count right
// away instead of waiting for the window to expire. This is not used when a tab
// closes, since the request would not finish in time, which is why a stable key
// matters. Nothing depends on it succeeding.
export async function releasePresence(key) {
  if (!supabase || !key) return;
  await supabase.rpc("release_presence", { p_key: key });
}

export { POLL_MS };
export { getPresenceKey } from "./presenceKey.js";