import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";
import { ensureMyProfile } from "../services/social.js";
import { flushPendingProgress, hydrateFromCloud, setSyncUser, syncAccount } from "../services/syncEngine.js";

const CLOUD_PULL_INTERVAL_MS = 60000;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return undefined;
    }

    let isMounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return;
      setSession(data.session || null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session?.user) {
      ensureMyProfile(session.user);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id || null;
    setSyncUser(userId);
    if (userId) syncAccount();
    return () => setSyncUser(null);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return undefined;

    const resumeSync = () => {
      if (navigator.onLine) syncAccount();
    };

    window.addEventListener("online", resumeSync);
    return () => window.removeEventListener("online", resumeSync);
  }, [session?.user?.id]);

  useEffect(() => {
    if (!session?.user) return undefined;

    const pullFromCloud = () => {
      if (document.visibilityState === "visible" && navigator.onLine) hydrateFromCloud();
    };

    const interval = window.setInterval(pullFromCloud, CLOUD_PULL_INTERVAL_MS);
    document.addEventListener("visibilitychange", pullFromCloud);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", pullFromCloud);
    };
  }, [session?.user?.id]);

  useEffect(() => {
    // Progress is debounced, so save whatever is still pending before the tab
    // is backgrounded or closed instead of waiting out the timer.
    const flushOnHide = () => {
      if (document.visibilityState === "hidden") flushPendingProgress();
    };

    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushPendingProgress);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushPendingProgress);
    };
  }, []);

  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user || null
  }), [loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}
