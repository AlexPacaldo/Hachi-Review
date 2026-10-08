import { supabase } from "../lib/supabaseClient.js";
import { SOCIAL_DATA_CHANGED_EVENT } from "../utils/storageUtils.js";
import { GROUP_VISIBILITIES, isFriendVisible, resolveVisibility } from "./reviewerVisibility.js";

const GROUPS_TABLE = "study_groups";
const MEMBERS_TABLE = "group_members";
const PROFILES_TABLE = "profiles";
const REVIEWERS_TABLE = "reviewers";
const SHARES_TABLE = "reviewer_group_shares";

const NOT_CONFIGURED = () => ({ error: new Error("Supabase is not configured.") });

// Groups are a newer addition, so a database that has not had the latest
// supabase-schema.sql applied reports a missing relation. Show something
// actionable instead of a raw Postgres code.
function friendlyGroupsError(error) {
  if (!error) return null;

  const message = error.message || "";
  if (error.code === "42P01" || /does not exist/i.test(message)) {
    return new Error("Groups need a database update. Run supabase-schema.sql in your Supabase SQL editor.");
  }

  return error;
}

function announceSocialChange() {
  window.dispatchEvent(new Event(SOCIAL_DATA_CHANGED_EVENT));
}

function mapById(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}

function normalizeGroupIds(groupIds) {
  return [...new Set((groupIds || []).filter((id) => typeof id === "string" && id))];
}

// One reviewer can exist as more than one row: the owner, plus a copy some group
// member uploaded from an offline save before the upload pass learned to skip a
// reviewer it does not own. Both rows carry the same reviewer_id and both are
// announced to the group, so the group page would list the reviewer twice and the
// count would be double. The oldest row is the original, so it is the one kept.
function dedupeByReviewerId(rows) {
  const byReviewerId = new Map();

  for (const row of rows || []) {
    if (!row?.reviewer_id) continue;
    const existing = byReviewerId.get(row.reviewer_id);
    if (!existing || new Date(row.created_at) < new Date(existing.created_at)) {
      byReviewerId.set(row.reviewer_id, row);
    }
  }

  return [...byReviewerId.values()];
}

