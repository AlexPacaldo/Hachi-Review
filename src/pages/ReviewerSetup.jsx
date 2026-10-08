import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, BookOpen, Cloud, Eye, EyeOff, HardDrive, Layers, Loader2, Play, Users, Zap } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import ReviewerMenu from "../components/ReviewerMenu.jsx";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useReviewer } from "../hooks/useReviewer.js";
import { countNegativeStemQuestions, createQuizSession, findChoiceBalanceIssues, getQuestionDifficulty, getQuestionStyle, getQuestionTypeOptions, getReviewerStyleCounts, getStoredQuestionTypes } from "../utils/quizUtils.js";
import { clearQuizProgress, getLatestAttempt, loadQuizProgress, markStudyDay, saveQuizProgress } from "../utils/storageUtils.js";
import { pushRemovedProgressToCloud, scheduleProgressSync, scheduleStudyDaySync } from "../services/syncEngine.js";
import hachiDogCurious from "../assets/hachi-dog-curious.gif";
import hachiDogExcited from "../assets/hachi-dog-excited.gif";
import hachiDogFocused from "../assets/hachi-dog-focused.gif";
import hachiDogProud from "../assets/hachi-dog-proud.gif";

const QUESTION_TYPE_LABELS = {
  multiple_choice: "Multiple Choice",
  true_false: "True / False",
  identification: "Identification",
  flashcard: "Flashcards"
};

const FLASHCARD_LIMIT_OPTIONS = [10, 20, 50, "all"];

// Mirrors the pool that createQuizSession builds, so the slider never asks for
// more questions than the chosen difficulty and style can supply. An empty pool
// falls back to the whole reviewer, the same way the session does.
function countAvailableQuestions(questions, settings) {
  const pool = (questions || []).filter((question) => {
    if (settings.difficulty && settings.difficulty !== "mixed" && getQuestionDifficulty(question) !== settings.difficulty) return false;
    if (settings.includeScenarioQuestions === false && getQuestionStyle(question) === "scenario") return false;
    return true;
  });

  return pool.length || (questions || []).length || 1;
}

function getReviewerDogState({ savedProgress, latestAttempt }) {
  if (savedProgress) {
    return {
      label: "In progress",
      className: "in-progress",
      image: hachiDogFocused,
      note: "Right where you left off.",
      cheer: "Focus mode is ready!"
    };
  }

  if (latestAttempt) {
    return {
      label: "Completed",
      className: "completed",
      image: hachiDogProud,
      note: "Reviewed before",
      cheer: "Good things ahead!"
    };
  }

  return {
    label: "Not started",
    className: "not-started",
    image: hachiDogCurious,
    note: "New topics today",
    cheer: "Let's sniff out the answers!"
  };
}

