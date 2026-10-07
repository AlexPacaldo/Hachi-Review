import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, UsersRound } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getGroupInvitePreview, joinGroupByInvite } from "../services/groups.js";

const POST_AUTH_PATH_KEY = "hachi:post-auth-path";

export default function GroupJoin() {
  const { inviteCode } = useParams();
  const navigate = useNavigate();
  const { configured, loading, user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!configured || !inviteCode) return undefined;

    // Signed out: remember this invite so sign-in can bring the user back to
    // it. Signed in (already here, or just back from OAuth): drop the marker.
    if (!user) {
      sessionStorage.setItem(POST_AUTH_PATH_KEY, `/groups/join/${inviteCode}`);
      return undefined;
    }

    sessionStorage.removeItem(POST_AUTH_PATH_KEY);
    return undefined;
  }, [configured, user?.id, inviteCode]);

  useEffect(() => {
    if (!configured || !user || !inviteCode) return undefined;

    let cancelled = false;
    setLoadingPreview(true);

    (async () => {
      const { data, error: previewError } = await getGroupInvitePreview(inviteCode);
      if (cancelled) return;

      setLoadingPreview(false);

      if (previewError) {
        setError(previewError.message || "Could not load this invite.");
        return;
      }

      if (!data) {
        setError("That invite link is not valid. Ask the group for a fresh one.");
        return;
      }

      setPreview(data);
    })();

    return () => {
      cancelled = true;
    };
  }, [configured, user?.id, inviteCode]);

  async function join() {
    if (joining) return;

    setJoining(true);
    setError(null);

    const { data, error: joinError } = await joinGroupByInvite(inviteCode);

    setJoining(false);

    if (joinError) {
      setError(joinError.message || "Could not join this group.");
      return;
    }

    if (data?.group_id) {
      if (data.already_member) {
        setNotice("You are already in this group. Opening it...");
        window.setTimeout(() => navigate(`/groups/${data.group_id}`), 1200);
        return;
      }
      navigate(`/groups/${data.group_id}`);
      return;
    }

    setError("Could not join this group.");
  }

  if (!configured) {
    return (
      <div className="page narrow">
        <EmptyState title="Cloud sync is not configured" message="Add Supabase settings before joining groups." />
      </div>
    );
  }

  if (loading) {
    return <div className="page narrow"><p className="muted">Checking session...</p></div>;
  }

  if (!user) {
    return (
      <div className="page narrow">
        <EmptyState
          title="Sign in to join this group"
          message="Groups need your account so the people you study with can see what you share. Sign in and you will be brought right back to this invite."
          action={<Link className="button primary" to="/account">Go to Account</Link>}
        />
      </div>
    );
  }

  // The preview is only null before the fetch starts; without this guard a
  // render between the session resolving and the effect firing would read
  // properties off null.
  if (loadingPreview || (!preview && !error)) {
    return <div className="page narrow"><p className="muted">Loading invite...</p></div>;
  }

  if (error && !preview) {
    return (
      <div className="page narrow">
        <EmptyState
          title="Invite unavailable"
          message={error}
          action={<Link className="button primary" to="/groups">Go to groups</Link>}
        />
      </div>
    );
  }

  return (
    <div className="page narrow">
      <section className="modal group-invite-card" aria-label="Group invite">
        <p className="eyebrow">Group invite</p>
        <h1>{preview.group_name}</h1>
        <p className="muted">
          <UsersRound size={14} aria-hidden="true" />{" "}
          {preview.member_count} member{Number(preview.member_count) === 1 ? "" : "s"}
        </p>

        {preview.description ? <p className="group-detail-description">{preview.description}</p> : null}

        {notice ? <p className="sync-message success">{notice}</p> : null}
        {error ? <p className="sync-message error">{error}</p> : null}

        <div className="modal-actions">
          <Link className="button subtle" to="/groups">Not now</Link>
          <button className="button primary" type="button" onClick={join} disabled={joining}>
            {joining ? <Loader2 className="spinner" size={16} aria-hidden="true" /> : null}
            {joining ? "Joining..." : "Join group"}
          </button>
        </div>
      </section>
    </div>
  );
}
