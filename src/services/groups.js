import { supabase } from "../lib/supabaseClient.js";
import { SOCIAL_DATA_CHANGED_EVENT } from "../utils/storageUtils.js";

const GROUPS_TABLE = "study_groups";
const MEMBERS_TABLE = "group_members";
const PROFILES_TABLE = "profiles";
const REVIEWERS_TABLE = "reviewers";

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
    ? await supabase.from(PROFILES_TABLE).select("id, email, display_name").in("id", adderIds)
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
          ? adder.display_name || adder.email || "Someone"
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

  const name = profile.display_name || profile.email;

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
  if (!supabase || !groupId) return { data: [], error: null };

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .select("*")
    .eq("visibility", "group")
    .not("shared_groups", "is", null);

  if (error) return { data: [], error };

  const matches = (data || []).filter((row) =>
    normalizeGroupIds(row.shared_groups).includes(groupId)
  );

  if (!matches.length) return { data: [], error: null };

  const ownerIds = [...new Set(matches.map((row) => row.owner_id))];
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await supabase.from(PROFILES_TABLE).select("id, email, display_name").in("id", ownerIds)
    : { data: [], error: null };

  if (profilesError) return { data: [], error: profilesError };

  const profilesById = mapById(profiles);

  return {
    data: matches
      .map((row) => ({
        ...row,
        ownerName: profilesById.get(row.owner_id)?.display_name
          || profilesById.get(row.owner_id)?.email
          || "A member"
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    error: null
  };
}

// Detaches a reviewer from every group without touching visibility, so a
// reviewer can move from group sharing back to friends or private cleanly.
export async function clearReviewerGroupShares(userId, reviewerId) {
  if (!supabase || !userId) return NOT_CONFIGURED();
  if (!reviewerId) return { error: new Error("This reviewer is missing an ID.") };

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .update({ shared_groups: null, updated_at: new Date().toISOString() })
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
    .select("shared_groups")
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId)
    .maybeSingle();

  if (readError) return { error: readError };
  if (!reviewer) return { error: new Error("Could not find that reviewer in your account.") };

  const remaining = normalizeGroupIds(reviewer.shared_groups).filter((id) => id !== groupId);
  return shareReviewerWithGroups(userId, reviewerId, remaining);
}

// Counts the reviewers shared into each of the given groups with a single
// read, instead of one query per group on the groups list.
export async function listGroupReviewerCounts(groupIds) {
  if (!supabase || !groupIds?.length) return { data: {}, error: null };

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .select("id, shared_groups")
    .eq("visibility", "group")
    .not("shared_groups", "is", null);

  if (error) return { data: {}, error: friendlyGroupsError(error) };

  const counts = {};
  groupIds.forEach((groupId) => {
    counts[groupId] = 0;
  });

  (data || []).forEach((row) => {
    normalizeGroupIds(row.shared_groups).forEach((groupId) => {
      if (groupId in counts) counts[groupId] += 1;
    });
  });

  return { data: counts, error: null };
}

export async function shareReviewerWithGroups(userId, reviewerId, groupIds) {
  if (!supabase || !userId) return NOT_CONFIGURED();
  if (!reviewerId) return { error: new Error("This reviewer is missing an ID.") };

  const nextGroupIds = normalizeGroupIds(groupIds);

  const { data, error } = await supabase
    .from(REVIEWERS_TABLE)
    .update({
      visibility: nextGroupIds.length ? "group" : "private",
      shared_groups: nextGroupIds.length ? nextGroupIds : null,
      updated_at: new Date().toISOString()
    })
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId)
    .select()
    .single();

  if (!error) announceSocialChange();
  return { data, error };
}
