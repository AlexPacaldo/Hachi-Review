import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Check,
  Loader2,
  MoreVertical,
  Pencil,
  Save,
  Trash2,
  UserPlus,
  Users,
  UsersRound,
  X
} from "lucide-react";
import {
  checkReviewerSharingReady,
  deleteCloudReviewer,
  getCloudReviewerById,
  getMyCloudReviewer,
  updateCloudReviewerVisibility,
  upsertCloudReviewer
} from "../services/cloudReviewers.js";
import ConfirmModal from "./ConfirmModal.jsx";
import { deleteReviewerSharesForOwner, listFriendships } from "../services/social.js";
import { clearReviewerGroupShares, listMyGroups, shareReviewerWithGroups } from "../services/groups.js";
import {
  isFriendVisible,
  isGroupVisible,
  normalizeVisibility,
  resolveVisibility,
  VISIBILITY_PRIVATE
} from "../services/reviewerVisibility.js";
import { pushRemovedProgressToCloud, saveReviewerToAccount } from "../services/syncEngine.js";
import {
  deleteLocalReviewer,
  getCloudReviewerCache,
  getLocalReviewers,
  saveCloudReviewerCache,
  saveLocalReviewer
} from "../utils/storageUtils.js";

function getProfileName(profile) {
  return profile?.display_name || "Hachi user";
}

