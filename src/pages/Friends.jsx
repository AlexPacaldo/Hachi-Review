import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Search, Trash2, UserPlus, Users } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import {
  acceptFriendRequest,
  ensureMyProfile,
  listFriendships,
  removeFriendship,
  searchProfiles,
  sendFriendRequest
} from "../services/social.js";
import { SOCIAL_DATA_CHANGED_EVENT } from "../utils/storageUtils.js";

const POLL_INTERVAL_MS = 30000;

function getProfileName(profile) {
  return profile?.display_name || "Hachi user";
}

export default function Friends() {
  const { configured, loading, user } = useAuth();
  const [query, setQuery] = useState("");
  const [friendQuery, setFriendQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [friendships, setFriendships] = useState([]);
  const [message, setMessage] = useState(null);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [loadingSocial, setLoadingSocial] = useState(false);
  const refreshRef = useRef(() => {});

  const acceptedFriends = friendships.filter((friendship) => friendship.status === "accepted");
  const incomingRequests = friendships.filter((friendship) => friendship.status === "pending" && friendship.addressee_id === user?.id);
  const outgoingRequests = friendships.filter((friendship) => friendship.status === "pending" && friendship.requester_id === user?.id);

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

    await ensureMyProfile(user);

    const friendsResult = await listFriendships(user.id);

    if (friendsResult.error) {
      if (!quiet) {
        setMessage({ type: "error", text: friendsResult.error.message || "Could not load friends." });
      }
    } else {
      setFriendships(friendsResult.data || []);
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
                <div>
                  <h3>{getProfileName(profile)}</h3>
                  <p className="muted">Search matched by name or address</p>
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
                  <div>
                    <h3>{getProfileName(friendship.otherProfile)}</h3>
                    <p className="muted">Incoming request</p>
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
                  <div>
                    <h3>{getProfileName(friendship.otherProfile)}</h3>
                    <p className="muted">Request sent</p>
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
                    <div>
                      <h3>{getProfileName(friendship.otherProfile)}</h3>
                      <p className="muted">Friends since {new Date(friendship.created_at).toLocaleDateString()}</p>
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
