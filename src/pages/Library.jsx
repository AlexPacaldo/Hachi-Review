import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Cloud, Download, Pencil, RefreshCw, Trash2, Upload } from "lucide-react";
import ConfirmModal from "../components/ConfirmModal.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { deleteCloudReviewer, listVisibleCloudReviewers, upsertCloudReviewer } from "../services/cloudReviewers.js";
import {
  clearAllQuizProgress,
  clearAttemptHistory,
  clearGeneratorDraft,
  clearLocalReviewers,
  clearSyncQueue,
  deleteLocalReviewer,
  getCloudReviewerCache,
  getAllProgress,
  getAttemptHistory,
  getGeneratorDraft,
  getLocalDataSnapshot,
  getLocalReviewers,
  getSyncQueue,
  queueReviewerForCloudSync,
  REVIEWER_DATA_CHANGED_EVENT,
  restoreLocalDataSnapshot,
  saveCloudReviewerCache,
  saveLocalReviewer,
  SOCIAL_DATA_CHANGED_EVENT
} from "../utils/storageUtils.js";
import { logClientError } from "../utils/errorLogger.js";
import { flushSyncQueue, pushClearedHistoryToCloud, pushClearedProgressToCloud, pushRemovedProgressToCloud } from "../services/syncEngine.js";

const MAX_BACKUP_RESTORE_SIZE = 8 * 1024 * 1024;
const CLOUD_POLL_INTERVAL_MS = 60000;

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function ReviewerStatusBadge({ status }) {
  const labels = {
    cloud: "Cloud only",
    local: "Offline only",
    both: "Cloud + offline"
  };
  const label = labels[status];

  if (!label) return null;

  return <span className={`reviewer-source-badge ${status}`}>{label}</span>;
}

