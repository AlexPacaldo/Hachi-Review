import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Grid3X3 } from "lucide-react";
import EmptyState from "../components/EmptyState.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import QuizQuestion from "../components/QuizQuestion.jsx";
import QuestionNavigator from "../components/QuestionNavigator.jsx";
import ConfirmModal from "../components/ConfirmModal.jsx";
import { getReviewerById } from "../data/reviewerRegistry.js";
import { clearQuizProgress, loadQuizProgress, markStudyDay, saveAttempt, saveQuizProgress } from "../utils/storageUtils.js";
import { cancelProgressSync, pushAttemptToCloud, pushRemovedProgressToCloud, scheduleProgressSync, scheduleStudyDaySync } from "../services/syncEngine.js";
import { createAttemptFromSession, formatDuration, getQuestionResult, getSessionElapsed, isAnswerCorrect, isTypedQuestion, pauseQuizSession, resumeQuizSession } from "../utils/quizUtils.js";
import { countResolved, createPracticeTracker, getDueRetry, getMostUrgentRetry, markRetryServed, recordPracticeOutcome, shiftPendingEligibility, summarizePractice } from "../utils/practiceRetry.js";
import { holdBusyWork } from "../utils/busyWork.js";

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
  const reviewer = getReviewerById(reviewerId);
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

  if (!reviewer || !session) {
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
    return recordPracticeOutcome(session.practice, question, isAnswerCorrect(question, answer), isRetry, session.currentIndex);
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
  }

  function submitTypedPracticeAnswer() {
    if (!selectedAnswer?.trim()) return;
    patchSession({
      submittedQuestions: { ...session.submittedQuestions, [currentQuestion.id]: true },
      ...(mode === "practice" ? { practice: recordPracticeAnswer(currentQuestion, selectedAnswer) } : {})
    });
  }

  function revealFlashcard() {
    patchSession({
      submittedQuestions: { ...session.submittedQuestions, [currentQuestion.id]: true }
    });
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
  }

  function goPrevious() {
    if (session.currentIndex > 0) patchSession({ currentIndex: session.currentIndex - 1 });
  }

  function goNext() {
    if (!isLastQuestion) patchSession({ currentIndex: session.currentIndex + 1 });
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
          {currentIsRetry ? <p className="muted">Revisiting a question you missed earlier.</p> : null}
        </div>
        <div className="quiz-meta">
          {mode === "timed" ? <span className={`timer ${remainingTime === 0 ? "danger" : ""}`}>{formatDuration(remainingTime)}</span> : null}
          {mode === "exam" ? <span className="timer">{formatDuration(elapsed)}</span> : null}
          <button className="button subtle" type="button" onClick={() => setNavigatorOpen(true)}>
            <Grid3X3 size={17} aria-hidden="true" />
            Questions
          </button>
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
        <section className={`feedback-panel ${result.isCorrect ? "success" : "danger"}`}>
          <h2>{result.isCorrect ? "Correct!" : "Incorrect"}</h2>
          <p>Your answer: <strong>{result.selectedText}</strong></p>
          <p>Correct answer: <strong>{result.correctText}</strong></p>
          <p><strong>Explanation:</strong> {currentQuestion.explanation}</p>
        </section>
      ) : null}

      <section className="quiz-actions">
        <button className="button subtle" type="button" onClick={goPrevious} disabled={session.currentIndex === 0}>
          <ArrowLeft size={17} aria-hidden="true" />
          Previous
        </button>

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

      <QuestionNavigator
        open={navigatorOpen}
        questions={session.questions}
        currentIndex={session.currentIndex}
        answers={session.answers}
        submittedQuestions={session.submittedQuestions}
        onJump={(index) => patchSession({ currentIndex: index })}
        onClose={() => setNavigatorOpen(false)}
      />

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
