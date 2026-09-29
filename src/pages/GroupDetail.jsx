import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Download,
  FolderKanban,
  Loader2,
  LogOut,
  Search,
  Trash2,
  UserPlus
} from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import {
  addGroupMember,
  leaveGroup,
  listGroupMembers,
  listGroupReviewers,
  listMyGroups,
  removeGroupMember,
  setGroupMemberRole,
  unshareReviewerFromGroup
} from "../services/groups.js";
import { searchProfiles } from "../services/social.js";
import {
  getLocalReviewers,
  saveLocalReviewer,
  SOCIAL_DATA_CHANGED_EVENT
} from "../utils/storageUtils.js";

const ROLE_LABELS = {
  owner: "Owner",
  admin: "Admin",
  member: "Member"
};

function getProfileName(profile) {
  return profile?.display_name || profile?.email || "Hachi user";
}

export default function GroupDetail() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { configured, loading, user } = useAuth();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [reviewers, setReviewers] = useState([]);
  const [message, setMessage] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingUnshare, setPendingUnshare] = useState(null);
  const [pendingLeave, setPendingLeave] = useState(false);

  const myRole = members.find((member) => member.user_id === user?.id)?.role || null;
  const canManage = myRole === "owner" || myRole === "admin";

  const loadGroup = useCallback(async (quiet = false) => {
    if (!user || !groupId) return;

    if (!quiet) setLoadingData(true);

    const [groupsResult, membersResult, reviewersResult] = await Promise.all([
      listMyGroups(user.id),
      listGroupMembers(groupId),
      listGroupReviewers(groupId)
    ]);

    setLoadingData(false);

    const match = (groupsResult.data || []).find((item) => item.id === groupId);

    if (groupsResult.error || membersResult.error) {
      setMessage({
        type: "error",
        text: (groupsResult.error || membersResult.error).message || "Could not load this group."
      });
      return;
    }

    if (!match) {
      setGroup(null);
      return;
    }

    setGroup(match);
    setMembers(membersResult.data || []);
    setReviewers(reviewersResult.data || []);

    if (reviewersResult.error) {
      setMessage({ type: "error", text: reviewersResult.error.message || "Could not load group reviewers." });
    }
  }, [user?.id, groupId]);

  useEffect(() => {
    if (!configured || !user) return;
    loadGroup();
  }, [configured, user?.id, groupId, loadGroup]);

  useEffect(() => {
    if (!configured || !user) return undefined;

    const refresh = () => {
      if (document.visibilityState === "visible") loadGroup(true);
    };

    window.addEventListener(SOCIAL_DATA_CHANGED_EVENT, refresh);

    return () => window.removeEventListener(SOCIAL_DATA_CHANGED_EVENT, refresh);
  }, [configured, user?.id, loadGroup]);

  async function runAction(key, action) {
    setBusyAction(key);
    setMessage(null);

    const { error } = await action();

    setBusyAction(null);

    if (error) {
      setMessage({ type: "error", text: error.message || "That action could not be completed." });
      return { ok: false };
    }

    return { ok: true };
  }

  async function searchForMembers(event) {
    event.preventDefault();
    if (!user) return;

    setSearching(true);
    setMessage(null);

    const { data, error } = await searchProfiles(query, user.id);
    setSearching(false);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not search users." });
      return;
    }

    setSearchResults(data || []);
  }

  async function addMember(profile) {
    const result = await runAction("add", () => addGroupMember(groupId, profile));
    if (!result.ok) return;

    setSearchResults([]);
    setQuery("");
    setMessage({ type: "success", text: `Added ${getProfileName(profile)}.` });
    loadGroup();
  }

  async function toggleAdmin(member) {
    const nextRole = member.role === "admin" ? "member" : "admin";
    const result = await runAction(`role-${member.id}`, () =>
      setGroupMemberRole(groupId, member.user_id, nextRole)
    );
    if (!result.ok) return;

    setMessage({
      type: "success",
      text: nextRole === "admin" ? `${getProfileName(member.profile)} is now an admin.` : `${getProfileName(member.profile)} is now a member.`
    });
    loadGroup();
  }

  async function confirmRemoveMember() {
    if (!pendingRemove) return;

    const name = getProfileName(pendingRemove.profile);
    const result = await runAction("remove", () => removeGroupMember(groupId, pendingRemove.user_id));
    setPendingRemove(null);

    if (!result.ok) return;

    setMessage({ type: "success", text: `Removed ${name}.` });
    loadGroup();
  }

  async function confirmUnshare() {
    if (!pendingUnshare) return;

    const title = pendingUnshare.title;
    const result = await runAction("unshare", () =>
      unshareReviewerFromGroup(user.id, pendingUnshare.reviewer_id, groupId)
    );
    setPendingUnshare(null);

    if (!result.ok) return;

    setMessage({ type: "success", text: `Stopped sharing "${title}" with this group.` });
    loadGroup();
  }

  async function confirmLeave() {
    const { error } = await leaveGroup(user.id, groupId);
    setPendingLeave(false);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not leave the group." });
      return;
    }

    navigate("/groups");
  }

  function saveReviewerOffline(reviewer) {
    const payload = reviewer.data || reviewer;
    saveLocalReviewer(payload);
    setMessage({ type: "success", text: "Saved on this device." });
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
          message="Groups need your account so the people you invite can see what you share."
          action={<Link className="button primary" to="/account">Go to Account</Link>}
        />
      </div>
    );
  }

  if (loadingData && !group) {
    return <div className="page narrow"><p className="muted">Loading group...</p></div>;
  }

  if (!group) {
    return (
      <div className="page narrow">
        <EmptyState
          title="Group not found"
          message="This group may have been deleted, or you may not be a member."
          action={<Link className="button primary" to="/groups">Back to groups</Link>}
        />
      </div>
    );
  }

  const offlineIds = new Set(getLocalReviewers().map((item) => item.reviewerId));

  return (
    <div className="page">
      <Link className="back-link" to="/groups">
        <ArrowLeft size={16} aria-hidden="true" />
        All groups
      </Link>

      <section className="section-heading">
        <div>
          <p className="eyebrow">Group</p>
          <h1>{group.name}</h1>
          <p className="muted">
            {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
            {myRole ? ` - you are ${ROLE_LABELS[myRole] || "a member"}` : ""}
          </p>
        </div>
        {myRole !== "owner" ? (
          <button className="button subtle danger-text" type="button" onClick={() => setPendingLeave(true)}>
            <LogOut size={17} aria-hidden="true" />
            Leave group
          </button>
        ) : null}
      </section>

      {group.description ? <p className="group-detail-description">{group.description}</p> : null}

      {message ? <p className={`sync-message ${message.type}`}>{message.text}</p> : null}

      <section className="library-panel">
        <div className="library-panel-head">
          <div>
            <h2>Reviewers</h2>
            <p className="muted">Everyone in this group can see these on their Home. Save one offline to study without a connection.</p>
          </div>
        </div>

        {reviewers.length ? (
          <div className="library-list">
            {reviewers.map((item) => {
              const payload = item.data || item;
              const reviewerId = payload?.reviewerId || item.reviewer_id;
              const savedOffline = offlineIds.has(reviewerId);
              const isOwner = item.owner_id === user.id;

              return (
                <article className="library-row" key={item.id || reviewerId}>
                  <div>
                    <h3>{payload?.title || item.title || "Untitled Reviewer"}</h3>
                    <p className="muted">
                      {payload?.subject || item.subject || "No subject"} - {payload?.questions?.length || 0} questions
                    </p>
                    <p className="muted">Shared by {isOwner ? "you" : item.ownerName}</p>
                  </div>
                  <div className="button-row">
                    {savedOffline ? (
                      <Link className="button primary" to={`/reviewer/${reviewerId}`}>
                        Open
                      </Link>
                    ) : null}
                    <button
                      className="button subtle"
                      type="button"
                      onClick={() => saveReviewerOffline(item)}
                      disabled={savedOffline}
                    >
                      {savedOffline ? <Check size={17} aria-hidden="true" /> : <Download size={17} aria-hidden="true" />}
                      {savedOffline ? "Saved Offline" : "Save Offline"}
                    </button>
                    {isOwner ? (
                      <button className="button subtle danger-text" type="button" onClick={() => setPendingUnshare({ ...item, title: payload?.title, reviewer_id: reviewerId })}>
                        <Trash2 size={17} aria-hidden="true" />
                        Stop sharing
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No reviewers shared yet"
            message="Open a reviewer you own and use Share with groups from its menu."
            action={<Link className="button subtle" to="/library">Go to Library</Link>}
          />
        )}
      </section>

      <section className="library-panel">
        <div className="library-panel-head">
          <div>
            <h2>Members</h2>
            <p className="muted">Admins and the owner can add or remove people.</p>
          </div>
        </div>

        {canManage ? (
          <form className="friend-search-form" onSubmit={searchForMembers}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Add someone by email or name"
            />
            <button className="button primary" type="submit" disabled={searching}>
              {searching ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Search size={17} aria-hidden="true" />}
              Search
            </button>
          </form>
        ) : null}

        {searchResults.length ? (
          <div className="library-list">
            {searchResults.map((profile) => (
              <article className="library-row" key={profile.id}>
                <div>
                  <h3>{getProfileName(profile)}</h3>
                  <p className="muted">{profile.email}</p>
                </div>
                <button
                  className="button subtle"
                  type="button"
                  onClick={() => addMember(profile)}
                  disabled={busyAction === "add"}
                >
                  <UserPlus size={17} aria-hidden="true" />
                  Add
                </button>
              </article>
            ))}
          </div>
        ) : null}

        <div className="library-list">
          {members.map((member) => {
            const isMe = member.user_id === user.id;

            return (
              <article className="library-row" key={member.id || member.user_id}>
                <div>
                  <h3>
                    {getProfileName(member.profile)}
                    {isMe ? " (you)" : ""}
                  </h3>
                  <p className="muted">{member.profile?.email || "No email"}</p>
                </div>
                <div className="button-row">
                  <span className={`group-role-badge ${member.role}`}>
                    {ROLE_LABELS[member.role] || "Member"}
                  </span>
                  {canManage && member.role !== "owner" ? (
                    <>
                      <button
                        className="button subtle"
                        type="button"
                        onClick={() => toggleAdmin(member)}
                        disabled={busyAction === `role-${member.id}`}
                      >
                        {member.role === "admin" ? "Make member" : "Make admin"}
                      </button>
                      <button
                        className="button subtle danger-text"
                        type="button"
                        onClick={() => setPendingRemove(member)}
                        disabled={isMe}
                      >
                        Remove
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <p className="reviewer-menu-note">
        <FolderKanban size={14} aria-hidden="true" />
        Reviewers you share with a group are only visible to that group, not to your friends.
      </p>

      <ConfirmModal
        open={Boolean(pendingRemove)}
        title="Remove this member?"
        message={pendingRemove ? `Remove ${getProfileName(pendingRemove.profile)} from ${group.name}?` : ""}
        confirmLabel="Remove"
        danger
        onCancel={() => setPendingRemove(null)}
        onConfirm={confirmRemoveMember}
      />

      <ConfirmModal
        open={Boolean(pendingUnshare)}
        title="Stop sharing?"
        message={pendingUnshare ? `Members of ${group.name} will no longer see "${pendingUnshare.title}".` : ""}
        confirmLabel="Stop sharing"
        danger
        onCancel={() => setPendingUnshare(null)}
        onConfirm={confirmUnshare}
      />

      <ConfirmModal
        open={pendingLeave}
        title="Leave this group?"
        message={`You will lose access to reviewers shared with ${group.name}.`}
        confirmLabel="Leave"
        danger
        onCancel={() => setPendingLeave(false)}
        onConfirm={confirmLeave}
      />
    </div>
  );
}