export default function Library() {
  const { configured, user } = useAuth();
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [localReviewers, setLocalReviewers] = useState(getLocalReviewers);
  const [progress, setProgress] = useState(getAllProgress);
  const [history, setHistory] = useState(getAttemptHistory);
  const [generatorDraft, setGeneratorDraft] = useState(getGeneratorDraft);
  const [confirmAction, setConfirmAction] = useState(null);
  const [backupMessage, setBackupMessage] = useState(null);
  const [syncStatus, setSyncStatus] = useState({});
  const [cloudReviewers, setCloudReviewers] = useState([]);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudMessage, setCloudMessage] = useState(null);
  const [syncAllLoading, setSyncAllLoading] = useState(false);
  const [offlineSaveStatus, setOfflineSaveStatus] = useState({});
  const [syncQueue, setSyncQueue] = useState(() => getSyncQueue(user?.id));
  const [storageInfo, setStorageInfo] = useState({
    supported: false,
    persisted: false,
    usage: null,
    quota: null
  });

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    refreshStorageInfo();
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    const handleReviewerDataChange = () => refreshLocalData();

    window.addEventListener(REVIEWER_DATA_CHANGED_EVENT, handleReviewerDataChange);
    return () => window.removeEventListener(REVIEWER_DATA_CHANGED_EVENT, handleReviewerDataChange);
  }, [user?.id]);

  useEffect(() => {
    if (!isOnline || !configured || !user || !syncQueue.length) return;
    processSyncQueue();
  }, [isOnline, configured, user?.id, syncQueue.length]);

  useEffect(() => {
    loadCloudReviewers();
  }, [configured, user?.id]);

  useEffect(() => {
    if (!configured || !user) return undefined;

    const pollRefresh = () => {
      if (document.visibilityState === "visible") loadCloudReviewers(true);
    };

    const interval = window.setInterval(pollRefresh, CLOUD_POLL_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") loadCloudReviewers(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const handleSocialChange = () => {
      if (document.visibilityState === "visible") loadCloudReviewers(true);
    };
    window.addEventListener(SOCIAL_DATA_CHANGED_EVENT, handleSocialChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(SOCIAL_DATA_CHANGED_EVENT, handleSocialChange);
    };
  }, [configured, user?.id]);

  const cloudReviewerIds = useMemo(() => {
    return new Set(cloudReviewers.map((item) => {
      const reviewer = getCloudReviewerData(item);
      return reviewer?.reviewerId || item?.reviewer_id;
    }).filter(Boolean));
  }, [cloudReviewers]);

  const unsyncedLocalReviewers = useMemo(() => {
    if (!user) return [];
    return localReviewers.filter((reviewer) => !cloudReviewerIds.has(reviewer.reviewerId));
  }, [cloudReviewerIds, localReviewers, user]);

  function refreshLocalData() {
    setLocalReviewers(getLocalReviewers());
    setProgress(getAllProgress());
    setHistory(getAttemptHistory());
    setGeneratorDraft(getGeneratorDraft());
    setSyncQueue(getSyncQueue(user?.id));
  }

  async function refreshStorageInfo() {
    if (!navigator.storage) {
      setStorageInfo({ supported: false, persisted: false, usage: null, quota: null });
      return;
    }

    const [persisted, estimate] = await Promise.all([
      navigator.storage.persisted ? navigator.storage.persisted() : false,
      navigator.storage.estimate ? navigator.storage.estimate() : {}
    ]);

    setStorageInfo({
      supported: true,
      persisted,
      usage: estimate.usage || null,
      quota: estimate.quota || null
    });
  }

  async function requestPersistentStorage() {
    if (!navigator.storage?.persist) {
      setBackupMessage({ type: "warning", text: "Your browser doesn't let apps ask for this protection." });
      return;
    }

    const persisted = await navigator.storage.persist();
    await refreshStorageInfo();
    setBackupMessage(persisted
      ? { type: "success", text: "Your reviews are now safe from automatic cleanup." }
      : { type: "warning", text: "Your browser didn't grant protection yet. You can try again later." });
  }

  async function loadCloudReviewers(quiet = false) {
    if (!configured || !user) {
      setCloudReviewers([]);
      setCloudMessage(null);
      return;
    }

    if (!quiet) {
      setCloudLoading(true);
      setCloudMessage(null);
    }
    const { data, error } = await listVisibleCloudReviewers(user.id);
    if (!quiet) setCloudLoading(false);

    if (error) {
      if (!quiet) {
        setCloudMessage({ type: "error", message: error.message || "Could not load cloud reviewers." });
      }
      return;
    }

    const ownItems = (data || []).filter((item) => item.owner_id === user.id);
    setCloudReviewers(ownItems);
    saveCloudReviewerCache((data || []).map((item) => {
      const reviewerData = item.data || item;
      return {
        ...reviewerData,
        ownerId: item.owner_id,
        ...(item.ownerName ? { ownerName: item.ownerName } : {}),
        visibility: item.visibility || reviewerData.visibility || "friends",
        sharedWith: Array.isArray(item.shared_with) ? item.shared_with : reviewerData.sharedWith || null
      };
    }));
  }

  function getCloudReviewerData(item) {
    return item?.data || item;
  }

  function getCloudReviewerKey(item) {
    return item?.id || item?.reviewer_id || getCloudReviewerData(item)?.reviewerId;
  }

  function isReviewerSavedOffline(reviewerId) {
    return localReviewers.some((reviewer) => reviewer.reviewerId === reviewerId);
  }

  function saveCloudReviewerOffline(item) {
    const reviewer = getCloudReviewerData(item);
    const key = getCloudReviewerKey(item);

    if (!reviewer?.reviewerId) {
      setOfflineSaveStatus((current) => ({
        ...current,
        [key]: { type: "error", message: "This cloud reviewer is missing a reviewer ID." }
      }));
      return;
    }

    saveLocalReviewer(reviewer);
    refreshLocalData();
    setOfflineSaveStatus((current) => ({
      ...current,
      [key]: { type: "success", message: "Saved offline on this device." }
    }));
  }

  function getRenamedReviewer(reviewer) {
    const nextTitle = window.prompt("Reviewer title", reviewer.title || "");
    if (nextTitle === null) return null;

    const trimmedTitle = nextTitle.trim();
    if (!trimmedTitle) {
      setCloudMessage({ type: "error", message: "Reviewer title cannot be empty." });
      return null;
    }

    const nextSubject = window.prompt("Subject", reviewer.subject || "");
    if (nextSubject === null) return null;

    const trimmedSubject = nextSubject.trim();
    if (!trimmedSubject) {
      setCloudMessage({ type: "error", message: "Subject cannot be empty." });
      return null;
    }

    if (trimmedTitle === reviewer.title && trimmedSubject === reviewer.subject) {
      return null;
    }

    return {
      ...reviewer,
      title: trimmedTitle,
      subject: trimmedSubject
    };
  }

  async function renameReviewerEverywhere(reviewer) {
    if (!reviewer?.reviewerId) {
      setCloudMessage({ type: "error", message: "This reviewer is missing a reviewer ID." });
      return;
    }

    const renamedReviewer = getRenamedReviewer(reviewer);
    if (!renamedReviewer) return;

    const hasOfflineCopy = isReviewerSavedOffline(reviewer.reviewerId);
    const hasCloudCopy = cloudReviewerIds.has(reviewer.reviewerId);

    if (hasCloudCopy) {
      if (!user) {
        setCloudMessage({ type: "error", message: "Sign in to rename the cloud copy." });
        return;
      }

      const { error } = await upsertCloudReviewer(user.id, renamedReviewer);

      if (error) {
        setCloudMessage({ type: "error", message: error.message || "Could not rename cloud reviewer." });
        return;
      }

      setCloudReviewers((current) => current.map((item) => {
        const itemReviewer = getCloudReviewerData(item);
        const itemReviewerId = itemReviewer?.reviewerId || item?.reviewer_id;

        if (itemReviewerId !== renamedReviewer.reviewerId) return item;

        return {
          ...item,
          title: renamedReviewer.title,
          subject: renamedReviewer.subject,
          data: renamedReviewer
        };
      }));
      saveCloudReviewerCache([
        renamedReviewer,
        ...getCloudReviewerCache().filter((item) => item.reviewerId !== renamedReviewer.reviewerId)
      ]);
    }

    if (hasOfflineCopy) {
      saveLocalReviewer(renamedReviewer);
      refreshLocalData();
    }

    setCloudMessage({
      type: "success",
      message: hasCloudCopy && hasOfflineCopy
        ? "Reviewer renamed in cloud and offline."
        : hasCloudCopy
          ? "Cloud reviewer renamed."
          : "Offline reviewer renamed."
    });
  }

  function restoreBackupFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_BACKUP_RESTORE_SIZE) {
      setBackupMessage({ type: "error", text: "That backup file is too large. Restore a Hachi backup under 8 MB." });
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const snapshot = JSON.parse(String(reader.result || ""));
        restoreLocalDataSnapshot(snapshot);
        refreshLocalData();
        setBackupMessage({ type: "success", text: "Backup restored on this device." });
      } catch (error) {
        logClientError("restore-backup", error, { fileName: file.name, fileSize: file.size });
        setBackupMessage({ type: "error", text: error?.message || "Could not restore that backup file." });
      }
    };
    reader.onerror = () => setBackupMessage({ type: "error", text: "Could not read that backup file." });
    reader.readAsText(file);
    event.target.value = "";
  }

  async function syncReviewerToCloud(reviewer) {
    if (!configured) {
      setSyncStatus((current) => ({
        ...current,
        [reviewer.reviewerId]: { type: "error", message: "Add Supabase env vars first." }
      }));
      return;
    }

    if (!user) {
      setSyncStatus((current) => ({
        ...current,
        [reviewer.reviewerId]: { type: "error", message: "Sign in to sync this reviewer." }
      }));
      return;
    }

    if (!isOnline) {
      queueReviewerForCloudSync(user.id, reviewer);
      setSyncQueue(getSyncQueue(user.id));
      setSyncStatus((current) => ({
        ...current,
        [reviewer.reviewerId]: { type: "pending", message: "Queued. It will sync when this device is online." }
      }));
      return;
    }

    setSyncStatus((current) => ({
      ...current,
      [reviewer.reviewerId]: { type: "pending", message: "Syncing..." }
    }));

    const { error } = await upsertCloudReviewer(user.id, reviewer);

    setSyncStatus((current) => ({
      ...current,
      [reviewer.reviewerId]: error
        ? { type: "error", message: error.message || "Could not sync reviewer." }
        : { type: "success", message: "Synced to cloud." }
    }));

    if (!error) {
      loadCloudReviewers();
    }
  }

  async function processSyncQueue() {
    const queuedItems = getSyncQueue(user?.id);
    if (!queuedItems.length || !user || !configured || !navigator.onLine) return;

    setCloudMessage({ type: "pending", message: `Syncing ${queuedItems.length} queued change${queuedItems.length === 1 ? "" : "s"}...` });

    const { results } = await flushSyncQueue();
    let failed = 0;

    results.forEach(({ item, error }) => {
      if (!item.reviewerId) return;

      setSyncStatus((current) => ({
        ...current,
        [item.reviewerId]: error
          ? { type: "error", message: error.message || "Queued sync failed." }
          : { type: "success", message: "Queued sync complete." }
      }));

      if (error) failed += 1;
    });

    setSyncQueue(getSyncQueue(user.id));
    await loadCloudReviewers();
    setCloudMessage(failed
      ? { type: "error", message: `${failed} queued change${failed === 1 ? "" : "s"} still need sync.` }
      : { type: "success", message: "Queued offline changes synced." });
  }

  async function syncAllLocalReviewersToCloud() {
    if (!configured) {
      setCloudMessage({ type: "error", message: "Add Supabase env vars first." });
      return;
    }

    if (!user) {
      setCloudMessage({ type: "error", message: "Sign in to sync offline reviewers." });
      return;
    }

    if (!unsyncedLocalReviewers.length) {
      setCloudMessage({ type: "success", message: "All offline reviewers are already synced." });
      return;
    }

    if (!isOnline) {
      unsyncedLocalReviewers.forEach((reviewer) => queueReviewerForCloudSync(user.id, reviewer));
      setSyncQueue(getSyncQueue(user.id));
      setCloudMessage({ type: "pending", message: `${unsyncedLocalReviewers.length} offline reviewer${unsyncedLocalReviewers.length === 1 ? "" : "s"} queued for sync.` });
      setSyncStatus((current) => {
        const nextStatus = { ...current };
        unsyncedLocalReviewers.forEach((reviewer) => {
          nextStatus[reviewer.reviewerId] = { type: "pending", message: "Queued for cloud sync." };
        });
        return nextStatus;
      });
      return;
    }

    setSyncAllLoading(true);
    setCloudMessage({ type: "pending", message: `Syncing ${unsyncedLocalReviewers.length} offline reviewer${unsyncedLocalReviewers.length === 1 ? "" : "s"}...` });
    setSyncStatus((current) => {
      const nextStatus = { ...current };
      unsyncedLocalReviewers.forEach((reviewer) => {
        nextStatus[reviewer.reviewerId] = { type: "pending", message: "Syncing..." };
      });
      return nextStatus;
    });

    const results = [];

    for (const reviewer of unsyncedLocalReviewers) {
      const { error } = await upsertCloudReviewer(user.id, reviewer);
      results.push({ reviewer, error });

      setSyncStatus((current) => ({
        ...current,
        [reviewer.reviewerId]: error
          ? { type: "error", message: error.message || "Could not sync reviewer." }
          : { type: "success", message: "Synced to cloud." }
      }));
    }

    const failed = results.filter((result) => result.error);
    const succeeded = results.length - failed.length;

    setSyncAllLoading(false);
    await loadCloudReviewers();
    setCloudMessage(failed.length
      ? { type: "error", message: `${succeeded} synced, ${failed.length} failed. Check the offline reviewer messages below.` }
      : { type: "success", message: `${succeeded} offline reviewer${succeeded === 1 ? "" : "s"} synced to cloud.` });
  }

  async function deleteReviewerFromCloud(item) {
    if (!user) return;

    const reviewer = getCloudReviewerData(item);
    const reviewerId = reviewer?.reviewerId || item?.reviewer_id;

    if (!reviewerId) {
      setCloudMessage({ type: "error", message: "Could not delete this cloud reviewer because it is missing a reviewer ID." });
      return;
    }

    const { error } = await deleteCloudReviewer(user.id, reviewerId);

    if (error) {
      setCloudMessage({ type: "error", message: error.message || "Could not delete cloud reviewer." });
      return;
    }

    const nextCloudReviewers = cloudReviewers.filter((cloudItem) => {
      const cloudReviewer = getCloudReviewerData(cloudItem);
      return (cloudReviewer?.reviewerId || cloudItem?.reviewer_id) !== reviewerId;
    });
    const nextCachedReviewers = getCloudReviewerCache().filter((cloudReviewer) => cloudReviewer.reviewerId !== reviewerId);

    setCloudReviewers(nextCloudReviewers);
    saveCloudReviewerCache(nextCachedReviewers);
    setCloudMessage({ type: "success", message: "Cloud reviewer deleted." });
  }

  async function runConfirmedAction() {
    if (confirmAction?.type === "clear-history") {
      clearAttemptHistory();
      pushClearedHistoryToCloud();
    }

    if (confirmAction?.type === "clear-progress") {
      clearAllQuizProgress();
      pushClearedProgressToCloud();
    }

    if (confirmAction?.type === "remove-reviewer") {
      deleteLocalReviewer(confirmAction.reviewerId);
      pushRemovedProgressToCloud(confirmAction.reviewerId);
    }

    if (confirmAction?.type === "clear-local-reviewers") {
      clearLocalReviewers();
    }

    if (confirmAction?.type === "remove-cloud-reviewer") {
      await deleteReviewerFromCloud(confirmAction.item);
    }

    if (confirmAction?.type === "clear-generator-draft") {
      clearGeneratorDraft();
    }

    if (confirmAction?.type === "clear-sync-queue") {
      clearSyncQueue(user?.id);
      setSyncQueue(getSyncQueue(user?.id));
      setCloudMessage({ type: "success", message: "Queued sync actions cleared." });
    }

    setConfirmAction(null);
    refreshLocalData();
    setSyncQueue(getSyncQueue(user?.id));
  }

  return (
    <div className="page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">Device Library</p>
          <h1>Library & Settings</h1>
          <p className="muted">Manage offline reviewers, cloud reviewers, backups, and device storage.</p>
        </div>
      </section>

      <section className="library-panel">
        <div className="library-panel-head">
          <div>
            <h2>Cloud Reviewers</h2>
            <p className="muted">Reviewers synced to your account. Save one offline to keep it available on this device.</p>
          </div>
          {user ? (
            <button className="button subtle" type="button" onClick={() => loadCloudReviewers()} disabled={cloudLoading}>
              <RefreshCw size={17} aria-hidden="true" />
              Refresh
            </button>
          ) : null}
        </div>

        {!configured ? (
          <EmptyState
            title="Cloud sync is not configured"
            message="Add your Supabase URL and anon key in Vercel to enable account reviewers."
          />
        ) : !user ? (
          <EmptyState
            title="Sign in to view cloud reviewers"
            message="Use Google sign-in to sync reviewers online and save them offline on each device."
            action={
              <Link className="button primary" to="/account">
                Go to Account
              </Link>
            }
          />
        ) : cloudLoading ? (
          <div className="library-inline-state">
            <RefreshCw size={18} aria-hidden="true" />
            <span>Loading cloud reviewers...</span>
          </div>
        ) : cloudReviewers.length ? (
          <div className="library-list">
            {cloudReviewers.map((item) => {
              const reviewer = getCloudReviewerData(item);
              const key = getCloudReviewerKey(item);
              const reviewerId = reviewer?.reviewerId;
              const savedOffline = isReviewerSavedOffline(reviewerId);

              return (
                <article className="library-row" key={key}>
                  <div>
                    <h3>{reviewer?.title || item.title || "Untitled Reviewer"}</h3>
                    <p className="muted">
                      {reviewer?.subject || item.subject || "No subject"} - {reviewer?.questions?.length || reviewer?.questionCount || 0} questions
                    </p>
                    <ReviewerStatusBadge status={savedOffline ? "both" : "cloud"} />
                    {offlineSaveStatus[key] ? (
                      <p className={`sync-message ${offlineSaveStatus[key].type}`}>{offlineSaveStatus[key].message}</p>
                    ) : null}
                  </div>
                  <div className="button-row">
                    {savedOffline ? (
                      <Link className="button primary" to={`/reviewer/${reviewerId}`}>
                        Open
                      </Link>
                    ) : null}
                    <button className="button subtle" type="button" onClick={() => saveCloudReviewerOffline(item)} disabled={savedOffline}>
                      <Download size={17} aria-hidden="true" />
                      {savedOffline ? "Saved Offline" : "Save Offline"}
                    </button>
                    <button className="button subtle" type="button" onClick={() => renameReviewerEverywhere(reviewer)}>
                      <Pencil size={17} aria-hidden="true" />
                      Rename
                    </button>
                    <button
                      className="button subtle danger-text"
                      type="button"
                      onClick={() => setConfirmAction({ type: "remove-cloud-reviewer", item })}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                      Delete Cloud
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No cloud reviewers yet"
            message="Sync a saved offline reviewer to your account and it will appear here."
          />
        )}
        {cloudMessage ? <p className={`sync-message ${cloudMessage.type}`}>{cloudMessage.message}</p> : null}
      </section>

      <section className="library-panel">
        <div className="library-panel-head">
          <div>
            <h2>Saved Offline Reviewers</h2>
            <p className="muted">Reviewers saved on this device will be available without signing in.</p>
          </div>
          {localReviewers.length ? (
            <button
              className="button subtle danger-text"
              type="button"
              onClick={() => setConfirmAction({ type: "clear-local-reviewers" })}
            >
              <Trash2 size={17} aria-hidden="true" />
              Clear Saved
            </button>
          ) : null}
        </div>

        {user && localReviewers.length ? (
          <div className="sync-all-panel">
            <div>
              <h3>{unsyncedLocalReviewers.length ? "Offline reviewers ready to sync" : "Offline reviewers are synced"}</h3>
              <p className="muted">
                {unsyncedLocalReviewers.length
                  ? `${unsyncedLocalReviewers.length} offline reviewer${unsyncedLocalReviewers.length === 1 ? "" : "s"} can be uploaded to your cloud account.`
                  : "Every offline reviewer on this device is already in your cloud account."}
              </p>
            </div>
            <button
              className="button subtle"
              type="button"
              onClick={syncAllLocalReviewersToCloud}
              disabled={!unsyncedLocalReviewers.length || syncAllLoading}
            >
              <Cloud size={17} aria-hidden="true" />
              {syncAllLoading ? "Syncing..." : "Sync All to Cloud"}
            </button>
          </div>
        ) : null}

        {syncQueue.length ? (
          <div className="sync-queue-panel">
            <div>
              <h3>{syncQueue.length} sync action{syncQueue.length === 1 ? "" : "s"} waiting</h3>
              <p className="muted">Queued reviewers will upload automatically when this device is online and signed in.</p>
            </div>
            <div className="button-row">
              <button className="button subtle" type="button" onClick={processSyncQueue} disabled={!isOnline || !user}>
                <Cloud size={17} aria-hidden="true" />
                Sync Now
              </button>
              <button className="button subtle danger-text" type="button" onClick={() => setConfirmAction({ type: "clear-sync-queue" })}>
                Clear Queue
              </button>
            </div>
          </div>
        ) : null}

        {localReviewers.length ? (
          <div className="library-list">
            {localReviewers.map((reviewer) => {
              const syncedToCloud = cloudReviewerIds.has(reviewer.reviewerId) || syncStatus[reviewer.reviewerId]?.type === "success";

              return (
                <article className="library-row" key={reviewer.reviewerId}>
                  <div>
                    <h3>{reviewer.title}</h3>
                    <p className="muted">{reviewer.subject} - {reviewer.questions?.length || reviewer.questionCount} questions</p>
                    <ReviewerStatusBadge status={syncedToCloud ? "both" : "local"} />
                    {syncStatus[reviewer.reviewerId] ? (
                      <p className={`sync-message ${syncStatus[reviewer.reviewerId].type}`}>
                        {syncStatus[reviewer.reviewerId].message}
                      </p>
                    ) : null}
                  </div>
                  <div className="button-row">
                    <Link className="button primary" to={`/reviewer/${reviewer.reviewerId}`}>
                      Open
                    </Link>
                    {syncedToCloud ? null : user ? (
                      <button
                        className="button subtle"
                        type="button"
                        onClick={() => syncReviewerToCloud(reviewer)}
                        disabled={syncStatus[reviewer.reviewerId]?.type === "pending"}
                      >
                        <Cloud size={17} aria-hidden="true" />
                        Sync to Cloud
                      </button>
                    ) : (
                      <Link className="button subtle" to="/account">
                        <Cloud size={17} aria-hidden="true" />
                        Sign In to Sync
                      </Link>
                    )}
                    <button className="button subtle" type="button" onClick={() => renameReviewerEverywhere(reviewer)}>
                      <Pencil size={17} aria-hidden="true" />
                      Rename
                    </button>
                    <button
                      className="button subtle danger-text"
                      type="button"
                      onClick={() => setConfirmAction({ type: "remove-reviewer", reviewerId: reviewer.reviewerId })}
                    >
                      Delete Offline
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="No saved offline reviewers"
            message="Save a cloud reviewer offline or create a reviewer to keep it on this device."
          />
        )}
      </section>

      <section className="library-panel">
        <h2>This Device</h2>
        <p className="muted">Changes here only affect this device. Nothing here is uploaded to your account.</p>
        <div className="local-data-grid">
          <article className="local-data-row">
            <div>
              <h3>Keep My Reviews Safe</h3>
              <p className="muted">
                {storageInfo.supported
                  ? storageInfo.persisted
                    ? "Protected. Your browser will try to keep your reviews, drafts, and progress even when this device is low on space."
                    : "Not protected yet. Browsers sometimes delete saved app information to free up space. Turning this on asks yours to keep your reviews, drafts, and progress."
                  : "Your browser doesn't let apps ask for this protection, so it isn't available here."}
              </p>
            </div>
            <div className="button-row">
              <button className="button subtle" type="button" onClick={requestPersistentStorage} disabled={storageInfo.persisted}>
                {storageInfo.persisted ? "Protection On" : "Protect My Reviews"}
              </button>
            </div>
          </article>
          <article className="local-data-row">
            <div>
              <h3>Unfinished Draft</h3>
              <p className="muted">
                {generatorDraft
                  ? `Saved ${new Date(generatorDraft.savedAt).toLocaleString()} with ${generatorDraft.questions?.length || 0} questions so far.`
                  : "You don't have a half-finished reviewer right now."}
              </p>
            </div>
            <div className="button-row">
              <Link className="button subtle" to="/generator">
                Continue Working
              </Link>
              {generatorDraft ? (
                <button className="button subtle danger-text" type="button" onClick={() => setConfirmAction({ type: "clear-generator-draft" })}>
                  Discard Draft
                </button>
              ) : null}
            </div>
          </article>
        </div>
        <div className="library-actions">
          <button className="button subtle" type="button" onClick={() => downloadJson("hachi_local_backup.json", getLocalDataSnapshot())}>
            <Download size={17} aria-hidden="true" />
            Back Up This Device
          </button>
          <label className="button subtle file-button">
            <Upload size={17} aria-hidden="true" />
            Load a Backup
            <input type="file" accept="application/json,.json" onChange={restoreBackupFile} />
          </label>
          <button className="button subtle danger-text" type="button" onClick={() => setConfirmAction({ type: "clear-progress" })}>
            Discard Unfinished Quizzes
          </button>
          <button className="button subtle danger-text" type="button" onClick={() => setConfirmAction({ type: "clear-history" })}>
            Clear Quiz History
          </button>
        </div>
        {backupMessage ? <p className={`sync-message ${backupMessage.type}`}>{backupMessage.text}</p> : null}
      </section>

      <ConfirmModal
        open={Boolean(confirmAction)}
        title="Confirm Action"
        message={confirmAction?.type === "remove-cloud-reviewer"
          ? "This deletes the reviewer from your cloud account. Offline copies on this device will stay."
          : "This changes data saved on this device. This cannot be undone."}
        confirmLabel="Continue"
        onCancel={() => setConfirmAction(null)}
        onConfirm={runConfirmedAction}
      />
    </div>
  );
}
