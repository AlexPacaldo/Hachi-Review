import { supabase } from "../lib/supabaseClient.js";

const PROFILES_TABLE = "profiles";
const FRIENDSHIPS_TABLE = "friendships";
const SHARES_TABLE = "reviewer_shares";

function getDisplayName(user) {
  return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split("@")[0] || "Hachi User";
}

function mapById(items) {
  return new Map((items || []).map((item) => [item.id, item]));
}

export async function ensureMyProfile(user) {
  if (!supabase || !user?.id || !user?.email) return { data: null, error: null };

  const payload = {
    id: user.id,
    email: user.email.toLowerCase(),
    display_name: getDisplayName(user),
    avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  return { data, error };
}

export async function updateMyProfile(user, updates) {
  if (!supabase || !user?.id || !user?.email) return { data: null, error: new Error("Supabase is not configured.") };

  const payload = {
    id: user.id,
    email: user.email.toLowerCase(),
    display_name: String(updates.displayName || "").trim() || null,
    avatar_url: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .upsert(payload, { onConflict: "id" })
    .select()
    .single();

  return { data, error };
}

export async function deleteMyCloudAppData(userId) {
  if (!supabase || !userId) return { error: new Error("Supabase is not configured.") };

  const operations = [
    supabase.from(SHARES_TABLE).delete().or(`owner_id.eq.${userId},recipient_id.eq.${userId}`),
    supabase.from(FRIENDSHIPS_TABLE).delete().or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase.from("reviewer_progress").delete().eq("owner_id", userId),
    supabase.from("reviewer_attempts").delete().eq("owner_id", userId),
    supabase.from("reviewers").delete().eq("owner_id", userId),
    supabase.from(PROFILES_TABLE).delete().eq("id", userId)
  ];

  const results = await Promise.all(operations);
  const error = results.find((result) => result.error)?.error || null;

  return { error };
}

export async function searchProfiles(query, currentUserId) {
  if (!supabase || !currentUserId) return { data: [], error: null };

  const term = String(query || "").trim();
  if (term.length < 2) return { data: [], error: null };

  const sanitizedTerm = term.replaceAll("%", "").replaceAll(",", " ");
  const { data, error } = await supabase
    .from(PROFILES_TABLE)
    .select("*")
    .or(`email.ilike.%${sanitizedTerm}%,display_name.ilike.%${sanitizedTerm}%`)
    .neq("id", currentUserId)
    .limit(10);

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
