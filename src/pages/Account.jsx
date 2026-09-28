import { useEffect, useState } from "react";
import { Database, HardDrive, LogOut, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { deleteMyCloudAppData, updateMyProfile } from "../services/social.js";
import { clearAllDeviceData } from "../utils/storageUtils.js";

const authRedirectUrl = import.meta.env.VITE_AUTH_REDIRECT_URL || window.location.origin;

function getUserName(user) {
  return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Hachi User";
}

function getUserAvatar(user) {
  return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || "";
}

export default function Account() {
  const { configured, loading, session, user } = useAuth();
  const [message, setMessage] = useState(null);
  const [profileName, setProfileName] = useState(() => getUserName(user));
  const [savingProfile, setSavingProfile] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);

  useEffect(() => {
    setProfileName(getUserName(user));
  }, [user?.id]);

  async function signInWithGoogle() {
    setMessage(null);

    if (!configured) {
      setMessage({ type: "warning", text: "Add your Supabase URL and anon key in .env.local first." });
      return;
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl
      }
    });

    if (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setMessage({ type: "success", text: "Signed out." });
  }

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true);
    setMessage(null);

    const { error: metadataError } = await supabase.auth.updateUser({
      data: { full_name: profileName.trim() || getUserName(user) }
    });

    const { error: profileError } = await updateMyProfile(user, { displayName: profileName });

    setSavingProfile(false);
    const failed = metadataError?.message || profileError?.message;
    setMessage(failed
      ? { type: "error", text: failed }
      : { type: "success", text: "Profile saved." });
  }

  async function deleteCloudData() {
    if (!user) return;
    setMessage(null);
    const { error } = await deleteMyCloudAppData(user.id);
    if (error) {
      setMessage({ type: "error", text: error.message || "Could not delete cloud app data." });
      return;
    }
    setMessage({ type: "success", text: "Cloud app data deleted. Your sign-in account still exists." });
  }

  function deleteDeviceData() {
    clearAllDeviceData();
    setMessage({ type: "success", text: "Device data deleted." });
  }

  async function handleConfirm() {
    const action = confirmAction;
    setConfirmAction(null);

    if (action === "sign-out") {
      await signOut();
    }

    if (action === "delete-device-data") {
      deleteDeviceData();
    }

    if (action === "delete-cloud-data") {
      await deleteCloudData();
    }
  }

  const avatarUrl = getUserAvatar(user);

  return (
    <div className="page narrow">
      <section className="setup-panel">
        <p className="eyebrow">Account</p>
        <h1>Account Settings</h1>
        <p className="muted">Sign in for cloud reviewers, database sync, friends, and sharing. Hachi stays website-first for now, with offline study still available without an account.</p>

        {loading ? (
          <p className="muted">Checking session...</p>
        ) : session ? (
          <>
            <div className="account-profile-card">
              <div className="account-avatar" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={24} />}
              </div>
              <div>
                <strong>{getUserName(user)}</strong>
                <p className="muted">{user.email}</p>
              </div>
              <button className="button subtle" type="button" onClick={() => setConfirmAction("sign-out")}>
                <LogOut size={17} aria-hidden="true" />
                Sign Out
              </button>
            </div>

            <form className="account-form" onSubmit={(event) => {
              event.preventDefault();
              saveProfile();
            }}>
              <label>
                <span>Display Name</span>
                <input value={profileName} onChange={(event) => setProfileName(event.target.value)} />
              </label>
              <button className="button primary" type="submit" disabled={savingProfile}>
                {savingProfile ? "Saving..." : "Save Profile"}
              </button>
            </form>

            <section className="account-danger-zone">
              <h2>Data Management</h2>
              <div className="account-data-actions">
                <button className="button subtle" type="button" onClick={() => setConfirmAction("delete-device-data")}>
                  <HardDrive size={17} aria-hidden="true" />
                  Delete Device Data
                </button>
                <button className="button subtle danger-text" type="button" onClick={() => setConfirmAction("delete-cloud-data")}>
                  <Database size={17} aria-hidden="true" />
                  Delete Cloud App Data
                </button>
              </div>
            </section>
          </>
        ) : (
          <div className="account-signin-stack">
            <button className="button primary wide" type="button" onClick={signInWithGoogle}>
              Continue with Google
            </button>
          </div>
        )}

        {message ? <p className={`account-message ${message.type}`}>{message.text}</p> : null}

        <div className="account-legal-links">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </div>
      </section>

      <ConfirmModal
        open={Boolean(confirmAction)}
        title={confirmAction === "sign-out" ? "Sign Out?" : confirmAction === "delete-cloud-data" ? "Delete Cloud App Data?" : "Delete Device Data?"}
        message={
          confirmAction === "sign-out"
            ? "You can sign in again anytime."
            : confirmAction === "delete-cloud-data"
              ? "This deletes your cloud reviewers, profile row, friendships, and reviewer shares. Your Google/Supabase login account may still exist."
              : "This clears your local study data, generated reviewers, progress, drafts, cached data, and theme preferences from this browser."
        }
        confirmLabel={confirmAction === "sign-out" ? "Sign Out" : "Delete"}
        onCancel={() => setConfirmAction(null)}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