// Group ids reach these functions from the route, and they are interpolated
// into a jsonb filter, so anything that is not a uuid is rejected first.
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isGroupId(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// shared_groups is jsonb, so the filter value has to be a json array literal
// rather than a Postgres array, which is what makes Postgres do the matching.
function sharedWithGroupFilter(groupId) {
  return `["${groupId}"]`;
}

// The share table is the fast path, but it only exists once supabase-schema.sql
// has been applied, so both readers fall back to the shared_groups column while
// a database is still missing it.
function isMissingRelation(error) {
  return error?.code === "42P01" || /does not exist/i.test(error?.message || "");
}

async function readGroupReviewers(groupId) {
  // The inner hint keeps the visibility rule, so this returns exactly what the
  // shared_groups filter returned before the share table existed. Both group
  // audiences count, because a reviewer can be shared with groups and friends.
  const { data, error } = await supabase
    .from(SHARES_TABLE)
    .select("reviewers!inner(*)")
    .eq("group_id", groupId)
    .in("reviewers.visibility", GROUP_VISIBILITIES);

  if (!error) return { rows: (data || []).map((row) => row.reviewers).filter(Boolean), error: null };
  if (!isMissingRelation(error)) return { rows: [], error };

  const fallback = await supabase
    .from(REVIEWERS_TABLE)
    .select("*")
    .in("visibility", GROUP_VISIBILITIES)
    .contains("shared_groups", sharedWithGroupFilter(groupId));

  return { rows: fallback.data || [], error: fallback.error || null };
}

async function readGroupReviewerCount(groupId) {
  // The count is over distinct reviewers, not share rows: one reviewer shared
  // into two groups, or existing twice under different owners, is still one
  // reviewer on the group's page.
  const { data, error } = await supabase
    .from(SHARES_TABLE)
    .select("reviewers!inner(reviewer_id)")
    .eq("group_id", groupId);

  if (!error) {
    const ids = new Set((data || []).map((row) => row.reviewers?.reviewer_id).filter(Boolean));
    return { count: ids.size, error: null };
  }
  if (!isMissingRelation(error)) return { count: 0, error };

  const fallback = await supabase
    .from(REVIEWERS_TABLE)
    .select("reviewer_id")
    .in("visibility", GROUP_VISIBILITIES)
    .contains("shared_groups", sharedWithGroupFilter(groupId));

  if (fallback.error) return { count: 0, error: fallback.error };

  return { count: new Set((fallback.data || []).map((row) => row.reviewer_id).filter(Boolean)).size, error: null };
}

export async function listMyGroups(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data: memberships, error } = await supabase
    .from(MEMBERS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) return { data: [], error: friendlyGroupsError(error) };

  const groupIds = (memberships || []).map((membership) => membership.group_id);
  if (!groupIds.length) return { data: [], error: null };

  const { data: groups, error: groupsError } = await supabase
    .from(GROUPS_TABLE)
    .select("*")
    .in("id", groupIds);

  if (groupsError) return { data: [], error: friendlyGroupsError(groupsError) };

  const memberRows = await listMemberCounts(groupIds);
  const countsById = new Map(memberRows.map((row) => [row.group_id, row.count]));
  const groupsById = mapById(groups);
  const roleById = new Map((memberships || []).map((m) => [m.group_id, m.role]));

  // Who added me, and when, drives the "X added you to Y" notification.
  const adderIds = [
    ...new Set((memberships || []).map((m) => m.added_by).filter((id) => id && id !== userId))
  ];
  const { data: adderProfiles } = adderIds.length
    ? await supabase.from(PROFILES_TABLE).select("id, display_name, avatar_url").in("id", adderIds)
    : { data: [] };
  const addersById = mapById(adderProfiles);

  const data = (memberships || [])
    .map((membership) => {
      const group = groupsById.get(membership.group_id);
      if (!group) return null;

      const adder = addersById.get(membership.added_by) || null;

      return {
        ...group,
        role: roleById.get(group.id) || "member",
        memberCount: countsById.get(group.id) || 1,
        membershipId: membership.id,
        joinedAt: membership.created_at,
        addedBy: membership.added_by || null,
        addedByName: adder
          ? adder.display_name || "Someone"
          : membership.added_by === userId
            ? "You"
            : null,
        addedByMe: !membership.added_by || membership.added_by === userId
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const roleOrder = { owner: 0, admin: 1, member: 2 };
      const byRole = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
      if (byRole !== 0) return byRole;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  return { data, error: null };
}

async function listMemberCounts(groupIds) {
  if (!groupIds.length) return [];

  const { data, error } = await supabase
    .from(MEMBERS_TABLE)
    .select("group_id")
    .in("group_id", groupIds);

  if (error) return [];

  const counts = new Map();
  (data || []).forEach((row) => {
    counts.set(row.group_id, (counts.get(row.group_id) || 0) + 1);
  });

  return [...counts].map(([group_id, count]) => ({ group_id, count }));
}

export async function createGroup(userId, { name, description = "" } = {}) {
  if (!supabase || !userId) return NOT_CONFIGURED();

  const trimmedName = String(name || "").trim();
  if (!trimmedName) return { error: new Error("Give the group a name.") };

  const trimmedDescription = String(description || "").trim();
  const now = new Date().toISOString();

  const { data: group, error: groupError } = await supabase
    .from(GROUPS_TABLE)
    .insert({
      name: trimmedName,
      description: trimmedDescription || null,
      owner_id: userId,
      created_at: now,
      updated_at: now
    })
    .select()
    .single();

  if (groupError) return { error: groupError };

  // The owner row is inserted separately so the group is never left without an
  // owner membership if this second insert fails.
  const { error: memberError } = await supabase
    .from(MEMBERS_TABLE)
    .insert({ group_id: group.id, user_id: userId, role: "owner", added_by: userId });

  if (memberError) {
    await supabase.from(GROUPS_TABLE).delete().eq("id", group.id);
    return { error: memberError };
  }

  announceSocialChange();
  return { data: { ...group, role: "owner", memberCount: 1 }, error: null };
}

export async function updateGroup(userId, groupId, { name, description } = {}) {
  if (!supabase || !userId) return NOT_CONFIGURED();
  if (!groupId) return { error: new Error("This group no longer exists.") };

  const payload = { updated_at: new Date().toISOString() };
  if (typeof name === "string") {
    const trimmedName = name.trim();
    if (!trimmedName) return { error: new Error("Give the group a name.") };
    payload.name = trimmedName;
  }
  if (typeof description === "string") {
    payload.description = description.trim() || null;
  }

  const { data, error } = await supabase
    .from(GROUPS_TABLE)
    .update(payload)
    .eq("id", groupId)
    .select()
    .single();

  if (!error) announceSocialChange();

  // Row level security silently filters a non-owner update down to zero rows,
  // and .single() turns that into a bare PGRST116 with no useful wording.
  if (error?.code === "PGRST116") {
    return {
      data: null,
      error: new Error("Only the group owner or an admin can change this group.")
    };
  }

  return { data, error: friendlyGroupsError(error) };
}

export async function deleteGroup(groupId) {
  if (!supabase) return NOT_CONFIGURED();
  if (!groupId) return { error: new Error("This group no longer exists.") };

  const { error } = await supabase.from(GROUPS_TABLE).delete().eq("id", groupId);
  if (!error) announceSocialChange();
  return { error };
}

export async function listGroupMembers(groupId) {
  if (!supabase || !groupId) return { data: [], error: null };

  const { data: members, error } = await supabase
    .from(MEMBERS_TABLE)
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });

  if (error) return { data: [], error: friendlyGroupsError(error) };

  const profileIds = [
    ...new Set([
      ...(members || []).map((member) => member.user_id),
      ...(members || []).map((member) => member.added_by).filter(Boolean)
    ])
  ];
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from(PROFILES_TABLE).select("*").in("id", profileIds)
    : { data: [], error: null };

  if (profilesError) return { data: [], error: profilesError };

  const profilesById = mapById(profiles);
  const roleOrder = { owner: 0, admin: 1, member: 2 };

  const data = (members || [])
    .map((member) => ({
      ...member,
      profile: profilesById.get(member.user_id) || null,
      addedByProfile: member.added_by ? profilesById.get(member.added_by) || null : null
    }))
    .sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3));

  return { data, error: null };
}

