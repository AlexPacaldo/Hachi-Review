import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Search, Trash2, UserPlus, Users } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import UserAvatar from "../components/UserAvatar.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import {
  acceptFriendRequest,
  ensureMyProfile,
  listFriendships,
  listSuggestedPeople,
  removeFriendship,
  searchProfiles,
  sendFriendRequest
} from "../services/social.js";
import { SOCIAL_DATA_CHANGED_EVENT } from "../utils/storageUtils.js";

const POLL_INTERVAL_MS = 30000;

function getProfileName(profile) {
  return profile?.display_name || "Hachi user";
}

// Why this person is a suggestion, in one line. The reason is the whole value of the
// section: a stranger with an Add button is noise, a classmate in your block is a
// reason to press it. Mutual friends are given as a count and never by name, because
// naming them would tell you things about the suggested person's own friendships.
function getSuggestionReason(suggestion) {
  if (suggestion.reason === "group") return `In ${suggestion.detail} with you`;
  if (suggestion.reason === "mutual") {
    const count = Number(suggestion.detail) || 0;
    return `${count} mutual friend${count === 1 ? "" : "s"}`;
  }
  if (suggestion.detail) return `Shared "${suggestion.detail}" with you`;
  return "Shared a reviewer with you";
}

export default function Friends() {
  const { configured, loading, user } = useAuth();
  const [query, setQuery] = useState("");
  const [friendQuery, setFriendQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [friendships, setFriendships] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [requestingId, setRequestingId] = useState("");
  const [message, setMessage] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [loadingSocial, setLoadingSocial] = useState(false);
  const refreshRef = useRef(() => {});

  const acceptedFriends = friendships.filter((friendship) => friendship.status === "accepted");
  const incomingRequests = friendships.filter((friendship) => friendship.status === "pending" && friendship.addressee_id === user?.id);
  const outgoingRequests = friendships.filter((friendship) => friendship.status === "pending" && friendship.requester_id === user?.id);

  // "You may know" means you do not know them yet, so anyone already accepted or
  // already pending is filtered out at render time. That is also why sending a
  // request makes a card disappear on its own, with no refetch: the friendship
  // arriving is what removes it.
  const connectedIds = useMemo(
    () => new Set(friendships.map((friendship) => friendship.otherUserId).filter(Boolean)),
    [friendships]
  );
  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => !connectedIds.has(suggestion.id)),
    [suggestions, connectedIds]
  );

  const normalizedFriendQuery = friendQuery.trim().toLowerCase();
  // Names only. Filtering your own friends by address used to read the address
  // off their profile, which is not something Hachi stores any more.
  const filteredFriends = acceptedFriends.filter((friendship) => (
    getProfileName(friendship.otherProfile).toLowerCase().includes(normalizedFriendQuery)
  ));

  useEffect(() => {
    if (!configured || !user) return;
    refreshSocialData();
  }, [configured, user?.id]);

  useEffect(() => {
    if (!configured || !user) return undefined;

    const pollRefresh = () => {
      if (document.visibilityState === "visible") refreshSocialData(true);
    };

    const interval = window.setInterval(pollRefresh, POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshSocialData(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    refreshRef.current = () => refreshSocialData(true);
    const handleSocialChange = () => refreshRef.current();

    window.addEventListener(SOCIAL_DATA_CHANGED_EVENT, handleSocialChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(SOCIAL_DATA_CHANGED_EVENT, handleSocialChange);
    };
  }, [configured, user?.id]);

  async function refreshSocialData(quiet = false) {
    if (!user) return;

    if (!quiet) {
      setLoadingSocial(true);
      setMessage(null);
    }

    // Creates the profile row if it is missing, and never rewrites an existing one.
    // This used to be the worst offender for a name reverting: it ran here on a
    // thirty second tick, so a rename could be undone while the page stayed open.
    await ensureMyProfile(user);

    // Suggestions are deliberately skipped on the quiet path. The 30 second tick
    // exists to notice a friend request arriving, and it costs four extra round trips
    // to rebuild a list whose worst outcome is being a minute out of date.
    const [friendsResult, suggestedResult] = await Promise.all([
      listFriendships(user.id),
      quiet ? Promise.resolve(null) : listSuggestedPeople(user.id)
    ]);

    if (friendsResult.error) {
      if (!quiet) {
        setMessage({ type: "error", text: friendsResult.error.message || "Could not load friends." });
      }
    } else {
      setFriendships(friendsResult.data || []);
    }

    // A suggestion whose profile the policy will not show is not an error worth
    // reporting. The section is optional, so a failure stays silent and leaves
    // whatever is already on screen alone.
    if (suggestedResult && !suggestedResult.error) {
      setSuggestions(suggestedResult.data || []);
    }

    if (!quiet) setLoadingSocial(false);
  }

  async function searchForFriends(event) {
    event.preventDefault();
    setMessage(null);

    if (!user) return;

    const { data, error } = await searchProfiles(query, user.id);
    if (error) {
      setMessage({ type: "error", text: error.message || "Could not search users." });
      return;
    }

    setSearchResults(data || []);
  }

  async function requestFriend(profile) {
    const { error } = await sendFriendRequest(user.id, profile.id);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not send friend request." });
      return;
    }

    setMessage({ type: "success", text: `Friend request sent to ${getProfileName(profile)}.` });
    setSearchResults([]);
    setQuery("");
    refreshSocialData();
  }

  async function requestSuggestion(profile) {
    if (!user || requestingId) return;

    setRequestingId(profile.id);
    const { error } = await sendFriendRequest(user.id, profile.id);
    setRequestingId("");

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not send friend request." });
      return;
    }

    setMessage({ type: "success", text: `Friend request sent to ${getProfileName(profile)}.` });
    // Dropped straight away rather than waiting for the list to come back, so the
    // card cannot be pressed twice. The friendship refresh that follows will also
    // filter it out, which is what stops it returning on the next tick.
    setSuggestions((current) => current.filter((suggestion) => suggestion.id !== profile.id));
    refreshSocialData();
  }

  async function acceptRequest(friendship) {
    const { error } = await acceptFriendRequest(friendship.id);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not accept request." });
      return;
    }

    setMessage({ type: "success", text: "Friend request accepted." });
    refreshSocialData();
  }

  async function confirmRemoveConnection() {
    if (!pendingRemove) return;

    const { error } = await removeFriendship(pendingRemove.id);
    setPendingRemove(null);

    if (error) {
      setMessage({ type: "error", text: error.message || "Could not remove connection." });
      return;
    }

    setMessage({ type: "success", text: "Connection removed." });
    refreshSocialData();
  }

  if (!configured) {
    return (
      <div className="page narrow">
        <EmptyState title="Cloud sync is not configured" message="Add Supabase settings before using friends and sharing." />
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
          title="Sign in to use friends"
          message="Friends and sharing need your Google account so shared reviewers know where to go."
          action={<Link className="button primary" to="/account">Go to Account</Link>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">Friends & Sharing</p>
          <h1>Study with friends</h1>
          <p className="muted">Find friends and share reviewers with them.</p>
        </div>
        <button className="button subtle" type="button" onClick={refreshSocialData} disabled={loadingSocial}>
          <Users size={17} aria-hidden="true" />
          {loadingSocial ? "Refreshing..." : "Refresh"}
        </button>
      </section>

      {message ? <p className={`sync-message ${message.type}`}>{message.text}</p> : null}

      <section className="friends-grid">
        <article className="library-panel">
          <div className="library-panel-head">
            <div>
              <h2>Find Friends</h2>
              <p className="muted">Search by email or display name.</p>
            </div>
          </div>
          <form className="friend-search-form" onSubmit={searchForFriends}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="friend@email.com" />
            <button className="button primary" type="submit">
              <Search size={17} aria-hidden="true" />
              Search
            </button>
          </form>
          <div className="library-list">
            {searchResults.map((profile) => (
              <article className="library-row" key={profile.id}>
                <div className="row-identity">
                  <UserAvatar profile={profile} />
                  <div>
                    <h3>{getProfileName(profile)}</h3>
                    <p className="muted">Search matched by name or address</p>
                  </div>
                </div>
                <button className="button subtle" type="button" onClick={() => requestFriend(profile)}>
                  <UserPlus size={17} aria-hidden="true" />
                  Add Friend
                </button>
              </article>
            ))}
          </div>
        </article>

        <article className="library-panel">
          <div className="library-panel-head">
            <div>
              <h2>Requests</h2>
              <p className="muted">Accept incoming requests or remove pending ones.</p>
            </div>
          </div>
          {incomingRequests.length || outgoingRequests.length ? (
            <div className="library-list">
              {incomingRequests.map((friendship) => (
                <article className="library-row" key={friendship.id}>
                  <div className="row-identity">
                    <UserAvatar profile={friendship.otherProfile} />
                    <div>
                      <h3>{getProfileName(friendship.otherProfile)}</h3>
                      <p className="muted">Incoming request</p>
                    </div>
                  </div>
                  <div className="button-row">
                    <button className="button primary" type="button" onClick={() => acceptRequest(friendship)}>
                      <Check size={17} aria-hidden="true" />
                      Accept
                    </button>
                    <button className="button subtle danger-text" type="button" onClick={() => setPendingRemove(friendship)}>
                      <Trash2 size={17} aria-hidden="true" />
                      Remove
                    </button>
                  </div>
                </article>
              ))}
              {outgoingRequests.map((friendship) => (
                <article className="library-row" key={friendship.id}>
                  <div className="row-identity">
                    <UserAvatar profile={friendship.otherProfile} />
                    <div>
                      <h3>{getProfileName(friendship.otherProfile)}</h3>
                      <p className="muted">Request sent</p>
                    </div>
                  </div>
                  <button className="button subtle danger-text" type="button" onClick={() => setPendingRemove(friendship)}>
                    <Trash2 size={17} aria-hidden="true" />
                    Cancel
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No friend requests" message="Search for a friend to send one." />
          )}
        </article>
      </section>

      <section className="library-panel">
        <div className="library-panel-head">
          <div>
            <h2>Friends</h2>
            <p className="muted">Accepted friends can receive reviewers from you.</p>
          </div>
        </div>
        {acceptedFriends.length ? (
          <>
            <form className="friend-search-form" onSubmit={(event) => event.preventDefault()}>
              <input value={friendQuery} onChange={(event) => setFriendQuery(event.target.value)} placeholder="Search friends by name" />
            </form>
            {filteredFriends.length ? (
              <div className="library-list">
                {filteredFriends.map((friendship) => (
                  <article className="library-row" key={friendship.id}>
                    <div className="row-identity">
                      <UserAvatar profile={friendship.otherProfile} />
                      <div>
                        <h3>{getProfileName(friendship.otherProfile)}</h3>
                        <p className="muted">Friends since {new Date(friendship.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <button className="button subtle danger-text" type="button" onClick={() => setPendingRemove(friendship)}>
                      <Trash2 size={17} aria-hidden="true" />
                      Remove Friend
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No friends match" message="Try a different name or email." />
            )}
          </>
        ) : (
          <EmptyState title="No friends yet" message="Accept a request or search for a friend to start sharing." />
        )}
      </section>

      {/* Hidden entirely when there is nobody to suggest. An always-present panel
          with an empty state trains people to scroll past it, and for someone in no
          groups it would never be anything but empty. */}
      {visibleSuggestions.length ? (
        <section className="library-panel">
          <div className="library-panel-head">
            <div className="suggestion-head">
              <span className="suggestion-head-icon" aria-hidden="true">
                <Users size={18} />
              </span>
              <div>
                <h2>People you may know</h2>
                <p className="muted">Classmates you share a group, a mutual friend, or a reviewer with.</p>
              </div>
            </div>
          </div>
          <div className="suggestion-grid">
            {visibleSuggestions.map((suggestion) => (
              <article className="suggestion-card" key={suggestion.id}>
                <UserAvatar profile={suggestion} size="cover" />
                <div className="suggestion-body">
                  <strong>{getProfileName(suggestion)}</strong>
                  <span className="muted">{getSuggestionReason(suggestion)}</span>
                  <button
                    className="button primary"
                    type="button"
                    onClick={() => requestSuggestion(suggestion)}
                    disabled={Boolean(requestingId)}
                  >
                    <UserPlus size={15} aria-hidden="true" />
                    {requestingId === suggestion.id ? "Sending..." : "Add Friend"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <ConfirmModal
        open={Boolean(pendingRemove)}
        title="Remove this connection?"
        message={pendingRemove ? `Remove ${getProfileName(pendingRemove.otherProfile)} from your friends?` : ""}
        confirmLabel="Remove"
        danger
        onCancel={() => setPendingRemove(null)}
        onConfirm={confirmRemoveConnection}
      />
    </div>
  );
}
