import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Layers, Plus, RefreshCw, Trash2, UserPlus, X } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import hachiDogCurious from "../assets/hachi-dog-curious.png";
import hachiDogFocused from "../assets/hachi-dog-focused.png";
import hachiDogProud from "../assets/hachi-dog-proud.png";
import { createGroup, deleteGroup, listGroupReviewerCounts, listMyGroups } from "../services/groups.js";
import { SOCIAL_DATA_CHANGED_EVENT } from "../utils/storageUtils.js";

const POLL_INTERVAL_MS = 30000;

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  member: "Member"
};

// A group borrows the reviewer card anatomy, so your role picks the same three
// visual states the homepage uses for progress.
const ROLE_STATES = {
  owner: { state: "completed", label: "You own this", dog: hachiDogProud },
  admin: { state: "in-progress", label: "You help run this", dog: hachiDogFocused },
  member: { state: "not-started", label: "You are a member", dog: hachiDogCurious }
};

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export default function Groups() {
  const { configured, loading, user } = useAuth();
  const [groups, setGroups] = useState([]);
  const [reviewerCounts, setReviewerCounts] = useState({});
  const [message, setMessage] = useState(null);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);

  const loadGroups = useCallback(async (quiet = false) => {
    if (!user) return;

    if (!quiet) setLoadingGroups(true);
    const { data, error } = await listMyGroups(user.id);
    setLoadingGroups(false);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not load your groups." });
      return;
    }

    const nextGroups = data || [];
    setGroups(nextGroups);

    // A missing count only costs a number on the card, so it never replaces the
    // groups that already loaded.
    const { data: counts } = await listGroupReviewerCounts(nextGroups.map((group) => group.id));
    setReviewerCounts(counts || {});
  }, [user?.id]);

  useEffect(() => {
    if (!configured || !user) return;
    loadGroups();
  }, [configured, user?.id, loadGroups]);

  useEffect(() => {
    if (!configured || !user) return undefined;

    const refresh = () => {
      if (document.visibilityState === "visible") loadGroups(true);
    };

    const interval = window.setInterval(refresh, POLL_INTERVAL_MS);
    const handleSocialChange = () => refresh();

    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(SOCIAL_DATA_CHANGED_EVENT, handleSocialChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(SOCIAL_DATA_CHANGED_EVENT, handleSocialChange);
    };
  }, [configured, user?.id, loadGroups]);

  async function submitCreateGroup(event) {
    event.preventDefault();
    if (creating) return;

    setCreating(true);
    setMessage(null);

    const { data, error } = await createGroup(user.id, { name, description });
    setCreating(false);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not create the group." });
      return;
    }

    setName("");
    setDescription("");
    setCreateOpen(false);
    setMessage({ type: "success", text: `Created "${data.name}".` });
    loadGroups();
  }

  async function confirmDeleteGroup() {
    if (!pendingDelete) return;

    const { error } = await deleteGroup(pendingDelete.id);
    setPendingDelete(null);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not delete the group." });
      return;
    }

    setMessage({ type: "success", text: "Group deleted." });
    loadGroups();
  }

  if (!configured) {
    return (
      <div className="page narrow">
        <EmptyState title="Cloud sync is not configured" message="Add Supabase settings before using groups." />
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
          title="Sign in to use groups"
          message="Groups need your account so the people you invite can see the reviewers you share."
          action={<Link className="button primary" to="/account">Go to Account</Link>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">Groups</p>
          <h1>Study groups</h1>
          <p className="muted">Share reviewers with a group so everyone can study the same material.</p>
        </div>
        <div className="button-row">
          <button className="button subtle" type="button" onClick={() => setCreateOpen(true)}>
            <Plus size={17} aria-hidden="true" />
            New Group
          </button>
          <button className="button subtle" type="button" onClick={() => loadGroups()} disabled={loadingGroups}>
            <RefreshCw size={17} aria-hidden="true" />
            {loadingGroups ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </section>

      {message ? <p className={`sync-message ${message.type}`}>{message.text}</p> : null}

      {groups.length ? (
        <div className="reviewer-grid">
          {groups.map((group) => {
            const role = group.role || "member";
            const roleState = ROLE_STATES[role] || ROLE_STATES.member;
            const reviewerCount = reviewerCounts[group.id] || 0;
            // Memberships predating the added_by column have nothing to name.
            const addedByLabel = group.addedByName
              ? group.addedByMe
                ? "You started this group"
                : `${group.addedByName} added you`
              : role === "owner"
                ? "You started this group"
                : "Joined this group";

            return (
              <article className={`reviewer-card group-tile reviewer-card-${roleState.state}`} key={group.id}>
                <Link className="reviewer-card-link" to={`/groups/${group.id}`}>
                  <div className="reviewer-card-hero">
                    <div className="card-topline">
                      <span className="course-code">{ROLE_LABELS[role] || "Member"}</span>
                      <span className="question-count">{pluralize(group.memberCount, "member")}</span>
                      <span className={`reviewer-progress-badge ${roleState.state}`}>
                        {roleState.label}
                      </span>
                    </div>

                    <span className="reviewer-owner-note">
                      <UserPlus size={13} aria-hidden="true" />
                      {addedByLabel}
                    </span>

                    <h3>{group.name}</h3>
                    <p>{group.description || "No description yet."}</p>
                    <img
                      className={`reviewer-card-dog ${roleState.state}`}
                      src={roleState.dog}
                      alt=""
                      aria-hidden="true"
                    />
                  </div>

                  <div className="coverage-block">
                    <div className="coverage-title">
                      <Layers size={16} aria-hidden="true" />
                      At a glance
                    </div>
                    <ul>
                      <li>{pluralize(group.memberCount, "member")}</li>
                      <li>{reviewerCount ? pluralize(reviewerCount, "reviewer") : "No reviewers shared yet"}</li>
                      <li>Your role: {ROLE_LABELS[role] || "Member"}</li>
                      {group.created_at ? (
                        <li>Created {new Date(group.created_at).toLocaleDateString()}</li>
                      ) : null}
                    </ul>
                  </div>
                </Link>

                {role === "owner" ? (
                  <button
                    className="button subtle icon-danger group-tile-remove"
                    type="button"
                    onClick={() => setPendingDelete(group)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                    Delete group
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No groups yet"
          message="Create a group, add people by email or name, then share a reviewer with everyone in it."
          action={
            <button className="button primary" type="button" onClick={() => setCreateOpen(true)}>
              <Plus size={17} aria-hidden="true" />
              Create your first group
            </button>
          }
        />
      )}

      {createOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setCreateOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="create-group-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 id="create-group-title">New group</h2>
                <p className="muted">You will be the owner. Add members next.</p>
              </div>
              <button className="icon-button small" type="button" onClick={() => setCreateOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <form className="group-form" onSubmit={submitCreateGroup}>
              <label htmlFor="group-name">Group name</label>
              <input
                id="group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Biology revision crew"
                maxLength={60}
                autoFocus
              />

              <label htmlFor="group-description">Description (optional)</label>
              <textarea
                id="group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What are you working through together?"
                rows={3}
                maxLength={240}
              />

              <div className="modal-actions">
                <button className="button subtle" type="button" onClick={() => setCreateOpen(false)}>
                  Cancel
                </button>
                <button className="button primary" type="submit" disabled={creating}>
                  <Plus size={16} aria-hidden="true" />
                  {creating ? "Creating..." : "Create group"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(pendingDelete)}
        title="Delete this group?"
        message={pendingDelete
          ? `Delete "${pendingDelete.name}"? Members lose access to reviewers shared only with this group.`
          : ""}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDeleteGroup}
      />
    </div>
  );
}
