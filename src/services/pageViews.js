import { supabase } from "../lib/supabaseClient.js";
import { analyticsPath } from "../utils/analyticsRoutes.js";
import { getPresenceKey } from "./presenceKey.js";

// Records a page view, one route name and one random per-tab key at a time.
//
// The key is the same one the landing page heartbeat uses, deliberately: two
// identifiers for the same tab would be two identifiers to store, and there is
// nothing to tell apart between them. It lives in session storage, so it does
// not follow the person to another tab, another browser or another device, and
// it disappears when the tab does.
//
// Nothing waits on this. A failed count costs a number nobody is looking at and
// no error is raised, because there is no state anywhere that depends on a page
// view having been recorded.
export async function recordPageView(pathname) {
  if (!supabase) return { recorded: false, path: null };

  const path = analyticsPath(pathname);

  // An unknown route is not recorded, not stored as itself. See analyticsRoutes.
  if (!path) return { recorded: false, path: null };

  try {
    const { error } = await supabase.rpc("record_page_view", {
      p_key: getPresenceKey(),
      p_path: path
    });

    return { recorded: !error, path, error: error || null };
  } catch {
    return { recorded: false, path };
  }
}