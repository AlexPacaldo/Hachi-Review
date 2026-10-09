import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { describeReviewer, getReviewerById, isReviewerSummary } from "../data/reviewerRegistry.js";
import { getCloudReviewerById } from "../services/cloudReviewers.js";

// Reviewers are listed as summaries now, so a card can be drawn from the list
// but the questions are only fetched when a reviewer is actually opened. The
// fetch is deliberately not persisted: opening a reviewer is not an explicit
// save, so its questions stay in memory for the session only. Saving to this
// device happens through saveLocalReviewer when the user asks for it.
//
// The list is not required, though. It is a cache, and on a cold load of a
// reviewer url there is nothing in it yet, so the id in the url is what the
// fetch is made from.
export function useReviewer(reviewerId, refreshKey = 0) {
  const { user } = useAuth();
  const cached = useMemo(() => getReviewerById(reviewerId), [reviewerId, refreshKey]);

  const [loaded, setLoaded] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const summary = isReviewerSummary(cached) ? cached : null;
  const summaryOwner = summary?.ownerId || cached?.ownerId;
  const userId = user?.id;

  // Someone else's reviewer is never authoritative on this device. Its owner can
  // correct an answer key from their own account at any time, and nothing about
  // opening it here is a signal that this copy is current, so it is refetched.
  // A reviewer's own copy is the other way round: it was just edited here, and
  // refetching it would race the write that made the edit.
  const isForeignReviewer = Boolean(cached?.ownerId && cached.ownerId !== userId);
  const hasUsableCache = Boolean(cached) && !isReviewerSummary(cached);

  useEffect(() => {
    // Signed out, so the only thing this device could have is what it already
    // has, and there is no account to fetch from.
    if (!userId || !reviewerId) return undefined;

    // A local copy is already complete, so there is nothing to ask for. Anything
    // else has to be fetched: a summary has no questions yet, and no cached entry
    // at all is the case this used to get wrong. The list that normally fills the
    // cache on the way to a reviewer has not run yet on a cold load, so the memo
    // above is empty, and reading the id straight out of the url is the only way
    // to find the row. Without this a reload of /reviewer/:id reported that the
    // reviewer does not exist and never tried again, because the early return
    // below left nothing to retry with.
    if (hasUsableCache && !isForeignReviewer) return undefined;

    let active = true;
    // Only a spinner when there is nothing to read in the meantime. Reopening a
    // shared reviewer offline has to keep working off the cached copy, so this
    // cannot blank the page every time the refetch cannot reach the cloud.
    setIsLoading(!hasUsableCache);
    setLoadError(null);

    getCloudReviewerById(reviewerId, summaryOwner)
      .then(({ data, error }) => {
        if (!active) return;

        if (error || !data) {
          // A cached copy still grades, so a failed refresh of one is not an
          // error. Reporting it would replace a working offline reviewer with an
          // empty state over a network that did not answer.
          if (hasUsableCache) {
            setIsLoading(false);
            return;
          }

          setLoadError(error?.message || "This reviewer could not be loaded.");
          setIsLoading(false);
          return;
        }

        // Read straight through the registry rather than persisting the row. A
        // row off the cloud has no source, storageStatus or validation on it,
        // and pages read all three. Persisting here would be an auto save to
        // device storage, so the fetched reviewer lives in state only.
        setLoaded(describeReviewer(data, "cloud", "cloud"));
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        if (hasUsableCache) {
          setIsLoading(false);
          return;
        }
        setLoadError("This reviewer could not be loaded.");
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reviewerId, summaryOwner, userId, attempt, hasUsableCache, isForeignReviewer]);

  // A reviewer id can change between renders when the route changes, so a fetch
  // that finished for a different reviewer is not carried over.
  const reviewer = loaded?.reviewerId === reviewerId ? loaded : cached;

  // Nothing to show and no settled verdict yet. Derived rather than read off the
  // fetch flag so the very first render of a cold load already reports it: the
  // request has not started at that point, and an unspinnered empty state would
  // flash "does not exist" before it did.
  const isResolving = !reviewer && (isLoading || (!loadError && Boolean(userId) && Boolean(reviewerId)));

  return {
    reviewer: reviewer || null,
    hasQuestions: Array.isArray(reviewer?.questions),
    isSummary: Boolean(summary),
    isResolving,
    loadError,
    reload
  };
}