import { useEffect, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";

// Presence lives on a plain public channel, so signed-out visitors count too and no
// database table or publication entry is needed. Supabase drops a member when its
// socket closes, so the number stays honest without any server-side cleanup job.
const CHANNEL = "landing-presence";
const HEARTBEAT_MS = 25_000;

function sessionKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useOnlineCount() {
  const [onlineCount, setOnlineCount] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;

    const key = sessionKey();
    let mounted = true;
    let channel = null;

    const publishCount = () => {
      if (!mounted || !channel) return;
      const state = channel.presenceState();
      const total = state ? Object.keys(state).length : 0;
      setOnlineCount(total > 0 ? total : null);
    };

    channel = supabase.channel(CHANNEL, { config: { presence: { key } } });
    channel
      .on("presence", { event: "sync" }, publishCount)
      .on("presence", { event: "join" }, publishCount)
      .on("presence", { event: "leave" }, publishCount)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ onlineAt: Date.now() });
          publishCount();
        }
      });

    // Re-tracking keeps the entry alive through proxies that hold the socket open
    // long after the tab is actually gone.
    const heartbeat = setInterval(() => {
      channel.track({ onlineAt: Date.now() });
    }, HEARTBEAT_MS);

    const leave = () => {
      if (channel) channel.untrack();
    };
    window.addEventListener("pagehide", leave);

    return () => {
      mounted = false;
      clearInterval(heartbeat);
      window.removeEventListener("pagehide", leave);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return onlineCount;
}