export default function ReviewerSetup() {
  const { reviewerId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const autoOpenQuestions = searchParams.get("edit") === "1";
  const { configured, user } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const [menuMessage, setMenuMessage] = useState(null);
  const { reviewer, hasQuestions, isResolving, loadError, reload } = useReviewer(reviewerId, refreshKey);
  const savedProgress = reviewer ? loadQuizProgress(reviewer.reviewerId) : null;
  const latestAttempt = reviewer ? getLatestAttempt(reviewer.reviewerId) : null;
  const [showStartOver, setShowStartOver] = useState(false);
  const [flashcardLimit, setFlashcardLimit] = useState(20);
  const [flashcardsVisible, setFlashcardsVisible] = useState(false);
  const storageStatus = reviewer?.storageStatus || reviewer?.source || "built-in";
  const hasLocal = storageStatus === "both" || reviewer?.source === "local";
  const hasCloud = storageStatus === "both" || reviewer?.source === "cloud";
  const isOwnerReviewer = user
    ? reviewer?.ownerId
      ? reviewer.ownerId === user.id
      : reviewer?.source !== "cloud" && reviewer?.source !== "built-in"
    : reviewer?.source === "local";
  const isSharedWithMe = reviewer?.ownerId && user
    ? reviewer.ownerId !== user.id
    : Boolean(reviewer?.ownerName) && !isOwnerReviewer;
  const mistakeIds = latestAttempt?.incorrectQuestionIds || [];

  const totalQuestions = reviewer?.questions?.length || 0;
  const questionCountMin = Math.min(10, totalQuestions);
  const questionCountMax = Math.max(questionCountMin, Math.min(100, totalQuestions));
  const defaultQuestionCount = Math.min(Math.max(questionCountMin, totalQuestions <= 10 ? totalQuestions : 10), questionCountMax);

  // Flashcards are their own Quiz Mode, so they are not a per-question-type choice.
  const questionTypeOptions = useMemo(() => (reviewer ? getQuestionTypeOptions(reviewer).filter((type) => type !== "flashcard") : []), [reviewer]);
  const defaultQuestionTypes = useMemo(() => (reviewer ? getStoredQuestionTypes(reviewer) : []), [reviewer]);
  const styleCounts = useMemo(() => getReviewerStyleCounts(reviewer?.questions || []), [reviewer]);
  const negativeStemCount = useMemo(() => countNegativeStemQuestions(reviewer?.questions || []), [reviewer]);
  const giveAwayCount = useMemo(() => findChoiceBalanceIssues(reviewer?.questions || []).length, [reviewer]);
  const difficultyCounts = useMemo(() => {
    return (reviewer?.questions || []).reduce((counts, question) => {
      const level = ["easy", "medium", "hard"].includes(question?.difficulty) ? question.difficulty : "medium";
      counts[level] += 1;
      return counts;
    }, { easy: 0, medium: 0, hard: 0 });
  }, [reviewer]);

  const [settings, setSettings] = useState({
    questionCount: defaultQuestionCount,
    questionOrder: "original",
    choiceOrder: "shuffle",
    mode: "practice",
    timeLimitMinutes: 15,
    questionTypes: defaultQuestionTypes.length ? defaultQuestionTypes : ["multiple_choice"],
    difficulty: "mixed",
    includeScenarioQuestions: true
  });

  // The setup state is initialised on the first render, when the reviewer is
  // usually still a question-less summary, so questionCount would be computed
  // as 0 and never corrected once the questions arrive. Re-anchor it to the
  // default whenever the reviewer (or its question total) changes.
  useEffect(() => {
    setSettings((current) => ({ ...current, questionCount: defaultQuestionCount }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewerId, totalQuestions]);

  // The list only holds a summary, so the questions are fetched here on open.
  // isResolving covers the cold load too, where there is nothing to show at all,
  // and it has to be checked before the empty state below: otherwise a reload
  // reports a reviewer that does not exist while the request for it is in flight.
  if (isResolving) {
    return (
      <div className="page narrow reviewer-setup-page">
        <EmptyState
          title="Loading this reviewer"
          message="Fetching the questions for this reviewer."
          action={<Loader2 className="spinner" size={20} aria-hidden="true" />}
        />
      </div>
    );
  }

  if (!reviewer) {
    return (
      <div className="page narrow reviewer-setup-page">
        <EmptyState
          title="Unable to load this reviewer."
          message={loadError || "The reviewer does not exist."}
          action={<div className="button-row"><button className="button primary" type="button" onClick={reload}>Try again</button><Link className="button subtle" to="/home">Back to Reviewers</Link></div>}
        />
      </div>
    );
  }

  if (!hasQuestions) {
    return (
      <div className="page narrow reviewer-setup-page">
        <EmptyState
          title="Unable to load this reviewer."
          message={loadError || "This reviewer has not been saved on this device. Open it while online, then use Save offline to keep it for later."}
          action={<div className="button-row"><button className="button primary" type="button" onClick={reload}>Try again</button><Link className="button subtle" to="/home">Back to Reviewers</Link></div>}
        />
      </div>
    );
  }

  if (!reviewer.validation.isValid) {
    return (
      <div className="page narrow reviewer-setup-page">
        <EmptyState title="Unable to load this reviewer." message={reviewer.validation.errors[0] || "The reviewer does not exist."} action={<Link className="button primary" to="/home">Back to Reviewers</Link>} />
      </div>
    );
  }

  const dogState = getReviewerDogState({ savedProgress, latestAttempt });
  const reviewerCode = reviewer.title.split(" ")[0];

  const startQuiz = (retryIds = null, overrides = {}) => {
    const nextSettings = { ...settings, ...overrides };
    nextSettings.questionCount = Math.min(nextSettings.questionCount, countAvailableQuestions(reviewer.questions, nextSettings));
    const session = createQuizSession(reviewer, nextSettings, retryIds);
    // Opening a reviewer counts as studying. Recording it here as well as on the
    // first answer means a session that is started and then put away still shows
    // up in the streak instead of looking like a day with nothing done on it.
    markStudyDay();
    scheduleStudyDaySync();
    saveQuizProgress(session);
    scheduleProgressSync(session);
    navigate(`/quiz/${reviewer.reviewerId}`);
  };

  const visibleFlashcards = flashcardLimit === "all"
    ? reviewer.questions
    : reviewer.questions.slice(0, Number(flashcardLimit));

  const updateSetting = (key, value) => {
    setSettings((current) => ({
      ...current,
      [key]: value,
      // Switching away from Flashcard Mode drops the flashcard-only type override.
      ...(key === "mode" && value !== "flashcard" && current.questionTypes.includes("flashcard")
        ? { questionTypes: defaultQuestionTypes }
        : {})
    }));
  };

  const toggleQuestionType = (value) => {
    setSettings((current) => {
      if (value === "flashcard") {
        return current.questionTypes.includes("flashcard")
          ? { ...current, questionTypes: defaultQuestionTypes, mode: "practice" }
          : { ...current, questionTypes: ["flashcard"], mode: "flashcard" };
      }

      const hadFlashcard = current.questionTypes.includes("flashcard");
      let nextTypes;

      if (hadFlashcard) {
        const base = defaultQuestionTypes.includes(value) ? defaultQuestionTypes : [...defaultQuestionTypes, value];
        nextTypes = base.length ? base : [value];
      } else {
        const toggled = current.questionTypes.includes(value)
          ? current.questionTypes.filter((type) => type !== value)
          : [...current.questionTypes, value];
        nextTypes = toggled.length ? toggled : defaultQuestionTypes;
      }

      return {
        ...current,
        questionTypes: [...new Set(nextTypes)],
        mode: hadFlashcard || current.mode === "flashcard" ? "practice" : current.mode
      };
    });
  };

  return (
    <div className="page narrow reviewer-setup-page">
      <Link className="back-link" to="/home">
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Reviewers
      </Link>

      <section className={`setup-panel reviewer-setup-hero reviewer-setup-${dogState.className}`}>
        <div className="reviewer-hero-copy">
          <div className="reviewer-head-row">
            <div className="reviewer-head-copy">
              <p className="eyebrow">{reviewer.subject}</p>
              <h1>{reviewer.title}</h1>
            </div>
            <ReviewerMenu
              reviewer={reviewer}
              user={user}
              configured={configured}
              onMessage={setMenuMessage}
              onChanged={() => setRefreshKey((current) => current + 1)}
              autoOpenQuestions={autoOpenQuestions}
            />
          </div>
          <p className="muted">{reviewer.instructions}</p>
          <div className="stat-strip reviewer-hero-stats">
            <span><strong>{reviewer.questions.length}</strong> available questions</span>
            <span><strong>{reviewer.coverage.length}</strong> coverage areas</span>
            <span className={`reviewer-status-pill ${dogState.className}`}>{dogState.label}</span>
          </div>
          {menuMessage ? <p className={`sync-message ${menuMessage.type}`}>{menuMessage.text}</p> : null}
        </div>

        <div className="reviewer-hero-dog" aria-hidden="true">
          <span className="reviewer-hero-note">{dogState.cheer}</span>
          <span className="reviewer-hero-code">{reviewerCode}</span>
          <img className={dogState.className} src={dogState.image} alt="" />
          <span className="reviewer-hero-paw paw-one" />
          <span className="reviewer-hero-paw paw-two" />
          <span className="reviewer-hero-paw paw-three" />
        </div>

        <div className="availability-box">
          <img className="availability-dog" src={isSharedWithMe ? hachiDogExcited : hachiDogFocused} alt="" aria-hidden="true" />
          <div className="availability-icon" aria-hidden="true">
            {isSharedWithMe ? <Users size={20} /> : hasCloud && isOwnerReviewer ? <Cloud size={20} /> : hasLocal ? <HardDrive size={20} /> : <BookOpen size={20} />}
          </div>
          <div>
            <h2>
              {isSharedWithMe
                ? `Shared with you by ${reviewer.ownerName || "a friend"}`
                : hasCloud && isOwnerReviewer
                  ? "Saved in your cloud account"
                  : hasLocal
                    ? "Saved on this device"
                    : "Built into Hachi"}
            </h2>
            <p className="muted">
              {isSharedWithMe
                ? "From your friend's cloud library. Save offline to keep it on this device."
                : hasCloud && isOwnerReviewer
                  ? "Synced to your account and available on any signed-in device."
                  : hasLocal
                    ? "Stored locally and remains available without signing in."
                    : "Bundled with the app, so it is already available for offline study."}
            </p>
          </div>
          <Link className="button subtle" to="/library">
            Manage Library
          </Link>
        </div>
      </section>

      <section className="setup-panel reviewer-info-panel">
        <div className="reviewer-info-copy">
          <span className="setup-section-icon">
            <Layers size={23} aria-hidden="true" />
          </span>
          <div className="coverage-block setup">
            <h2>Coverage</h2>
            <p className="muted">This reviewer covers the following topics:</p>
            <ul>
              {reviewer.coverage.map((topic) => (
                <li key={topic}>{topic}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="reviewer-quote-card" aria-hidden="true">
          <span>{dogState.note}</span>
          <strong>New topics today, brighter tomorrow!</strong>
          <img src={hachiDogCurious} alt="" />
        </div>
      </section>

      {savedProgress ? (
        <section className="notice-panel">
          <h2>Unfinished Quiz</h2>
          <p>You have an unfinished {reviewer.subject} quiz.</p>
          <div className="button-row">
            <button className="button primary" type="button" onClick={() => navigate(`/quiz/${reviewer.reviewerId}`)}>
              Continue Quiz
            </button>
            <button className="button subtle" type="button" onClick={() => setShowStartOver(true)}>
              Start Over
            </button>
          </div>
        </section>
      ) : null}

      <section className="setup-panel quiz-setup-panel">
        <div className="quiz-setup-head">
          <span className="setup-section-icon">
            <Zap size={24} aria-hidden="true" />
          </span>
          <div>
            <h2>Quiz Setup</h2>
            <p className="muted">Customize your practice session below.</p>
          </div>
          <div className="quiz-setup-dog" aria-hidden="true">
            <span>Practice today for a brighter tomorrow.</span>
            <img src={savedProgress ? hachiDogFocused : hachiDogExcited} alt="" />
          </div>
        </div>

        <fieldset>
          <legend>Number of Questions</legend>
          <label className="question-count-control">
            <span className="question-count-value">
              <strong>{settings.questionCount}</strong>
              <small>out of {totalQuestions} questions</small>
            </span>
            <input
              type="range"
              min={questionCountMin}
              max={questionCountMax}
              step={1}
              value={settings.questionCount}
              onChange={(event) => updateSetting("questionCount", Number(event.target.value))}
            />
            <span className="question-count-range">
              <small>{questionCountMin}</small>
              <small>{questionCountMax}</small>
            </span>
          </label>
        </fieldset>

        <fieldset>
          <legend>Difficulty</legend>
          <div className="segmented">
            <button type="button" className={settings.difficulty === "mixed" ? "active" : ""} onClick={() => updateSetting("difficulty", "mixed")}>Mixed</button>
            <button type="button" className={settings.difficulty === "easy" ? "active" : ""} onClick={() => updateSetting("difficulty", "easy")}>Easy</button>
            <button type="button" className={settings.difficulty === "medium" ? "active" : ""} onClick={() => updateSetting("difficulty", "medium")}>Medium</button>
            <button type="button" className={settings.difficulty === "hard" ? "active" : ""} onClick={() => updateSetting("difficulty", "hard")}>Hard</button>
          </div>
          <p className="muted">
            {settings.difficulty === "mixed"
              ? `Mixed uses every level in this reviewer: ${difficultyCounts.easy} easy, ${difficultyCounts.medium} medium, ${difficultyCounts.hard} hard.`
              : `Uses the ${settings.difficulty} questions only. ${difficultyCounts[settings.difficulty]} available in this reviewer.`}
          </p>
        </fieldset>

        <fieldset>
          <legend>Question Style</legend>
          <div className="mode-options">
            <button
              type="button"
              className={`mode-card ${settings.includeScenarioQuestions ? "active" : ""}`}
              onClick={() => updateSetting("includeScenarioQuestions", true)}
            >
              <strong>Include Exam-style</strong>
              <span>Keeps the scenario and application questions alongside the rest of the reviewer.</span>
              <span>
                {styleCounts.scenario} exam-style and {styleCounts.direct} direct{" "}
                {styleCounts.direct === 1 ? "question" : "questions"}
                {negativeStemCount > 0
                  ? `, of which ${negativeStemCount} ${negativeStemCount === 1 ? "is" : "are"} an odd-one-out "which is NOT..." ${negativeStemCount === 1 ? "question" : "questions"}`
                  : ""}
                .
              </span>
            </button>
            <button
              type="button"
              className={`mode-card ${!settings.includeScenarioQuestions ? "active" : ""}`}
              onClick={() => updateSetting("includeScenarioQuestions", false)}
            >
              <strong>Direct Questions Only</strong>
              <span>Leaves out the scenarios and drills the definitions, facts, and comparisons.</span>
              <span>
                {styleCounts.direct} direct {styleCounts.direct === 1 ? "question" : "questions"} once the
                exam-style ones are left out.
              </span>
            </button>
          </div>
        </fieldset>

        {giveAwayCount > 0 ? (
          <fieldset>
            <legend>Answer Balance</legend>
            {/* Names the fault rather than one symptom of it. This check reports the
                answer echoing the stem, the distractors sharing a tone, the answer
                claiming something absolute, and two options that are the same option
                twice, so "by its length or detail" was true of at most one rule out of
                seven. "Rewritten automatically" was also more than the generator does:
                the repair pass keeps the original whenever a rewrite does not measure
                clean, which is why it reports a count instead of promising a fix. And
                regenerating replaces every question in the reviewer, when Edit
                Questions already filters down to exactly these. */}
            <p className="muted">
              <span>
                {giveAwayCount} of {totalQuestions}{" "}
                {giveAwayCount === 1 ? "question has" : "questions have"} an answer you could guess just by looking at the choices, without knowing the material.
              </span>
              <span>
                New reviewers try to fix these automatically, and a fix is only kept when it works. To fix one here, open Edit Questions from the reviewer's menu.
              </span>
            </p>
          </fieldset>
        ) : null}

        <fieldset>
          <legend>Question Order</legend>
          <div className="segmented">
            <button type="button" className={settings.questionOrder === "random" ? "active" : ""} onClick={() => updateSetting("questionOrder", "random")}>Random</button>
            <button type="button" className={settings.questionOrder === "original" ? "active" : ""} onClick={() => updateSetting("questionOrder", "original")}>Original Order</button>
          </div>
        </fieldset>

        <fieldset>
          <legend>Answer Choice Order</legend>
          <div className="segmented">
            <button type="button" className={settings.choiceOrder === "shuffle" ? "active" : ""} onClick={() => updateSetting("choiceOrder", "shuffle")}>Shuffle Choices</button>
            <button type="button" className={settings.choiceOrder === "original" ? "active" : ""} onClick={() => updateSetting("choiceOrder", "original")}>Original Order</button>
          </div>
        </fieldset>

        {questionTypeOptions.length ? (
          <fieldset>
            <legend>Question Type</legend>
            <div className="type-check-grid">
              {questionTypeOptions.map((type) => (
                <label
                  className={`type-check-card ${settings.questionTypes.includes(type) ? "active" : ""}`}
                  key={type}
                >
                  <input
                    type="checkbox"
                    checked={settings.questionTypes.includes(type)}
                    onChange={() => toggleQuestionType(type)}
                  />
                  <span>
                    <strong>{QUESTION_TYPE_LABELS[type]}</strong>
                    <small>
                      {type === "flashcard"
                        ? "Card-style review"
                        : type === "identification"
                          ? "Type the answer in"
                          : type === "true_false"
                            ? "True or false"
                            : "Pick the best choice"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
            <p className="muted">
            {questionTypeOptions.length > 1
              ? "Pick the formats to use. Selecting only one converts the whole quiz to it."
              : "This reviewer uses this question format."}
            </p>
          </fieldset>
        ) : null}

        <fieldset>
          <legend>Quiz Mode</legend>
          <div className="mode-options">
            <button
              type="button"
              className={`mode-card ${settings.mode === "practice" ? "active" : ""}`}
              onClick={() => updateSetting("mode", "practice")}
            >
              <strong>Practice Mode</strong>
              <span>Checks each answer right away and explains it. Missed questions come back later in the same quiz until you get them right.</span>
            </button>
            <button
              type="button"
              className={`mode-card ${settings.mode === "exam" ? "active" : ""}`}
              onClick={() => updateSetting("mode", "exam")}
            >
              <strong>Exam Mode</strong>
              <span>Lets you answer, go back, and change choices. Correct answers and explanations appear only after final submission.</span>
            </button>
            <button
              type="button"
              className={`mode-card ${settings.mode === "timed" ? "active" : ""}`}
              onClick={() => updateSetting("mode", "timed")}
            >
              <strong>Timed Mode</strong>
              <span>Runs like exam mode with a countdown timer and submits automatically when time runs out.</span>
            </button>
            <button
              type="button"
              className={`mode-card ${settings.mode === "mistakes" ? "active" : ""}`}
              onClick={() => updateSetting("mode", "mistakes")}
              disabled={!mistakeIds.length}
            >
              <strong>Mistakes-Only Mode</strong>
              <span>Reviews only the questions missed in your most recent completed attempt.</span>
            </button>
            <button
              type="button"
              className={`mode-card ${settings.mode === "flashcard" ? "active" : ""}`}
              onClick={() => setSettings((current) => ({
                ...current,
                mode: "flashcard",
                questionTypes: ["flashcard"]
              }))}
            >
              <strong>Flashcard Mode</strong>
              <span>Shows the prompt first, then reveals the answer so you can mark whether you remembered it.</span>
            </button>
          </div>
        </fieldset>

        {settings.mode === "timed" ? (
          <label className="time-limit-control">
            <span>Time Limit</span>
            <select value={settings.timeLimitMinutes} onChange={(event) => updateSetting("timeLimitMinutes", Number(event.target.value))}>
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={15}>15 minutes</option>
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </label>
        ) : null}

        <button
          className="button primary large"
          type="button"
          onClick={() => settings.mode === "mistakes"
            ? startQuiz(mistakeIds, { questionCount: mistakeIds.length, questionOrder: "original" })
            : startQuiz()}
          disabled={settings.mode === "mistakes" && !mistakeIds.length}
        >
          <Play size={18} aria-hidden="true" />
          Start Quiz
        </button>
      </section>

      <button className="button subtle flashcard-toggle" type="button" onClick={() => setFlashcardsVisible((current) => !current)} aria-expanded={flashcardsVisible}>
        {flashcardsVisible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        {flashcardsVisible ? "Hide Flashcards" : "View Flashcards"}
      </button>

      {flashcardsVisible ? (
      <section className="setup-panel flashcard-review-panel">
        <div className="reviewer-head-row">
          <div className="reviewer-head-copy">
            <p className="eyebrow">Flashcard review</p>
            <h2>All Flashcards</h2>
            <p className="muted">Browse every question with its answer. Scroll through to study the whole reviewer at a glance.</p>
          </div>
          <label className="flashcard-limit-control">
            <span>Cards to show</span>
            <select
              value={flashcardLimit}
              onChange={(event) => setFlashcardLimit(event.target.value === "all" ? "all" : Number(event.target.value))}
            >
              {FLASHCARD_LIMIT_OPTIONS.map((option) => (
                <option key={option} value={option}>{option === "all" ? "All" : option}</option>
              ))}
            </select>
          </label>
        </div>

        <ol className="flashcard-review-list">
          {visibleFlashcards.map((question, index) => (
            <li className="flashcard-review-card" key={question.id}>
              <span className="flashcard-index" aria-hidden="true">{index + 1}</span>
              <div className="flashcard-review-body">
                <div className="flashcard-review-front">
                  <p className="topic-label">{question.topic}</p>
                  <h3>{question.question}</h3>
                </div>
                <div className="flashcard-review-back">
                  <p>
                    <span>Answer</span>
                    <strong>{question.answerText || question.choices?.[question.correctAnswer] || "No answer stored."}</strong>
                  </p>
                  {question.explanation ? <p className="muted">{question.explanation}</p> : null}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {visibleFlashcards.length ? (
          <p className="muted flashcard-review-count">
            Showing {visibleFlashcards.length} of {reviewer.questions.length} cards
          </p>
        ) : null}
      </section>
      ) : null}

      <ConfirmModal
        open={showStartOver}
        title="Start Over?"
        message="This will replace your unfinished quiz for this reviewer."
        confirmLabel="Start Over"
        onCancel={() => setShowStartOver(false)}
        onConfirm={() => {
          clearQuizProgress(reviewer.reviewerId);
          pushRemovedProgressToCloud(reviewer.reviewerId);
          setShowStartOver(false);
          startQuiz();
        }}
      />
    </div>
  );
}