// Every membership across all of the signed-in user's groups, with profiles.
// The notification watcher uses this to spot people joining a group the user
// already belongs to without querying one group at a time.
export async function listMyGroupMembers(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data: memberships, error } = await supabase
    .from(MEMBERS_TABLE)
    .select("group_id")
    .eq("user_id", userId);

  if (error) return { data: [], error: friendlyGroupsError(error) };

  const groupIds = [...new Set((memberships || []).map((row) => row.group_id))];
  if (!groupIds.length) return { data: [], error: null };

  const { data: members, error: membersError } = await supabase
    .from(MEMBERS_TABLE)
    .select("*")
    .in("group_id", groupIds);

  if (membersError) return { data: [], error: friendlyGroupsError(membersError) };

  const profileIds = [
    ...new Set([
      ...(members || []).map((member) => member.user_id),
      ...(members || []).map((member) => member.added_by).filter(Boolean)
    ])
  ];
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from(PROFILES_TABLE).select("*").in("id", profileIds)
    : { data: [], error: null };

  if (profilesError) return { data: [], error: profilesError };

  const profilesById = mapById(profiles);

  return {
    data: (members || []).map((member) => ({
      ...member,
      profile: profilesById.get(member.user_id) || null,
      addedByProfile: member.added_by ? profilesById.get(member.added_by) || null : null
    })),
    error: null
  };
}

export async function addGroupMember(groupId, profile, addedBy) {
  if (!supabase) return NOT_CONFIGURED();
  if (!groupId || !profile?.id) return { error: new Error("Choose someone to add.") };

  const name = profile.display_name || "Someone";

  const { data: existing } = await supabase
    .from(MEMBERS_TABLE)
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", profile.id)
    .maybeSingle();

  if (existing) return { error: new Error(`${name} is already in this group.`) };

  const { data, error } = await supabase
    .from(MEMBERS_TABLE)
    .insert({ group_id: groupId, user_id: profile.id, role: "member", added_by: addedBy || null })
    .select()
    .single();

  // Someone can join between the check above and this insert, and the unique
  // constraint is what actually settles it, so 23505 is the same situation.
  if (error?.code === "23505") {
    return { data: null, error: new Error(`${name} is already in this group.`) };
  }

  if (!error) announceSocialChange();
  return { data, error };
}

export async function setGroupMemberRole(groupId, userId, role) {
  if (!supabase) return NOT_CONFIGURED();
  if (!groupId || !userId) return { error: new Error("Choose a member first.") };
  if (!["admin", "member"].includes(role)) {
    return { error: new Error("Only admins and members can be set here.") };
  }

  const { data, error } = await supabase
    .from(MEMBERS_TABLE)
    .update({ role })
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .select()
    .single();

  if (!error) announceSocialChange();
  return { data, error };
}

