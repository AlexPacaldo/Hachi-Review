import { useEffect, useState } from "react";
import { isSupabaseConfigured } from "../lib/supabaseClient.js";
import { POLL_MS, releasePresence, touchPresence } from "../services/cloudPresence.js";

function sessionKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Counted from a heartbeat row rather than a presence channel, so a busy landing
// page no longer needs a Realtime connection per visitor. The trade is a poll
// instead of a socket, which is why a hidden tab stops pinging and picks the
// count back up as soon as it is looked at again.
export function useOnlineCount() {
  const [onlineCount, setOnlineCount] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;

    const key = sessionKey();
    let active = true;
    let timer = null;

    const schedule = () => {
      if (!active) return;
      timer = window.setTimeout(run, POLL_MS);
    };

    async function run() {
      if (!active) return;

      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }

      try {
        const { count, error } = await touchPresence(key);
        if (!active || error) return;
        if (count) setOnlineCount(count);
      } catch {
        // A failed count just leaves the last good number on screen.
      }

      schedule();
    }

    run();

    // Returning to the tab refreshes immediately rather than waiting out the
    // poll, so a number left open overnight does not show a stale count.
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) window.clearTimeout(timer);
      run();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      releasePresence(key);
    };
  }, []);

  return onlineCount;
}