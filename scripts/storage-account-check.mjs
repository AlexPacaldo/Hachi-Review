// Guards the account storage rules. A browser can be handed from one account to
// another, and every one of these stores holds real content: another account's
// reviewers, an unfinished quiz, a study streak. Nothing here fails loudly when
// the rules slip, the wrong reviewers simply appear under "Shared with You", so
// the rules are asserted here instead.
//
// Run with `npm test`. No dependencies, so it runs the same on a phone-less CI
// box as on a workstation.

import { pathToFileURL } from "node:url";

// localStorage stub, declared before the module under test is imported because
// the module reads one key while it loads.
const store = new Map();

globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  key: (index) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  }
};

globalThis.window = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {}
};

const MODULE_URL = pathToFileURL(new URL("../src/utils/storageUtils.js", import.meta.url).pathname.replace(/^\//, "")).href;
// The registry reads both stores and decides which copy a reader is shown, so it
// shares this file's localStorage stub and is reimported per scenario alongside it.
const REGISTRY_URL = pathToFileURL(new URL("../src/data/reviewerRegistry.js", import.meta.url).pathname.replace(/^\//, "")).href;
let instance = 0;

// A fresh module per scenario. The account that used the device last is read once
// when the module loads, so no later write can change what a scenario sees.
async function loadApp({ lastUserId = null, seed = {} } = {}) {
  store.clear();
  if (lastUserId) store.set("reviewer_last_user_id", lastUserId);
  Object.entries(seed).forEach(([key, value]) => store.set(key, JSON.stringify(value)));
  instance += 1;
  return import(`${MODULE_URL}?case=${instance}`);
}

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${ok ? "" : `\n          got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

function section(title) {
  console.log(`\n${title}`);
}

const ALEX = "account-alex";
const PSAJ = "account-psaj";
const THIRD = "account-third";
const FRIEND_OF_ALEX = "friend-of-alex";
const STREAK = { currentStreak: 9, longestStreak: 12, totalDays: 20, lastStudyDay: "2026-10-01", recentDays: ["2026-10-01"] };

const ownReviewer = { reviewerId: "alex-own", title: "Alex own", subject: "Bio", questions: [], ownerId: ALEX };
const friendReviewer = { reviewerId: "friend-1", title: "Friend one", subject: "Bio", questions: [], ownerId: FRIEND_OF_ALEX };
const generatedReviewer = { reviewerId: "generated", title: "Made on device", subject: "Bio", questions: [] };

section("two accounts on one browser keep their own state");
{
  const storage = await loadApp();

  storage.setAccountDataOwner(ALEX);
  storage.markStudyDay("2026-10-01");
  storage.saveQuizProgress({ reviewerId: "alex-own", answers: { 1: "A" } });
  storage.saveAttempt({ attemptId: "attempt-alex", reviewerId: "alex-own", date: "2026-10-01T10:00:00.000Z" });
  storage.saveLocalReviewer(generatedReviewer);
  storage.mergeCloudReviewerCache([ownReviewer, friendReviewer]);
  storage.saveNotificationHistory([{ id: "n-alex", title: "Alex shared a reviewer", read: false }]);
  storage.saveGeneratorDraft({ title: "Alex draft" });

  storage.setAccountDataOwner(PSAJ);
  check("no streak", storage.getStudyStreak().currentStreak, 0);
  check("no progress", Object.keys(storage.getAllProgress()), []);
  check("no attempts", storage.getAttemptHistory(), []);
  check("no local reviewers", storage.getLocalReviewers(), []);
  check("no reviewers", storage.getCloudReviewerCache(), []);
  check("no notifications", storage.getNotificationHistory(), []);
  check("no generator draft", storage.getGeneratorDraft(), null);

  storage.markStudyDay("2026-10-02");
  storage.saveQuizProgress({ reviewerId: "psaj-own", answers: {} });
  storage.saveLocalReviewer({ reviewerId: "psaj-local", title: "Psaj set", subject: "Math", questions: [] });

  storage.setAccountDataOwner(ALEX);
  check("streak survived the switch", storage.getStudyStreak().currentStreak, 1);
  check("progress survived the switch", Object.keys(storage.getAllProgress()), ["alex-own"]);
  check("attempts survived the switch", storage.getAttemptHistory().length, 1);
  check("local reviewers survived the switch", storage.getLocalReviewers().length, 1);
  check("reviewers survived the switch", storage.getCloudReviewerCache().length, 2);
  check("notifications survived the switch", storage.getNotificationHistory().length, 1);
  check("generator draft survived the switch", storage.getGeneratorDraft().title, "Alex draft");
  check("and the other account's progress never arrived", storage.getAllProgress()["psaj-own"], undefined);
}

section("work done with no account is claimed by the next one to sign in");
{
  const storage = await loadApp();

  storage.setAccountDataOwner(null);
  storage.markStudyDay("2026-10-01");
  storage.saveLocalReviewer({ reviewerId: "signed-out-local", title: "Offline set", subject: "Math", questions: [] });
  check("readable while signed out", storage.getLocalReviewers().length, 1);

  storage.setAccountDataOwner(ALEX);
  check("claimed by the first account", storage.getLocalReviewers().length, 1);
  check("streak claimed too", storage.getStudyStreak().currentStreak, 1);

  storage.setAccountDataOwner(PSAJ);
  check("not available to the account after it", storage.getLocalReviewers().length, 0);

  storage.setAccountDataOwner(null);
  storage.setAccountDataOwner(ALEX);
  check("the first account still has it", storage.getLocalReviewers().length, 1);
}

section("a store written before the slots existed");
{
  const storage = await loadApp({
    lastUserId: ALEX,
    seed: {
      reviewer_study_streak: STREAK,
      reviewer_cloud_reviewer_cache: [ownReviewer, friendReviewer, generatedReviewer]
    }
  });

  storage.setAccountDataOwner(PSAJ);
  check("another account cannot take the streak", storage.getStudyStreak().currentStreak, 0);
  check("another account cannot take the reviewers", storage.getCloudReviewerCache(), []);

  storage.setAccountDataOwner(ALEX);
  check("the account that used the device last takes the streak", storage.getStudyStreak().currentStreak, 9);
  check(
    "and only the reviewers it owns or made itself",
    storage.getCloudReviewerCache().map((reviewer) => reviewer.reviewerId),
    ["alex-own", "generated"]
  );

  storage.setAccountDataOwner(PSAJ);
  check("both stores are then gone for the other account", storage.getCloudReviewerCache(), []);
}

section("a group peer's reviewer is kept, it is the account's to read");
{
  const storage = await loadApp();

  storage.setAccountDataOwner(ALEX);
  storage.mergeCloudReviewerCache([
    { reviewerId: "peer-group", title: "Group set", subject: "Bio", questions: [], ownerId: "group-peer", visibility: "group" }
  ]);
  check("cached", storage.getCloudReviewerCache().some((reviewer) => reviewer.reviewerId === "peer-group"), true);

  storage.setAccountDataOwner(PSAJ);
  check("not visible to another account", storage.getCloudReviewerCache(), []);
}

// The bug these guard: an owner corrects an answer key, the row is rewritten,
// and every other device kept marking the old key forever. A summary carries no
// questions, so the cached copy used to be carried over unconditionally and
// nothing could ever replace it. The row's updated_at is the only signal there is.
section("a corrected answer key reaches the other devices");
{
  const storage = await loadApp();
  storage.setAccountDataOwner(PSAJ);

  const OLD = "2026-10-01T09:00:00.000Z";
  const NEW = "2026-10-02T09:00:00.000Z";
  const keyed = (correctAnswer, updatedAt) => ({
    reviewerId: "shared-set",
    title: "Shared set",
    subject: "Bio",
    ownerId: FRIEND_OF_ALEX,
    updatedAt,
    questions: [{ id: "q1", correctAnswer, answerText: correctAnswer, choices: { A: "a", B: "b", C: "c", D: "d" } }]
  });

  storage.mergeCloudReviewerCache([keyed("B", OLD)]);
  check("the fetched copy kept its questions", storage.getCloudReviewerCache()[0].questions[0].correctAnswer, "B");

  // The owner's edit. The list only ever carries this much.
  storage.mergeCloudReviewerCache([{ reviewerId: "shared-set", title: "Shared set", subject: "Bio", ownerId: FRIEND_OF_ALEX, updatedAt: NEW }]);
  const afterEdit = storage.getCloudReviewerCache()[0];
  check("the stale key is gone", afterEdit.questions, undefined);
  check("the newer version is recorded so the next open refetches", afterEdit.updatedAt, NEW);

  // A list load that says nothing new must not cost the device its offline copy.
  storage.mergeCloudReviewerCache([{ reviewerId: "shared-set", title: "Shared set", subject: "Bio", ownerId: FRIEND_OF_ALEX, updatedAt: NEW }]);
  storage.cacheCloudReviewer(keyed("C", NEW));
  storage.mergeCloudReviewerCache([{ reviewerId: "shared-set", title: "Shared set", subject: "Bio", ownerId: FRIEND_OF_ALEX, updatedAt: NEW }]);
  check("a refetched copy survives the next list load", storage.getCloudReviewerCache()[0].questions[0].correctAnswer, "C");

  // An owner who edited on this device has already written through, so their own
  // cache keeps working without a round trip.
  storage.setAccountDataOwner(FRIEND_OF_ALEX);
  storage.mergeCloudReviewerCache([{ reviewerId: "own-set", title: "Mine", subject: "Bio", ownerId: FRIEND_OF_ALEX, updatedAt: OLD, questions: [{ id: "q1", correctAnswer: "A", answerText: "A" }] }]);
  storage.mergeCloudReviewerCache([{ reviewerId: "own-set", title: "Mine", subject: "Bio", ownerId: FRIEND_OF_ALEX, updatedAt: NEW }]);
  check("this account's own reviewer keeps its questions", storage.getCloudReviewerCache()[0].questions[0].correctAnswer, "A");
}

section("an offline copy of somebody else's reviewer is dropped when its owner edits");
{
  const storage = await loadApp();
  storage.setAccountDataOwner(PSAJ);

  const OLD = "2026-10-01T09:00:00.000Z";
  const NEW = "2026-10-02T09:00:00.000Z";
  const copy = (correctAnswer, updatedAt) => ({
    reviewerId: "shared-offline",
    title: "Shared set",
    subject: "Bio",
    ownerId: FRIEND_OF_ALEX,
    updatedAt,
    questions: [{ id: "q1", correctAnswer, answerText: correctAnswer }]
  });

  storage.saveLocalReviewer(copy("A", OLD));
  storage.mergeCloudReviewerCache([{ reviewerId: "shared-offline", title: "Shared set", subject: "Bio", ownerId: FRIEND_OF_ALEX, updatedAt: NEW }]);
  check("the stale offline copy is gone", storage.getLocalReviewers().some((r) => r.reviewerId === "shared-offline"), false);

  // An unfinished quiz is not wrong, its key is rebuilt on resume, so dropping the
  // copy must not take the learner's progress with it.
  storage.saveQuizProgress({ reviewerId: "shared-offline", answers: { q1: "A" } });
  storage.mergeCloudReviewerCache([{ reviewerId: "shared-offline", title: "Shared set", subject: "Bio", ownerId: FRIEND_OF_ALEX, updatedAt: "2026-10-03T09:00:00.000Z" }]);
  check("their progress survived", storage.loadQuizProgress("shared-offline").answers, { q1: "A" });

  // This account's own offline reviewer can hold edits not uploaded yet, so it is
  // never dropped on the strength of a timestamp.
  storage.saveLocalReviewer({ reviewerId: "psaj-draft", title: "Draft", subject: "Bio", ownerId: PSAJ, updatedAt: OLD, questions: [{ id: "q1", correctAnswer: "A", answerText: "A" }] });
  storage.mergeCloudReviewerCache([{ reviewerId: "psaj-draft", title: "Draft", subject: "Bio", ownerId: PSAJ, updatedAt: NEW }]);
  check("this account's own offline reviewer is kept", storage.getLocalReviewers().some((r) => r.reviewerId === "psaj-draft"), true);
}

// Which of the cloud cache and the offline store a reader is shown. The registry
// merges the two and this is the rule it merges them by, so it is asserted here
// rather than left to a code read: picking wrong either way either serves a
// retired answer key or throws away an edit that has not been uploaded.
section("a reviewer this account does not own is read from the newer copy");
{
  // Both modules un-suffixed here, deliberately. The registry resolves storageUtils
  // by its own path, so a suffixed storage here would leave the registry reading a
  // different instance and a different account slot than the one under test.
  store.clear();
  const storage = await import(MODULE_URL);
  const registry = await import(REGISTRY_URL);
  storage.setAccountDataOwner(PSAJ);

  const OLD = "2026-10-01T09:00:00.000Z";
  const NEW = "2026-10-02T09:00:00.000Z";
  const keyed = (correctAnswer) => ([{
    id: "q1",
    topic: "T",
    question: "Q",
    correctAnswer,
    // validateReviewer refuses a reviewer whose answerText is not the text of its
    // own correct choice, so this has to agree or the fixture is invalid.
    answerText: correctAnswer === "A" ? "alpha" : "beta",
    explanation: "why",
    choices: { A: "alpha", B: "beta", C: "gamma", D: "delta" }
  }]);

  // A summary of the same version says nothing new, so the offline copy stands.
  storage.saveLocalReviewer({ reviewerId: "tie", title: "T", subject: "S", ownerId: FRIEND_OF_ALEX, updatedAt: OLD, questions: keyed("B"), questionCount: 1 });
  storage.mergeCloudReviewerCache([{ reviewerId: "tie", title: "T", subject: "S", ownerId: FRIEND_OF_ALEX, updatedAt: OLD }]);
  check("an unchanged version keeps the offline copy", registry.getReviewerById("tie").questions[0].correctAnswer, "B");
  check("and it is still one reviewer, not two", registry.getReviewerById("tie").storageStatus, "both");

  // The owner's edit, seen only as a newer summary. Questions must not survive it,
  // or the reviewer reads as complete and is trusted instead of refetched.
  storage.saveLocalReviewer({ reviewerId: "stale", title: "T", subject: "S", ownerId: FRIEND_OF_ALEX, updatedAt: OLD, questions: keyed("B"), questionCount: 1 });
  storage.mergeCloudReviewerCache([{ reviewerId: "stale", title: "T", subject: "S", ownerId: FRIEND_OF_ALEX, updatedAt: NEW }]);
  check("a newer version wins", Array.isArray(registry.getReviewerById("stale").questions), false);
  check("so it reads as a summary and gets refetched", registry.isReviewerSummary(registry.getReviewerById("stale")), true);
  check("and a summary is not reported as a broken reviewer", registry.getReviewerById("stale").validation.isValid, true);

  // This account's own reviewer is the other way round. Its local copy can hold an
  // edit the row has not seen yet, so a newer cloud stamp must not cost it that.
  storage.saveLocalReviewer({ reviewerId: "mine", title: "T", subject: "S", ownerId: PSAJ, updatedAt: OLD, questions: keyed("A"), questionCount: 1 });
  storage.mergeCloudReviewerCache([{ reviewerId: "mine", title: "T", subject: "S", ownerId: PSAJ, updatedAt: NEW }]);
  const mine = registry.getReviewerById("mine");
  check("this account's own unsynced edit survives a newer row", mine.questions[0].correctAnswer, "A");
  check("and it is one reviewer, not two", mine.storageStatus, "both");
  check("and it still validates", mine.validation.isValid, true);
}

section("nothing is written before the account is known");
{
  const storage = await loadApp();
  storage.setAccountDataOwner(ALEX);
  storage.saveQuizProgress({ reviewerId: "alex-own", answers: {} });

  // A second module instance, as a second tab would be, writing before its own
  // session has resolved.
  const other = await import(`${MODULE_URL}?case=unresolved`);
  other.saveQuizProgress({ reviewerId: "too-early", answers: {} });

  storage.setAccountDataOwner(ALEX);
  check("the early write did not land", Object.keys(storage.getAllProgress()), ["alex-own"]);
}

section("deleting device data clears every account on the device");
{
  const storage = await loadApp();

  storage.setAccountDataOwner(ALEX);
  storage.saveQuizProgress({ reviewerId: "alex-own", answers: {} });
  storage.mergeCloudReviewerCache([ownReviewer]);
  storage.saveNotificationHistory([{ id: "n-alex", title: "x", read: false }]);

  storage.setAccountDataOwner(PSAJ);
  storage.saveQuizProgress({ reviewerId: "psaj-own", answers: {} });
  storage.saveLocalReviewer({ reviewerId: "psaj-local", title: "t", subject: "s", questions: [] });

  storage.setAccountDataOwner(null);
  storage.markStudyDay("2026-10-02");
  store.set("hachi_social_notification_state", JSON.stringify({ [ALEX]: { groupReviewerMeta: { a: { title: "Secret set" } } } }));

  storage.clearAllDeviceData();

  check("no progress anywhere", storage.getAllProgress(), {});
  check("no reviewers anywhere", storage.getCloudReviewerCache(), []);
  check("no local reviewers anywhere", storage.getLocalReviewers(), []);
  check("no notifications anywhere", storage.getNotificationHistory(), []);
  check("no streak anywhere", storage.getStudyStreak().currentStreak, 0);
  check("the social notification state went too", store.has("hachi_social_notification_state"), false);
  check("nothing of any kind is left", [...store.keys()].filter((key) => !key.startsWith("reviewer_") || key === "reviewer_last_user_id").length, 0);
}

section("a backup is a plain file and lands on the account that imported it");
{
  const storage = await loadApp();

  storage.setAccountDataOwner(ALEX);
  storage.saveQuizProgress({ reviewerId: "alex-own", answers: {} });
  const snapshot = storage.getLocalDataSnapshot();
  check("the export carries no owner", snapshot.ownerId, undefined);
  check("progress exported", Object.keys(snapshot.progress), ["alex-own"]);

  storage.setAccountDataOwner(PSAJ);
  storage.restoreLocalDataSnapshot(snapshot);
  check("restored for the importing account", Object.keys(storage.getAllProgress()), ["alex-own"]);

  storage.setAccountDataOwner(ALEX);
  check("the exporting account is untouched by the import", Object.keys(storage.getAllProgress()), ["alex-own"]);

  storage.setAccountDataOwner(THIRD);
  check("and a third account cannot read the imported copy", storage.getAllProgress(), {});
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);