import { supabase } from "../lib/supabaseClient.js";
import {
  isFriendVisible,
  isGroupVisible,
  normalizeVisibility,
  readVisibilityToggles,
  resolveVisibility,
  VISIBILITY_PRIVATE
} from "./reviewerVisibility.js";

const REVIEWERS_TABLE = "reviewers";
const REVIEWER_SUMMARIES_VIEW = "reviewer_summaries";
const TOMBSTONES_TABLE = "reviewer_tombstones";
// A tombstone is only useful while another device might still hold a copy of the
// reviewer it names. Reading back a long-dead one would clear work that has since
// been redone, so anything older than this is ignored here. The rows themselves
// are pruned separately.
const TOMBSTONE_MAX_AGE_DAYS = 30;

// Reviewers this account deleted, so a local copy of one can be dropped instead of
// being re-uploaded on the next sync. Read only; the tombstone is written by a
// trigger on the reviewers table so a delete cannot skip it.
export async function listReviewerTombstones(userId) {
  if (!supabase || !userId) return { reviewerIds: [], error: null };

  const cutoff = new Date(Date.now() - TOMBSTONE_MAX_AGE_DAYS * 86400000).toISOString();

  const { data, error } = await supabase
    .from(TOMBSTONES_TABLE)
    .select("reviewer_id, deleted_at")
    .eq("owner_id", userId)
    .gte("deleted_at", cutoff);

  if (error) return { reviewerIds: [], error };

  return {
    reviewerIds: (data || []).map((row) => row?.reviewer_id).filter(Boolean),
    error: null
  };
}

// Runs alongside the attempts prune so tombstone rows do not accumulate. Fire and
// forget, like that one.
export async function pruneReviewerTombstones(days = TOMBSTONE_MAX_AGE_DAYS) {
  if (!supabase || !(Number(days) > 0)) return { deleted: 0, error: null };

  const { data, error } = await supabase.rpc("prune_reviewer_tombstones", {
    p_older_than_days: Math.round(Number(days))
  });

  return { deleted: Number(data) || 0, error };
}

// Only the ids are needed here, to tell which device-only reviewers still have
// to be uploaded. Selecting the whole row used to pull every question for every
// reviewer on each sync.
export async function listMyCloudReviewers(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .select("reviewer_id")
    .eq("owner_id", userId);

  return { data: data || [], error };
}

// Group and friend ids are stored in uuid arrays, so they are normalized to a
// deduped list of non-empty strings before anything is written.
function normalizeIdList(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
}

function getSharingScope(reviewer) {
  const ids = normalizeIdList(reviewer.sharedWith);
  return ids.length ? ids : null;
}

function getGroupScope(reviewer) {
  const ids = normalizeIdList(reviewer.sharedGroups);
  return ids.length ? ids : null;
}

// A reviewer listed in groups has to keep the group audience whatever the stored
// value says, otherwise a save would leave a group list that nobody can see.
function resolveAudience(visibility, groupScope) {
  const toggles = readVisibilityToggles(visibility);
  return { friends: toggles.friends, groups: toggles.groups || Boolean(groupScope) };
}

// Restoring progress needs the full question list, so a signed-in account with a
// long history would otherwise pull every reviewer in one unbounded query. These
// rows are large, so the fetch is batched to keep a sync from stalling.
const REVIEWER_FETCH_BATCH_SIZE = 12;

export async function listCloudReviewersByIds(reviewerIds) {
  const ids = [...new Set((reviewerIds || []).map(String).filter(Boolean))];
  if (!supabase || !ids.length) return { data: [], error: null };

  const rows = [];
  let firstError = null;

  for (let index = 0; index < ids.length; index += REVIEWER_FETCH_BATCH_SIZE) {
    const batch = ids.slice(index, index + REVIEWER_FETCH_BATCH_SIZE);

    // No owner filter on purpose: a synced record can belong to a reviewer a
    // friend shared, and the read policies already decide who may see it.
    const { data, error } = await supabase
      .from(REVIEWERS_TABLE)
      .select("reviewer_id, data")
      .in("reviewer_id", batch);

    if (error) {
      // A failed batch is reported but never discards the batches that worked,
      // so one bad request cannot throw away the whole history.
      firstError = firstError || error;
      continue;
    }

    rows.push(...(data || []));
  }

  return { data: rows, error: firstError };
}