export async function removeGroupMember(groupId, userId) {
  if (!supabase) return NOT_CONFIGURED();
  if (!groupId || !userId) return { error: new Error("Choose a member first.") };

  const { error } = await supabase
    .from(MEMBERS_TABLE)
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);

  if (!error) announceSocialChange();
  return { error };
}

export async function leaveGroup(userId, groupId) {
  if (!supabase) return NOT_CONFIGURED();
  if (!userId) return { error: new Error("Sign in to leave this group.") };
  return removeGroupMember(groupId, userId);
}

export async function listGroupReviewers(groupId) {
  if (!supabase || !isGroupId(groupId)) return { data: [], error: null };

  // Read through the share table so Postgres answers from the group index, and
  // the second check keeps a row with a malformed id from leaking into a group
  // it is not actually shared with.
  const { rows, error } = await readGroupReviewers(groupId);
  if (error) return { data: [], error: friendlyGroupsError(error) };

  const matches = rows.filter((row) =>
    normalizeGroupIds(row.shared_groups).includes(groupId)
  );

  if (!matches.length) return { data: [], error: null };

  const ownerIds = [...new Set(matches.map((row) => row.owner_id))];
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await supabase.from(PROFILES_TABLE).select("id, display_name, avatar_url").in("id", ownerIds)
    : { data: [], error: null };

  if (profilesError) return { data: [], error: profilesError };

  const profilesById = mapById(profiles);

  return {
    data: dedupeByReviewerId(matches)
      .map((row) => ({
        ...row,
        ownerName: profilesById.get(row.owner_id)?.display_name
          || "A member"
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    error: null
  };
}

// Detaches a reviewer from every group. visibility is only written when the
// caller passes it, because dropping the last group changes the audience unless
// the reviewer was also shared with friends.
export async function clearReviewerGroupShares(userId, reviewerId, { visibility } = {}) {
  if (!supabase || !userId) return NOT_CONFIGURED();
  if (!reviewerId) return { error: new Error("This reviewer is missing an ID.") };

  const updates = { shared_groups: null, updated_at: new Date().toISOString() };
  if (visibility) updates.visibility = visibility;

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .update(updates)
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId)
    .select()
    .single();

  if (!error) announceSocialChange();
  return { data, error };
}

export async function unshareReviewerFromGroup(userId, reviewerId, groupId) {
  if (!supabase || !userId) return NOT_CONFIGURED();
  if (!reviewerId || !groupId) return { error: new Error("This reviewer is missing an ID.") };

  const { data: reviewer, error: readError } = await supabase
    .from(REVIEWERS_TABLE)
    .select("visibility, shared_groups")
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId)
    .maybeSingle();

  if (readError) return { error: readError };
  if (!reviewer) return { error: new Error("Could not find that reviewer in your account.") };

  const remaining = normalizeGroupIds(reviewer.shared_groups).filter((id) => id !== groupId);
  // Removing the last group leaves the friend audience exactly as it was, so a
  // reviewer shared with both stays shared with friends.
  return shareReviewerWithGroups(userId, reviewerId, remaining, {
    friendsVisible: isFriendVisible(reviewer.visibility)
  });
}

// Converts the browser's random bytes into the same hex shape the database
// default produces, so a regenerated code is indistinguishable from a fresh row.
function generateInviteCode() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildGroupInviteUrl(inviteCode) {
  if (!inviteCode || typeof inviteCode !== "string") return null;
  const origin = typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "https://hachi-review.site";
  return `${origin}/groups/join/${encodeURIComponent(inviteCode)}`;
}

export async function getGroupInvitePreview(inviteCode) {
  if (!supabase) return NOT_CONFIGURED();
  if (!inviteCode) return { data: null, error: new Error("This invite link is missing its code.") };

  const { data, error } = await supabase.rpc("get_group_invite_preview", { p_code: inviteCode });

  if (error) {
    if (/function .* does not exist|schema cache/i.test(error.message || "")) {
      return { data: null, error: new Error("Invite links need a database update. Run supabase-migration-2026-10-group-invites.sql in your Supabase SQL editor.") };
    }
    return { data: null, error };
  }

  return { data: Array.isArray(data) ? data[0] || null : data || null, error: null };
}

export async function joinGroupByInvite(inviteCode) {
  if (!supabase) return NOT_CONFIGURED();
  if (!inviteCode) return { data: null, error: new Error("This invite link is missing its code.") };

  const { data, error } = await supabase.rpc("join_group_by_invite", { p_code: inviteCode });

  if (error) {
    if (/function .* does not exist|schema cache/i.test(error.message || "")) {
      return { data: null, error: new Error("Invite links need a database update. Run supabase-migration-2026-10-group-invites.sql in your Supabase SQL editor.") };
    }
    return { data: null, error };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!error) announceSocialChange();
  return { data: row || null, error: null };
}

// Rotates the invite code, invalidating every outstanding link. Only owners and
// admins can save because the study_groups update policy gates the write.
export async function regenerateGroupInviteCode(groupId) {
  if (!supabase) return NOT_CONFIGURED();
  if (!groupId) return { error: new Error("This group no longer exists.") };

  const { data, error } = await supabase
    .from(GROUPS_TABLE)
    .update({ invite_code: generateInviteCode(), updated_at: new Date().toISOString() })
    .eq("id", groupId)
    .select()
    .single();

  if (!error) announceSocialChange();

  if (error?.code === "PGRST116") {
    return { data: null, error: new Error("Only the group owner or an admin can change the invite link.") };
  }

  return { data, error: friendlyGroupsError(error) };
}

// Counts the reviewers shared into each of the given groups, one count-only
// read per group, so no reviewer rows are transferred to count them here.
export async function listGroupReviewerCounts(groupIds) {
  if (!supabase || !groupIds?.length) return { data: {}, error: null };

  const counts = {};
  groupIds.forEach((groupId) => {
    counts[groupId] = 0;
  });

  const uniqueGroupIds = [...new Set(groupIds.filter(isGroupId))];
  if (!uniqueGroupIds.length) return { data: counts, error: null };

  const results = await Promise.all(uniqueGroupIds.map((groupId) => readGroupReviewerCount(groupId)));

  const failed = results.find((result) => result.error);
  if (failed) return { data: {}, error: friendlyGroupsError(failed.error) };

  uniqueGroupIds.forEach((groupId, index) => {
    counts[groupId] = results[index].count || 0;
  });

  return { data: counts, error: null };
}

// Shares with groups without disturbing the friend audience, so friendsVisible
// has to say whether friends can still see this. Dropping the last group leaves
// the reviewer private unless that was left on.
export async function shareReviewerWithGroups(userId, reviewerId, groupIds, { friendsVisible = false } = {}) {
  if (!supabase || !userId) return NOT_CONFIGURED();
  if (!reviewerId) return { error: new Error("This reviewer is missing an ID.") };

  const nextGroupIds = normalizeGroupIds(groupIds);

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .update({
      visibility: resolveVisibility({ friends: friendsVisible, groups: Boolean(nextGroupIds.length) }),
      shared_groups: nextGroupIds.length ? nextGroupIds : null,
      updated_at: new Date().toISOString()
    })
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId)
    .select()
    .single();

  // The share table is supposed to track shared_groups through a trigger, but
  // a database that missed that part of the schema leaves it stale forever.
  // Reconcile by hand so the group list is never wrong about who is shared.
  if (!error && data?.id) {
    const { data: shareRows } = await supabase
      .from(SHARES_TABLE)
      .select("group_id")
      .eq("reviewer_id", data.id);

    const desired = new Set(nextGroupIds.map(String));
    const stale = (shareRows || [])
      .map((row) => String(row.group_id))
      .filter((groupId) => !desired.has(groupId));
    const missing = nextGroupIds.filter((groupId) =>
      !(shareRows || []).some((row) => String(row.group_id) === String(groupId))
    );

    if (stale.length) {
      await supabase.from(SHARES_TABLE).delete().eq("reviewer_id", data.id).in("group_id", stale);
    }
    if (missing.length) {
      await supabase.from(SHARES_TABLE).upsert(
        missing.map((groupId) => ({ reviewer_id: data.id, group_id: groupId, shared_by: userId })),
        { onConflict: "reviewer_id,group_id", ignoreDuplicates: true }
      );
    }
  }

  // Announce only after the share table agrees with shared_groups, otherwise
  // the page's event-driven reload can read a stale share list.
  if (!error) announceSocialChange();

  return { data, error };
}
