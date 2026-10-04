import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { describeReviewer, getReviewerById, isReviewerSummary } from "../data/reviewerRegistry.js";
import { getCloudReviewerById } from "../services/cloudReviewers.js";
import { cacheCloudReviewer } from "../utils/storageUtils.js";

// Reviewers are listed as summaries now, so a card can be drawn from the list
// but the questions are only fetched when a reviewer is actually opened. The
// fetch is cached on the way through, so a second visit, and any later visit
// while offline, finds the reviewer already complete.
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
  const summaryOwner = summary?.ownerId;
  const userId = user?.id;

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
    if (cached && !isReviewerSummary(cached)) return undefined;

    let active = true;
    setIsLoading(true);
    setLoadError(null);

    getCloudReviewerById(reviewerId, summaryOwner)
      .then(({ data, error }) => {
        if (!active) return;

        if (error || !data) {
          setLoadError(error?.message || "This reviewer could not be loaded.");
          setIsLoading(false);
          return;
        }

        cacheCloudReviewer(data);
        // Read back through the registry instead of using the fetched row. A row
        // straight off the cloud has no source, storageStatus or validation on
        // it, and pages read all three, so passing it through untouched threw on
        // the first render of any reviewer this device had not opened yet and
        // left the page blank until it was reloaded. Going back through the
        // registry also keeps the merged local-plus-cloud case deciding its
        // validity the same way it does on every later visit.
        setLoaded(getReviewerById(reviewerId) || describeReviewer(data, "cloud", "cloud"));
        setIsLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoadError("This reviewer could not be loaded.");
        setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reviewerId, summaryOwner, userId, attempt]);

  // A reviewer id can change between renders when the route changes, so a fetch
  // that finished for a different reviewer is not carried over.
  const reviewer = loaded?.reviewerId === reviewerId ? loaded : cached;

  // Nothing to show and no settled verdict yet. Derived rather than read off the
  // fetch flag so the very first render of a cold load already reports it: the
  // request has not started at that point, and an unspinnered empty state would
  // flash "does not exist" before it did.
  const isResolving = isLoading || (!reviewer && !loadError && Boolean(userId) && Boolean(reviewerId));

  return {
    reviewer: reviewer || null,
    hasQuestions: Array.isArray(reviewer?.questions),
    isSummary: Boolean(summary),
    isResolving,
    loadError,
    reload
  };
}