export default function ReviewerMenu({ reviewer, user, configured, onMessage, onChanged }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Friends and groups are two independent audiences. Both are derived from the
  // one stored value so a row that names either or both reads the same here.
  const [visibility, setVisibility] = useState(normalizeVisibility(reviewer.visibility));
  const [sharedWith, setSharedWith] = useState(
    Array.isArray(reviewer.sharedWith) && reviewer.sharedWith.length ? reviewer.sharedWith : null
  );
  const [sharedGroups, setSharedGroups] = useState(
    Array.isArray(reviewer.sharedGroups) ? reviewer.sharedGroups : []
  );
  const [sharingError, setSharingError] = useState(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [friends, setFriends] = useState([]);
  const [friendLoading, setFriendLoading] = useState(false);
  const [friendMode, setFriendMode] = useState("all");
  const [selectedFriends, setSelectedFriends] = useState([]);
  const [pickSaving, setPickSaving] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupList, setGroupList] = useState([]);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupSaving, setGroupSaving] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState([]);
  const menuRef = useRef(null);
  const popoverRef = useRef(null);
  const [popoverStyle, setPopoverStyle] = useState(null);

  const storageStatus = reviewer.storageStatus || reviewer.source;
  const hasLocal = storageStatus === "both" || reviewer.source === "local";
  const hasCloud = storageStatus === "both" || reviewer.source === "cloud";
  const isOwner = user
    ? reviewer.ownerId
      ? reviewer.ownerId === user.id
      : reviewer.source !== "built-in"
    : reviewer.source !== "cloud" && reviewer.source !== "built-in";
  const isBuiltIn = reviewer.source === "built-in";
  const friendsVisible = isFriendVisible(visibility);
  const groupsVisible = isGroupVisible(visibility);
  const friendAudienceText = !friendsVisible
    ? "Off"
    : sharedWith ? `${sharedWith.length} chosen` : "All friends";
  const groupAudienceText = groupsVisible
    ? `${sharedGroups.length} group${sharedGroups.length === 1 ? "" : "s"}`
    : "Off";

  const [renameOpen, setRenameOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(reviewer.title || "");
  const [newSubject, setNewSubject] = useState(reviewer.subject || "");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState(null);

  useEffect(() => {
    if (!open) {
      setPopoverStyle(null);
      return undefined;
    }

    // The popover is portalled to the body, so it positions itself against the
    // trigger's viewport rectangle instead of an ancestor's box.
    const updatePosition = () => {
      const trigger = menuRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const gutter = 12;
      const width = Math.min(320, window.innerWidth - gutter * 2);
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
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event) => {
      const insideTrigger = menuRef.current?.contains(event.target);
      const insidePopover = popoverRef.current?.contains(event.target);
      if (!insideTrigger && !insidePopover) {
        setOpen(false);
      }
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    let isMounted = true;

    if (!open || !configured || !user || !isOwner || !hasCloud) {
      return undefined;
    }

    async function loadSharingState() {
      const { ready, error } = await checkReviewerSharingReady(user.id);
      if (!isMounted) return;

      if (!ready) {
        setSharingError(error?.message || "Sharing needs a database update. Run supabase-schema.sql.");
        return;
      }

      setSharingError(null);
      const { data } = await getMyCloudReviewer(user.id, reviewer.reviewerId);
      if (!isMounted) return;

      if (data) {
        setVisibility(normalizeVisibility(data.visibility));
        setSharedWith(Array.isArray(data.shared_with) && data.shared_with.length ? data.shared_with : null);
        setSharedGroups(Array.isArray(data.shared_groups) ? data.shared_groups : []);
      }
    }

    loadSharingState();

    return () => {
      isMounted = false;
    };
  }, [open, configured, user?.id, isOwner, hasCloud]);

  if (isBuiltIn) return null;

  function syncMetadata(fields) {
    const nextCache = getCloudReviewerCache().map((item) =>
      item.reviewerId === reviewer.reviewerId ? { ...item, ...fields } : item
    );
    saveCloudReviewerCache(nextCache);

    // The offline copy already holds the questions, so it is patched rather than
    // rebuilt from a summary that no longer carries them.
    if (hasLocal) {
      const offlineCopy = getLocalReviewers().find((item) => item.reviewerId === reviewer.reviewerId);
      if (offlineCopy) saveLocalReviewer({ ...offlineCopy, ...fields });
    }

    onChanged();
  }

  function openRename() {
    setOpen(false);
    setNewTitle(reviewer.title || "");
    setNewSubject(reviewer.subject || "");
    setRenameError(null);
    setRenameOpen(true);
  }

  async function submitRename(event) {
    event.preventDefault();
    if (renameSaving) return;

    const title = newTitle.trim();
    const subject = newSubject.trim();

    if (!title) {
      setRenameError("Give the reviewer a title.");
      return;
    }

    if (!subject) {
      setRenameError("Give the reviewer a subject.");
      return;
    }

    setRenameSaving(true);
    setRenameError(null);

    // Persist to cloud DB if this is a cloud reviewer
    if (hasCloud && user && isOwner) {
      // Renaming must not change who the reviewer is shared with, and the cache
      // copy can be behind the row, so the saved scope comes from the row.
      const { data: current } = await getMyCloudReviewer(user.id, reviewer.reviewerId);
      const scope = current
        ? {
            visibility: current.visibility,
            sharedWith: current.shared_with || null,
            sharedGroups: current.shared_groups || null
          }
        : {};

      const { error } = await upsertCloudReviewer(user.id, {
        ...reviewer,
        ...scope,
        title,
        subject
      });

      if (error) {
        setRenameSaving(false);
        setRenameError(error.message || "Could not save rename.");
        return;
      }
    }

    syncMetadata({ title, subject });
    setRenameSaving(false);
    setRenameOpen(false);
    onMessage({ type: "success", text: "Reviewer renamed." });
  }

  // Applies both audiences at once, so turning one off can never quietly take the
  // other with it. Turning groups on goes through the picker instead, because a
  // group audience needs groups to point at before it can be saved.
  async function changeVisibility(next) {
    if (!user || !isOwner) return;

    if (next.groups && !groupsVisible) {
      await openGroupPicker();
      return;
    }

    const nextVisibility = resolveVisibility(next);

    setVisibilitySaving(true);

    // Leaving groups clears the group list in the same write, so a reviewer never
    // keeps a group audience that no longer names any group.
    const result = next.groups === groupsVisible
      ? await updateCloudReviewerVisibility(user.id, reviewer.reviewerId, {
          visibility: nextVisibility,
          sharedWith: next.friends ? sharedWith : null
        })
      : await clearReviewerGroupShares(user.id, reviewer.reviewerId, { visibility: nextVisibility });

    if (result.error) {
      onMessage({ type: "error", text: result.error.message || "Could not update visibility." });
      setVisibilitySaving(false);
      return;
    }

    if (nextVisibility === VISIBILITY_PRIVATE) {
      await deleteReviewerSharesForOwner(user.id, reviewer.reviewerId);
    }

    if (next.groups !== groupsVisible) {
      setSharedGroups([]);
      syncMetadata({ visibility: nextVisibility, sharedGroups: null });
    } else {
      syncMetadata({ visibility: nextVisibility, sharedWith: next.friends ? sharedWith : null });
    }

    setVisibility(nextVisibility);
    onMessage({ type: "success", text: describeAudience(next) });
    setVisibilitySaving(false);
  }

  function describeAudience(next) {
    const parts = [];
    if (next.friends) parts.push(sharedWith ? `${sharedWith.length} friends` : "your friends");
    if (next.groups) parts.push("your groups");
    return parts.length ? `Shared with ${parts.join(" and ")}.` : "Now private. Only you can see it.";
  }

  async function openGroupPicker() {
    if (!user) return;

    setOpen(false);
    setGroupOpen(true);
    setGroupLoading(true);

    const { data } = await getMyCloudReviewer(user.id, reviewer.reviewerId);
    setSelectedGroups(Array.isArray(data?.shared_groups) ? data.shared_groups : []);

    const groupsResult = await listMyGroups(user.id);
    setGroupList(groupsResult.data || []);
    // Without this a database that is missing the group tables looks exactly like
    // an account with no groups, which sends the owner down the wrong path.
    if (groupsResult.error) setSharingError(groupsResult.error.message);
    setGroupLoading(false);
  }

  function togglePickGroup(groupId) {
    setSelectedGroups((current) =>
      current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]
    );
  }

  async function saveGroupSelection() {
    if (!user || !isOwner || groupSaving) return;

    if (!selectedGroups.length) {
      onMessage({ type: "error", text: "Pick at least one group, or turn Groups off." });
      return;
    }

    setGroupSaving(true);
    // The friend audience is separate, so saving groups has to say whether it
    // should survive.
    const nextVisibility = resolveVisibility({ friends: friendsVisible, groups: true });
    const { error } = await shareReviewerWithGroups(user.id, reviewer.reviewerId, selectedGroups, {
      friendsVisible
    });

    if (error) {
      onMessage({ type: "error", text: error.message || "Could not save group sharing." });
      setGroupSaving(false);
      return;
    }

    setVisibility(nextVisibility);
    setSharedGroups(selectedGroups);
    syncMetadata({ visibility: nextVisibility, sharedGroups: selectedGroups });
    setGroupSaving(false);
    setGroupOpen(false);
    onMessage({
      type: "success",
      text: friendsVisible
        ? `Shared with ${selectedGroups.length} group${selectedGroups.length === 1 ? "" : "s"} and your friends.`
        : `Shared with ${selectedGroups.length} group${selectedGroups.length === 1 ? "" : "s"}.`
    });
  }

  async function shareWithAllFriends() {
    if (!user || !isOwner) return;

    setVisibilitySaving(true);
    // Widening the friend audience must not close the group one.
    const nextVisibility = resolveVisibility({ friends: true, groups: groupsVisible });
    const { error } = await updateCloudReviewerVisibility(user.id, reviewer.reviewerId, {
      visibility: nextVisibility,
      sharedWith: null
    });

    if (error) {
      onMessage({ type: "error", text: error.message || "Could not share with friends." });
      setVisibilitySaving(false);
      return;
    }

    setVisibility(nextVisibility);
    setSharedWith(null);
    syncMetadata({ visibility: nextVisibility, sharedWith: null });
    onMessage({
      type: "success",
      text: groupsVisible ? "Shared with all your friends and groups." : "Shared with all your friends."
    });
    setVisibilitySaving(false);
  }

  async function openFriendPicker() {
    if (!user) return;

    setOpen(false);
    setPickOpen(true);
    setFriendLoading(true);
    setFriendMode(sharedWith && sharedWith.length ? "selected" : "all");
    setSelectedFriends(sharedWith || []);

    const { data } = await listFriendships(user.id);
    setFriends((data || []).filter((friendship) => friendship.status === "accepted"));
    setFriendLoading(false);
  }

  function togglePickFriend(friendId) {
    setSelectedFriends((current) =>
      current.includes(friendId) ? current.filter((id) => id !== friendId) : [...current, friendId]
    );
  }

  async function saveFriendSelection() {
    if (!user || !isOwner || pickSaving) return;

    const nextSharedWith = friendMode === "all" ? null : selectedFriends;

    if (friendMode === "selected" && !selectedFriends.length) {
      onMessage({ type: "error", text: "Pick at least one friend, or choose All friends." });
      return;
    }

    setPickSaving(true);
    const nextVisibility = resolveVisibility({ friends: true, groups: groupsVisible });
    const { error } = await updateCloudReviewerVisibility(user.id, reviewer.reviewerId, {
      visibility: nextVisibility,
      sharedWith: nextSharedWith
    });

    if (error) {
      onMessage({ type: "error", text: error.message || "Could not save sharing choices." });
      setPickSaving(false);
      return;
    }

    setVisibility(nextVisibility);
    setSharedWith(nextSharedWith);
    syncMetadata({ visibility: nextVisibility, sharedWith: nextSharedWith });
    setPickSaving(false);
    setPickOpen(false);
    onMessage({
      type: "success",
      text: nextSharedWith
        ? `Shared with ${nextSharedWith.length} friend${nextSharedWith.length === 1 ? "" : "s"}.`
        : "Shared with all your friends."
    });
  }

  async function saveOffline() {
    // Cloud reviewers reach this menu as summaries, and saving a summary would
    // replace the offline copy with one that has no questions.
    let offlineReviewer = reviewer;
    if (!Array.isArray(offlineReviewer?.questions)) {
      const cachedFull = getCloudReviewerCache().find((item) => (
        item.reviewerId === offlineReviewer?.reviewerId && Array.isArray(item.questions)
      ));
      const { data } = cachedFull
        ? { data: cachedFull }
        : await getCloudReviewerById(offlineReviewer?.reviewerId, user?.id);
      offlineReviewer = data;
    }

    if (!offlineReviewer?.questions) {
      onMessage({ type: "warning", text: "Could not download this reviewer. Try again in a moment." });
      return;
    }

    saveLocalReviewer(offlineReviewer);

    if (user && isOwner) {
      const { error } = await saveReviewerToAccount(user.id, offlineReviewer);
      onMessage(error
        ? { type: "warning", text: `Saved on this device. Cloud save failed: ${error.message}` }
        : { type: "success", text: "Saved to your account and this device." });
    } else {
      onMessage({ type: "success", text: "Saved offline on this device." });
    }

    onChanged();
  }

  async function runDelete(target) {
    if (target !== "local" && !user) {
      onMessage({ type: "error", text: "Sign in to remove this reviewer from cloud." });
      return;
    }

    setDeleteBusy(true);

    if (target === "local" || target === "both") {
      deleteLocalReviewer(reviewer.reviewerId);
      pushRemovedProgressToCloud(reviewer.reviewerId);
    }

    if ((target === "cloud" || target === "both") && user) {
      await deleteCloudReviewer(user.id, reviewer.reviewerId);
      await deleteReviewerSharesForOwner(user.id, reviewer.reviewerId);
      saveCloudReviewerCache(getCloudReviewerCache().filter((item) => item.reviewerId !== reviewer.reviewerId));
    }

    navigate("/home");
  }

  const deleteOptions = [];
  if (hasLocal) deleteOptions.push({ target: "local", title: "This device", copy: "Removes the offline copy saved here." });
  if (hasCloud && user && isOwner) {
    deleteOptions.push({ target: "cloud", title: "Cloud account", copy: "Removes it from your account and friends' homes." });
  }
  if (hasLocal && hasCloud && user && isOwner) {
    deleteOptions.push({ target: "both", title: "Both", copy: "Removes the device copy and the cloud copy." });
  }

  return (
    <div className="reviewer-menu-anchor" ref={menuRef}>
      <button
        className="icon-button reviewer-menu-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="Reviewer options"
        aria-expanded={open}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>

      {open
        ? createPortal(
          <section
            className="reviewer-menu-popover"
            ref={popoverRef}
            style={popoverStyle || { visibility: "hidden" }}
            aria-label="Reviewer options"
          >
          {isOwner && visibilitySaving ? (
            <div className="reviewer-menu-item reviewer-menu-status">
              <Loader2 className="spinner" size={16} aria-hidden="true" />
              Saving...
            </div>
          ) : null}

          {!user && hasCloud ? (
            <div className="reviewer-menu-section">
              <p className="reviewer-menu-note">Sign in to manage sharing and cloud copies for this reviewer.</p>
            </div>
          ) : null}

          {user && !isOwner && reviewer.ownerName ? (
            <div className="reviewer-menu-section">
              <span className="reviewer-menu-label">Shared with you</span>
              <p className="reviewer-menu-note">
                <Users size={13} aria-hidden="true" />
                by {reviewer.ownerName}
              </p>
            </div>
          ) : null}

          {sharingError ? (
            <div className="reviewer-menu-section">
              <p className="reviewer-menu-note error">{sharingError}</p>
            </div>
          ) : null}

          {isOwner && hasCloud && user ? (
            <>
              <div className="reviewer-menu-section">
                <span className="reviewer-menu-label">Visibility</span>
                <div className="reviewer-menu-toggles">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={friendsVisible}
                    className={`reviewer-menu-toggle${friendsVisible ? " on" : ""}`}
                    onClick={() => changeVisibility({ friends: !friendsVisible, groups: groupsVisible })}
                    disabled={visibilitySaving}
                  >
                    <Users size={15} aria-hidden="true" />
                    <span className="reviewer-menu-toggle-copy">
                      <strong>Friends</strong>
                      <small>{friendAudienceText}</small>
                    </span>
                    <span className="reviewer-menu-switch" aria-hidden="true" />
                  </button>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={groupsVisible}
                    className={`reviewer-menu-toggle${groupsVisible ? " on" : ""}`}
                    onClick={() => changeVisibility({ friends: friendsVisible, groups: !groupsVisible })}
                    disabled={visibilitySaving}
                  >
                    <UsersRound size={15} aria-hidden="true" />
                    <span className="reviewer-menu-toggle-copy">
                      <strong>Groups</strong>
                      <small>{groupAudienceText}</small>
                    </span>
                    <span className="reviewer-menu-switch" aria-hidden="true" />
                  </button>
                </div>
                <p className="reviewer-menu-note">
                  {friendsVisible || groupsVisible
                    ? "Turn both off to make this private to you."
                    : "Only you can see this."}
                </p>
              </div>

              {friendsVisible ? (
                <div className="reviewer-menu-section">
                  <span className="reviewer-menu-label">Shared with friends</span>
                  <div className="reviewer-menu-seg">
                    <button
                      type="button"
                      className={!sharedWith ? "active" : ""}
                      onClick={shareWithAllFriends}
                      disabled={visibilitySaving}
                    >
                      <Users size={15} aria-hidden="true" />
                      All friends
                    </button>
                    <button
                      type="button"
                      className={sharedWith ? "active" : ""}
                      onClick={openFriendPicker}
                    >
                      <UserPlus size={15} aria-hidden="true" />
                      Choose friends
                    </button>
                  </div>
                  <p className="reviewer-menu-note">
                    {sharedWith
                      ? `${sharedWith.length} friend${sharedWith.length === 1 ? "" : "s"} can see this.`
                      : "Visible on every accepted friend's Home."}
                  </p>
                </div>
              ) : null}

              {groupsVisible ? (
                <div className="reviewer-menu-section">
                  <span className="reviewer-menu-label">Shared with groups</span>
                  <div className="reviewer-menu-seg single">
                    <button type="button" onClick={openGroupPicker}>
                      <UsersRound size={15} aria-hidden="true" />
                      Choose groups
                    </button>
                  </div>
                  <p className="reviewer-menu-note">
                    {sharedGroups.length
                      ? `Members of ${sharedGroups.length} group${sharedGroups.length === 1 ? "" : "s"} can see this.`
                      : "Pick the groups that can see this."}
                  </p>
                </div>
              ) : null}
            </>
          ) : null}

          {isOwner && !hasCloud && !isBuiltIn ? (
            <div className="reviewer-menu-section">
              <p className="reviewer-menu-note">
                Saved only on this device. Use Library to sync it to your cloud account so friends can see it.
              </p>
            </div>
          ) : null}

          {(!isOwner || !hasLocal) && !isBuiltIn ? (
            <div className="reviewer-menu-section">
              <button className="reviewer-menu-item" type="button" onClick={saveOffline}>
                <Save size={16} aria-hidden="true" />
                Save offline on this device
              </button>
            </div>
          ) : null}

          {isOwner && hasCloud ? (
            <div className="reviewer-menu-section">
              <button className="reviewer-menu-item" type="button" onClick={openRename}>
                <Pencil size={16} aria-hidden="true" />
                Rename Reviewer
              </button>
            </div>
          ) : null}

          {deleteOptions.length ? (
            <div className="reviewer-menu-section">
              <button className="reviewer-menu-item danger" type="button" onClick={() => { setOpen(false); setDeleteOpen(true); }}>
                <Trash2 size={16} aria-hidden="true" />
                Delete Reviewer
              </button>
            </div>
          ) : null}

          {!user && hasCloud && hasLocal ? (
            <div className="reviewer-menu-section">
              <button
                className="reviewer-menu-item danger"
                type="button"
                onClick={() => { setOpen(false); setDeleteOpen(true); }}
              >
                <Trash2 size={16} aria-hidden="true" />
                Delete from this device
              </button>
            </div>
          ) : null}
        </section>,
        document.body
      )
        : null}

      {deleteOpen ? createPortal(
        <div className="modal-backdrop" role="presentation" onClick={() => setDeleteOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="reviewer-delete-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 id="reviewer-delete-title">Delete Reviewer</h2>
                <p className="muted">Choose which copies to remove. This cannot be undone.</p>
              </div>
              <button className="icon-button small" type="button" onClick={() => setDeleteOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="delete-location-list">
              {deleteOptions.map((option) => (
                <article className="delete-location-row" key={option.target}>
                  <div>
                    <strong>{option.title}</strong>
                    <p className="muted">{option.copy}</p>
                  </div>
                  <button
                    className="button subtle danger-text"
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => setPendingDelete(option)}
                  >
                    Delete
                  </button>
                </article>
              ))}
            </div>

            <p className="reviewer-menu-note">This only affects the owner's copies. Your saved answers belong to this device.</p>
          </section>
        </div>,
        document.body
      ) : null}

      {pickOpen ? createPortal(
        <div className="modal-backdrop" role="presentation" onClick={() => setPickOpen(false)}>
          <section className="modal reviewer-pick-modal" role="dialog" aria-modal="true" aria-labelledby="reviewer-pick-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 id="reviewer-pick-title">Share with friends</h2>
                <p className="muted">Choose who can see "{reviewer.title}" on their Home.</p>
              </div>
              <button className="icon-button small" type="button" onClick={() => setPickOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <div className="reviewer-menu-seg pick-mode">
              <button type="button" className={friendMode === "all" ? "active" : ""} onClick={() => setFriendMode("all")}>
                All friends
              </button>
              <button type="button" className={friendMode === "selected" ? "active" : ""} onClick={() => setFriendMode("selected")}>
                Choose friends
              </button>
            </div>

            {friendLoading ? (
              <p className="reviewer-menu-note">Loading friends...</p>
            ) : friendMode === "all" ? (
              <p className="reviewer-menu-note">Every accepted friend will see this reviewer on their Home.</p>
            ) : friends.length ? (
              <div className="friend-picker-list">
                {friends.map((friendship) => (
                  <label className="friend-picker-row" key={friendship.id}>
                    <input
                      type="checkbox"
                      checked={selectedFriends.includes(friendship.otherUserId)}
                      onChange={() => togglePickFriend(friendship.otherUserId)}
                    />
                    <span>
                      <strong>{getProfileName(friendship.otherProfile)}</strong>
                      <small>Friend</small>
                    </span>
                    <span className="friend-picker-check" aria-hidden="true">
                      {selectedFriends.includes(friendship.otherUserId) ? <Check size={14} /> : null}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="friend-picker-empty">
                <p className="reviewer-menu-note">You do not have any accepted friends yet.</p>
                <Link className="button subtle" to="/friends">
                  <UserPlus size={16} aria-hidden="true" />
                  Find Friends
                </Link>
              </div>
            )}

            <div className="modal-actions">
              <button className="button subtle" type="button" onClick={() => setPickOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="button" onClick={saveFriendSelection} disabled={pickSaving || friendLoading}>
                {pickSaving ? <Loader2 className="spinner" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                {pickSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}

      {groupOpen ? createPortal(
        <div className="modal-backdrop" role="presentation" onClick={() => setGroupOpen(false)}>
          <section className="modal reviewer-pick-modal" role="dialog" aria-modal="true" aria-labelledby="reviewer-group-pick-title" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 id="reviewer-group-pick-title">Share with groups</h2>
                <p className="muted">
                  Every member of a group you pick can see "{reviewer.title}".
                  {friendsVisible ? " Your friends can already see it too." : null}
                </p>
              </div>
              <button className="icon-button small" type="button" onClick={() => setGroupOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {groupLoading ? (
              <p className="reviewer-menu-note">Loading your groups...</p>
            ) : groupList.length ? (
              <div className="friend-picker-list">
                {groupList.map((group) => (
                  <label className="friend-picker-row" key={group.id}>
                    <input
                      type="checkbox"
                      checked={selectedGroups.includes(group.id)}
                      onChange={() => togglePickGroup(group.id)}
                    />
                    <span>
                      <strong>{group.name}</strong>
                      <small>{group.memberCount} member{group.memberCount === 1 ? "" : "s"}</small>
                    </span>
                    <span className="friend-picker-check" aria-hidden="true">
                      {selectedGroups.includes(group.id) ? <Check size={14} /> : null}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="friend-picker-empty">
                <p className="reviewer-menu-note">You are not in any groups yet.</p>
                <Link className="button subtle" to="/groups">
                  <UsersRound size={16} aria-hidden="true" />
                  Create a group
                </Link>
              </div>
            )}

            <div className="modal-actions">
              <button className="button subtle" type="button" onClick={() => setGroupOpen(false)}>
                Cancel
              </button>
              <button className="button primary" type="button" onClick={saveGroupSelection} disabled={groupSaving || groupLoading}>
                {groupSaving ? <Loader2 className="spinner" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                {groupSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </section>
        </div>,
        document.body
      ) : null}

      {renameOpen ? createPortal(
        <div className="modal-backdrop" role="presentation" onClick={() => setRenameOpen(false)}>
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="reviewer-rename-heading" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div>
                <h2 id="reviewer-rename-heading">Rename reviewer</h2>
                <p className="muted">Everyone this reviewer is shared with sees the new title and subject.</p>
              </div>
              <button className="icon-button small" type="button" onClick={() => setRenameOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <form className="modal-form" onSubmit={submitRename}>
              <label htmlFor="reviewer-rename-title">Title</label>
              <input
                id="reviewer-rename-title"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Cell Biology midterm"
                maxLength={80}
                autoFocus
              />

              <label htmlFor="reviewer-rename-subject">Subject</label>
              <input
                id="reviewer-rename-subject"
                value={newSubject}
                onChange={(event) => setNewSubject(event.target.value)}
                placeholder="Biology"
                maxLength={60}
              />

              {renameError ? <p className="sync-message error">{renameError}</p> : null}

              <div className="modal-actions">
                <button className="button subtle" type="button" onClick={() => setRenameOpen(false)}>
                  Cancel
                </button>
                <button className="button primary" type="submit" disabled={renameSaving}>
                  {renameSaving ? <Loader2 className="spinner" size={16} aria-hidden="true" /> : <Pencil size={16} aria-hidden="true" />}
                  {renameSaving ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </section>
        </div>,
        document.body
      ) : null}

      {createPortal(
        <ConfirmModal
          open={Boolean(pendingDelete)}
          title="Delete Reviewer"
          message={pendingDelete ? `Delete "${reviewer.title}" from ${pendingDelete.title.toLowerCase()}? This cannot be undone.` : ""}
          confirmLabel="Delete"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const target = pendingDelete?.target;
            setPendingDelete(null);
            if (target) runDelete(target);
          }}
        />,
        document.body
      )}
    </div>
  );
}