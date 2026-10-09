import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Grid3X3, X } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import QuizQuestion from "../components/QuizQuestion.jsx";
import QuestionNavigator from "../components/QuestionNavigator.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { useReviewer } from "../hooks/useReviewer.js";
import { clearQuizProgress, loadQuizProgress, markStudyDay, saveAttempt, saveQuizProgress } from "../utils/storageUtils.js";
import { cancelProgressSync, pushAttemptToCloud, pushRemovedProgressToCloud, scheduleProgressSync, scheduleStudyDaySync } from "../services/syncEngine.js";
import { createAttemptFromSession, formatDuration, getQuestionResult, getSessionElapsed, isAnswerCorrect, isTypedQuestion, pauseQuizSession, refreshSessionAnswerKey, resumeQuizSession } from "../utils/quizUtils.js";
import { countResolved, createPracticeTracker, getDueRetry, getMostUrgentRetry, markRetryServed, recordPracticeOutcome, shiftPendingEligibility, summarizePractice } from "../utils/practiceRetry.js";
import { holdBusyWork } from "../utils/busyWork.js";
import hachiDogHearts from "../assets/hachi-dog-hearts.gif";
import hachiDogLying from "../assets/hachi-dog-lying.gif";

function isTypingTarget(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName) || target?.isContentEditable;
}

function dedupeQuestionsById(questions) {
  const seen = new Set();
  return (questions || []).filter((question) => {
    if (!question?.id || seen.has(question.id)) return false;
    seen.add(question.id);
    return true;
  });
}

