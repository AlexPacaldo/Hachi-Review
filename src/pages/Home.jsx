import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { BookOpen, Flame, PawPrint, Target } from "lucide-react";
import ReviewerCard from "../components/ReviewerCard.jsx";
import ReviewerSearch from "../components/ReviewerSearch.jsx";
import EmptyState from "../components/EmptyState.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import hachiDogExcited from "../assets/hachi-dog-excited.png";
import { useAuth } from "../contexts/AuthContext.jsx";
import { getAllReviewers } from "../data/reviewerRegistry.js";
import { listVisibleCloudReviewers } from "../services/cloudReviewers.js";
import { clearCloudReviewerCache, deleteLocalReviewer, getAllProgress, getAttemptHistory, REVIEWER_DATA_CHANGED_EVENT, saveCloudReviewerCache } from "../utils/storageUtils.js";

const WEEK_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function toLocalDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getStudySnapshot(allAttempts) {
  const studiedDays = new Set();
  allAttempts.forEach((attempt) => {
    if (attempt.date) studiedDays.add(toLocalDateKey(new Date(attempt.date)));
  });

  let streakDays = 0;
  const cursor = new Date();
  if (!studiedDays.has(toLocalDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (studiedDays.has(toLocalDateKey(cursor))) {
    streakDays += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  const today = new Date();
  const mondayOffset = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset);
  const week = WEEK_LABELS.map((label, index) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    return { label, studied: studiedDays.has(toLocalDateKey(day)) };
  });

  return { streakDays, week };
}

export default function Home() {
  const { configured, loading, user } = useAuth();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [reviewerList, setReviewerList] = useState(getAllReviewers);
  const [pendingRemove, setPendingRemove] = useState(null);
  const [cloudLoadMessage, setCloudLoadMessage] = useState("");
  const progress = getAllProgress();
  const allAttempts = getAttemptHistory();
  const recentAttempts = allAttempts.slice(0, 5);
  const { streakDays, week } = useMemo(() => getStudySnapshot(allAttempts), [allAttempts]);
  const streakNote = streakDays === 0 ? "Start a streak today!" : streakDays < 3 ? "Keep it going!" : "You're on a roll!";
  const completedReviewerIds = useMemo(() => new Set(allAttempts.map((attempt) => attempt.reviewerId).filter(Boolean)), [allAttempts]);

  useEffect(() => {
    let isMounted = true;

    async function loadSignedInReviewers() {
      if (loading) return;

      if (!configured || !user) {
        clearCloudReviewerCache();
        setReviewerList(getAllReviewers());
        setCloudLoadMessage("");
        return;
      }

      const { data, error } = await listVisibleCloudReviewers(user.id);

      if (!isMounted) return;

      if (error) {
        setCloudLoadMessage(error.message || "Could not refresh reviewers.");
        setReviewerList(getAllReviewers());
        return;
      }

      setCloudLoadMessage("");
      const cachedReviewers = (data || []).map((item) => {
        const reviewerData = item.data || item;
        return {
          ...reviewerData,
          ownerId: item.owner_id,
          ...(item.ownerName ? { ownerName: item.ownerName } : {}),
          visibility: item.visibility || reviewerData.visibility || "friends",
          sharedWith: Array.isArray(item.shared_with) ? item.shared_with : reviewerData.sharedWith || null,
          sharedGroups: Array.isArray(item.shared_groups) ? item.shared_groups : reviewerData.sharedGroups || null
        };
      });
      saveCloudReviewerCache(cachedReviewers);
      setReviewerList(getAllReviewers());
    }

    loadSignedInReviewers();

    return () => {
      isMounted = false;
    };
  }, [configured, loading, user?.id]);

  useEffect(() => {
    const refreshReviewers = () => setReviewerList(getAllReviewers());

    window.addEventListener(REVIEWER_DATA_CHANGED_EVENT, refreshReviewers);
    window.addEventListener("storage", refreshReviewers);
    return () => {
      window.removeEventListener(REVIEWER_DATA_CHANGED_EVENT, refreshReviewers);
      window.removeEventListener("storage", refreshReviewers);
    };
  }, []);

  const filteredReviewers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return reviewerList;

    const myName = user?.user_metadata?.display_name || user?.email?.split("@")[0] || "";

    return reviewerList.filter((reviewer) => {
      const haystack = [
        reviewer.title,
        reviewer.subject,
        reviewer.reviewerId,
        reviewer.ownerName || (user ? myName : ""),
        ...(reviewer.coverage || [])
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [reviewerList, search, user?.id]);

  const isSharedReviewer = useMemo(() => (reviewer) => {
    if (!user) return false;
    if (reviewer.ownerId) return reviewer.ownerId !== user.id;
    return Boolean(reviewer.ownerName);
  }, [user]);

  const ownReviewers = useMemo(() => filteredReviewers.filter((reviewer) => !isSharedReviewer(reviewer)), [filteredReviewers, isSharedReviewer]);
  const friendsReviewers = useMemo(() => filteredReviewers.filter((reviewer) => isSharedReviewer(reviewer)), [filteredReviewers, isSharedReviewer]);

  const renderReviewerGrid = (reviewers) => (
    <div className="reviewer-grid">
      {reviewers.map((reviewer) =>
        reviewer.validation.isValid ? (
          <ReviewerCard
            key={`${reviewer.source}-${reviewer.reviewerId}`}
            reviewer={reviewer}
            progress={progress[reviewer.reviewerId]}
            hasCompleted={completedReviewerIds.has(reviewer.reviewerId)}
            onDelete={requestRemoveLocal}
          />
        ) : (
          <article className="reviewer-card error-card" key={reviewer.reviewerId || reviewer.title}>
            <h3>Unable to load this reviewer.</h3>
            <p>{reviewer.title || "Untitled reviewer"}</p>
            <p className="muted">{reviewer.validation.errors[0]}</p>
          </article>
        )
      )}
    </div>
  );

  const hasSearch = search.trim().length > 0;
  const emptyState = hasSearch
    ? { title: "No reviewers found", message: "Try another search term." }
    : sourceFilter === "friends"
      ? { title: "No friends reviewers yet", message: "Reviewers your friends share with you will appear here." }
      : sourceFilter === "mine"
        ? { title: "No reviewers here", message: "Add or sync a reviewer from Library to see it here." }
        : { title: "No reviewers yet", message: "Explore Library to save reviewers for your study sessions." };

  function requestRemoveLocal(reviewer) {
    setPendingRemove(reviewer);
  }

  function confirmRemoveLocal() {
    if (!pendingRemove) return;
    deleteLocalReviewer(pendingRemove.reviewerId);
    setPendingRemove(null);
    setReviewerList(getAllReviewers());
  }

  return (
    <div className="page home-page">
      <section className="hero home-hero">
        <div className="hero-paws" aria-hidden="true">
          <PawPrint className="hero-paw paw-a" size={26} />
          <PawPrint className="hero-paw paw-b" size={18} />
          <PawPrint className="hero-paw paw-c" size={22} />
          <PawPrint className="hero-paw paw-d" size={14} />
          <PawPrint className="hero-paw paw-e" size={20} />
          <PawPrint className="hero-paw paw-f" size={15} />
          <PawPrint className="hero-paw paw-g" size={24} />
          <PawPrint className="hero-paw paw-h" size={16} />
          <PawPrint className="hero-paw paw-i" size={19} />
          <PawPrint className="hero-paw paw-j" size={13} />
          <PawPrint className="hero-paw paw-k" size={17} />
          <PawPrint className="hero-paw paw-l" size={21} />
          <PawPrint className="hero-paw paw-m" size={12} />
          <PawPrint className="hero-paw paw-n" size={16} />
          <PawPrint className="hero-paw paw-o" size={18} />
          <PawPrint className="hero-paw paw-p" size={15} />
        </div>
        <div className="home-hero-main">
          <div className="home-hero-copy">
            <p className="eyebrow">Welcome back!</p>
            <h1>Hachi</h1>
            <p className="home-hero-tagline">Your study companion.</p>
            <p className="home-hero-subcopy">Study smarter, go further. Create, explore, and master reviewers with Hachi by your side.</p>
          </div>

          <div className="home-hero-dog" aria-hidden="true">
            <span className="hero-note">You can do it!</span>
            <img src={hachiDogExcited} alt="" />
          </div>
        </div>

        <div className="home-hero-stats" aria-label="Study snapshot">
          <article className="hero-stat streak">
            <div className="hero-stat-head">
              <span className="hero-stat-icon"><Flame size={24} aria-hidden="true" /></span>
              <span className="hero-stat-text">
                <small>Study Streak</small>
                <strong>{streakDays} {streakDays === 1 ? "day" : "days"}</strong>
                <em>{streakNote}</em>
              </span>
            </div>
            <div className="streak-week" aria-hidden="true">
              {week.map((day, index) => (
                <span className={day.studied ? "filled" : ""} key={`${day.label}-${index}`}>{day.label}</span>
              ))}
              <PawPrint size={20} />
            </div>
          </article>
          <article className="hero-stat reviewers">
            <div className="hero-stat-head">
              <span className="hero-stat-icon"><BookOpen size={24} aria-hidden="true" /></span>
              <span className="hero-stat-text">
                <small>Total Reviewers</small>
                <strong>{reviewerList.length}</strong>
                <em>Keep learning!</em>
              </span>
            </div>
          </article>
          <article className="hero-stat answered">
            <div className="hero-stat-head">
              <span className="hero-stat-icon"><Target size={25} aria-hidden="true" /></span>
              <span className="hero-stat-text">
                <small>Reviewers Reviewed</small>
                <strong>{completedReviewerIds.size}</strong>
                <em>Great progress!</em>
              </span>
            </div>
          </article>
        </div>
      </section>

      <section className="section-heading" id="reviewers">
        <div>
          <h2>Choose a Reviewer</h2>
          <p className="muted">Search by subject, title, course code, coverage topic, or creator.</p>
        </div>
        <ReviewerSearch value={search} onChange={setSearch} />
      </section>

      {user ? (
        <div className="filter-pills" role="tablist" aria-label="Filter reviewers">
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === "all"}
            className={sourceFilter === "all" ? "active" : ""}
            onClick={() => setSourceFilter("all")}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === "mine"}
            className={sourceFilter === "mine" ? "active" : ""}
            onClick={() => setSourceFilter("mine")}
          >
            Mine
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sourceFilter === "friends"}
            className={sourceFilter === "friends" ? "active" : ""}
            onClick={() => setSourceFilter("friends")}
          >
            Friends
          </button>
        </div>
      ) : null}

      {sourceFilter === "all" && user ? (
        <>
          {ownReviewers.length ? (
            <section className="reviewer-group">
              <div className="reviewer-group-head">
                <h3>Your Reviewers</h3>
                <span className="muted">{ownReviewers.length}</span>
              </div>
              {renderReviewerGrid(ownReviewers)}
            </section>
          ) : null}

          {friendsReviewers.length ? (
            <section className="reviewer-group">
              <div className="reviewer-group-head">
                <h3>Shared with You</h3>
                <span className="muted">{friendsReviewers.length}</span>
              </div>
              {renderReviewerGrid(friendsReviewers)}
            </section>
          ) : null}

          {!ownReviewers.length && !friendsReviewers.length ? (
            <EmptyState title={emptyState.title} message={emptyState.message} />
          ) : null}
        </>
      ) : (
        <>
          {renderReviewerGrid(sourceFilter === "friends" && user ? friendsReviewers : ownReviewers)}
          {(sourceFilter === "friends" && user ? friendsReviewers : ownReviewers).length ? null : (
            <EmptyState title={emptyState.title} message={emptyState.message} />
          )}
        </>
      )}
      {cloudLoadMessage ? <p className="sync-message error">{cloudLoadMessage}</p> : null}

      <section className="recent-section">
        <div className="section-heading compact">
          <div>
            <h2>Recent Attempts</h2>
            <p className="muted">Your latest completed quizzes are stored in this browser.</p>
          </div>
          <Link className="button subtle" to="/history">
            View History
          </Link>
        </div>

        {recentAttempts.length ? (
          <div className="attempt-list">
            {recentAttempts.map((attempt) => (
              <Link className="attempt-row" to={`/results/${attempt.reviewerId}?attempt=${attempt.attemptId}`} key={attempt.attemptId}>
                <span>
                  <strong>{attempt.reviewerTitle}</strong>
                  <small>{new Date(attempt.date).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</small>
                </span>
                <span>{attempt.score} / {attempt.totalQuestions}</span>
                <span>{attempt.percentage}%</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No attempts yet" message="Complete a quiz and your score will appear here." />
        )}
      </section>

      <ConfirmModal
        open={Boolean(pendingRemove)}
        title="Remove from this device?"
        message={pendingRemove ? `Remove "${pendingRemove.title}" from this device? Your saved answers for it will also be cleared.` : ""}
        confirmLabel="Remove"
        danger
        onCancel={() => setPendingRemove(null)}
        onConfirm={confirmRemoveLocal}
      />
    </div>
  );
}
