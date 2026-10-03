import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileJson, FileText, Loader2, Plus, RotateCcw, Save, Sparkles, Upload, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useTurnstile } from "../hooks/useTurnstile.js";
import { validateReviewer } from "../data/reviewerRegistry.js";
import { upsertCloudReviewer } from "../services/cloudReviewers.js";
import { clearGeneratorDraft, getCloudReviewerCache, getGeneratorDraft, saveCloudReviewerCache, saveGeneratorDraft, saveLocalReviewer } from "../utils/storageUtils.js";
import { inferQuestionStyle } from "../utils/quizUtils.js";
import { logClientError } from "../utils/errorLogger.js";

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

const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".csv", ".json"];
const MAX_UPLOAD_SIZE = 12 * 1024 * 1024;
const MAX_AI_FILE_UPLOAD_SIZE = 3 * 1024 * 1024;
const MIN_PDF_TEXT_LENGTH = 100;
const MAX_AI_SOURCE_TEXT_LENGTH = 45000;
const AI_RATE_LIMIT_KEY = "reviewer_ai_request_window";
const AI_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const AI_RATE_LIMIT_MAX_REQUESTS = 8;
// Mirrors AI_ANON_RATE_LIMIT_MAX_REQUESTS on the server. Kept in step so a guest is
// stopped here with the same number the server would have used, instead of being
// allowed to click through to a 429.
const AI_ANON_RATE_LIMIT_MAX_REQUESTS = 3;
const QUESTION_TYPE_OPTIONS = [
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "identification", label: "Identification" },
  { value: "true_false", label: "True / False" },
  { value: "flashcard", label: "Flashcards" }
];
const QUESTION_COUNT_OPTIONS = [
  { value: "20", label: "20" },
  { value: "50", label: "50" },
  { value: "75", label: "75" },
  { value: "100", label: "100" },
  { value: "comprehensive", label: "Comprehensive" }
];
const MORE_QUESTION_COUNT_OPTIONS = [
  { value: "10", label: "+10" },
  { value: "20", label: "+20" },
  { value: "50", label: "+50" }
];
const QUESTION_STYLES = ["scenario", "direct"];

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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
      return {
        ...base,
        choices,
        correctAnswer,
        answerText: choices[correctAnswer]
      };
    }

    if (type === "identification" || type === "flashcard") {
      return {
        ...base,
        choices: {},
        correctAnswer: "TEXT",
        answerText: question.answer.trim()
      };
    }

    const choices = {
      A: question.A.trim(),
      B: question.B.trim(),
      C: question.C.trim(),
      D: question.D.trim()
    };

    return {
      ...base,
      choices,
      correctAnswer: question.correctAnswer,
      answerText: choices[question.correctAnswer] || ""
    };
  });

  return {
    reviewerId: `${slugify(safeTitle || safeSubject || "generated-reviewer")}-${Date.now()}`,
    title: safeTitle,
    subject: safeSubject,
    coverage: [...new Set(reviewerQuestions.map((question) => question.topic).filter(Boolean))],
    questionCount: reviewerQuestions.length,
    questionType: "multiple_choice",
    choicesPerQuestion: 4,
    instructions: instructions.trim() || "Select the best answer for each question.",
    questions: reviewerQuestions
  };
}

