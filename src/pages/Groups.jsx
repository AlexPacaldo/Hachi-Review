import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, RefreshCw, UsersRound, X } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { createGroup, deleteGroup, listMyGroups } from "../services/groups.js";
import { SOCIAL_DATA_CHANGED_EVENT } from "../utils/storageUtils.js";

const POLL_INTERVAL_MS = 30000;

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  member: "Member"
};

export default function Groups() {
  const { configured, loading, user } = useAuth();
  const [groups, setGroups] = useState([]);
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

    setGroups(data || []);
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
        <div className="group-grid">
          {groups.map((group) => (
            <article className="group-card" key={group.id}>
              <div className="group-card-head">
                <span className="group-card-icon" aria-hidden="true">
                  <UsersRound size={18} />
                </span>
                <div>
                  <h2>{group.name}</h2>
                  <p className="muted">
                    {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
                  </p>
                </div>
                <span className={`group-role-badge ${group.role}`}>{ROLE_LABELS[group.role] || "Member"}</span>
              </div>

              {group.description ? <p className="group-card-description">{group.description}</p> : null}

              <div className="button-row">
                <Link className="button primary" to={`/groups/${group.id}`}>
                  Open
                </Link>
                {group.role === "owner" ? (
                  <button className="button subtle danger-text" type="button" onClick={() => setPendingDelete(group)}>
                    Delete
                  </button>
                ) : null}
              </div>
            </article>
          ))}
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
