import { useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useNotifications } from "../contexts/NotificationContext.jsx";
import { acceptFriendRequest, listFriendships, removeFriendship } from "../services/social.js";
import { listVisibleCloudReviewers } from "../services/cloudReviewers.js";
import { listMyGroupMembers, listMyGroups } from "../services/groups.js";
import { isFriendVisible, isGroupVisible, normalizeVisibility } from "../services/reviewerVisibility.js";
import { mergeCloudReviewerCache, SOCIAL_DATA_CHANGED_EVENT, SOCIAL_NOTIFICATION_STATE_KEY } from "../utils/storageUtils.js";
import { supabase } from "../lib/supabaseClient.js";

// Held per account inside one object, so switching accounts cannot replay the
// other's notifications. The key lives with the other store names so that
// deleting the device data clears the names and reviewer titles cached here too.
const STATE_KEY = SOCIAL_NOTIFICATION_STATE_KEY;
const POLL_INTERVAL_MS = 60_000;
const MAX_SEEN = 300;

function getFriendName(profile) {
  return profile?.display_name || "A friend";
}

function readState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadUserState(userId) {
  const all = readState();
  const current = all[userId] && typeof all[userId] === "object" ? all[userId] : {};
  return {
    seeded: Boolean(current.seeded),
    incomingSeen: Array.isArray(current.incomingSeen) ? current.incomingSeen : [],
    acceptedSeen: Array.isArray(current.acceptedSeen) ? current.acceptedSeen : [],
    sharedSeen: Array.isArray(current.sharedSeen) ? current.sharedSeen : [],
    groupJoinedSeen: Array.isArray(current.groupJoinedSeen) ? current.groupJoinedSeen : [],
    groupMemberSeen: Array.isArray(current.groupMemberSeen) ? current.groupMemberSeen : [],
    groupReviewerSeen: Array.isArray(current.groupReviewerSeen) ? current.groupReviewerSeen : [],
    groupRoles: current.groupRoles && typeof current.groupRoles === "object" ? current.groupRoles : {},
    groupReviewerMeta:
      current.groupReviewerMeta && typeof current.groupReviewerMeta === "object"
        ? current.groupReviewerMeta
        : {}
  };
}

function saveUserState(userId, state) {
  try {
    const all = readState();
    all[userId] = {
      seeded: Boolean(state.seeded),
      incomingSeen: state.incomingSeen.slice(0, MAX_SEEN),
      acceptedSeen: state.acceptedSeen.slice(0, MAX_SEEN),
      sharedSeen: state.sharedSeen.slice(0, MAX_SEEN),
      groupJoinedSeen: state.groupJoinedSeen.slice(0, MAX_SEEN),
      groupMemberSeen: state.groupMemberSeen.slice(0, MAX_SEEN),
      groupReviewerSeen: state.groupReviewerSeen.slice(0, MAX_SEEN),
      groupRoles: state.groupRoles,
      groupReviewerMeta: state.groupReviewerMeta
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(all));
  } catch {
    // Best-effort persistence; a failed write just means one-time re-notification risk.
  }
}

