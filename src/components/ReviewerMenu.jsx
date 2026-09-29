import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import {
  Check,
  Cloud,
  Loader2,
  MoreVertical,
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
  getMyCloudReviewer,
  updateCloudReviewerVisibility
} from "../services/cloudReviewers.js";
import ConfirmModal from "./ConfirmModal.jsx";
import { deleteReviewerSharesForOwner, listFriendships } from "../services/social.js";
import { clearReviewerGroupShares, listMyGroups, shareReviewerWithGroups } from "../services/groups.js";
import { pushRemovedProgressToCloud, saveReviewerToAccount } from "../services/syncEngine.js";
import {
  deleteLocalReviewer,
  getCloudReviewerCache,
  saveCloudReviewerCache,
  saveLocalReviewer
} from "../utils/storageUtils.js";

function getProfileName(profile) {
  return profile?.display_name || profile?.email || "Hachi user";
}

export default function ReviewerMenu({ reviewer, user, configured, onMessage, onChanged }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [visibility, setVisibility] = useState(
    reviewer.visibility === "private" ? "private" : reviewer.visibility === "group" ? "group" : "friends"
  );
  const [sharedWith, setSharedWith] = useState(
    Array.isArray(reviewer.sharedWith) && reviewer.sharedWith.length ? reviewer.sharedWith : null
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
        setVisibility(data.visibility === "private" ? "private" : data.visibility === "group" ? "group" : "friends");
        setSharedWith(Array.isArray(data.shared_with) && data.shared_with.length ? data.shared_with : null);
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

    if (hasLocal) {
      saveLocalReviewer({ ...reviewer, ...fields });
    }

    onChanged();
  }

  async function changeVisibility(nextVisibility) {
    if (!user || !isOwner) return;

    if (nextVisibility === "group") {
      await openGroupPicker();
      return;
    }

    setVisibilitySaving(true);
    const { error } = await updateCloudReviewerVisibility(user.id, reviewer.reviewerId, {
      visibility: nextVisibility,
      sharedWith
    });

    if (error) {
      onMessage({ type: "error", text: error.message || "Could not update visibility." });
      setVisibilitySaving(false);
      return;
    }

    if (nextVisibility === "private") {
      await deleteReviewerSharesForOwner(user.id, reviewer.reviewerId);
    }

    // Leaving group sharing clears the group list without changing visibility,
    // so switching to Groups then back to Friends works.
    if (visibility === "group") {
      await clearReviewerGroupShares(user.id, reviewer.reviewerId);
    }

    setVisibility(nextVisibility);
    syncMetadata({ visibility: nextVisibility, sharedGroups: null });
    onMessage({
      type: "success",
      text: nextVisibility === "friends" ? "Visible to friends." : "Now private. Only you can see it."
    });
    setVisibilitySaving(false);
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
      onMessage({ type: "error", text: "Pick at least one group, or switch back to Private." });
      return;
    }

    setGroupSaving(true);
    const { error } = await shareReviewerWithGroups(user.id, reviewer.reviewerId, selectedGroups);

    if (error) {
      onMessage({ type: "error", text: error.message || "Could not save group sharing." });
      setGroupSaving(false);
      return;
    }

    setVisibility("group");
    syncMetadata({ visibility: "group", sharedGroups: selectedGroups });
    setGroupSaving(false);
    setGroupOpen(false);
    onMessage({
      type: "success",
      text: `Shared with ${selectedGroups.length} group${selectedGroups.length === 1 ? "" : "s"}.`
    });
  }

  async function shareWithAllFriends() {
    if (!user || !isOwner) return;

    setVisibilitySaving(true);
    const { error } = await updateCloudReviewerVisibility(user.id, reviewer.reviewerId, {
      visibility: "friends",
      sharedWith: null
    });

    if (error) {
      onMessage({ type: "error", text: error.message || "Could not share with friends." });
      setVisibilitySaving(false);
      return;
    }

    setSharedWith(null);
    syncMetadata({ sharedWith: null });
    onMessage({ type: "success", text: "Shared with all your friends." });
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
    const { error } = await updateCloudReviewerVisibility(user.id, reviewer.reviewerId, {
      visibility: "friends",
      sharedWith: nextSharedWith
    });

    if (error) {
      onMessage({ type: "error", text: error.message || "Could not save sharing choices." });
      setPickSaving(false);
      return;
    }

    setSharedWith(nextSharedWith);
    syncMetadata({ sharedWith: nextSharedWith });
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
    saveLocalReviewer(reviewer);

    if (user && isOwner) {
      const { error } = await saveReviewerToAccount(user.id, reviewer);
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

    navigate("/");
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
                <div className="reviewer-menu-seg">
                  <button
                    type="button"
                    className={visibility === "friends" ? "active" : ""}
                    onClick={() => changeVisibility("friends")}
                    disabled={visibilitySaving}
                  >
                    <Users size={15} aria-hidden="true" />
                    Friends can see
                  </button>
                  <button
                    type="button"
                    className={visibility === "private" ? "active" : ""}
                    onClick={() => changeVisibility("private")}
                    disabled={visibilitySaving}
                  >
                    <Cloud size={15} aria-hidden="true" />
                    Private
                  </button>
                  <button
                    type="button"
                    className={visibility === "group" ? "active" : ""}
                    onClick={() => changeVisibility("group")}
                    disabled={visibilitySaving}
                  >
                    <UsersRound size={15} aria-hidden="true" />
                    Groups
                  </button>
                </div>
              </div>

              {visibility === "group" ? (
                <div className="reviewer-menu-section">
                  <span className="reviewer-menu-label">Shared with</span>
                  <div className="reviewer-menu-seg">
                    <button type="button" onClick={openGroupPicker}>
                      <UsersRound size={15} aria-hidden="true" />
                      Choose groups
                    </button>
                  </div>
                  <p className="reviewer-menu-note">
                    Only members of the groups you pick can see this.
                  </p>
                </div>
              ) : null}

              {visibility === "friends" ? (
                <div className="reviewer-menu-section">
                  <span className="reviewer-menu-label">Shared with</span>
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
                      <small>{friendship.otherProfile?.email || "No email"}</small>
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
                <p className="muted">Every member of a group you pick can see "{reviewer.title}".</p>
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