function normalizeReviewerJson(reviewer, options = {}) {
  const questions = Array.isArray(reviewer?.questions) ? reviewer.questions : [];
  const reviewerQuestionType = QUESTION_TYPE_OPTIONS.some((option) => option.value === reviewer?.questionType)
    ? reviewer.questionType
    : options.questionType || "multiple_choice";
  const normalizedQuestions = questions.map((question, index) => {
    const type = QUESTION_TYPE_OPTIONS.some((option) => option.value === question.type)
      ? question.type
      : reviewerQuestionType;
    const isTyped = type === "identification" || type === "flashcard";
    const validAnswers = type === "true_false" ? ["A", "B"] : isTyped ? ["TEXT"] : ["A", "B", "C", "D"];
    const rawCorrectAnswer = String(question.correctAnswer || (isTyped ? "TEXT" : "A")).toUpperCase();
    const correctAnswer = validAnswers.includes(rawCorrectAnswer) ? rawCorrectAnswer : validAnswers[0];
    const choices = question.choices || {};
    const normalizedChoices = type === "true_false"
      ? {
          A: choices.A || "True",
          B: choices.B || "False",
          C: "",
          D: ""
        }
      : {
          A: choices.A || "",
          B: choices.B || "",
          C: choices.C || "",
          D: choices.D || ""
        };

    return {
      id: question.id || index + 1,
      type,
      difficulty: ["easy", "medium", "hard"].includes(question.difficulty) ? question.difficulty : "medium",
      style: QUESTION_STYLES.includes(question.style) ? question.style : inferQuestionStyle(question.question),
      topic: question.topic || "Generated Reviewer",
      question: question.question || "",
      choices: normalizedChoices,
      correctAnswer,
      answerText: question.answerText || normalizedChoices[correctAnswer] || "",
      explanation: question.explanation || ""
    };
  });
  const title = reviewer?.title || "Generated Reviewer";
  const subject = reviewer?.subject || "Generated";
  const coverage = Array.isArray(reviewer?.coverage) && reviewer.coverage.length
    ? reviewer.coverage
    : [...new Set(normalizedQuestions.map((question) => question.topic).filter(Boolean))];

  return {
    ...reviewer,
    reviewerId: options.preserveReviewerId && reviewer?.reviewerId
      ? reviewer.reviewerId
      : `${slugify(reviewer?.reviewerId || title || subject || "generated-reviewer")}-${Date.now()}`,
    title,
    subject,
    coverage,
    questionCount: normalizedQuestions.length,
    questionType: reviewerQuestionType,
    choicesPerQuestion: reviewerQuestionType === "multiple_choice" ? 4 : reviewerQuestionType === "true_false" ? 2 : 0,
    instructions: reviewer?.instructions || "Select the best answer for each question.",
    questions: normalizedQuestions
  };
}

function getFriendlyGenerationError(error) {
  const message = error?.message || "";
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("expected pattern") ||
    lowerMessage.includes("function_payload_too_large") ||
    lowerMessage.includes("payload too large") ||
    lowerMessage.includes("413") ||
    lowerMessage.includes("cannot read the uploaded file") ||
    lowerMessage.includes("cannot read the file")
  ) {
    return "That file is too large to send to the AI after browser encoding, or the AI cannot read the file format. Paste the study material as text (e.g., .txt, .doc) or extract text from the PDF and try again.";
  }

  return message || "Could not generate a reviewer.";
}

// This is a courtesy limiter, not the real one. The server keeps the count that
// matters, in a table, keyed on the account or the address. This one exists so the
// person is told the number without a round trip, and so the guest cap matches what
// the server would have applied.
function checkAiRateLimit(userId = "") {
  const now = Date.now();
  const isSignedIn = Boolean(userId);
  const maxRequests = isSignedIn ? AI_RATE_LIMIT_MAX_REQUESTS : AI_ANON_RATE_LIMIT_MAX_REQUESTS;
  const key = `${AI_RATE_LIMIT_KEY}:${isSignedIn ? userId : "guest"}`;

  try {
    const current = JSON.parse(localStorage.getItem(key) || "null");

    if (!current || now - current.windowStart >= AI_RATE_LIMIT_WINDOW_MS) {
      localStorage.setItem(key, JSON.stringify({ windowStart: now, count: 1 }));
      return null;
    }

    if (current.count >= maxRequests) {
      const retryMinutes = Math.max(1, Math.ceil((AI_RATE_LIMIT_WINDOW_MS - (now - current.windowStart)) / 60000));
      const upgrade = isSignedIn ? "" : ` Sign in for ${AI_RATE_LIMIT_MAX_REQUESTS} instead.`;
      return `AI generation is limited to ${maxRequests} requests every 10 minutes. Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.${upgrade}`;
    }

    localStorage.setItem(key, JSON.stringify({ ...current, count: current.count + 1 }));
    return null;
  } catch {
    return null;
  }
}

