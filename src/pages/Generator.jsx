import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Loader2, Plus, RotateCcw, Save, Sparkles, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { validateReviewer } from "../data/reviewerRegistry.js";
import { clearGeneratorDraft, getGeneratorDraft, saveGeneratorDraft } from "../utils/storageUtils.js";
import { inferQuestionStyle } from "../utils/quizUtils.js";
import ExamPaperMode from "./generator/ExamPaperMode.jsx";
import StudyMaterialMode from "./generator/StudyMaterialMode.jsx";
import {
  DEFAULT_EXAM_INSTRUCTIONS,
  DEFAULT_INSTRUCTIONS,
  QUESTION_STYLES,
  QUESTION_TYPE_OPTIONS,
  slugify
} from "./generator/generatorShared.js";
import { persistReviewer } from "./generator/generatorApi.js";

const emptyQuestion = {
  type: "multiple_choice",
  topic: "",
  difficulty: "easy",
  style: "direct",
  question: "",
  A: "",
  B: "",
  C: "",
  D: "",
  correctAnswer: "A",
  answer: "",
  explanation: ""
};

// Two separate modes rather than one form with extra switches. Writing questions
// from a module and transcribing an exam paper want opposite things from the same
// fields, and a combined form ends up conditional on almost every line of it.
const GENERATOR_MODES = [
  {
    value: "material",
    label: "Study Material",
    heading: "Generate Reviewer",
    description: "Upload notes, a PDF, or a photo of a page. The AI writes new questions from it.",
    icon: Sparkles
  },
  {
    value: "exam",
    label: "Exam Paper",
    heading: "Import Exam Paper",
    description: "Upload an existing exam paper. The AI copies it as printed and attaches an answer key.",
    icon: FileText
  }
];

function buildReviewer({ title, subject, instructions }, questions) {
  const safeTitle = title.trim();
  const safeSubject = subject.trim();
  const reviewerQuestions = questions.map((question, index) => {
    const type = ["multiple_choice", "true_false", "identification", "flashcard"].includes(question.type)
      ? question.type
      : "multiple_choice";
    const difficulty = ["easy", "medium", "hard"].includes(question.difficulty) ? question.difficulty : "easy";
    const base = {
      id: index + 1,
      type,
      difficulty,
      style: QUESTION_STYLES.includes(question.style) ? question.style : inferQuestionStyle(question.question),
      topic: question.topic.trim(),
      question: question.question.trim(),
      explanation: question.explanation.trim()
    };

    if (type === "true_false") {
      const correctAnswer = question.correctAnswer === "B" ? "B" : "A";
      const choices = { A: question.A.trim() || "True", B: question.B.trim() || "False", C: "", D: "" };
      return { ...base, choices, correctAnswer, answerText: choices[correctAnswer] };
    }

    if (type === "identification" || type === "flashcard") {
      return { ...base, choices: {}, correctAnswer: "TEXT", answerText: question.answer.trim() };
    }

    const choices = {
      A: question.A.trim(),
      B: question.B.trim(),
      C: question.C.trim(),
      D: question.D.trim()
    };

    return { ...base, choices, correctAnswer: question.correctAnswer, answerText: choices[question.correctAnswer] || "" };
  });

  return {
    reviewerId: `${slugify(safeTitle || safeSubject || "generated-reviewer")}-${Date.now()}`,
    title: safeTitle,
    subject: safeSubject,
    coverage: [...new Set(reviewerQuestions.map((question) => question.topic).filter(Boolean))],
    questionCount: reviewerQuestions.length,
    questionType: "multiple_choice",
    choicesPerQuestion: 4,
    instructions: instructions.trim() || DEFAULT_INSTRUCTIONS,
    questions: reviewerQuestions
  };
}

