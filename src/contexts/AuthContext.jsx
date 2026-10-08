import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "../lib/supabaseClient.js";
import { ensureMyProfile, getMyProfile } from "../services/social.js";
import { flushPendingProgress, flushPendingStudyDays, hydrateFromCloud, setSyncUser, syncAccount } from "../services/syncEngine.js";
import { getOwnAvatarUrl, getOwnDisplayName } from "../utils/userProfile.js";

const CLOUD_PULL_INTERVAL_MS = 60000;

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  // The signed-in account's own profile row, which is where its display name
  // lives. Held here so the interface can show the name other people see rather
  // than the provider's metadata, which is a different value that OAuth rewrites.
  const [profile, setProfile] = useState(null);

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

  // Reads the profile rather than writing it, and never overwrites an edited
  // name: ensureMyProfile only creates a row that does not exist yet.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setProfile(null);
      return undefined;
    }

    let isMounted = true;

    ensureMyProfile(session.user).then(() => getMyProfile(userId)).then(({ data }) => {
      if (isMounted) setProfile(data || null);
    });

    return () => {
      isMounted = false;
    };
  }, [session?.user?.id]);

  // Called after a rename so the interface does not have to wait for the next
  // mount or reload to show the name that was just saved.
  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) return null;

    const { data } = await getMyProfile(userId);
    setProfile(data || null);
    return data || null;
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
    // is backgrounded or closed instead of waiting out the timer. Study days are
    // debounced on their own and pushed the same way.
    const flushOnHide = () => {
      if (document.visibilityState !== "hidden") return;
      flushPendingProgress();
      flushPendingStudyDays();
    };

    document.addEventListener("visibilitychange", flushOnHide);
    window.addEventListener("pagehide", flushOnHide);
    return () => {
      document.removeEventListener("visibilitychange", flushOnHide);
      window.removeEventListener("pagehide", flushOnHide);
    };
  }, []);

  const value = useMemo(() => ({
    configured: isSupabaseConfigured,
    loading,
    session,
    user: session?.user || null,
    profile,
    displayName: session?.user ? getOwnDisplayName(session.user, profile) : "",
    avatarUrl: session?.user ? getOwnAvatarUrl(session.user, profile) : "",
    refreshProfile
  }), [loading, profile, refreshProfile, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}
