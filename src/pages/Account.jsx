import { useEffect, useState } from "react";
import { Cloud, Database, HardDrive, LogIn, LogOut, RefreshCw, UserRound, Users } from "lucide-react";
import { Link } from "react-router-dom";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { supabase } from "../lib/supabaseClient.js";
import { deleteMyCloudAppData, updateMyProfile } from "../services/social.js";
import { clearAllDeviceData } from "../utils/storageUtils.js";

const authRedirectUrl = import.meta.env.VITE_AUTH_REDIRECT_URL || window.location.origin;

const SIGN_IN_BENEFITS = [
  {
    icon: Cloud,
    title: "Reviewers on every device",
    text: "Save a reviewer to your account and pick it up on any device, online or offline."
  },
  {
    icon: Users,
    title: "Friends and group study",
    text: "Share reviewers with friends and study together in a group."
  },
  {
    icon: Database,
    title: "Progress that follows you",
    text: "Attempts, in progress quizzes, and generated reviewers stay in sync."
  }
];

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

  // Only a hint about where to look. The database decides who can actually read
  // the statistics, and refuses anyone else, so hiding the link is a
  // convenience rather than the control that keeps the numbers private.
  const isOwner = user?.app_metadata?.admin === true;

  useEffect(() => {
    setProfileName(getUserName(user));
  }, [user?.id]);

  async function signInWithGoogle() {
    setMessage(null);

    if (!configured) {
      setMessage({ type: "warning", text: "Add your Supabase URL and anon key in .env.local first." });
      return;
    }

    const returnPath = sessionStorage.getItem("hachi:post-auth-path");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: returnPath ? `${authRedirectUrl.replace(/\/$/, "")}${returnPath}` : authRedirectUrl
      }
    });

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      sessionStorage.removeItem("hachi:post-auth-path");
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
  const displayName = getUserName(user);
  // An empty field would fall back to the current name on save, so the button
  // only lights up when there is a real change to send.
  const hasNameChange = Boolean(profileName.trim()) && profileName.trim() !== displayName;

  return (
    <div className="page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">Account</p>
          <h1>Account Settings</h1>
          <p className="muted">Your identity, your session, and your data, in one place.</p>
        </div>
      </section>

      {message ? (
        <p role="status" className={`account-message ${message.type}`}>{message.text}</p>
      ) : null}

      {loading ? (
        <section className="account-panel">
          <div className="account-inline-state">
            <RefreshCw size={18} className="spinner" aria-hidden="true" />
            <span>Checking your session...</span>
          </div>
        </section>
      ) : session ? (
        <div className="account-layout">
          <section className="account-panel account-panel-profile">
            <header className="account-panel-head">
              <h2>Profile</h2>
              <p className="muted">This is the name friends see when you share a reviewer or join a group.</p>
            </header>

            <div className="account-identity">
              <div className="account-avatar" aria-hidden="true">
                {avatarUrl ? <img src={avatarUrl} alt="" /> : <UserRound size={30} />}
              </div>
              <div className="account-identity-text">
                <strong>{displayName}</strong>
                <p className="muted">{user.email}</p>
              </div>
              <span className="account-pill">Signed in</span>
            </div>

            <form className="account-form" onSubmit={(event) => {
              event.preventDefault();
              saveProfile();
            }}>
              <label>
                <span>Display name</span>
                <input
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                  autoComplete="name"
                />
              </label>
              <button className="button primary" type="submit" disabled={savingProfile || !hasNameChange}>
                {savingProfile ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </section>

          <section className="account-panel">
            <header className="account-panel-head">
              <h2>Session</h2>
              <p className="muted">Signed in with Google. Your cloud reviewers stay linked to this account.</p>
            </header>

            <div className="account-row">
              <div className="account-row-text">
                <strong>Sign out</strong>
                <p className="muted">You can sign back in at any time. Nothing on the cloud is affected.</p>
              </div>
              <button className="button subtle" type="button" onClick={() => setConfirmAction("sign-out")}>
                <LogOut size={17} aria-hidden="true" />
                Sign Out
              </button>
            </div>
          </section>

          <section className="account-panel account-panel-danger">
            <header className="account-panel-head">
              <h2>Data</h2>
              <p className="muted">Deleting data is permanent and cannot be undone.</p>
            </header>

            <div className="account-row">
              <div className="account-row-text">
                <strong>Delete cloud data</strong>
                <p className="muted">Removes your cloud reviewers, profile, friendships, and shares. Your sign-in account stays.</p>
              </div>
              <button className="button subtle danger-text" type="button" onClick={() => setConfirmAction("delete-cloud-data")}>
                <Database size={17} aria-hidden="true" />
                Delete
              </button>
            </div>

            <div className="account-row">
              <div className="account-row-text">
                <strong>Delete device data</strong>
                <p className="muted">Clears offline reviewers, progress, drafts, and preferences in this browser only.</p>
              </div>
              <button className="button subtle danger-text" type="button" onClick={() => setConfirmAction("delete-device-data")}>
                <HardDrive size={17} aria-hidden="true" />
                Delete
              </button>
            </div>
          </section>
        </div>
      ) : (
        <section className="account-panel account-signin">
          <div className="account-signin-head">
            <div className="account-avatar account-avatar-large" aria-hidden="true">
              <UserRound size={34} />
            </div>
            <div>
              <h2>Sign in to Hachi</h2>
              <p className="muted">Keep studying offline as you are now, or sign in to carry everything with you.</p>
            </div>
          </div>

          <ul className="account-benefits">
            {SIGN_IN_BENEFITS.map((benefit) => {
              const BenefitIcon = benefit.icon;
              return (
                <li key={benefit.title}>
                  <span className="account-benefit-icon" aria-hidden="true">
                    <BenefitIcon size={18} />
                  </span>
                  <div>
                    <strong>{benefit.title}</strong>
                    <p className="muted">{benefit.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          {!configured ? (
            <p className="account-inline-notice">
              Cloud features need a Supabase URL and anon key in <code>.env.local</code> first.
            </p>
          ) : null}

          <button className="button primary wide" type="button" onClick={signInWithGoogle}>
            <LogIn size={17} aria-hidden="true" />
            Continue with Google
          </button>
        </section>
      )}

      <footer className="account-legal-links">
        {isOwner ? (
          <>
            <Link to="/admin/stats">Statistics</Link>
            <span aria-hidden="true">/</span>
          </>
        ) : null}
        <Link to="/about">About</Link>
        <span aria-hidden="true">/</span>
        <Link to="/contact">Contact</Link>
        <span aria-hidden="true">/</span>
        <Link to="/privacy">Privacy Policy</Link>
        <span aria-hidden="true">/</span>
        <Link to="/terms">Terms of Service</Link>
      </footer>

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
