import { supabase } from "../lib/supabaseClient.js";

const PROFILES_TABLE = "profiles";
const FRIENDSHIPS_TABLE = "friendships";
const SHARES_TABLE = "reviewer_shares";
const GROUP_MEMBERS_TABLE = "group_members";
const GROUPS_TABLE = "study_groups";
const SUGGESTION_LIMIT = 6;

function getDisplayName(user) {
  return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Hachi User";
}

function getAvatarUrl(user) {
  return user?.user_metadata?.avatar_url || user?.user_metadata?.picture || null;
}

function mapById(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}

// Creates this account's profile row, and never edits it afterwards.
//
// The display name is the app's own value, edited from the account page, but the
// name in auth metadata belongs to whichever provider signed the account in.
// Google repopulates its own metadata on every later login, so a profile write
// derived from it put the provider's name back over the edited one: the rename
// held until the next sign-in, and on /friends it could be undone within thirty
// seconds, because this used to be called from a poll as well as on load.
// Insert-only means the first value wins and only a profile row that does not
// exist yet can be created here.
export async function ensureMyProfile(user) {
  if (!supabase || !user?.id) return { data: null, error: null };

  // email is not written here. It used to be, and because the profiles select
  // policy was open to every signed-in account that put every registered address
  // in reach of "select email from profiles". Supabase keeps the address in
  // auth.users, which clients cannot read, so the copy here was only a liability.
  const payload = {
    id: user.id,
    display_name: getDisplayName(user),
    avatar_url: getAvatarUrl(user),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .upsert(payload, { onConflict: "id", ignoreDuplicates: true })
    .select()
    .maybeSingle();

  if (error) return { data: null, error };

  // insert-if-missing has no column list, so on conflict it leaves the row alone
  // rather than confirming what it now holds. Reading it back is what lets the
  // interface show the name other people see.
  const { data: profile, error: readError } = await supabase
    .from(PROFILES_TABLE)
    .select("id, display_name, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) return { data, error: readError };

  // The avatar is provider-owned, so a row created before the provider supplied a
  // picture can still be filled in. Scoped to rows with no display name, which is
  // exactly the set this insert just created, so it cannot rewrite an edited name.
  if (payload.avatar_url && profile && !profile.display_name) {
    const { data: filled } = await supabase
      .from(PROFILES_TABLE)
      .update({ avatar_url: payload.avatar_url, updated_at: payload.updated_at })
      .eq("id", user.id)
      .is("display_name", null)
      .select("id, display_name, avatar_url")
      .maybeSingle();

    return { data: filled || profile, error: null };
  }

  return { data: profile || data, error: null };
}

export async function updateMyProfile(user, updates) {
  if (!supabase || !user?.id) return { data: null, error: new Error("Supabase is not configured.") };

  const payload = {
    id: user.id,
    display_name: String(updates.displayName || "").trim() || null,
    // Only written when supplied. The picture is provider-owned, so re-deriving it
    // from metadata on every save was another way a rename could be undone.
    ...(updates.avatarUrl !== undefined ? { avatar_url: updates.avatarUrl } : {}),
    updated_at: new Date().toISOString()
  };

  // An update, not an upsert: the row is created by ensureMyProfile, and writing it
  // here would recreate a profile this account had asked to delete.
  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .update(payload)
    .eq("id", user.id)
    .select()
    .single();

  return { data, error };
}

// The signed-in account's own profile row, which is the app's source of truth for
// the display name. Nothing reads it for the current user, which is how a rename
// and the name friends saw could disagree without either side noticing.
export async function getMyProfile(userId) {
  if (!supabase || !userId) return { data: null, error: null };

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("id, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  return { data, error };
}

export async function deleteMyCloudAppData(userId) {
  if (!supabase || !userId) return { error: new Error("Supabase is not configured.") };

  const operations = [
    supabase.from(SHARES_TABLE).delete().or(`owner_id.eq.${userId},recipient_id.eq.${userId}`),
    supabase.from(FRIENDSHIPS_TABLE).delete().or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase.from("reviewer_progress").delete().eq("owner_id", userId),
    supabase.from("reviewer_attempts").delete().eq("owner_id", userId),
    supabase.from("reviewer_study_streak").delete().eq("owner_id", userId),
    supabase.from("reviewers").delete().eq("owner_id", userId),
    supabase.from(PROFILES_TABLE).delete().eq("id", userId)
  ];

  const results = await Promise.all(operations);
  const error = results.find((result) => result.error)?.error || null;

  return { error };
}

// Routed through find_people rather than querying profiles. The profiles table is
// closed to anyone you have no relationship with, and this used to do a substring
// match on email across the whole table, which returned up to ten people's
// addresses for any two characters typed. The function matches an address
// exactly, matches names by prefix only, and returns nothing but a name.
export async function searchProfiles(query, currentUserId) {
  if (!supabase || !currentUserId) return { data: [], error: null };

  const term = String(query || "").trim();
  if (term.length < 2) return { data: [], error: null };

  const { data, error } = await supabase.rpc("find_people", {
    p_term: term,
    p_limit: 10
  });

  return { data: data || [], error };
}

export async function listFriendships(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data: friendships, error } = await supabase
    .from(FRIENDSHIPS_TABLE)
    .select("*")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order("updated_at", { ascending: false });

  if (error) return { data: [], error };

  const profileIds = [...new Set((friendships || []).flatMap((friendship) => [
    friendship.requester_id,
    friendship.addressee_id
  ]))];

  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from(PROFILES_TABLE).select("*").in("id", profileIds)
    : { data: [], error: null };

  if (profilesError) return { data: [], error: profilesError };

  const profilesById = mapById(profiles);
  const data = (friendships || []).map((friendship) => {
    const otherUserId = friendship.requester_id === userId ? friendship.addressee_id : friendship.requester_id;

    return {
      ...friendship,
      otherUserId,
      requesterProfile: profilesById.get(friendship.requester_id) || null,
      addresseeProfile: profilesById.get(friendship.addressee_id) || null,
      otherProfile: profilesById.get(otherUserId) || null
    };
  });

  return { data, error: null };
}

// Who to suggest, and why.
//
// This deliberately cannot mean "everybody who has an account". The profiles select
// policy is closed to exactly four relationships, and that closure is the point: the
// table used to carry a duplicate email column behind a `using (true)` policy, which
// let any signed-in account enumerate the whole directory by typing prefixes into the
// friend search. A suggestion panel is that same hole under a friendlier label, only
// it needs no typing at all. So this is built strictly from relationships the policy
// already permits, and a peer the policy hides simply does not appear. Nothing here
// loosens a policy, which is why it needs no migration.
//
// The two relationships that are both permitted and worth surfacing:
//   - someone in a group you are both in
//   - someone who shared a reviewer with you, or that you shared with them
//
// Friends of friends is absent on purpose. A friend of a friend satisfies none of the
// four predicates, so the policy returns no row for them. Surfacing them would mean
// widening the policy, which is the opposite of what this is for.

// First half: turn the rows already fetched into an ordered list of candidates and
// the reason each one is worth suggesting. Insertion order is the preference order, and
// the sources are applied strongest first: a named group is the most concrete reason, a
// mutual friend is next, and a reviewer share is the weakest. The first reason recorded
// for a person is the one that gets shown.
export function collectSuggestionCandidates({ userId, myGroupIds = [], groups = [], coMembers = [], friendsOfFriends = [], shares = [], excludeIds = [] }) {
  const excluded = new Set([userId, ...(excludeIds || []).filter(Boolean)]);
  const candidates = new Map();

  // A group whose name the policy will not describe cannot be offered as a reason, so
  // it is skipped rather than summarised as nothing.
  (groups || [])
    .filter((group) => group && String(group.name || "").trim())
    .forEach((group) => {
      (coMembers || [])
        .filter((row) => row.group_id === group.id && !excluded.has(row.user_id))
        .forEach((row) => {
          if (candidates.has(row.user_id)) return;
          candidates.set(row.user_id, { reason: "group", detail: group.name });
        });
    });

  // Two hops out, already filtered to accepted friendships and to people who are not
  // already known by the function itself. The count is the only thing carried: naming
  // the friends behind it would tell the reader facts about the suggested person's own
  // friendships, which is not what a suggestion is for.
  (friendsOfFriends || []).forEach((row) => {
    const mutualCount = Number(row?.mutual_count) || 0;
    if (!row?.id || mutualCount < 1 || excluded.has(row.id) || candidates.has(row.id)) return;
    candidates.set(row.id, { reason: "mutual", detail: mutualCount });
  });

  (shares || []).forEach((share) => {
    const peerId = share.owner_id === userId ? share.recipient_id : share.owner_id;
    if (!peerId || excluded.has(peerId) || candidates.has(peerId)) return;
    candidates.set(peerId, { reason: "reviewer", detail: String(share.title || "").trim() });
  });

  return candidates;
}

// Second half: pair the candidates with the profiles that came back. A candidate the
// policy did not return is dropped rather than rendered as a blank card, and the cap
// is applied here so over-fetching upstream still fills the list.
export function toSuggestions(candidates, profiles, limit = SUGGESTION_LIMIT) {
  const profilesById = mapById(profiles);

  return [...candidates.keys()]
    .map((id) => {
      const profile = profilesById.get(id);
      if (!profile) return null;
      const { reason, detail } = candidates.get(id);
      return { id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url, reason, detail };
    })
    .filter(Boolean)
    .slice(0, limit);
}

// Which reviewers in a poll had their questions edited since this device last
// looked. Split out of the watcher for the same reason the suggestion rules are:
// the rule is what decides whether other people get told something, and it is
// testable here without a browser.
//
// The comparison is on questions_updated_at rather than updated_at, because
// updated_at also moves on a rename, a visibility change and a group share.
// Keying off it would announce an edit that never happened, and a reader who is
// told that often stops reading what the app says.
//
// Three cases stay quiet, and each for its own reason. A reviewer this account
// owns is the editor, not the audience. A stamp the device has never recorded is
// a first sighting, which on a device that has been watching means the reviewer
// was only just shared and already has its own notification. A row with no stamp
// at all is a database that has not had the migration run, where every reviewer
// would otherwise look permanently edited.
export function collectReviewerEdits(rows, { userId, seen = {}, seeded = true } = {}) {
  const previous = seen && typeof seen === "object" ? seen : {};
  const next = {};
  const edits = [];

  (rows || []).forEach((row) => {
    const reviewerId = row?.reviewer_id;
    if (!reviewerId || row.owner_id === userId) return;

    // Copied through so the caller's saved state is never mutated in place. The
    // watcher holds this map for the length of a poll and then saves it.
    const known = Object.prototype.hasOwnProperty.call(previous, reviewerId)
      ? previous[reviewerId]
      : undefined;
    const stamp = row.questionsUpdatedAt || null;
    next[reviewerId] = stamp;

    if (!stamp) return;
    if (known === undefined) return;
    if (known === stamp) return;
    if (!seeded) return;

    edits.push({
      reviewerId,
      stamp,
      title: row.title || row.data?.title || "a reviewer",
      ownerName: row.ownerName || row.ownerProfile?.display_name || "A friend"
    });
  });

  return { edits, next };
}

export async function listSuggestedPeople(userId, { excludeIds = [], limit = SUGGESTION_LIMIT } = {}) {
  if (!supabase || !userId) return { data: [], error: null };

  // The friends-of-friends call is a separate migration, so it can be missing on a
  // database that has not had supabase-migration-2026-10-social-graph.sql run yet.
  // That is an expected state, not a fault: its failure is dropped and the other two
  // sources still produce a section, rather than the whole feature disappearing
  // because of a function nobody has deployed.
  const [membershipsResult, sharesResult, mutualResult] = await Promise.all([
    supabase.from(GROUP_MEMBERS_TABLE).select("group_id").eq("user_id", userId),
    supabase
      .from(SHARES_TABLE)
      .select("owner_id, recipient_id, title")
      .or(`owner_id.eq.${userId},recipient_id.eq.${userId}`),
    supabase.rpc("find_friends_of_friends", { p_limit: limit * 2 })
  ]);

  const friendsOfFriends = mutualResult.error ? [] : (mutualResult.data || []);
  const myGroupIds = [...new Set((membershipsResult.data || []).map((row) => row.group_id))];
  const [{ data: coMembers }, { data: groups }] = myGroupIds.length
    ? await Promise.all([
        supabase.from(GROUP_MEMBERS_TABLE).select("group_id, user_id").in("group_id", myGroupIds),
        supabase.from(GROUPS_TABLE).select("id, name").in("id", myGroupIds)
      ])
    : [{ data: [] }, { data: [] }];

  const candidates = collectSuggestionCandidates({
    userId,
    groups,
    coMembers,
    friendsOfFriends,
    shares: sharesResult.data || [],
    excludeIds
  });
  if (!candidates.size) return { data: [], error: null };

  // Overfetched on purpose, because the policy can still hide a profile row and four
  // suggestions is a better outcome than none. The real cap is applied in
  // toSuggestions once the readable rows are known.
  const { data: profiles, error } = await supabase
    .from(PROFILES_TABLE)
    .select("id, display_name, avatar_url")
    .in("id", [...candidates.keys()].slice(0, limit * 2));

  if (error) return { data: [], error };

  return { data: toSuggestions(candidates, profiles, limit), error: null };
}

export async function sendFriendRequest(requesterId, addresseeId) {
  if (!supabase || !requesterId) return { error: new Error("Supabase is not configured.") };

  const { data: outgoing, error: outgoingError } = await supabase
    .from(FRIENDSHIPS_TABLE)
    .select("*")
    .eq("requester_id", requesterId)
    .eq("addressee_id", addresseeId)
    .maybeSingle();

  if (outgoingError) return { error: outgoingError };
  if (outgoing) return { error: new Error("A friend request or friendship already exists.") };

  const { data: incoming, error: incomingError } = await supabase
    .from(FRIENDSHIPS_TABLE)
    .select("*")
    .eq("requester_id", addresseeId)
    .eq("addressee_id", requesterId)
    .maybeSingle();

  if (incomingError) return { error: incomingError };
  if (incoming) return { error: new Error("A friend request or friendship already exists.") };

  const { data, error } = await supabase
    .from(FRIENDSHIPS_TABLE)
    .insert({
      requester_id: requesterId,
      addressee_id: addresseeId,
      status: "pending"
    })
    .select()
    .single();

  return { data, error };
}

export async function acceptFriendRequest(friendshipId) {
  if (!supabase) return { error: new Error("Supabase is not configured.") };

  const { data, error } = await supabase
    .from(FRIENDSHIPS_TABLE)
    .update({
      status: "accepted",
      updated_at: new Date().toISOString()
    })
    .eq("id", friendshipId)
    .select()
    .single();

  return { data, error };
}

export async function removeFriendship(friendshipId) {
  if (!supabase) return { error: new Error("Supabase is not configured.") };

  const { error } = await supabase
    .from(FRIENDSHIPS_TABLE)
    .delete()
    .eq("id", friendshipId);

  return { error };
}

export async function shareReviewer(ownerId, recipientId, reviewer, message = "") {
  if (!supabase || !ownerId) return { error: new Error("Supabase is not configured.") };

  const payload = {
    owner_id: ownerId,
    recipient_id: recipientId,
    reviewer_id: reviewer.reviewerId,
    title: reviewer.title,
    subject: reviewer.subject,
    data: reviewer,
    message: message.trim() || null
  };

  const { data, error } = await supabase
    .from(SHARES_TABLE)
    .insert(payload)
    .select()
    .single();

  return { data, error };
}

export async function listReceivedReviewerShares(userId) {
  if (!supabase || !userId) return { data: [], error: null };

  const { data: shares, error } = await supabase
    .from(SHARES_TABLE)
    .select("*")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false });

  if (error) return { data: [], error };

  const ownerIds = [...new Set((shares || []).map((share) => share.owner_id))];
  const { data: profiles, error: profilesError } = ownerIds.length
    ? await supabase.from(PROFILES_TABLE).select("*").in("id", ownerIds)
    : { data: [], error: null };

  if (profilesError) return { data: [], error: profilesError };

  const profilesById = mapById(profiles);
  return {
    data: (shares || []).map((share) => ({
      ...share,
      ownerProfile: profilesById.get(share.owner_id) || null
    })),
    error: null
  };
}

export async function deleteReviewerShare(shareId) {
  if (!supabase) return { error: new Error("Supabase is not configured.") };

  const { error } = await supabase
    .from(SHARES_TABLE)
    .delete()
    .eq("id", shareId);

  return { error };
}

export async function deleteReviewerSharesForOwner(userId, reviewerId) {
  if (!supabase || !userId) return { error: null };

  const { error } = await supabase
    .from(SHARES_TABLE)
    .delete()
    .eq("owner_id", userId)
    .eq("reviewer_id", reviewerId);

  return { error };
}