export async function upsertCloudReviewer(userId, reviewer) {
  if (!supabase || !userId) {
    return { data: null, error: new Error("Supabase is not configured.") };
  }

  let groupScope = getGroupScope(reviewer);
  let sharedWith = getSharingScope(reviewer);
  let visibility = resolveVisibility(resolveAudience(reviewer.visibility, groupScope));

  // The stored row is the only current source for who a reviewer is shared
  // with, because sharing is recorded on the row and not in the payload. Most
  // callers pass a payload without any scope, so without this a routine save
  // would unshare a reviewer and expose it to every friend.
  const scopeIsExplicit = Boolean(reviewer.visibility) || Boolean(groupScope);
  if (!scopeIsExplicit) {
    const { data: existing } = await getMyCloudReviewer(userId, reviewer.reviewerId);
    const existingGroups = getGroupScope(existing || {});

    groupScope = existingGroups;
    sharedWith = getSharingScope(existing || {});
    // A reviewer that is not in the account yet has never been shared, so it
    // starts private rather than inheriting the column default.
    visibility = existing
      ? resolveVisibility(resolveAudience(existing.visibility, groupScope))
      : VISIBILITY_PRIVATE;
  }

  // A payload that names a different owner is a cached copy of somebody else's
  // reviewer, not this account's own. owner_id is the caller's here, so an
  // uploaded copy would silently become a second row owned by the recipient while
  // carrying the original's audience, and the group share trigger would
  // re-announce it. Sharing is the owner's decision, so the scope is dropped and
  // the copy lands private until this account deliberately shares it.
  const isForeignCopy = Boolean(reviewer.ownerId) && reviewer.ownerId !== userId;
  if (isForeignCopy) {
    groupScope = [];
    sharedWith = null;
    visibility = VISIBILITY_PRIVATE;
  }

  const payload = {
    owner_id: userId,
    reviewer_id: reviewer.reviewerId,
    title: reviewer.title,
    subject: reviewer.subject,
    // The resolved scope is stored in the blob too, so a payload read back out
    // of the row never disagrees with the sharing columns next to it.
    data: isForeignCopy
      ? { ...reviewer, ownerId: userId, ownerName: reviewer.ownerName, visibility, sharedWith, sharedGroups: groupScope }
      : { ...reviewer, visibility, sharedWith, sharedGroups: groupScope },
    visibility,
    shared_with: sharedWith,
    shared_groups: groupScope,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .upsert(payload, { onConflict: "owner_id,reviewer_id" })
    .select()
    .single();

  return { data, error };
}

export async function deleteCloudReviewer(userId, reviewerId) {
  if (!supabase || !userId) {
    return { error: new Error("Supabase is not configured.") };
  }

  const { error } = await supabase
    .from(REVIEWERS_TABLE)
    .delete()
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId);

  return { error };
}

export async function getMyCloudReviewer(userId, reviewerId) {
  if (!supabase || !userId) return { data: null, error: null };

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .select("*")
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId)
    .maybeSingle();

  return { data, error };
}

