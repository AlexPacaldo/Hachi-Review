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
  Pencil,
  Share2,
  Trash2,
  UserMinus,
  UserPlus,
  UsersRound,
  X
} from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import ReviewerCard from "../components/ReviewerCard.jsx";
import UserAvatar from "../components/UserAvatar.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { validateReviewer } from "../data/reviewerRegistry.js";
import {
  addGroupMember,
  buildGroupInviteUrl,
  deleteGroup,
  leaveGroup,
  listGroupMembers,
  listGroupReviewers,
  listMyGroups,
  regenerateGroupInviteCode,
  removeGroupMember,
  setGroupMemberRole,
  shareReviewerWithGroups,
  updateGroup
} from "../services/groups.js";
import { listFriendships, searchProfiles } from "../services/social.js";
import { getCloudReviewerById } from "../services/cloudReviewers.js";
import { isFriendVisible } from "../services/reviewerVisibility.js";
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
  return profile?.display_name || "Hachi user";
}

// Saving the cloud cache announces a reviewer data change, and this page
// reloads on that event, so the cache is only written when its contents would
// actually differ. Without this the page reloads itself forever.
function cacheFingerprint(reviewers) {
  return JSON.stringify(
    (reviewers || []).map((item) => [
      item.reviewerId,
      item.updatedAt,
      item.title,
      item.subject,
      item.ownerId,
      item.visibility,
      item.sharedGroups,
      item.sharedWith
    ])
  );
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

  const [pendingKick, setPendingKick] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);
  const [pendingUnshare, setPendingUnshare] = useState(null);
  const [pendingLeave, setPendingLeave] = useState(false);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCandidates, setShareCandidates] = useState([]);
  const [sharingId, setSharingId] = useState(null);

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
          updatedAt: row.updated_at,
          // The row knows whether its owner also shared it with friends, and
          // that audience has to survive into the cache.
          visibility: row.visibility || "group",
          sharedGroups: row.shared_groups || null
        };
      });
      const incomingIds = new Set(incoming.map((item) => item.reviewerId));
      const currentCache = getCloudReviewerCache();
      const currentById = new Map(currentCache.map((item) => [item.reviewerId, item]));

      // An incoming summary must not drop the questions of a reviewer this
      // device has already downloaded, so the cached copy is carried over.
      const nextCache = [
        ...incoming.map((item) => {
          const existing = currentById.get(item.reviewerId);
          return existing && Array.isArray(existing.questions) && !Array.isArray(item.questions)
            ? { ...existing, ...item, questions: existing.questions }
            : item;
        }),
        ...currentCache.filter((item) => !incomingIds.has(item.reviewerId))
      ];

      if (cacheFingerprint(nextCache) !== cacheFingerprint(currentCache)) {
        saveCloudReviewerCache(nextCache);
      }
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

  async function confirmKick() {
    if (!pendingKick) return;

    const name = getProfileName(pendingKick.profile);
    const result = await runAction(`kick-${pendingKick.id}`, () =>
      removeGroupMember(groupId, pendingKick.user_id)
    );
    setPendingKick(null);

    if (!result.ok) return;

    setMessage({ type: "success", text: `${name} was removed from ${group.name}.` });
    await loadGroup(true);
  }

  async function confirmUnshare() {
    if (!pendingUnshare) return;

    const title = pendingUnshare.title;
    // Stopping a group share only touches the group audience, so the owner keeps
    // whatever friend sharing the reviewer already had.
    const result = await runAction("unshare", () =>
      shareReviewerWithGroups(user.id, pendingUnshare.reviewer_id, pendingUnshare.remaining, {
        friendsVisible: pendingUnshare.friendsVisible
      })
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

  function openEditGroup() {
    setEditName(group.name || "");
    setEditDescription(group.description || "");
    setEditError(null);
    setEditOpen(true);
  }

  async function submitEditGroup(event) {
    event.preventDefault();
    if (editSaving) return;

    if (!editName.trim()) {
      setEditError("Give the group a name.");
      return;
    }

    setEditSaving(true);
    setEditError(null);

    const { error } = await updateGroup(user.id, groupId, {
      name: editName,
      description: editDescription
    });

    setEditSaving(false);

    if (error) {
      setEditError(error.message || "Could not save the group.");
      return;
    }

    setEditOpen(false);
    setMessage({ type: "success", text: "Group details updated." });
    await loadGroup(true);
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

  async function saveReviewerOffline(reviewer) {
    const payload = reviewer.data || reviewer;

    // Group reviewers are listed as summaries, so the questions are downloaded
    // before anything is written to local storage.
    if (!Array.isArray(payload?.questions)) {
      if (!payload?.reviewerId) {
        setMessage({ type: "error", text: "This reviewer is missing a reviewer ID." });
        return;
      }

      const cachedFull = getCloudReviewerCache().find((item) => (
        item.reviewerId === payload.reviewerId && Array.isArray(item.questions)
      ));
      const { data } = cachedFull
        ? { data: cachedFull }
        : await getCloudReviewerById(payload.reviewerId, user?.id);

      if (!data?.questions) {
        setMessage({ type: "error", text: "Could not download this reviewer." });
        return;
      }

      saveLocalReviewer(data);
      setMessage({ type: "success", text: "Saved on this device." });
      return;
    }

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

  function openShareWithGroup() {
    const candidates = getCloudReviewerCache()
      .filter((item) => item.ownerId === user.id)
      .filter((item) => !(item.sharedGroups || []).map(String).includes(String(groupId)))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

    setShareCandidates(candidates);
    setShareOpen(true);
  }

  async function shareWithGroup(reviewer) {
    if (sharingId) return;

    setSharingId(reviewer.reviewerId);

    const { error } = await shareReviewerWithGroups(
      user.id,
      reviewer.reviewerId,
      [...(reviewer.sharedGroups || []), groupId],
      { friendsVisible: isFriendVisible(reviewer.visibility) }
    );

    setSharingId(null);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not share that reviewer." });
      return;
    }

    setShareCandidates((current) => current.filter((item) => item.reviewerId !== reviewer.reviewerId));
    setMessage({ type: "success", text: `Shared "${reviewer.title || "Untitled reviewer"}" with ${group.name}.` });
    await loadGroup(true);
  }

  const inviteUrl = buildGroupInviteUrl(group?.invite_code);

  async function copyInviteLink() {
    if (!inviteUrl) return;

    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      setMessage({ type: "error", text: "Could not copy the link. Select it and copy it by hand." });
    }
  }

  async function rotateInviteLink() {
    if (inviteBusy) return;

    setInviteBusy(true);
    setMessage(null);

    const { error } = await regenerateGroupInviteCode(groupId);

    setInviteBusy(false);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not make a new invite link." });
      return;
    }

    setMessage({ type: "success", text: "New invite link created. The old one no longer works." });
    await loadGroup(true);
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
    // Every card names the person who shared it into this group, including the
    // reviewers you shared yourself.
    const sharedBy = isOwner ? "You" : row.ownerName || "A member";

    return {
      row,
      reviewerId,
      isOwner,
      savedOffline,
      sharedBy,
      card: {
        ...payload,
        ownerName: sharedBy,
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
                  // Kicking is the one member action reserved for the owner, so
                  // admins get the role toggle without it.
                  const canKick = myRole === "owner" && !isMe && member.role !== "owner";

                  return (
                    <div className="group-menu-row" key={member.id || member.user_id}>
                      <UserAvatar profile={member.profile} size="sm" />
                      <span className="group-menu-name">
                        <strong>
                          {getProfileName(member.profile)}
                          {isMe ? " (you)" : ""}
                        </strong>
                        <small>{member.role === "owner" ? "Owner" : member.role === "admin" ? "Admin" : "Member"}</small>
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
                          {canKick ? (
                            <button
                              className="button subtle small danger-text"
                              type="button"
                              onClick={() => setPendingKick(member)}
                              disabled={busyAction === `kick-${member.id}`}
                            >
                              <UserMinus size={14} aria-hidden="true" />
                              Kick
                            </button>
                          ) : null}
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

              {inviteUrl ? (
                <div className="group-menu-section">
                  <span className="group-menu-label">Invite link</span>
                  <div className="group-menu-search">
                    <input value={inviteUrl} readOnly aria-label="Group invite link" onFocus={(event) => event.target.select()} />
                    <button className="button subtle" type="button" onClick={copyInviteLink}>
                      {inviteCopied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  {canManage ? (
                    <button
                      className="button subtle small"
                      type="button"
                      onClick={rotateInviteLink}
                      disabled={inviteBusy}
                    >
                      {inviteBusy ? <Loader2 className="spinner" size={14} aria-hidden="true" /> : null}
                      New link
                    </button>
                  ) : null}
                </div>
              ) : null}

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
                          <UserAvatar profile={profile} size="sm" />
                          <span className="group-menu-name">
                            <strong>{getProfileName(profile)}</strong>
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
                {canManage ? (
                  <button
                    className="button subtle"
                    type="button"
                    onClick={() => { setMenuOpen(false); openEditGroup(); }}
                  >
                    <Pencil size={15} aria-hidden="true" />
                    Edit group
                  </button>
                ) : null}

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
        <button className="button subtle" type="button" onClick={openShareWithGroup}>
          <Share2 size={15} aria-hidden="true" />
          Share a reviewer
        </button>
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
                  sharedByPrefix="Shared with this group by "
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
                        friendsVisible: isFriendVisible(row.visibility),
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
          message="Open a reviewer you own and turn on Groups from its sharing menu."
          action={<Link className="button subtle" to="/library">Go to Library</Link>}
        />
      )}

      <p className="reviewer-menu-note">
        <UsersRound size={14} aria-hidden="true" />
        Group sharing is separate from friend sharing, so friends outside this group only see what the
        owner shared with them directly.
      </p>

      {editOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setEditOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-group-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2 id="edit-group-title">Edit group</h2>
                <p className="muted">Everyone in the group sees this name and description.</p>
              </div>
              <button
                className="icon-button small"
                type="button"
                onClick={() => setEditOpen(false)}
                aria-label="Close"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <form className="group-form" onSubmit={submitEditGroup}>
              <label htmlFor="edit-group-name">Group name</label>
              <input
                id="edit-group-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                placeholder="Biology revision crew"
                maxLength={60}
                autoFocus
              />

              <label htmlFor="edit-group-description">Description (optional)</label>
              <textarea
                id="edit-group-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                placeholder="What are you working through together?"
                rows={3}
                maxLength={240}
              />

              {editError ? <p className="sync-message error">{editError}</p> : null}

              <div className="modal-actions">
                <button className="button subtle" type="button" onClick={() => setEditOpen(false)}>
                  Cancel
                </button>
                <button className="button primary" type="submit" disabled={editSaving}>
                  {editSaving ? <Loader2 className="spinner" size={16} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
                  {editSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {shareOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setShareOpen(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-reviewer-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h2 id="share-reviewer-title">Share a reviewer</h2>
                <p className="muted">Pick one from your library to share with {group.name}.</p>
              </div>
              <button
                className="icon-button small"
                type="button"
                onClick={() => setShareOpen(false)}
                aria-label="Close"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {shareCandidates.length ? (
              <div className="group-menu-list">
                {shareCandidates.map((reviewer) => (
                  <div className="group-menu-row" key={reviewer.reviewerId}>
                    <span className="group-menu-name">
                      <strong>{reviewer.title || "Untitled reviewer"}</strong>
                      <small>{reviewer.subject || "No subject"}</small>
                    </span>
                    <button
                      className="button subtle small"
                      type="button"
                      onClick={() => shareWithGroup(reviewer)}
                      disabled={sharingId === reviewer.reviewerId}
                    >
                      {sharingId === reviewer.reviewerId ? <Loader2 className="spinner" size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />}
                      Share
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="group-menu-note">
                {getCloudReviewerCache().some((item) => item.ownerId === user.id)
                  ? "Every reviewer you own is already shared with this group."
                  : "No cloud reviewers yet. Generate or upload one first."}
              </p>
            )}
          </section>
        </div>
      ) : null}

      <ConfirmModal
        open={Boolean(pendingKick)}
        title="Remove this member?"
        message={pendingKick
          ? `${getProfileName(pendingKick.profile)} will lose access to ${group.name} and to every reviewer shared with it. They can be added again later.`
          : ""}
        confirmLabel="Remove"
        danger
        onCancel={() => setPendingKick(null)}
        onConfirm={confirmKick}
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
