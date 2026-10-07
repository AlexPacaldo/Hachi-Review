import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Loader2, UsersRound } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getGroupInvitePreview, joinGroupByInvite } from "../services/groups.js";

export default function GroupJoin() {
  const { inviteCode } = useParams();
  const navigate = useNavigate();
  const { configured, loading, user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!configured || !user || !inviteCode) {
      setLoadingPreview(false);
      return undefined;
    }

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
          message="Groups need your account so the people you study with can see what you share. After signing in, open this invite link again."
          action={<Link className="button primary" to="/account">Go to Account</Link>}
        />
      </div>
    );
  }

  if (loadingPreview) {
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
      <section className="section-heading">
        <div>
          <p className="eyebrow">Group invite</p>
          <h1>{preview.group_name}</h1>
          <p className="muted">
            <UsersRound size={14} aria-hidden="true" />{" "}
            {preview.member_count} member{Number(preview.member_count) === 1 ? "" : "s"}
          </p>
        </div>
      </section>

      {preview.description ? <p className="group-detail-description">{preview.description}</p> : null}

      {error ? <p className="sync-message error">{error}</p> : null}

      <div className="modal-actions">
        <Link className="button subtle" to="/groups">Not now</Link>
        <button className="button primary" type="button" onClick={join} disabled={joining}>
          {joining ? <Loader2 className="spinner" size={16} aria-hidden="true" /> : null}
          {joining ? "Joining..." : "Join group"}
        </button>
      </div>
    </div>
  );
}