async function extractPdfText(file) {
  if (!Promise.withResolvers) {
    Promise.withResolvers = function withResolvers() {
      let resolve;
      let reject;
      const promise = new Promise((nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
      });

      return { promise, resolve, reject };
    };
  }

  const [pdfjsLib, pdfWorker] = await Promise.all([
    import("pdfjs-dist/legacy/build/pdf.mjs"),
    import("pdfjs-dist/legacy/build/pdf.worker.mjs?url")
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker.default;

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (text) pageTexts.push(`Page ${pageNumber}: ${text}`);
    if (pageTexts.join("\n\n").length >= MAX_AI_SOURCE_TEXT_LENGTH) break;
  }

  return pageTexts.join("\n\n").slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
}

export default function Generator() {
  const navigate = useNavigate();
  const { configured, session, user } = useAuth();
  const turnstile = useTurnstile();
  const savedDraft = getGeneratorDraft();
  const skipNextAutosave = useRef(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [details, setDetails] = useState(savedDraft?.details || {
    title: "",
    subject: "",
    instructions: "Select the best answer for each question."
  });
  const [questionDraft, setQuestionDraft] = useState(
    savedDraft?.questionDraft ? { ...emptyQuestion, ...savedDraft.questionDraft } : emptyQuestion
  );
  const [questions, setQuestions] = useState(savedDraft?.questions || []);
  const [sourceText, setSourceText] = useState(savedDraft?.sourceText || "");
  const [targetQuestionCount, setTargetQuestionCount] = useState(savedDraft?.targetQuestionCount || "50");
  const [difficulty, setDifficulty] = useState(savedDraft?.difficulty || "mixed");
  const [questionType, setQuestionType] = useState(savedDraft?.questionType || "multiple_choice");
  const [moreQuestionCount, setMoreQuestionCount] = useState(savedDraft?.moreQuestionCount || "20");
  const [saveOfflineCopy, setSaveOfflineCopy] = useState(savedDraft?.saveOfflineCopy || false);
  const [studyFile, setStudyFile] = useState(null);
  const [jsonText, setJsonText] = useState(savedDraft?.jsonText || "");
  const [errors, setErrors] = useState([]);
  const [jsonCheck, setJsonCheck] = useState(null);
  const [savedReviewer, setSavedReviewer] = useState(null);
  const [generationStats, setGenerationStats] = useState(null);
  const [generationMessage, setGenerationMessage] = useState("");
  const [generationSteps, setGenerationSteps] = useState([]);
const [isGenerating, setIsGenerating] = useState(false);
const [isAddingQuestions, setIsAddingQuestions] = useState(false);
const [isSavingReviewer, setIsSavingReviewer] = useState(false);
const [generationElapsed, setGenerationElapsed] = useState(0);
  const [draftMessage, setDraftMessage] = useState(savedDraft?.savedAt ? `Draft restored from ${new Date(savedDraft.savedAt).toLocaleString()}.` : "");

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (!isGenerating && !isAddingQuestions) {
      setGenerationElapsed(0);
      return undefined;
    }

    const timer = window.setInterval(() => setGenerationElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isGenerating, isAddingQuestions]);

  useEffect(() => {
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false;
      return;
    }

    saveGeneratorDraft({
      details,
      questionDraft,
      questions,
      sourceText,
      targetQuestionCount,
      difficulty,
      questionType,
      moreQuestionCount,
      saveOfflineCopy,
      jsonText
    });
    setDraftMessage("Draft saved on this device.");
  }, [details, questionDraft, questions, sourceText, targetQuestionCount, difficulty, questionType, moreQuestionCount, saveOfflineCopy, jsonText]);

  function updateDetails(key, value) {
    setDetails((current) => ({ ...current, [key]: value }));
  }

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

  function updateJsonText(value) {
    setJsonText(value);
    setJsonCheck(null);
  }

  function setProgressStep(step) {
    setGenerationSteps((current) => current.includes(step) ? current : [...current, step]);
  }

  function getAiRequestHeaders() {
    return {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    };
  }

  // Generation works without an account, at a lower cap. A signed-in request carries
  // the session so the server can key the rate limit on the account rather than the
  // address, which is both more generous and harder to work around. Only a
  // deployment with no Supabase config at all cannot generate.
  function getAiGenerationNotice() {
    if (!configured) {
      return "AI generation needs Supabase configured on this deployment. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.";
    }

    if (!session?.access_token) {
      return `Signed out, so AI generation is limited to ${AI_ANON_RATE_LIMIT_MAX_REQUESTS} requests every 10 minutes. Sign in for ${AI_RATE_LIMIT_MAX_REQUESTS}.`;
    }

    return null;
  }

  // Returns the body to send, or a ready-made error when the request cannot be made.
  async function buildAiRequestBody(payload) {
    if (!configured) {
      return { error: getAiGenerationNotice() };
    }

    if (turnstile.enabled && turnstile.error) {
      return { error: turnstile.error };
    }

    // No token means the widget is missing, blocked, or still loading. Sending
    // the request anyway would only earn a 403.
    const turnstileToken = turnstile.enabled ? await turnstile.getToken() : "";

    if (turnstile.enabled && !turnstileToken) {
      return { error: "Finish the bot check above, then try again." };
    }

    return { body: { ...payload, ...(turnstileToken ? { turnstileToken } : {}) } };
  }

  function getCurrentReviewerFromJson({ preserveReviewerId = false } = {}) {
    if (!jsonText) return null;
    return normalizeReviewerJson(JSON.parse(jsonText), { preserveReviewerId, questionType });
  }

  function isTextFile(file) {
    const fileName = file.name.toLowerCase();
    return file.type.startsWith("text/") || TEXT_FILE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsDataURL(file);
    });
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Could not read that file."));
      reader.readAsText(file);
    });
  }

  async function handleStudyFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) return;

    if (file.size > MAX_UPLOAD_SIZE) {
      setErrors(["That file is too large. Use a file under 12 MB or paste the important text."]);
      return;
    }

    setErrors([]);
    setGenerationSteps([]);
    setGenerationMessage(isPdfFile(file) ? "Reading PDF text..." : "");

    try {
      if (isTextFile(file)) {
        const text = await readFileAsText(file);
        setSourceText(text);
        setStudyFile({
          name: file.name,
          mimeType: file.type || "text/plain",
          size: file.size,
          data: null
        });
        setGenerationMessage("Text file loaded.");
        return;
      }

      if (isPdfFile(file)) {
        setProgressStep("Extracting PDF text");

        // A PDF with a text layer can be sent as text, which every AI provider
        // understands. A scanned PDF with no text layer has to be sent as a file,
        // which only providers that can read images can make sense of.
        let extractedText = "";
        try {
          extractedText = await extractPdfText(file);
        } catch {
          extractedText = "";
        }

        const hasTextLayer = extractedText.length >= MIN_PDF_TEXT_LENGTH;

        if (hasTextLayer && file.size > MAX_AI_FILE_UPLOAD_SIZE) {
          setSourceText(extractedText);
          setStudyFile({
            name: `${file.name} (text extracted)`,
            mimeType: "text/plain",
            size: file.size,
            data: null
          });
          setGenerationMessage(`Extracted text from ${file.name}. It is too large to upload, so the text version will be used.`);
          setProgressStep("PDF text ready");
          return;
        }

        if (hasTextLayer) {
          // Send the text and the PDF together, so providers that can read the PDF
          // get the original while the fallback providers still get usable text.
          const [, base64Data = ""] = (await readFileAsDataUrl(file)).split(",");
          setSourceText(extractedText);
          setStudyFile({
            name: file.name,
            mimeType: file.type || "application/pdf",
            size: file.size,
            data: base64Data
          });
          setGenerationMessage(`Extracted text from ${file.name} and kept the PDF for the AI.`);
          setProgressStep("PDF text ready");
          return;
        }

        if (file.size > MAX_AI_FILE_UPLOAD_SIZE) {
          setStudyFile(null);
          setErrors(["That PDF has no readable text and is too large to upload. It may be scanned images. Compress/split it, OCR it, or paste the important notes into Extra Notes."]);
          setGenerationMessage("");
          return;
        }
      }

      if (file.size > MAX_AI_FILE_UPLOAD_SIZE) {
        setStudyFile(null);
        setErrors(["That file is too large for AI upload. Use a smaller file or paste the important notes into Extra Notes."]);
        setGenerationMessage("");
        return;
      }

      const dataUrl = await readFileAsDataUrl(file);
      const [, base64Data = ""] = dataUrl.split(",");
      setStudyFile({
        name: file.name,
        mimeType: file.type || "application/pdf",
        size: file.size,
        data: base64Data
      });
      setGenerationMessage("File ready for the AI.");
    } catch (error) {
      setStudyFile(null);
      setErrors([error?.message || "Could not read that file."]);
    }
  }

  function removeStudyFile() {
    setStudyFile(null);
    setGenerationMessage("");
  }

  function validateQuestionDraft() {
    const type = questionDraft.type || "multiple_choice";
    const isTyped = type === "identification" || type === "flashcard";
    const required = ["topic", "question", "explanation"];

    if (type === "multiple_choice") required.push("A", "B", "C", "D");
    if (isTyped) required.push("answer");

    const missingFields = required.filter((field) => !questionDraft[field].trim());
    if (missingFields.length) {
      return ["Complete the question fields before adding it."];
    }
    return [];
  }

  function addQuestion() {
    const draftErrors = validateQuestionDraft();
    if (draftErrors.length) {
      setErrors(draftErrors);
      return;
    }

    setQuestions((current) => [...current, questionDraft]);
    setQuestionDraft(emptyQuestion);
    setErrors([]);
  }

  async function persistReviewer(reviewer, { saveOffline = false } = {}) {
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

  function getSaveMessage(saveMode) {
    if (saveMode === "cloud-and-offline") return "Reviewer saved to cloud and this device.";
    if (saveMode === "cloud") return "Reviewer saved to cloud.";
    return "Reviewer saved offline on this device.";
  }

  async function saveDraftReviewer() {
    const reviewer = buildReviewer(details, questions);
    const validation = validateReviewer(reviewer);
    const nextErrors = [];

    if (!details.title.trim()) nextErrors.push("Add a reviewer title.");
    if (!details.subject.trim()) nextErrors.push("Add a subject.");
    if (!questions.length) nextErrors.push("Add at least one question.");
    if (!validation.isValid) nextErrors.push(...validation.errors);

    if (nextErrors.length) {
      setErrors(nextErrors);
      return;
    }

    setIsSavingReviewer(true);

    try {
      await persistReviewer(reviewer, { saveOffline: saveOfflineCopy });
      clearGeneratorDraft();
      navigate(`/reviewer/${reviewer.reviewerId}`);
    } catch (error) {
      setErrors([error?.message || "Could not save reviewer."]);
    } finally {
      setIsSavingReviewer(false);
    }
  }

  async function saveReviewerJson(rawJson) {
    try {
      const parsedReviewer = JSON.parse(rawJson);
      const reviewer = normalizeReviewerJson(parsedReviewer);
      const validation = validateReviewer(reviewer);

      if (!validation.isValid) {
        setErrors(validation.errors);
        return;
      }

      setIsSavingReviewer(true);
      const saveMode = await persistReviewer(reviewer, { saveOffline: saveOfflineCopy });
      clearGeneratorDraft();
      setSavedReviewer({ reviewerId: reviewer.reviewerId, saveMode });
      setGenerationMessage(getSaveMessage(saveMode));
    } catch (error) {
      setErrors([error?.message || "Paste valid reviewer JSON before saving."]);
    } finally {
      setIsSavingReviewer(false);
    }
  }

  function checkReviewerJson(rawJson) {
    try {
      const parsedReviewer = JSON.parse(rawJson);
      const reviewer = normalizeReviewerJson(parsedReviewer);
      const validation = validateReviewer(reviewer);

      if (!validation.isValid) {
        setJsonCheck(null);
        setErrors(validation.errors);
        return;
      }

      setErrors([]);
      setJsonCheck({
        title: reviewer.title,
        subject: reviewer.subject,
        questions: reviewer.questions.length,
        coverage: reviewer.coverage.length
      });
    } catch {
      setJsonCheck(null);
      setErrors(["Paste valid reviewer JSON before checking."]);
    }
  }

  async function generateReviewerWithAi({ regenerate = false } = {}) {
    const trimmedSourceText = sourceText.trim().slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
    const hasUploadedFile = Boolean(studyFile?.data);

    if (!isOnline) {
      setErrors(["Connect to the internet before using AI generation."]);
      return;
    }

    if (!hasUploadedFile && trimmedSourceText.length < 100) {
      setErrors(["Upload a study file or paste more study material before generating a reviewer."]);
      return;
    }

    // Only blocks when Supabase is not configured at all. Signed out is allowed,
    // because the server applies the lower cap and the notice below says so.
    if (!configured) {
      setErrors([getAiGenerationNotice()]);
      return;
    }

    const rateLimitError = checkAiRateLimit(user?.id);
    if (rateLimitError) {
      setErrors([rateLimitError]);
      return;
    }

    setIsGenerating(true);
    setErrors([]);
    setJsonCheck(null);
    setSavedReviewer(null);
    setGenerationStats(null);
    setGenerationSteps(["Preparing study material"]);
    setGenerationMessage(regenerate ? "Regenerating reviewer..." : "Generating reviewer...");

    try {
      setProgressStep("Sending material to the AI");
      const request = await buildAiRequestBody({
        sourceText: trimmedSourceText,
        file: hasUploadedFile
          ? {
              name: studyFile.name,
              mimeType: studyFile.mimeType,
              data: studyFile.data
            }
          : null,
        title: details.title,
        subject: details.subject,
        instructions: details.instructions,
        questionCount: targetQuestionCount,
        difficulty,
        questionType
      });

      if (request.error) {
        throw new Error(request.error);
      }

      const response = await fetch("/api/generate-reviewer", {
        method: "POST",
        headers: getAiRequestHeaders(),
        body: JSON.stringify(request.body)
      });
      setProgressStep("Reading AI response");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.requestId ? `${data?.error || "The AI could not generate a reviewer."} Request ID: ${data.requestId}` : data?.error || "The AI could not generate a reviewer.");
      }

      const reviewer = normalizeReviewerJson(data.reviewer, { questionType });
      const validation = validateReviewer(reviewer);

      if (!validation.isValid) {
        throw new Error(validation.errors[0] || "The AI generated an invalid reviewer.");
      }

      setProgressStep("Saving reviewer");
      const saveMode = await persistReviewer(reviewer, { saveOffline: saveOfflineCopy });
      const nextJsonText = JSON.stringify(reviewer, null, 2);
      updateJsonText(nextJsonText);
      checkReviewerJson(nextJsonText);
      skipNextAutosave.current = true;
      clearGeneratorDraft();
      setSavedReviewer({ reviewerId: reviewer.reviewerId, saveMode });
      setGenerationStats({
        requested: data.requestedQuestionCount || targetQuestionCount,
        generated: data.generatedQuestionCount || reviewer.questions.length,
        difficultyMix: data.difficultyMix || null,
        warning: data.warning || ""
      });
      setGenerationMessage(data.warning
        ? `${data.warning} ${getSaveMessage(saveMode)}`
        : `Reviewer generated with ${reviewer.questions.length} questions. ${getSaveMessage(saveMode)}`);
      setProgressStep("Done");
    } catch (error) {
      logClientError("generate-reviewer", error, {
        targetQuestionCount,
        difficulty,
        questionType,
        hasUploadedFile,
        sourceLength: trimmedSourceText.length
      });
      setGenerationMessage("");
      setErrors([getFriendlyGenerationError(error)]);
    } finally {
      // A bot-check token is single use. Invalidate it here rather than after a
      // successful fetch, so a failed request cannot leave a live one behind.
      turnstile.reset();
      setIsGenerating(false);
    }
  }

  async function makeMoreQuestions() {
    const trimmedSourceText = sourceText.trim().slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
    const hasUploadedFile = Boolean(studyFile?.data);

    if (!isOnline) {
      setErrors(["Connect to the internet before asking for more questions."]);
      return;
    }

    let currentReviewer;
    try {
      currentReviewer = getCurrentReviewerFromJson({ preserveReviewerId: true });
    } catch {
      setErrors(["Generate a valid reviewer before making more questions."]);
      return;
    }

    if (!currentReviewer?.questions?.length) {
      setErrors(["Generate a reviewer before making more questions."]);
      return;
    }

    if (currentReviewer.questions.length >= 150) {
      setErrors(["This reviewer already has 150 questions, which is the current maximum."]);
      return;
    }

    if (!configured) {
      setErrors([getAiGenerationNotice()]);
      return;
    }

    const rateLimitError = checkAiRateLimit(user?.id);
    if (rateLimitError) {
      setErrors([rateLimitError]);
      return;
    }

    setIsAddingQuestions(true);
    setErrors([]);
    setGenerationSteps(["Preparing existing reviewer", "Sending request for more questions"]);
    setGenerationMessage(`Making ${moreQuestionCount} more questions...`);

    try {
      const request = await buildAiRequestBody({
        mode: "extend",
        sourceText: trimmedSourceText,
        file: hasUploadedFile
          ? {
              name: studyFile.name,
              mimeType: studyFile.mimeType,
              data: studyFile.data
            }
          : null,
        title: currentReviewer.title || details.title,
        subject: currentReviewer.subject || details.subject,
        instructions: currentReviewer.instructions || details.instructions,
        difficulty,
        questionType: currentReviewer.questionType || questionType,
        additionalCount: moreQuestionCount,
        existingReviewer: currentReviewer
      });

      if (request.error) {
        throw new Error(request.error);
      }

      const response = await fetch("/api/generate-reviewer", {
        method: "POST",
        headers: getAiRequestHeaders(),
        body: JSON.stringify(request.body)
      });
      setProgressStep("Checking new questions");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.requestId ? `${data?.error || "The AI could not make more questions."} Request ID: ${data.requestId}` : data?.error || "The AI could not make more questions.");
      }

      const reviewer = normalizeReviewerJson(data.reviewer, { preserveReviewerId: true, questionType: currentReviewer.questionType || questionType });
      const validation = validateReviewer(reviewer);

      if (!validation.isValid) {
        throw new Error(validation.errors[0] || "The AI generated invalid additional questions.");
      }

      setProgressStep("Saving expanded reviewer");
      const saveMode = await persistReviewer(reviewer, { saveOffline: saveOfflineCopy });
      const nextJsonText = JSON.stringify(reviewer, null, 2);
      updateJsonText(nextJsonText);
      checkReviewerJson(nextJsonText);
      setSavedReviewer({ reviewerId: reviewer.reviewerId, saveMode });
      setGenerationStats({
        requested: data.requestedQuestionCount || reviewer.questions.length,
        generated: data.generatedQuestionCount || reviewer.questions.length,
        difficultyMix: data.difficultyMix || null,
        warning: data.warning || ""
      });
      setGenerationMessage(data.warning
        ? `${data.warning} ${getSaveMessage(saveMode)}`
        : `Added ${data.addedQuestionCount || moreQuestionCount} questions. ${getSaveMessage(saveMode)}`);
      setProgressStep("Done");
    } catch (error) {
      logClientError("extend-reviewer", error, {
        moreQuestionCount,
        difficulty,
        questionType: currentReviewer?.questionType || questionType,
        sourceLength: trimmedSourceText.length
      });
      setGenerationMessage("");
      setErrors([getFriendlyGenerationError(error)]);
    } finally {
      turnstile.reset();
      setIsAddingQuestions(false);
    }
  }

  function clearDraft() {
    clearGeneratorDraft();
    skipNextAutosave.current = true;
    setDetails({
      title: "",
      subject: "",
      instructions: "Select the best answer for each question."
    });
    setQuestionDraft(emptyQuestion);
    setQuestions([]);
    setSourceText("");
    setTargetQuestionCount("50");
    setDifficulty("mixed");
    setQuestionType("multiple_choice");
    setMoreQuestionCount("20");
    setSaveOfflineCopy(false);
    setStudyFile(null);
    setJsonText("");
    setErrors([]);
    setJsonCheck(null);
    setSavedReviewer(null);
    setGenerationStats(null);
    setGenerationSteps([]);
    setDraftMessage("Draft cleared.");
  }

  return (
    <div className="page generator-page">
      <section className="section-heading">
        <div>
          <p className="eyebrow">AI Generator</p>
          <h1>Generate a reviewer</h1>
          <p className="muted">Upload study material, generate a reviewer with Gemini, then save it for offline study.</p>
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
          <div className="generator-panel-head">
            <Sparkles size={22} aria-hidden="true" />
            <div>
              <h2>Generate Reviewer</h2>
              <p className="muted">Upload a PDF or text file. You can also paste notes if that is faster.</p>
            </div>
          </div>

          <div className="production-note" role="note">
            <strong>AI limits</strong>
            <span>PDF upload under 3 MB direct, up to 12 MB for browser text extraction, 45,000 characters of notes, 150 questions max, and 8 AI requests every 10 minutes per signed-in account. Guests are limited by connection.</span>
          </div>

          <div className="ai-prompt-panel">
            <div className="generator-form-grid">
              <label>
                <span>Reviewer Title</span>
                <input value={details.title} onChange={(event) => updateDetails("title", event.target.value)} placeholder="Example: Biology Prelim Reviewer" />
              </label>
              <label>
                <span>Subject</span>
                <input value={details.subject} onChange={(event) => updateDetails("subject", event.target.value)} placeholder="Example: Biology" />
              </label>
            </div>

            <fieldset className="generator-option-group">
              <legend>Number of Questions</legend>
              <div className="segmented">
                {QUESTION_COUNT_OPTIONS.map((option) => (
                  <button
                    className={targetQuestionCount === option.value ? "active" : ""}
                    type="button"
                    key={option.value}
                    onClick={() => setTargetQuestionCount(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="upload-zone ai-upload-zone">
              <input type="file" accept=".pdf,.txt,.md,.csv,.json,text/plain,application/pdf" onChange={handleStudyFile} />
              <Upload size={30} aria-hidden="true" />
              <strong>{studyFile ? studyFile.name : "Upload study material"}</strong>
              <span>{studyFile ? `${(studyFile.size / 1024 / 1024).toFixed(2)} MB ready` : "PDF under 3 MB, or TXT, MD, CSV, JSON. Text files will also fill the notes box below."}</span>
            </label>

            {studyFile ? (
              <div className="button-row">
                <button className="button subtle" type="button" onClick={removeStudyFile}>
                  Remove File
                </button>
              </div>
            ) : null}

            <label className="prompt-box">
              <span>Extra Notes</span>
              <textarea value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Optional: paste notes here, or use this instead of uploading a file." />
            </label>
            {configured && user ? (
              <label className="generator-checkbox">
                <input
                  type="checkbox"
                  checked={saveOfflineCopy}
                  onChange={(event) => setSaveOfflineCopy(event.target.checked)}
                />
                <span>Also save an offline copy on this device</span>
              </label>
            ) : null}
            {turnstile.enabled ? (
              <div className="generator-turnstile">
                <div ref={turnstile.containerRef} />
                {turnstile.error ? <p className="generator-turnstile-note">{turnstile.error}</p> : null}
              </div>
            ) : null}
            {configured && !user ? (
              <p className="generation-hint">
                {getAiGenerationNotice()} Reviewers still save to this device without an account.
              </p>
            ) : null}
            <div className="button-row">
              <button className="button primary" type="button" onClick={generateReviewerWithAi} disabled={isGenerating || isAddingQuestions || !isOnline}>
                {isGenerating ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
                {isGenerating ? "Generating..." : "Generate with AI"}
              </button>
              {generationMessage ? <span className="template-message">{generationMessage}</span> : null}
            </div>

            {generationSteps.length ? (
              <ol className="generation-progress" aria-label="Generation progress">
                {generationSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
            {isGenerating || isAddingQuestions ? (
              <p className="generation-hint">
                Working for {generationElapsed}s{generationElapsed >= 30 ? " — AI generation can take a minute or two, especially for larger counts." : " — hang tight."}
              </p>
            ) : null}
          </div>

          {jsonText ? (
            <div className="json-import-panel">
              <div className="generator-panel-head compact">
                <FileJson size={20} aria-hidden="true" />
                <div>
                  <h2>Generated Reviewer</h2>
                  <p className="muted">This reviewer passed the app's JSON structure check.</p>
                </div>
              </div>
              {jsonCheck ? (
                <div className="json-check-card" role="status">
                  <strong>{jsonCheck.title}</strong>
                  <span>{jsonCheck.subject}</span>
                  <span>{jsonCheck.questions} questions across {jsonCheck.coverage} coverage areas</span>
                  {generationStats ? (
                    <span>
                      Requested {generationStats.requested}; generated {generationStats.generated}
                    </span>
                  ) : null}
                  {generationStats?.difficultyMix ? (
                    <span>
                      {generationStats.difficultyMix.easy} easy / {generationStats.difficultyMix.medium} medium / {generationStats.difficultyMix.hard} hard &middot; {generationStats.difficultyMix.scenario} exam-style / {generationStats.difficultyMix.direct} direct
                    </span>
                  ) : null}
                </div>
              ) : null}
              <div className="more-question-tools">
                <fieldset className="generator-option-group">
                  <legend>Make More Questions</legend>
                  <div className="segmented compact">
                    {MORE_QUESTION_COUNT_OPTIONS.map((option) => (
                      <button
                        className={moreQuestionCount === option.value ? "active" : ""}
                        type="button"
                        key={option.value}
                        onClick={() => setMoreQuestionCount(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <button
                  className="button subtle"
                  type="button"
                  onClick={makeMoreQuestions}
                  disabled={isGenerating || isAddingQuestions || !isOnline}
                >
                  {isAddingQuestions ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
                  {isAddingQuestions ? "Adding..." : "Add Questions"}
                </button>
              </div>
              <div className="button-row">
                <button
                  className="button subtle"
                  type="button"
                  onClick={() => generateReviewerWithAi({ regenerate: true })}
                  disabled={isGenerating || isAddingQuestions || !isOnline}
                >
                  {isGenerating ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <RotateCcw size={17} aria-hidden="true" />}
                  Regenerate
                </button>
                {savedReviewer ? (
                  <button className="button primary" type="button" onClick={() => navigate(`/reviewer/${savedReviewer.reviewerId}`)}>
                    Open Reviewer
                  </button>
                ) : (
                  <button className="button primary" type="button" onClick={() => saveReviewerJson(jsonText)} disabled={isSavingReviewer}>
                    {isSavingReviewer ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
                    {isSavingReviewer ? "Saving..." : configured && user ? "Save to Cloud" : "Save Offline"}
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {errors.length ? (
            <div className="generator-errors" role="alert">
              {errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
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
                <input value={details.title} onChange={(event) => updateDetails("title", event.target.value)} placeholder="Example: Biology Prelim Reviewer" />
              </label>
              <label>
                <span>Subject</span>
                <input value={details.subject} onChange={(event) => updateDetails("subject", event.target.value)} placeholder="Example: Biology" />
              </label>
            </div>

            <label className="prompt-box">
              <span>Instructions</span>
              <textarea value={details.instructions} onChange={(event) => updateDetails("instructions", event.target.value)} />
            </label>

            <div className="question-builder">
              <div className="generator-panel-head compact">
                <Sparkles size={20} aria-hidden="true" />
                <div>
                  <h2>Question {questions.length + 1}</h2>
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