export default function SocialNotificationWatcher() {
  const { configured, loading, user } = useAuth();
  const { notify, registerAction } = useNotifications();
  const inFlight = useRef(false);

  useEffect(() => {
    if (loading || !configured || !user) return undefined;

    const unregisterAccept = registerAction("friend-request-accept", async (payload) => {
      const { error } = await acceptFriendRequest(payload.friendshipId);
      if (error) throw error;
      notify({
        type: "success",
        title: "Friend request accepted",
        message: `You and ${payload.friendName} are now friends.`
      });
    });

    const unregisterDecline = registerAction("friend-request-decline", async (payload) => {
      const { error } = await removeFriendship(payload.friendshipId);
      if (error) throw error;
      notify({
        type: "info",
        title: "Friend request declined",
        message: `You declined ${payload.friendName}'s friend request.`
      });
    });

    const runPoll = async () => {
      if (inFlight.current) return;
      inFlight.current = true;

      try {
        const [friendshipsResult, visibleResult, groupsResult, groupMembersResult] = await Promise.all([
          listFriendships(user.id),
          listVisibleCloudReviewers(user.id),
          listMyGroups(user.id),
          listMyGroupMembers(user.id)
        ]);

        if (friendshipsResult.error || visibleResult.error) return;

        // A group failure should never silence friend notifications, and it must
        // never look like "your groups disappeared" either, so the group half
        // only runs when both group queries actually succeeded.
        const groupsOk = !groupsResult.error && !groupMembersResult.error;
        const myGroups = groupsOk ? groupsResult.data || [] : [];
        const myGroupMembers = groupsOk ? groupMembersResult.data || [] : [];
        const myGroupIds = new Set(myGroups.map((group) => group.id));
        const groupsById = new Map(myGroups.map((group) => [group.id, group]));

        const friendships = friendshipsResult.data || [];
        const incomingPending = friendships.filter(
          (friendship) => friendship.addressee_id === user.id && friendship.status === "pending"
        );
        const acceptedByFriends = friendships.filter(
          (friendship) => friendship.requester_id === user.id && friendship.status === "accepted"
        );
        const visibleRows = visibleResult.data || [];

        // A reviewer shared with groups and with friends reaches this account
        // through either audience. Group shares are announced per group below, so
        // one that already announced a reviewer must not also fire the plain
        // "shared with you" notification for it.
        const groupAnnouncedIds = new Set(
          visibleRows
            .filter((row) => row.owner_id !== user.id && isGroupVisible(row.visibility))
            .filter((row) => (row.shared_groups || []).some((groupId) => myGroupIds.has(String(groupId))))
            .map((row) => row.reviewer_id)
        );

        const friendReviewers = visibleRows.filter(
          (row) => (
            row.owner_id !== user.id
            && isFriendVisible(row.visibility)
            && !groupAnnouncedIds.has(row.reviewer_id)
          )
        );

        const cachedReviewers = visibleRows.map((item) => {
          const reviewerData = item.data || item;
          return {
            ...reviewerData,
            ownerId: item.owner_id,
            ...(item.ownerName ? { ownerName: item.ownerName } : {}),
            visibility: normalizeVisibility(item.visibility || reviewerData.visibility),
            sharedWith: Array.isArray(item.shared_with) ? item.shared_with : reviewerData.sharedWith || null,
            sharedGroups: Array.isArray(item.shared_groups) ? item.shared_groups : reviewerData.sharedGroups || null
          };
        });
        mergeCloudReviewerCache(cachedReviewers);

        const state = loadUserState(user.id);
        const incomingSeen = new Set(state.incomingSeen);
        const acceptedSeen = new Set(state.acceptedSeen);
        const sharedSeen = new Set(state.sharedSeen);
        const groupJoinedSeen = new Set(state.groupJoinedSeen);
        const groupMemberSeen = new Set(state.groupMemberSeen);
        const groupReviewerSeen = new Set(state.groupReviewerSeen);
        const groupReviewerMeta = { ...state.groupReviewerMeta };
        const groupRoles = { ...state.groupRoles };

        if (state.seeded) {
          incomingPending.forEach((friendship) => {
            if (incomingSeen.has(friendship.id)) return;
            incomingSeen.add(friendship.id);
            const friendName = getFriendName(friendship.otherProfile);
            notify({
              type: "info",
              title: "New friend request",
              message: `${friendName} sent you a friend request.`,
              actions: [
                { label: "Accept", kind: "friend-request-accept", variant: "primary", payload: { friendshipId: friendship.id, friendName } },
                { label: "Decline", kind: "friend-request-decline", variant: "subtle", payload: { friendshipId: friendship.id, friendName } }
              ]
            });
          });

          acceptedByFriends.forEach((friendship) => {
            if (acceptedSeen.has(friendship.id)) return;
            acceptedSeen.add(friendship.id);
            notify({
              type: "success",
              title: "Friend request accepted",
              message: `${getFriendName(friendship.otherProfile)} accepted your friend request.`,
              actionLabel: "View friends",
              actionHref: "/friends"
            });
          });

          friendReviewers.forEach((row) => {
            if (sharedSeen.has(row.reviewer_id)) return;
            sharedSeen.add(row.reviewer_id);
            const ownerName = row.ownerName || getFriendName(row.ownerProfile);
            const reviewerTitle = row.data?.title || row.title || "a reviewer";
            notify({
              type: "success",
              title: "New reviewer shared with you",
              message: `${ownerName} shared "${reviewerTitle}".`,
              actionLabel: "Open reviewer",
              actionHref: `/reviewer/${row.reviewer_id}`
            });
          });
          if (groupsOk) {
            // Someone put me in a group. Only a membership that someone else
            // created counts, so making my own group never notifies me.
            myGroups.forEach((myGroup) => {
              if (!myGroup.membershipId) return;
              if (groupJoinedSeen.has(myGroup.membershipId)) return;
              groupJoinedSeen.add(myGroup.membershipId);

              if (state.seeded && myGroup.addedBy && !myGroup.addedByMe) {
                notify({
                  type: "info",
                  title: "Added to a group",
                  message: `${myGroup.addedByName} added you to "${myGroup.name}".`,
                  actionLabel: "Open group",
                  actionHref: `/groups/${myGroup.id}`
                });
              }

              // A role change lands on a membership that is already known.
              const previous = groupRoles[myGroup.id];
              const previousRole = typeof previous === "string" ? previous : previous?.role;
              if (previousRole && previousRole !== myGroup.role) {
                notify({
                  type: myGroup.role === "admin" ? "success" : "info",
                  title: "Group role updated",
                  message: `You are now ${myGroup.role === "admin" ? "an admin" : "a member"} of "${myGroup.name}".`,
                  actionLabel: "Open group",
                  actionHref: `/groups/${myGroup.id}`
                });
              }
              groupRoles[myGroup.id] = { role: myGroup.role, name: myGroup.name };
            });

            // A group I could see has gone, so I was removed or it was deleted.
            Object.entries(groupRoles).forEach(([knownId, known]) => {
              if (myGroupIds.has(knownId)) return;
              delete groupRoles[knownId];
              if (!state.seeded) return;

              notify({
                type: "warning",
                title: "Group access ended",
                message: `You no longer have access to "${known?.name || "a group"}".`,
                actionLabel: "View groups",
                actionHref: "/groups"
              });
            });

            // Someone joined one of my groups. The new member is skipped here
            // because they get the "added you" notification instead.
            myGroupMembers.forEach((member) => {
              if (member.user_id === user.id) return;
              if (!myGroupIds.has(member.group_id)) return;
              if (groupMemberSeen.has(member.id)) return;
              groupMemberSeen.add(member.id);

              if (!state.seeded) return;

              const memberName = getFriendName(member.profile);
              const groupName = groupsById.get(member.group_id)?.name || "a group";
              const adderName = member.added_by ? getFriendName(member.addedByProfile) : null;

              notify({
                type: "info",
                title: "New group member",
                message: adderName && adderName !== memberName
                  ? `${adderName} added ${memberName} to "${groupName}".`
                  : `${memberName} joined "${groupName}".`,
                actionLabel: "Open group",
                actionHref: `/groups/${member.group_id}`
              });
            });

            // Reviewers shared into any group I belong to, excluding my own. This covers
            // the group audience on its own and a reviewer shared with groups and
            // friends, which is announced here rather than as a friend share.
            const groupReviewers = visibleRows.filter(
              (row) => row.owner_id !== user.id && isGroupVisible(row.visibility)
            );

            const currentKeys = new Set();

            groupReviewers.forEach((row) => {
              const sharedGroups = Array.isArray(row.shared_groups) ? row.shared_groups : [];
              const ownerName = row.ownerName || getFriendName(row.ownerProfile);
              const reviewerTitle = row.data?.title || row.title || "a reviewer";

              sharedGroups.forEach((sharedGroupId) => {
                if (!myGroupIds.has(String(sharedGroupId))) return;

                const key = `${row.reviewer_id}:${sharedGroupId}`;
                currentKeys.add(key);

                const groupName = groupsById.get(sharedGroupId)?.name || "a group";
                groupReviewerMeta[key] = { title: reviewerTitle, groupName, ownerName };

                if (groupReviewerSeen.has(key)) return;
                groupReviewerSeen.add(key);
                if (!state.seeded) return;

                notify({
                  type: "success",
                  title: "New reviewer in a group",
                  message: `${ownerName} shared "${reviewerTitle}" in "${groupName}".`,
                  actionLabel: "Open reviewer",
                  actionHref: `/reviewer/${row.reviewer_id}`
                });
              });
            });

            // A share that vanished from a group I still belong to means the
            // owner unshared it. The title is recovered from the saved meta
            // because the row itself is no longer visible.
            state.groupReviewerSeen.forEach((key) => {
              if (currentKeys.has(key)) return;
              groupReviewerSeen.delete(key);
              if (!state.seeded) return;

              const meta = state.groupReviewerMeta[key];
              const reviewerId = key.split(":")[0];
              if (!meta) return;

              notify({
                type: "warning",
                title: "Reviewer no longer shared",
                message: `"${meta.title}" is no longer shared in "${meta.groupName}".`,
                actionLabel: "Open group",
                actionHref: `/groups/${key.split(":")[1]}`
              });
              if (!visibleRows.some((row) => row.reviewer_id === reviewerId)) {
                delete groupReviewerMeta[key];
              }
            });
          }
        } else {
          incomingPending.forEach((friendship) => incomingSeen.add(friendship.id));
          acceptedByFriends.forEach((friendship) => acceptedSeen.add(friendship.id));
          friendReviewers.forEach((row) => sharedSeen.add(row.reviewer_id));

          if (groupsOk) {
            myGroups.forEach((myGroup) => {
              if (myGroup.membershipId) groupJoinedSeen.add(myGroup.membershipId);
              groupRoles[myGroup.id] = { role: myGroup.role, name: myGroup.name };
            });
            myGroupMembers.forEach((member) => groupMemberSeen.add(member.id));

            visibleRows
              .filter((row) => row.owner_id !== user.id && isGroupVisible(row.visibility))
              .forEach((row) => {
                (row.shared_groups || []).forEach((sharedGroupId) => {
                  const key = `${row.reviewer_id}:${sharedGroupId}`;
                  groupReviewerSeen.add(key);
                  groupReviewerMeta[key] = {
                    title: row.data?.title || row.title || "a reviewer",
                    groupName: groupsById.get(sharedGroupId)?.name || "a group",
                    ownerName: row.ownerName || "A member"
                  };
                });
              });
          }
        }

        const currentFriendReviewerIds = new Set(friendReviewers.map((row) => row.reviewer_id));
        saveUserState(user.id, {
          seeded: true,
          incomingSeen: [...incomingSeen],
          acceptedSeen: [...acceptedSeen],
          sharedSeen: [...sharedSeen].filter((reviewerId) => currentFriendReviewerIds.has(reviewerId)),
          groupJoinedSeen: [...groupJoinedSeen],
          groupMemberSeen: [...groupMemberSeen],
          groupReviewerSeen: [...groupReviewerSeen],
          groupRoles,
          groupReviewerMeta
        });
      } finally {
        inFlight.current = false;
      }
    };

    runPoll();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") runPoll();
    }, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") runPoll();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const handleRealtimeChange = () => {
      runPoll();
      window.dispatchEvent(new Event(SOCIAL_DATA_CHANGED_EVENT));
    };

    const channel = supabase
      ? supabase
          .channel(`social-watcher-${user.id}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "friendships" }, handleRealtimeChange)
          .on("postgres_changes", { event: "*", schema: "public", table: "reviewer_shares" }, handleRealtimeChange)
          .on("postgres_changes", { event: "*", schema: "public", table: "reviewers" }, handleRealtimeChange)
          .on("postgres_changes", { event: "*", schema: "public", table: "study_groups" }, handleRealtimeChange)
          .on("postgres_changes", { event: "*", schema: "public", table: "group_members" }, handleRealtimeChange)
          .subscribe()
      : null;

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (channel) supabase.removeChannel(channel);
      unregisterAccept();
      unregisterDecline();
    };
  }, [configured, loading, registerAction, user?.id, notify]);

  return null;
}