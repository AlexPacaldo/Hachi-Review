import { validateReviewer } from "../../data/reviewerRegistry.js";
import { upsertCloudReviewer } from "../../services/cloudReviewers.js";
import { getCloudReviewerCache, saveCloudReviewerCache, saveLocalReviewer } from "../../utils/storageUtils.js";

// The request and save plumbing both generator modes share. It is here rather than
// in either mode because a mistake in it has to be made once: the sign-in gate, the
// courtesy limiter, and the save path are the three places where the two modes would
// otherwise diverge and only one of them would be correct.

// Generation needs an account. The provider keys are on free tiers, so letting
// anonymous callers in risks the daily quota rather than a bill, and a per-address
// cap cannot stop that because an address is not an identity. Checked here so the
// person gets told why instead of reading a 401 out of the network tab.
export function getSignInError({ configured, session }) {
  if (!configured) {
    return "AI generation needs Supabase configured on this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
  }

  if (!session?.access_token) {
    return "Sign in to generate a reviewer with AI. Saving and taking a quiz still work without an account.";
  }

  return null;
}

function getRequestHeaders(session) {
  return {
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
  };
}

export async function postGenerationRequest({ session, body, fallbackMessage }) {
  const response = await fetch("/api/generate-reviewer", {
    method: "POST",
    headers: getRequestHeaders(session),
    body: JSON.stringify(body)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data?.error || fallbackMessage || "The AI could not generate a reviewer.";
    // The request id goes back to the person because it is the only handle that ties
    // what they see to what the server logged.
    throw new Error(data?.requestId ? `${message} Request ID: ${data.requestId}` : message);
  }

  return data;
}

export async function persistReviewer({ configured, user, reviewer, saveOffline }) {
  if (configured && user) {
    const { error } = await upsertCloudReviewer(user.id, reviewer);

    if (error) {
      throw new Error(`Cloud save failed: ${error.message || "Unknown error"}`);
    }

    const cachedReviewers = getCloudReviewerCache().filter((item) => item.reviewerId !== reviewer.reviewerId);
    saveCloudReviewerCache([reviewer, ...cachedReviewers]);

    if (saveOffline) {
      saveLocalReviewer(reviewer);
      return "cloud-and-offline";
    }

    return "cloud";
  }

  saveLocalReviewer(reviewer);
  return "offline";
}

export function getSaveMessage(saveMode) {
  if (saveMode === "cloud-and-offline") return "Reviewer saved to cloud and this device.";
  if (saveMode === "cloud") return "Reviewer saved to cloud.";
  return "Reviewer saved offline on this device.";
}

// Checked against the app's own reviewer shape before anything is saved. Run after
// normalising and before persisting: normalising afterwards would let a required
// field pass the check and then be dropped, and persisting first would put an
// unusable reviewer into the account.
export function assertValidReviewer(reviewer, message) {
  const validation = validateReviewer(reviewer);

  if (!validation.isValid) {
    throw new Error(validation.errors[0] || message || "The AI generated an invalid reviewer.");
  }

  return reviewer;
}