import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Crown,
  Download,
  Loader2,
  LogOut,
  MoreVertical,
  Search,
  Trash2,
  UserPlus,
  UsersRound,
  X
} from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import ReviewerCard from "../components/ReviewerCard.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { validateReviewer } from "../data/reviewerRegistry.js";
import {
  addGroupMember,
  deleteGroup,
  leaveGroup,
  listGroupMembers,
  listGroupReviewers,
  listMyGroups,
  removeGroupMember,
  setGroupMemberRole,
  shareReviewerWithGroups
} from "../services/groups.js";
import { listFriendships, searchProfiles } from "../services/social.js";
import {
  getAllProgress,
  getAttemptHistory,
  getCloudReviewerCache,
  getLocalReviewers,
  REVIEWER_DATA_CHANGED_EVENT,
  saveCloudReviewerCache,
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
  const [dataVersion, setDataVersion] = useState(0);

  const [menuOpen, setMenuOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [friendCandidates, setFriendCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyAction, setBusyAction] = useState(null);

  const [pendingRemove, setPendingRemove] = useState(null);
  const [pendingUnshare, setPendingUnshare] = useState(null);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState(false);

  const menuRef = useRef(null);
  const popoverRef = useRef(null);
  const [popoverStyle, setPopoverStyle] = useState(null);

  // Bump on any local or social mutation so the progress, attempt history, and
  // offline badges re-read from storage instead of staying stale.
  const progress = useMemo(() => getAllProgress(), [dataVersion]);
  const attempts = useMemo(() => getAttemptHistory(), [dataVersion]);
  const offlineIds = useMemo(
    () => new Set(getLocalReviewers().map((item) => item.reviewerId)),
    [dataVersion]
  );
  const completedReviewerIds = useMemo(
    () => new Set(attempts.map((attempt) => attempt.reviewerId).filter(Boolean)),
    [attempts]
  );

  const myRole = members.find((member) => member.user_id === user?.id)?.role || null;
  const canManage = myRole === "owner" || myRole === "admin";

  const memberIds = useMemo(() => new Set(members.map((member) => member.user_id)), [members]);

  // People who can still be added: accepted friends first, then anyone the
  // search turned up. Each row gets an Add button beside the name.
  const addableCandidates = useMemo(() => {
    const fromFriends = friendCandidates
      .filter((profile) => !memberIds.has(profile.id))
      .map((profile) => ({ ...profile, source: "friend" }));

    const seen = new Set(fromFriends.map((profile) => profile.id));
    const fromSearch = (searchResults || [])
      .filter((profile) => !memberIds.has(profile.id) && !seen.has(profile.id))
      .map((profile) => ({ ...profile, source: "search" }));

    return [...fromFriends, ...fromSearch];
  }, [friendCandidates, searchResults, memberIds]);

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

    // Seed the cloud cache so the cards link out to the reviewer like they do
    // on Home, even if the shared reviewer was never saved to this device.
    const groupRows = reviewersResult.data || [];
    if (groupRows.length) {
      const incoming = groupRows.map((row) => {
        const payload = row.data || row;
        return {
          ...payload,
          ownerId: row.owner_id,
          ownerName: row.ownerName,
          visibility: "group",
          sharedGroups: row.shared_groups || null
        };
      });
      const incomingIds = new Set(incoming.map((item) => item.reviewerId));
      saveCloudReviewerCache([
        ...incoming,
        ...getCloudReviewerCache().filter((item) => !incomingIds.has(item.reviewerId))
      ]);
    }

    if (reviewersResult.error) {
      setMessage({ type: "error", text: reviewersResult.error.message || "Could not load group reviewers." });
    }
  }, [user?.id, groupId]);

  const loadFriendCandidates = useCallback(async () => {
    if (!user) return;

    const { data } = await listFriendships(user.id);
    setFriendCandidates(
      (data || [])
        .filter((friendship) => friendship.status === "accepted")
        .map((friendship) => friendship.otherProfile)
        .filter(Boolean)
    );
  }, [user?.id]);

  useEffect(() => {
    if (!configured || !user) return;
    loadGroup();
  }, [configured, user?.id, groupId, loadGroup]);

  useEffect(() => {
    if (!configured || !user) return undefined;

    const refresh = () => {
      setDataVersion((current) => current + 1);
      if (document.visibilityState === "visible") loadGroup(true);
    };

    window.addEventListener(SOCIAL_DATA_CHANGED_EVENT, refresh);
    window.addEventListener(REVIEWER_DATA_CHANGED_EVENT, refresh);

    return () => {
      window.removeEventListener(SOCIAL_DATA_CHANGED_EVENT, refresh);
      window.removeEventListener(REVIEWER_DATA_CHANGED_EVENT, refresh);
    };
  }, [configured, user?.id, loadGroup]);

  // The menu is portalled to the body, so it anchors to the trigger's viewport
  // rectangle rather than an ancestor's box, same as the reviewer card menu.
  useEffect(() => {
    if (!menuOpen) {
      setPopoverStyle(null);
      return undefined;
    }

    const updatePosition = () => {
      const trigger = menuRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const gutter = 12;
      const width = Math.min(340, window.innerWidth - gutter * 2);
      let left = rect.right - width;
      let top = rect.bottom + 8;

      left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));

      const height = popoverRef.current?.offsetHeight || 0;
      if (height && top + height > window.innerHeight - gutter) {
        top = Math.max(gutter, rect.top - height - 8);
      }

      setPopoverStyle({ top, left, width });
    };

    updatePosition();
    const frame = requestAnimationFrame(updatePosition);

    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const closeOnOutsideClick = (event) => {
      const insideTrigger = menuRef.current?.contains(event.target);
      const insidePopover = popoverRef.current?.contains(event.target);
      if (!insideTrigger && !insidePopover) setMenuOpen(false);
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

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

    const { data, error } = await searchProfiles(memberQuery, user.id);
    setSearching(false);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not search users." });
      return;
    }

    setSearchResults(data || []);
  }

  async function addMember(profile) {
    const result = await runAction(`add-${profile.id}`, () =>
      addGroupMember(groupId, profile, user.id)
    );
    if (!result.ok) return;

    setMessage({ type: "success", text: `Added ${getProfileName(profile)} to ${group?.name}.` });
    await loadGroup(true);
  }

  async function toggleAdmin(member) {
    const nextRole = member.role === "admin" ? "member" : "admin";
    const result = await runAction(`role-${member.id}`, () =>
      setGroupMemberRole(groupId, member.user_id, nextRole)
    );
    if (!result.ok) return;

    setMessage({
      type: "success",
      text: nextRole === "admin"
        ? `${getProfileName(member.profile)} is now an admin.`
        : `${getProfileName(member.profile)} is now a member.`
    });
    await loadGroup(true);
  }

  async function confirmRemoveMember() {
    if (!pendingRemove) return;

    const name = getProfileName(pendingRemove.profile);
    const result = await runAction("remove", () =>
      removeGroupMember(groupId, pendingRemove.user_id)
    );
    setPendingRemove(null);

    if (!result.ok) return;

    setMessage({ type: "success", text: `Removed ${name}.` });
    await loadGroup(true);
  }

  async function confirmUnshare() {
    if (!pendingUnshare) return;

    const title = pendingUnshare.title;
    const result = await runAction("unshare", () =>
      shareReviewerWithGroups(user.id, pendingUnshare.reviewer_id, pendingUnshare.remaining)
    );
    setPendingUnshare(null);

    if (!result.ok) return;

    setMessage({ type: "success", text: `Stopped sharing "${title}" with this group.` });
    await loadGroup(true);
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

  async function confirmDeleteGroup() {
    setPendingDeleteGroup(false);
    const { error } = await deleteGroup(groupId);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not delete the group." });
      return;
    }

    navigate("/groups");
  }

  function saveReviewerOffline(reviewer) {
    const payload = reviewer.data || reviewer;
    saveLocalReviewer(payload);
    setMessage({ type: "success", text: "Saved on this device." });
  }

  function openMemberMenu() {
    setMenuOpen((current) => {
      const next = !current;
      if (next) loadFriendCandidates();
      return next;
    });
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

  const cards = reviewers.map((row) => {
    const payload = row.data || row;
    const reviewerId = payload?.reviewerId || row.reviewer_id;
    const savedOffline = offlineIds.has(reviewerId);
    const isOwner = row.owner_id === user.id;

    return {
      row,
      reviewerId,
      isOwner,
      savedOffline,
      card: {
        ...payload,
        ownerName: isOwner ? null : row.ownerName,
        source: "cloud",
        storageStatus: savedOffline ? "both" : "cloud",
        validation: validateReviewer(payload)
      }
    };
  });

  return (
    <div className="page">
      <div className="group-detail-bar">
        <Link className="back-link" to="/groups">
          <ArrowLeft size={16} aria-hidden="true" />
          All groups
        </Link>

        <div className="group-menu-anchor" ref={menuRef}>
          <button
            className="icon-button group-menu-trigger"
            type="button"
            onClick={openMemberMenu}
            aria-label="Group options"
            aria-expanded={menuOpen}
          >
            <MoreVertical size={18} aria-hidden="true" />
          </button>

          {menuOpen ? (
            <section
              className="group-menu-popover"
              ref={popoverRef}
              style={popoverStyle || { visibility: "hidden" }}
              role="dialog"
              aria-label="Group options"
            >
              <div className="group-menu-head">
                <strong>Members</strong>
                <span className="muted">{members.length}</span>
                <button className="icon-button small" type="button" onClick={() => setMenuOpen(false)} aria-label="Close">
                  <X size={15} aria-hidden="true" />
                </button>
              </div>

              <div className="group-menu-list">
                {members.map((member) => {
                  const isMe = member.user_id === user.id;

                  return (
                    <div className="group-menu-row" key={member.id || member.user_id}>
                      <span className="group-menu-name">
                        <strong>
                          {getProfileName(member.profile)}
                          {isMe ? " (you)" : ""}
                        </strong>
                        <small>{member.profile?.email || "No email"}</small>
                      </span>

                      {member.role === "owner" ? (
                        <span className="group-role-badge owner" title="Group owner">
                          <Crown size={12} aria-hidden="true" />
                        </span>
                      ) : canManage ? (
                        <span className="button-row">
                          <button
                            className="button subtle small"
                            type="button"
                            onClick={() => toggleAdmin(member)}
                            disabled={busyAction === `role-${member.id}`}
                          >
                            {member.role === "admin" ? "Demote" : "Admin"}
                          </button>
                          <button
                            className="button subtle small danger-text"
                            type="button"
                            onClick={() => setPendingRemove(member)}
                            disabled={isMe}
                          >
                            Remove
                          </button>
                        </span>
                      ) : (
                        <span className={`group-role-badge ${member.role}`}>
                          {ROLE_LABELS[member.role] || "Member"}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {canManage ? (
                <div className="group-menu-section">
                  <span className="group-menu-label">Add people</span>

                  <form className="group-menu-search" onSubmit={searchForMembers}>
                    <input
                      value={memberQuery}
                      onChange={(event) => setMemberQuery(event.target.value)}
                      placeholder="Search by email or name"
                      aria-label="Search people to add"
                    />
                    <button className="button subtle" type="submit" disabled={searching} aria-label="Search">
                      {searching ? <Loader2 className="spinner" size={15} aria-hidden="true" /> : <Search size={15} aria-hidden="true" />}
                    </button>
                  </form>

                  {addableCandidates.length ? (
                    <div className="group-menu-list">
                      {addableCandidates.map((profile) => (
                        <div className="group-menu-row" key={profile.id}>
                          <span className="group-menu-name">
                            <strong>{getProfileName(profile)}</strong>
                            <small>{profile.email}</small>
                          </span>
                          <button
                            className="button subtle small"
                            type="button"
                            onClick={() => addMember(profile)}
                            disabled={busyAction === `add-${profile.id}`}
                          >
                            <UserPlus size={14} aria-hidden="true" />
                            Add
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="group-menu-note">
                      {friendCandidates.length || searchResults.length
                        ? "Everyone here is already a member."
                        : "Add friends first, or search for someone by email."}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="group-menu-actions">
                {myRole === "owner" ? (
                  <button
                    className="button subtle danger-text"
                    type="button"
                    onClick={() => { setMenuOpen(false); setPendingDeleteGroup(true); }}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Delete group
                  </button>
                ) : (
                  <button
                    className="button subtle danger-text"
                    type="button"
                    onClick={() => { setMenuOpen(false); setPendingLeave(true); }}
                  >
                    <LogOut size={15} aria-hidden="true" />
                    Leave group
                  </button>
                )}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <section className="section-heading">
        <div>
          <p className="eyebrow">Group</p>
          <h1>{group.name}</h1>
          <p className="muted">
            {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
            {myRole ? ` - you are ${ROLE_LABELS[myRole] || "a member"}` : ""}
          </p>
        </div>
      </section>

      {group.description ? <p className="group-detail-description">{group.description}</p> : null}

      {message ? <p className={`sync-message ${message.type}`}>{message.text}</p> : null}

      <section className="section-heading" id="group-reviewers">
        <div>
          <h2>Choose a Reviewer</h2>
          <p className="muted">Everyone in this group can open these. Save one offline to study without a connection.</p>
        </div>
      </section>

      {cards.length ? (
        <div className="reviewer-grid">
          {cards.map(({ row, reviewerId, isOwner, savedOffline, card }) =>
            card.validation.isValid ? (
              <div className="group-reviewer-card" key={row.id || reviewerId}>
                <ReviewerCard
                  reviewer={card}
                  progress={progress[reviewerId]}
                  hasCompleted={completedReviewerIds.has(reviewerId)}
                />
                <div className="group-reviewer-actions">
                  <button
                    className="button subtle"
                    type="button"
                    onClick={() => saveReviewerOffline(row)}
                    disabled={savedOffline}
                  >
                    <Download size={16} aria-hidden="true" />
                    {savedOffline ? "Saved Offline" : "Save Offline"}
                  </button>
                  {isOwner ? (
                    <button
                      className="button subtle danger-text"
                      type="button"
                      onClick={() => setPendingUnshare({
                        title: card.title,
                        reviewer_id: reviewerId,
                        remaining: (row.shared_groups || []).filter((id) => String(id) !== String(groupId))
                      })}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      Stop sharing
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <article className="reviewer-card error-card" key={reviewerId || card.title}>
                <h3>Unable to load this reviewer.</h3>
                <p>{card.title || "Untitled reviewer"}</p>
                <p className="muted">{card.validation.errors[0]}</p>
              </article>
            )
          )}
        </div>
      ) : (
        <EmptyState
          title="No reviewers shared yet"
          message="Open a reviewer you own and choose Groups from its sharing menu."
          action={<Link className="button subtle" to="/library">Go to Library</Link>}
        />
      )}

      <p className="reviewer-menu-note">
        <UsersRound size={14} aria-hidden="true" />
        Reviewers shared with a group are only visible to that group, not to your friends.
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

      <ConfirmModal
        open={pendingDeleteGroup}
        title="Delete this group?"
        message={`Delete "${group.name}"? Everyone in it loses access to reviewers shared only with this group.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setPendingDeleteGroup(false)}
        onConfirm={confirmDeleteGroup}
      />
    </div>
  );
}
