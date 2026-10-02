import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { describeReviewer, getReviewerById, isReviewerSummary } from "../data/reviewerRegistry.js";
import { getCloudReviewerById } from "../services/cloudReviewers.js";
import { cacheCloudReviewer } from "../utils/storageUtils.js";

// Reviewers are listed as summaries now, so a card can be drawn from the list
// but the questions are only fetched when a reviewer is actually opened. The
// fetch is cached on the way through, so a second visit, and any later visit
// while offline, finds the reviewer already complete.
export function useReviewer(reviewerId, refreshKey = 0) {
  const { user } = useAuth();
  const cached = useMemo(() => getReviewerById(reviewerId), [reviewerId, refreshKey]);

  const [loaded, setLoaded] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const summary = isReviewerSummary(cached) ? cached : null;
  const summaryId = summary?.reviewerId;
  const summaryOwner = summary?.ownerId;
  const userId = user?.id;

  useEffect(() => {
    // Signed out, or already held in full, so there is nothing to fetch.
    if (!summaryId || !userId) return undefined;

    let active = true;
    setIsLoading(true);
    setLoadError(null);

    getCloudReviewerById(summaryId, summaryOwner)
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
        setLoaded(getReviewerById(summaryId) || describeReviewer(data, "cloud", "cloud"));
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
  }, [summaryId, summaryOwner, userId, attempt]);

  // A reviewer id can change between renders when the route changes, so a fetch
  // that finished for a different reviewer is not carried over.
  const reviewer = loaded?.reviewerId === reviewerId ? loaded : cached;

  return {
    reviewer: reviewer || null,
    hasQuestions: Array.isArray(reviewer?.questions),
    isSummary: Boolean(summary),
    isLoading: isLoading && Boolean(reviewer),
    loadError,
    reload
  };
}