export default function Generator() {
  const navigate = useNavigate();
  const { configured, user } = useAuth();
  const savedDraft = getGeneratorDraft();
  const skipNextAutosave = useRef(false);
  const hasMounted = useRef(false);

  // Drafts written before the modes were split were flat, and everything in them was
  // the study material form. Reading the flat shape as the material slice keeps an
  // in-progress draft instead of silently dropping it on upgrade.
  const materialDraft = savedDraft?.material || savedDraft || {};
  const examDraft = savedDraft?.exam || {};
  const manualDraft = savedDraft?.manual || {};

  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [mode, setMode] = useState(() => (savedDraft?.mode === "exam" ? "exam" : "material"));

  const [materialDetails, setMaterialDetails] = useState({
    title: materialDraft.details?.title || "",
    subject: materialDraft.details?.subject || "",
    instructions: materialDraft.details?.instructions || DEFAULT_INSTRUCTIONS
  });
  const [materialSlice, setMaterialSlice] = useState({
    sourceText: materialDraft.sourceText || "",
    targetQuestionCount: materialDraft.targetQuestionCount || "50",
    difficulty: materialDraft.difficulty || "mixed",
    questionType: materialDraft.questionType || "multiple_choice",
    moreQuestionCount: materialDraft.moreQuestionCount || "20",
    jsonText: materialDraft.jsonText || ""
  });
  const [examDetails, setExamDetails] = useState({
    title: examDraft.details?.title || "",
    subject: examDraft.details?.subject || ""
  });
  const [examSlice, setExamSlice] = useState({
    notes: examDraft.notes || "",
    answerSource: examDraft.answerSource || "solve",
    instructions: examDraft.instructions || DEFAULT_EXAM_INSTRUCTIONS,
    jsonText: examDraft.jsonText || ""
  });
  const [questionDraft, setQuestionDraft] = useState(
    manualDraft.questionDraft ? { ...emptyQuestion, ...manualDraft.questionDraft } : emptyQuestion
  );
  const [manualQuestions, setManualQuestions] = useState(manualDraft.questions || []);
  const [saveOfflineCopy, setSaveOfflineCopy] = useState(materialDraft.saveOfflineCopy || false);

  const [errors, setErrors] = useState([]);
  const [isSavingReviewer, setIsSavingReviewer] = useState(false);
  const [draftMessage, setDraftMessage] = useState(savedDraft?.savedAt ? `Draft restored from ${new Date(savedDraft.savedAt).toLocaleString()}.` : "");

  const activeMode = GENERATOR_MODES.find((entry) => entry.value === mode) || GENERATOR_MODES[0];
  const ActiveModeIcon = activeMode.icon;

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  // Written here rather than in each mode so there is exactly one writer for the
  // draft key. Attached files are deliberately absent: they are not saved, because a
  // base64 photo in localStorage would spend the storage quota the offline reviewers
  // depend on.
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }

    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }

    saveGeneratorDraft({
      mode,
      material: { details: materialDetails, ...materialSlice, saveOfflineCopy },
      exam: { details: examDetails, ...examSlice },
      manual: { questionDraft, questions: manualQuestions }
    });
    setDraftMessage("Draft saved on this device.");
  }, [mode, materialDetails, materialSlice, saveOfflineCopy, examDetails, examSlice, questionDraft, manualQuestions]);

  const updateMaterialDetails = useCallback((key, value) => {
    setMaterialDetails((current) => ({ ...current, [key]: value }));
  }, []);

  const updateExamDetails = useCallback((key, value) => {
    setExamDetails((current) => ({ ...current, [key]: value }));
  }, []);

  // Stable identity, so a mode's own autosave effect does not re-fire every time the
  // shell re-renders and hands it a fresh callback.
  const patchMaterialSlice = useCallback((changes) => {
    setMaterialSlice((current) => ({ ...current, ...changes }));
  }, []);

  const patchExamSlice = useCallback((changes) => {
    setExamSlice((current) => ({ ...current, ...changes }));
  }, []);

  const forgetDraft = useCallback(() => {
    clearGeneratorDraft();
    skipNextAutosave.current = true;
  }, []);

  const navigateToReviewer = useCallback((reviewerId, { edit = false } = {}) => {
    if (!reviewerId) return;
    navigate(`/reviewer/${reviewerId}${edit ? "?edit=1" : ""}`);
  }, [navigate]);

  function updateQuestion(key, value) {
    if (key !== "type") {
      setQuestionDraft((current) => ({ ...current, [key]: value }));
      return;
    }

    setQuestionDraft((current) => {
      const next = { ...current, type: value };

      if (value === "true_false") {
        next.A = "True";
        next.B = "False";
        next.C = "";
        next.D = "";
        next.answer = "";
        next.correctAnswer = current.correctAnswer === "B" ? "B" : "A";
      } else if (value === "identification" || value === "flashcard") {
        next.A = "";
        next.B = "";
        next.C = "";
        next.D = "";
        next.answer = current.answer || "";
        next.correctAnswer = "TEXT";
      } else {
        next.A = current.A || "";
        next.B = current.B || "";
        next.C = current.C || "";
        next.D = current.D || "";
        next.answer = "";
        next.correctAnswer = current.correctAnswer === "TEXT" ? "A" : current.correctAnswer || "A";
      }

      return next;
    });
  }

  function validateQuestionDraft() {
    const type = questionDraft.type || "multiple_choice";
    const isTyped = type === "identification" || type === "flashcard";
    const required = ["topic", "question", "explanation"];

    if (type === "multiple_choice") required.push("A", "B", "C", "D");
    if (isTyped) required.push("answer");

    return required.some((field) => !questionDraft[field].trim())
      ? ["Complete the question fields before adding it."]
      : [];
  }

  function addQuestion() {
    const draftErrors = validateQuestionDraft();

    if (draftErrors.length) {
      setErrors(draftErrors);
      return;
    }

    setManualQuestions((current) => [...current, questionDraft]);
    setQuestionDraft(emptyQuestion);
    setErrors([]);
  }

  async function saveDraftReviewer() {
    const reviewer = buildReviewer(materialDetails, manualQuestions);
    const validation = validateReviewer(reviewer);
    const nextErrors = [];

    if (!materialDetails.title.trim()) nextErrors.push("Add a reviewer title.");
    if (!materialDetails.subject.trim()) nextErrors.push("Add a subject.");
    if (!manualQuestions.length) nextErrors.push("Add at least one question.");
    if (!validation.isValid) nextErrors.push(...validation.errors);

    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    setIsSavingReviewer(true);

    try {
      await persistReviewer({ configured, user, reviewer, saveOffline: saveOfflineCopy });
      forgetDraft();
      navigateToReviewer(reviewer.reviewerId);
    } catch (error) {
      setErrors([error?.message || "Could not save reviewer."]);
    } finally {
      setIsSavingReviewer(false);
    }
  }

  function clearDraft() {
    clearGeneratorDraft();
    skipNextAutosave.current = true;
    hasMounted.current = true;
    setMode("material");
    setMaterialDetails({ title: "", subject: "", instructions: DEFAULT_INSTRUCTIONS });
    setMaterialSlice({
      sourceText: "",
      targetQuestionCount: "50",
      difficulty: "mixed",
      questionType: "multiple_choice",
      moreQuestionCount: "20",
      jsonText: ""
    });
    setExamDetails({ title: "", subject: "" });
    setExamSlice({ notes: "", answerSource: "solve", instructions: DEFAULT_EXAM_INSTRUCTIONS, jsonText: "" });
    setQuestionDraft(emptyQuestion);
    setManualQuestions([]);
    setSaveOfflineCopy(false);
    setErrors([]);
    setDraftMessage("Draft cleared.");
  }

  return (
    <div className="page generator-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">AI Generator</p>
          <h1>Generate a reviewer</h1>
          <p className="muted">Upload study material or an existing exam paper, then save the result for offline study.</p>
          {draftMessage ? <p className="draft-save-note">{draftMessage}</p> : null}
        </div>
        <div className="generator-heading-actions">
          <span className={`generator-status ${isOnline ? "online" : "offline"}`}>
            {isOnline ? <Wifi size={17} aria-hidden="true" /> : <WifiOff size={17} aria-hidden="true" />}
            {isOnline ? "Online" : "Offline"}
          </span>
          <button className="button subtle" type="button" onClick={clearDraft}>
            <RotateCcw size={17} aria-hidden="true" />
            Clear Draft
          </button>
        </div>
      </section>

      <section className="generator-layout">
        <div className="generator-panel">
          <div className="generator-mode-tabs" role="tablist" aria-label="Generator mode">
            {GENERATOR_MODES.map((entry) => {
              const Icon = entry.icon;
              const isActive = mode === entry.value;

              return (
                <button
                  key={entry.value}
                  type="button"
                  role="tab"
                  id={`generator-tab-${entry.value}`}
                  aria-selected={isActive}
                  aria-controls={`generator-panel-${entry.value}`}
                  className={`generator-mode-tab${isActive ? " active" : ""}`}
                  onClick={() => setMode(entry.value)}
                >
                  <Icon size={17} aria-hidden="true" />
                  {entry.label}
                </button>
              );
            })}
          </div>

          <div
            className="generator-mode-body"
            role="tabpanel"
            id={`generator-panel-${activeMode.value}`}
            aria-labelledby={`generator-tab-${activeMode.value}`}
          >
            <div className="generator-panel-head">
              <ActiveModeIcon size={22} aria-hidden="true" />
              <div>
                <h2>{activeMode.heading}</h2>
                <p className="muted">{activeMode.description}</p>
              </div>
            </div>

            <div className="production-note" role="note">
              <strong>AI limits</strong>
              <span>Up to 6 attachments totalling 3 MB per request, up to 12 MB each for PDF text extraction, 45,000 characters of notes, 150 questions max, and 8 AI requests every 10 minutes per signed-in account. Guests are limited by connection.</span>
            </div>

            {/* Both modes stay mounted and the inactive one is hidden rather than
                unmounted. Rendering conditionally would throw away the half-finished
                form on the other tab, including a reviewer already generated there,
                and switching tabs has to be free. */}
            <div className="generator-mode-slot" hidden={mode !== "exam"}>
              <ExamPaperMode
                details={examDetails}
                updateDetails={updateExamDetails}
                draft={examSlice}
                onDraftChange={patchExamSlice}
                saveOfflineCopy={saveOfflineCopy}
                onSaveOfflineChange={setSaveOfflineCopy}
                isOnline={isOnline}
                onReviewerPersisted={forgetDraft}
                onNavigate={navigateToReviewer}
              />
            </div>

            <div className="generator-mode-slot" hidden={mode !== "material"}>
              <StudyMaterialMode
                details={materialDetails}
                updateDetails={updateMaterialDetails}
                draft={materialSlice}
                onDraftChange={patchMaterialSlice}
                saveOfflineCopy={saveOfflineCopy}
                onSaveOfflineChange={setSaveOfflineCopy}
                isOnline={isOnline}
                onReviewerPersisted={forgetDraft}
                onNavigate={navigateToReviewer}
              />
            </div>
          </div>

          {errors.length ? (
            <div className="generator-errors" role="alert">
              {errors.map((error) => <p key={error}>{error}</p>)}
            </div>
          ) : null}

          <details className="advanced-panel">
            <summary>Manual Builder</summary>
            <div className="generator-panel-head compact">
              <FileText size={20} aria-hidden="true" />
              <div>
                <h2>Manual Builder</h2>
                <p className="muted">Fallback for creating or testing a reviewer without AI. Reviewer options like question count, difficulty, and question types are chosen in the reviewer view.</p>
              </div>
            </div>

            <div className="generator-form-grid">
              <label>
                <span>Reviewer Title</span>
                <input value={materialDetails.title} onChange={(event) => updateMaterialDetails("title", event.target.value)} placeholder="Example: Biology Prelim Reviewer" />
              </label>
              <label>
                <span>Subject</span>
                <input value={materialDetails.subject} onChange={(event) => updateMaterialDetails("subject", event.target.value)} placeholder="Example: Biology" />
              </label>
            </div>

            <label className="prompt-box">
              <span>Instructions</span>
              <textarea value={materialDetails.instructions} onChange={(event) => updateMaterialDetails("instructions", event.target.value)} />
            </label>

            <div className="question-builder">
              <div className="generator-panel-head compact">
                <Sparkles size={20} aria-hidden="true" />
                <div>
                  <h2>Question {manualQuestions.length + 1}</h2>
                  <p className="muted">Pick a type and fill in its fields.</p>
                </div>
              </div>

              <div className="generator-form-grid">
                <label>
                  <span>Question Type</span>
                  <select value={questionDraft.type} onChange={(event) => updateQuestion("type", event.target.value)}>
                    {QUESTION_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Topic</span>
                  <input value={questionDraft.topic} onChange={(event) => updateQuestion("topic", event.target.value)} placeholder="Example: Photosynthesis" />
                </label>
                {questionDraft.type === "identification" || questionDraft.type === "flashcard" ? null : (
                  <label>
                    <span>Correct Answer</span>
                    <select value={questionDraft.correctAnswer} onChange={(event) => updateQuestion("correctAnswer", event.target.value)}>
                      {questionDraft.type === "true_false" ? (
                        <>
                          <option value="A">True</option>
                          <option value="B">False</option>
                        </>
                      ) : (
                        <>
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </>
                      )}
                    </select>
                  </label>
                )}
                <label>
                  <span>Difficulty</span>
                  <select value={questionDraft.difficulty} onChange={(event) => updateQuestion("difficulty", event.target.value)}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </label>
                <label>
                  <span>Question Style</span>
                  <select value={questionDraft.style} onChange={(event) => updateQuestion("style", event.target.value)}>
                    <option value="scenario">Exam-style scenario</option>
                    <option value="direct">Direct</option>
                  </select>
                </label>
                <span className="generator-note manual-difficulty-note">
                  Difficulty tags each question, just like AI-generated reviewers, so the quiz setup can filter by level. Question style controls the exam-style filter in the reviewer view.
                </span>
              </div>

              <label className="prompt-box">
                <span>Question</span>
                <textarea value={questionDraft.question} onChange={(event) => updateQuestion("question", event.target.value)} placeholder="Write the question here." />
              </label>

              {questionDraft.type === "multiple_choice" ? (
                <div className="choice-entry-grid">
                  {["A", "B", "C", "D"].map((letter) => (
                    <label key={letter}>
                      <span>{letter}</span>
                      <input value={questionDraft[letter]} onChange={(event) => updateQuestion(letter, event.target.value)} placeholder={`Choice ${letter}`} />
                    </label>
                  ))}
                </div>
              ) : questionDraft.type === "true_false" ? (
                <p className="muted builder-fixed-choices">
                  Choices are fixed to <strong>True</strong> and <strong>False</strong>.
                </p>
              ) : (
                <label className="prompt-box">
                  <span>Answer</span>
                  <textarea value={questionDraft.answer} onChange={(event) => updateQuestion("answer", event.target.value)} placeholder="Write the correct answer." />
                </label>
              )}

              <label className="prompt-box">
                <span>Explanation</span>
                <textarea value={questionDraft.explanation} onChange={(event) => updateQuestion("explanation", event.target.value)} placeholder="Explain why the correct answer is correct." />
              </label>

              <button className="button subtle" type="button" onClick={addQuestion}>
                <Plus size={18} aria-hidden="true" />
                Add Question
              </button>
            </div>

            <button className="button primary large" type="button" onClick={saveDraftReviewer} disabled={isSavingReviewer}>
              {isSavingReviewer ? <Loader2 className="spinner" size={18} aria-hidden="true" /> : <Save size={18} aria-hidden="true" />}
              {isSavingReviewer ? "Saving..." : configured && user ? "Save Manual to Cloud & Offline" : "Save Manual Offline"}
            </button>
          </details>
        </div>
      </section>
    </div>
  );
}