export default function Quiz() {
  const { reviewerId } = useParams();
  const navigate = useNavigate();
  const { reviewer, hasQuestions } = useReviewer(reviewerId);
  const [session, setSession] = useState(() => resumeQuizSession(loadQuizProgress(reviewerId)));
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const sessionRef = useRef(session);
  const completedRef = useRef(false);
  sessionRef.current = session;

  const currentQuestion = session?.questions[session.currentIndex];
  const mode = session?.settings.mode;
  const selectedAnswer = currentQuestion ? session.answers[currentQuestion.id] : null;
  const currentQuestionIsTyped = currentQuestion ? isTypedQuestion(currentQuestion) : false;
  const isImmediateMode = mode === "practice" || mode === "mistakes";
  const isFlashcardMode = mode === "flashcard";
  const isPracticeSubmitted = currentQuestion ? Boolean(session.submittedQuestions[currentQuestion.id]) : false;
  const isPracticeRevealed = isImmediateMode && (currentQuestionIsTyped ? isPracticeSubmitted : Boolean(selectedAnswer));
  const isFlashcardRevealed = isFlashcardMode && isPracticeSubmitted;
  const isLastQuestion = session ? session.currentIndex === session.questions.length - 1 : false;
  const timeLimit = mode === "timed" ? (session.settings.timeLimitMinutes || 15) * 60 * 1000 : null;
  const remainingTime = timeLimit === null ? null : Math.max(0, timeLimit - elapsed);
  const isQuizRunning = Boolean(session) && !session.completed;

  useEffect(() => {
    if (!session) return;
    const nextSession = { ...session, updatedAt: Date.now() };
    saveQuizProgress(nextSession);
    scheduleProgressSync(nextSession);
  }, [session]);

  // A running quiz holds the update reload. The session is saved on every
  // change, so a reload would not lose the answers, but it would drop the
  // reader back into the middle of a timed paper without warning.
  useEffect(() => {
    if (!isQuizRunning) return undefined;
    return holdBusyWork("quiz");
  }, [isQuizRunning]);

  // The session froze the answer key it started with, so an owner who corrects
  // a question while this quiz is in progress would otherwise leave it marking
  // the old key. Rebuilt once the reviewer is in hand, which for a shared
  // reviewer is after the fetch this page made. An unchanged key returns the
  // same session, so this settles rather than re-rendering.
  useEffect(() => {
    if (!session || session.completed || !hasQuestions) return;
    setSession((current) => refreshSessionAnswerKey(current, reviewer));
  }, [reviewer, hasQuestions, session?.sessionId, session?.completed]);

  useEffect(() => {
    if (!session || mode !== "practice" || session.practice) return;
    // Sessions saved before the retry tracker existed adopt it on open.
    setSession((current) => current && !current.practice
      ? {
          ...current,
          practice: createPracticeTracker(),
          entryMeta: current.entryMeta || current.questions.map(() => ({ retry: false })),
          originalQuestionCount: current.originalQuestionCount || current.questions.length
        }
      : current);
  }, [session, mode]);

  useEffect(() => {
    if (!session) return;
    const tick = () => setElapsed(getSessionElapsed(session));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [session?.startedAt, session?.elapsedBeforePause]);

  // Leaving the quiz, closing the tab, or reloading all stop the clock. Without
  // this the session keeps a startedAt from the previous visit, and the gap gets
  // counted as work the next time the quiz is opened.
  useEffect(() => {
    const stopClock = () => {
      const current = sessionRef.current;
      if (!current || current.completed || completedRef.current) return;
      saveQuizProgress({ ...pauseQuizSession(current), updatedAt: Date.now() });
    };

    window.addEventListener("pagehide", stopClock);
    return () => {
      window.removeEventListener("pagehide", stopClock);
      stopClock();
    };
  }, []);

  useEffect(() => {
    if (!session || mode !== "timed" || remainingTime !== 0) return;
    completeQuiz();
  }, [session, mode, remainingTime]);

  useEffect(() => {
    if (!session || !currentQuestion) return;
    const handler = (event) => {
      if (isTypingTarget(event.target)) return;

      if (!currentQuestionIsTyped && ["1", "2", "3", "4"].includes(event.key)) {
        const choice = currentQuestion.choices[Number(event.key) - 1];
        if (choice && !(mode === "practice" && isPracticeRevealed)) {
          chooseAnswer(choice.value);
        }
      }

      if (event.key === "Enter") {
        if (isFlashcardMode) {
          if (!isFlashcardRevealed) revealFlashcard();
          return;
        }
        if (isImmediateMode) {
          if (currentQuestionIsTyped && selectedAnswer && !isPracticeRevealed) {
            submitTypedPracticeAnswer();
            return;
          }
          if (isPracticeRevealed) goNextOrFinish();
        } else if (isLastQuestion) {
          setConfirmSubmit(true);
        } else if (selectedAnswer) {
          goNext();
        }
      }

      if (event.key === "ArrowLeft") goPrevious();
      if (event.key === "ArrowRight") {
        if (isImmediateMode) {
          if (isPracticeRevealed && !isLastQuestion) goNext();
        } else if (isFlashcardMode) {
          if (selectedAnswer && !isLastQuestion) goNext();
        } else {
          goNext();
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const answeredCount = useMemo(() => (session ? Object.values(session.answers).filter((answer) => String(answer || "").trim()).length : 0), [session]);
  const isPractice = mode === "practice" && session?.practice;
  const practiceResolved = isPractice ? countResolved(session.practice) : 0;
  const practiceTotal = isPractice ? session.originalQuestionCount || session.questions.length : 0;
  const currentIsRetry = isPractice && Boolean(session.entryMeta?.[session.currentIndex]?.retry);

  if (!reviewer || !session || !Array.isArray(session.questions) || session.questions.length === 0 || !currentQuestion) {
    return (
      <EmptyState
        title="No active quiz"
        message="Start or continue a reviewer quiz first."
        action={<Link className="button primary" to={reviewer ? `/reviewer/${reviewerId}` : "/home"}>Back to Reviewer</Link>}
      />
    );
  }

  function patchSession(patch) {
    // Answering, revealing a card, or typing an answer is what counts as study.
    // Moving between questions is not, so a learner who only clicks through the
    // navigation does not quietly bank a day. Marking here covers every mode,
    // including a session resumed on a later day.
    if (patch.answers || patch.submittedQuestions) {
      markStudyDay();
      scheduleStudyDaySync();
    }
    setSession((current) => ({ ...current, ...patch }));
  }

  function recordPracticeAnswer(question, answer) {
    if (mode !== "practice" || !session.practice) return null;
    const isRetry = Boolean(session.entryMeta?.[session.currentIndex]?.retry);
    return recordPracticeOutcome(session.practice, question, isAnswerCorrect(question, answer), isRetry, session.currentIndex, answer);
  }

  function scrollToBottom() {
    // The feedback panel sits below the answers, and on a long question the
    // reveal can land off-screen, so the answer a person just gave would look
    // like nothing happened. Scrolling to the end also brings the Next button
    // into view, which is the only way forward from here.
    requestAnimationFrame(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    });
  }

  function scrollToTop() {
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function chooseAnswer(answer) {
    if (isImmediateMode && (isPracticeRevealed || isPracticeSubmitted)) return;
    if (currentQuestionIsTyped) {
      patchSession({ answers: { ...session.answers, [currentQuestion.id]: answer } });
      return;
    }
    if (mode === "exam") {
      patchSession({ answers: { ...session.answers, [currentQuestion.id]: answer } });
      return;
    }
    patchSession({
      answers: { ...session.answers, [currentQuestion.id]: answer },
      submittedQuestions: { ...session.submittedQuestions, [currentQuestion.id]: true },
      ...(mode === "practice" ? { practice: recordPracticeAnswer(currentQuestion, answer) } : {})
    });
    scrollToBottom();
  }

  function submitTypedPracticeAnswer() {
    if (!selectedAnswer?.trim()) return;
    patchSession({
      submittedQuestions: { ...session.submittedQuestions, [currentQuestion.id]: true },
      ...(mode === "practice" ? { practice: recordPracticeAnswer(currentQuestion, selectedAnswer) } : {})
    });
    scrollToBottom();
  }

  function revealFlashcard() {
    patchSession({
      submittedQuestions: { ...session.submittedQuestions, [currentQuestion.id]: true }
    });
    scrollToBottom();
  }

  function gradeFlashcard(answer) {
    const nextSession = {
      ...session,
      answers: { ...session.answers, [currentQuestion.id]: answer },
      submittedQuestions: { ...session.submittedQuestions, [currentQuestion.id]: true }
    };

    if (isLastQuestion) {
      completeQuiz(nextSession);
      return;
    }

    setSession({ ...nextSession, currentIndex: session.currentIndex + 1 });
    scrollToTop();
  }

  function goPrevious() {
    if (mode === "practice") return;
    if (session.currentIndex > 0) {
      patchSession({ currentIndex: session.currentIndex - 1 });
      scrollToTop();
    }
  }

  function goNext() {
    if (!isLastQuestion) {
      patchSession({ currentIndex: session.currentIndex + 1 });
      scrollToTop();
    }
  }

  function completeQuiz(sessionOverride = session) {
    // The attempt reads the elapsed time from the session itself. Overwriting
    // elapsedBeforePause here would bank the whole total and then add the
    // running segment again, so every attempt came out at roughly double.
    completedRef.current = true;
    // A practice session's question list carries retries, so the attempt is
    // built from one entry per question: the last answer to each decides.
    const attemptSession = mode === "practice"
      ? { ...sessionOverride, questions: dedupeQuestionsById(sessionOverride.questions) }
      : sessionOverride;
    const finalSession = { ...attemptSession, completed: true };
    const attempt = createAttemptFromSession(finalSession);

    if (mode === "practice" && sessionOverride.practice) {
      attempt.practiceStats = summarizePractice(sessionOverride.practice);
      // Retries always bring practice to 100% mastery, so the headline score and
      // topics reflect first-try correctness — that is the honest measure here.
      const statsByQuestion = sessionOverride.practice.stats || {};
      const firstTryIds = Object.keys(statsByQuestion);
      const firstTryCorrect = firstTryIds.filter((id) => statsByQuestion[id].firstTryCorrect === true);
      const topicStats = new Map();

      for (const question of attemptSession.questions) {
        const correct = statsByQuestion[question.id]?.firstTryCorrect === true;
        const current = topicStats.get(question.topic || "General") || { topic: question.topic || "General", total: 0, correct: 0, incorrect: 0, percentage: 0 };
        current.total += 1;
        current.correct += correct ? 1 : 0;
        current.incorrect += correct ? 0 : 1;
        current.percentage = current.total ? Math.round((current.correct / current.total) * 100) : 0;
        topicStats.set(current.topic, current);
      }

      attempt.score = firstTryCorrect.length;
      attempt.correctAnswers = firstTryCorrect.length;
      attempt.totalQuestions = attemptSession.questions.length;
      attempt.percentage = attempt.totalQuestions ? Math.round((attempt.score / attempt.totalQuestions) * 100) : 0;
      attempt.wrongAnswers = attempt.totalQuestions - attempt.score;
      attempt.topicStats = [...topicStats.values()].sort((a, b) => a.percentage - b.percentage || b.total - a.total);
      attempt.incorrectQuestionIds = firstTryIds.filter((id) => statsByQuestion[id].firstTryCorrect !== true);
      attempt.weakTopics = attempt.topicStats.filter((topic) => topic.percentage < 70).map((topic) => topic.topic);
      // What the learner picked the first time round, which is what the score
      // above reflects. Without this the answers map holds the last answer, and
      // every question the retries fixed would read as correct on review.
      attempt.firstTryAnswers = Object.fromEntries(
        firstTryIds
          .filter((id) => statsByQuestion[id].firstTryAnswer !== undefined)
          .map((id) => [id, statsByQuestion[id].firstTryAnswer])
      );
    }

    saveAttempt(attempt);
    clearQuizProgress(session.reviewerId);
    cancelProgressSync(session.reviewerId);
    pushAttemptToCloud(attempt);
    pushRemovedProgressToCloud(session.reviewerId);
    navigate(`/results/${session.reviewerId}?attempt=${attempt.attemptId}`);
  }

  function insertRetryQuestion(entry, nextIndex) {
    const source = session.questions.find((question) => question.id === entry.id);
    const practiceAfterServed = markRetryServed(session.practice, entry.id, source?.topic);

    if (!source) {
      setSession((current) => ({
        ...current,
        practice: { ...practiceAfterServed, pending: practiceAfterServed.pending.filter((item) => item.id !== entry.id) },
        currentIndex: nextIndex
      }));
      return;
    }

    const answers = { ...session.answers };
    delete answers[entry.id];
    const submittedQuestions = { ...session.submittedQuestions };
    delete submittedQuestions[entry.id];
    const questions = [...session.questions];
    questions.splice(nextIndex, 0, source);
    const entryMeta = [...(session.entryMeta || session.questions.map(() => ({ retry: false })))];
    entryMeta.splice(nextIndex, 0, { retry: true });

    setSession((current) => ({
      ...current,
      questions,
      entryMeta,
      answers,
      submittedQuestions,
      currentIndex: nextIndex,
      practice: shiftPendingEligibility(
        { ...practiceAfterServed, pending: practiceAfterServed.pending.filter((item) => item.id !== entry.id) },
        nextIndex
      )
    }));
  }

  function goNextOrFinish() {
    if (mode === "practice") scrollToTop();
    if (mode === "practice" && session.practice) {
      const nextIndex = session.currentIndex + 1;
      const atEnd = nextIndex >= session.questions.length;
      const due = getDueRetry(session.practice, nextIndex);

      if (due) {
        insertRetryQuestion(due, nextIndex);
        return;
      }

      if (atEnd) {
        const urgent = getMostUrgentRetry(session.practice);
        if (urgent) {
          insertRetryQuestion(urgent, nextIndex);
          return;
        }
        completeQuiz();
        return;
      }

      goNext();
      return;
    }

    if (isLastQuestion) completeQuiz();
    else goNext();
  }

  const result = currentQuestion ? getQuestionResult(currentQuestion, selectedAnswer) : null;

  return (
    <div className="quiz-layout">
      <section className="quiz-topbar">
        <div>
          <p className="eyebrow">{session.subject}</p>
          <h1>
            {isPractice
              ? `${practiceResolved} of ${practiceTotal} answered`
              : `Question ${session.currentIndex + 1} of ${session.questions.length}`}
          </h1>
          {currentIsRetry ? <p className="retry-notice">Encore! You got this one wrong earlier — try it again!</p> : null}
        </div>
        <div className="quiz-meta">
          {mode === "timed" ? <span className={`timer ${remainingTime === 0 ? "danger" : ""}`}>{formatDuration(remainingTime)}</span> : null}
          {mode === "exam" ? <span className="timer">{formatDuration(elapsed)}</span> : null}
          {mode !== "practice" ? (
            <button className="button subtle" type="button" onClick={() => setNavigatorOpen(true)}>
              <Grid3X3 size={17} aria-hidden="true" />
              Questions
            </button>
          ) : null}
          <button className="button subtle" type="button" onClick={() => setConfirmLeave(true)}>
            Leave
          </button>
        </div>
      </section>

      <ProgressBar
        value={isPractice ? practiceResolved : session.currentIndex + 1}
        max={isPractice ? practiceTotal : session.questions.length}
        label="Quiz progress"
      />

      {isFlashcardMode ? (
        <section className="question-panel flashcard-panel">
          <div className="question-prompt">
            <p className="topic-label">{currentQuestion.topic}</p>
            <h1>{currentQuestion.question}</h1>
          </div>
          {isFlashcardRevealed ? (
            <div className="flashcard-answer">
              <span>Answer</span>
              <strong>{currentQuestion.answerText}</strong>
              <p>{currentQuestion.explanation}</p>
            </div>
          ) : null}
        </section>
      ) : (
        <QuizQuestion
          question={currentQuestion}
          selectedAnswer={selectedAnswer}
          revealed={isPracticeRevealed}
          locked={isPracticeRevealed}
          onSelect={chooseAnswer}
        />
      )}

      {isPracticeRevealed ? (
        <section className={`feedback-panel ${result.isCorrect ? "success answer-pop" : "danger answer-shake"}`}>
          <div className="feedback-head">
            <div className="feedback-status">
              <span className="feedback-status-icon" aria-hidden="true">
                {result.isCorrect ? <Check size={22} strokeWidth={2.6} /> : <X size={22} strokeWidth={2.6} />}
              </span>
              <div className="feedback-status-text">
                <h2>{result.isCorrect ? "Correct!" : "Incorrect"}</h2>
                <p>{result.isCorrect ? "Hachi approves." : "Hachi will get you there."}</p>
              </div>
            </div>
            {mode === "practice" ? (
              <div className="feedback-dog" aria-hidden="true">
                <img src={result.isCorrect ? hachiDogHearts : hachiDogLying} alt="" />
              </div>
            ) : null}
          </div>
          <dl className="feedback-details">
            <div className="feedback-row">
              <dt>Your answer</dt>
              <dd>{result.selectedText}</dd>
            </div>
            <div className="feedback-row">
              <dt>Correct answer</dt>
              <dd>{result.correctText}</dd>
            </div>
          </dl>
          <div className="feedback-note">
            <span>Explanation</span>
            <p>{currentQuestion.explanation}</p>
          </div>
        </section>
      ) : null}

      <section className="quiz-actions">
        {mode !== "practice" ? (
          <button className="button subtle" type="button" onClick={goPrevious} disabled={session.currentIndex === 0}>
            <ArrowLeft size={17} aria-hidden="true" />
            Previous
          </button>
        ) : (
          <span />
        )}

        <span className="answered-count">
          {isPractice ? Object.keys(session.practice.stats).length : answeredCount} answered
        </span>

        {isFlashcardMode ? (
          isFlashcardRevealed ? (
            <>
              <button className="button subtle" type="button" onClick={() => gradeFlashcard("__incorrect")}>
                Missed
              </button>
              <button className="button primary" type="button" onClick={() => gradeFlashcard("__correct")}>
                Got It
              </button>
            </>
          ) : (
            <button className="button primary" type="button" onClick={revealFlashcard}>
              Show Answer
            </button>
          )
        ) : isImmediateMode ? (
          isPracticeRevealed ? (
            <button className="button primary" type="button" onClick={goNextOrFinish}>
              {isLastQuestion ? "Finish Quiz" : "Next Question"}
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          ) : currentQuestionIsTyped ? (
            <button className="button primary" type="button" onClick={submitTypedPracticeAnswer} disabled={!selectedAnswer?.trim()}>
              Check Answer
            </button>
          ) : (
            <span className="answered-count">Select an answer to check it</span>
          )
        ) : isLastQuestion ? (
          <button className="button primary" type="button" onClick={() => setConfirmSubmit(true)}>
            Submit Quiz
          </button>
        ) : (
          <button className="button primary" type="button" onClick={goNext}>
            Next
            <ArrowRight size={17} aria-hidden="true" />
          </button>
        )}
      </section>

      {mode !== "practice" ? (
        <QuestionNavigator
          open={navigatorOpen}
          questions={session.questions}
          currentIndex={session.currentIndex}
          answers={session.answers}
          submittedQuestions={session.submittedQuestions}
          onJump={(index) => {
            patchSession({ currentIndex: index });
            scrollToTop();
          }}
          onClose={() => setNavigatorOpen(false)}
        />
      ) : null}

      <ConfirmModal
        open={confirmSubmit}
        title="Submit Quiz?"
        message="Are you sure you want to submit your quiz?"
        confirmLabel="Submit Quiz"
        onCancel={() => setConfirmSubmit(false)}
        onConfirm={() => completeQuiz()}
      />

      <ConfirmModal
        open={confirmLeave}
        title="Leave Quiz?"
        message="Your progress has been saved and you can continue later."
        cancelLabel="Stay"
        confirmLabel="Leave Quiz"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate(`/reviewer/${session.reviewerId}`)}
      />
    </div>
  );
}