export async function listVisibleCloudReviewers(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const [friendshipsResult, membershipsResult] = await Promise.all([
    supabase
      .from("friendships")
      .select("requester_id, addressee_id, status")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
  ]);

  const friendshipsError = friendshipsResult.error;
  const membershipsError = membershipsResult.error;

  if (friendshipsError) return { data: [], error: friendshipsError };

  const friendIds = [
    ...new Set((friendshipsResult.data || [])
      .filter((friendship) => friendship.status === "accepted")
      .flatMap((friendship) => {
        const otherId = friendship.requester_id === userId
          ? friendship.addressee_id
          : friendship.requester_id;
        return otherId !== userId ? [otherId] : [];
      }))
  ];

  // Group shares live on the reviewer row, so the owners to look for are the
  // other members of any group this user belongs to.
  const groupMemberIds = membershipsError
    ? []
    : [
        ...new Set((membershipsResult.data || [])
          .flatMap((membership) => [membership.group_id]))
      ];

  const { data: groupPeers } = groupMemberIds.length
    ? await supabase
        .from("group_members")
        .select("user_id, group_id")
        .in("group_id", groupMemberIds)
    : { data: [] };

  const groupOwnerIds = [
    ...new Set((groupPeers || [])
      .map((peer) => peer.user_id)
      .filter((peerId) => peerId && peerId !== userId))
  ];

  const visibleOwnerIds = [...new Set([...friendIds, ...groupOwnerIds])];

  const query = supabase.from(REVIEWER_SUMMARIES_VIEW).select("*");

  const builtQuery = visibleOwnerIds.length
    ? query.or(`owner_id.eq.${userId},owner_id.in.(${visibleOwnerIds.join(",")})`)
    : query.eq("owner_id", userId);

  const { data: rows, error } = await builtQuery.order("updated_at", { ascending: false });

  if (error) return { data: [], error };

  // RLS already limits rows to owner, accepted friends, and groups, but filter
  // defensively so a shared reviewer never leaks into the wrong list. The two
  // audiences are independent, so either one is enough to see the row.
  const visibleRows = (rows || []).filter((row) => {
    if (row.owner_id === userId) return true;

    if (isGroupVisible(row.visibility)) {
      const shared = Array.isArray(row.shared_groups) ? row.shared_groups.map(String) : [];
      if (shared.some((groupId) => groupMemberIds.includes(groupId))) return true;
    }

    if (!isFriendVisible(row.visibility)) return false;
    if (!friendIds.includes(row.owner_id)) return false;
    if (row.shared_with == null || (Array.isArray(row.shared_with) && !row.shared_with.length)) return true;
    return (row.shared_with || []).map(String).includes(userId);
  });

  const ownerIds = [...new Set(visibleRows.map((row) => row.owner_id))];
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", ownerIds)
    : { data: [], error: null };

  if (profilesError) return { data: [], error: profilesError };

  const profilesById = new Map((profiles || []).map((profile) => [profile.id, profile]));

  // The same reviewer can arrive under two owners when somebody uploaded a copy
  // of a group-shared reviewer from an offline save. The reader caches by
  // reviewer_id, so whichever row is processed last decides the owner and the
  // name; deduping on the way out keeps the original instead.
  const byReviewerId = new Map();
  for (const row of visibleRows) {
    const existing = byReviewerId.get(row.reviewer_id);
    if (!existing || new Date(row.created_at) < new Date(existing.created_at)) {
      byReviewerId.set(row.reviewer_id, row);
    }
  }
  const uniqueRows = [...byReviewerId.values()];

  // The summary is flattened onto the row, so callers that used to read
  // item.data keep working and simply see the lighter object. Questions are
  // fetched later, per reviewer, by getCloudReviewerById.
  return {
    data: uniqueRows.map((row) => {
      const profile = row.owner_id === userId ? null : profilesById.get(row.owner_id) || null;

      return {
        ...row.summary,
        owner_id: row.owner_id,
        reviewer_id: row.reviewer_id,
        ownerName: profile ? profile.display_name || "A friend" : null,
        ownerProfile: profile
      };
    }),
    error: null
  };
}

// Fetches one reviewer in full, questions included, for when it is actually
// opened. ownerId narrows the row because a reviewer id is only unique per owner.
export async function getCloudReviewerById(reviewerId, ownerId) {
  if (!supabase || !reviewerId) return { data: null, error: null };

  const query = supabase
    .from(REVIEWERS_TABLE)
    .select("*")
    .eq("reviewer_id", reviewerId);

  const { data, error } = ownerId
    ? await query.eq("owner_id", ownerId).maybeSingle()
    : await query.limit(1).maybeSingle();

  if (error || !data) return { data: null, error };

  // A cold load of /reviewer/:id has no cache entry behind it, so the row's
  // owner name has to come from the profile table the way the list path does.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .eq("id", data.owner_id)
    .maybeSingle();

  return {
    data: {
      ...data.data,
      reviewerId: data.reviewer_id,
      ownerId: data.owner_id,
      ownerName: profile ? profile.display_name || "A friend" : null,
      ownerProfile: profile || null,
      visibility: normalizeVisibility(data.visibility || data.data?.visibility),
      sharedWith: data.shared_with || data.data?.sharedWith || null,
      sharedGroups: data.shared_groups || data.data?.sharedGroups || null,
      updatedAt: data.updated_at
    },
    error: null
  };
}

// Writes the friend audience and which friends, leaving shared_groups alone so
// that turning friends on or off never disturbs a group share. Group audiences
// go through shareReviewerWithGroups in the groups service instead.
export async function updateCloudReviewerVisibility(userId, reviewerId, { visibility, sharedWith }) {
  if (!supabase || !userId) {
    return { data: null, error: new Error("Supabase is not configured.") };
  }

  const payload = {
    visibility: normalizeVisibility(visibility),
    shared_with: Array.isArray(sharedWith) && sharedWith.length ? sharedWith : null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .update(payload)
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId)
    .select()
    .single();

  return { data, error };
}

export async function checkReviewerSharingReady(userId) {
  if (!supabase || !userId) return { ready: false, error: null };

  const { error } = await supabase
    .from(REVIEWERS_TABLE)
    .select("visibility")
    .eq("owner_id", userId)
    .limit(1);

  return { ready: !error, error };
}
