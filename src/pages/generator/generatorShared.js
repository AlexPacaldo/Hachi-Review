import { getQuestionStyle } from "../../utils/quizUtils.js";

// Everything the two generator modes have in common. The page shell owns the mode
// switch and the manual builder; each mode owns its own form. Anything both modes
// read or both modes have to agree on lives here, so the two cannot drift.

export const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".csv", ".json"];
// HEIC is listed so the picker does not hide the file a phone produced, and it is
// rejected with a message further down. A file the picker silently refuses to show
// looks like the app is broken; a file it explains is refused is a helpful answer.
export const IMAGE_FILE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".heic", ".heif"];
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp", "image/heic", "image/heif"];
export const DOCUMENT_ACCEPT = ".pdf,.txt,.md,.csv,.json,.doc,.docx,application/pdf,text/plain";
export const IMAGE_ACCEPT = IMAGE_FILE_EXTENSIONS.map((extension) => extension.slice(1)).join(",");
export const SOURCE_ACCEPT = [DOCUMENT_ACCEPT, IMAGE_ACCEPT, ...IMAGE_MIME_TYPES].join(",");

// Hard stop before anything is read into memory. A file bigger than this is
// refused rather than decoded, because the failure this protects against is the
// tab dying, and that is not recoverable.
export const MAX_SINGLE_FILE_BYTES = 12 * 1024 * 1024;
// The upload budget across every attachment on one request. The endpoint enforces
// the same ceiling in base64 characters, which is what it can actually measure, so
// this is the decoded figure that ceiling corresponds to. The two must not drift:
// a browser that let through more than the endpoint accepts would fail the request
// after the person had already waited for the encoding.
export const MAX_AI_ATTACHMENT_BYTES = 3 * 1024 * 1024;
export const MAX_SOURCE_FILES = 6;
export const MAX_AI_SOURCE_TEXT_LENGTH = 45000;
export const MIN_EXTRACTED_TEXT_LENGTH = 100;

// Providers downscale an image before reading it, so sending a 12 MP phone photo at
// full size spends the upload budget to arrive at the same pixels. Capping the long
// edge also sharpens small type, which is what a page of notes is made of.
export const MAX_IMAGE_EDGE = 2000;
export const IMAGE_JPEG_QUALITY = 0.9;

export const QUESTION_TYPE_OPTIONS = [
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "identification", label: "Identification" },
  { value: "true_false", label: "True / False" },
  { value: "flashcard", label: "Flashcards" }
];
export const QUESTION_COUNT_OPTIONS = [
  { value: "20", label: "20" },
  { value: "50", label: "50" },
  { value: "75", label: "75" },
  { value: "100", label: "100" },
  { value: "comprehensive", label: "Comprehensive" }
];
export const MORE_QUESTION_COUNT_OPTIONS = [
  { value: "10", label: "+10" },
  { value: "20", label: "+20" },
  { value: "50", label: "+50" }
];
export const QUESTION_STYLES = ["scenario", "direct"];
export const MAX_REVIEWER_QUESTIONS = 150;

export const DEFAULT_INSTRUCTIONS = "Select the best answer for each question.";
export const DEFAULT_EXAM_INSTRUCTIONS = "Answer every item, then check the explanations to see what you missed.";

// Where an imported exam item's answer came from. These mirror the endpoint's
// vocabulary because they are reported back per question, and a label shown here has
// to mean the same thing as the field it is describing.
export const ANSWER_SOURCE_VALUES = ["paper", "solved", "unresolved"];

export const EXAM_ANSWER_OPTIONS = [
  {
    value: "solve",
    label: "Work out the answers",
    description: "The AI answers every item itself. Use this when the paper has no answer key, or when you want a fresh key rather than the one printed on it."
  },
  {
    value: "extract",
    label: "Use the paper's answer key",
    description: "Only answers printed in the upload are used. Items the paper does not answer are left out rather than guessed, so this is only right when the key is actually in the upload."
  }
];

export function isPdfFile(file) {
  return file?.type === "application/pdf" || file?.name?.toLowerCase().endsWith(".pdf");
}

export function isTextFile(file) {
  const fileName = String(file?.name || "").toLowerCase();
  return Boolean(file?.type?.startsWith("text/")) || TEXT_FILE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

export function isImageFile(file) {
  if (file?.type?.startsWith("image/")) return true;
  const fileName = String(file?.name || "").toLowerCase();
  return IMAGE_FILE_EXTENSIONS.some((extension) => fileName.endsWith(extension));
}

// Every browser that can run this app renders HEIC as a blank box, and no provider
// here decodes it, so accepting one would mean an upload that silently produces
// nothing. Caught on the way in, with the conversion named.
export function isHeicFile(file) {
  const mimeType = String(file?.type || "").toLowerCase();
  const fileName = String(file?.name || "").toLowerCase();
  return mimeType === "image/heic" || mimeType === "image/heif" || fileName.endsWith(".heic") || fileName.endsWith(".heif");
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getDataUrlBytes(dataUrl) {
  const base64 = String(dataUrl || "").split(",")[1] || "";
  return Math.floor((base64.length * 3) / 4);
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsText(file);
  });
}

async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Falls through to the <img> path below, which handles formats createImageBitmap
      // rejects for reasons that vary by browser.
    }
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    image.src = objectUrl;
  });
}

// Returns what to send for an image, or null when the browser cannot decode it and
// the original bytes should go as they are.
//
// dataUrl comes back empty when the file is already small enough and is being sent
// untouched. That is not only a shortcut: a small JPEG re-encoded through a canvas
// comes out larger than it went in, so round-tripping one spends upload budget and
// loses quality to arrive at the same picture. The original is always the better
// answer once there is nothing to downscale.
export async function prepareImageForUpload(file) {
  const decoded = await decodeImage(file);

  if (!decoded) return null;

  try {
    const longEdge = Math.max(decoded.width || 0, decoded.height || 0);
    if (!longEdge) return null;

    const original = { originalWidth: decoded.width, originalHeight: decoded.height };

    if (longEdge <= MAX_IMAGE_EDGE) {
      return { dataUrl: "", width: decoded.width, height: decoded.height, ...original };
    }

    const scale = MAX_IMAGE_EDGE / longEdge;
    const width = Math.max(1, Math.round(decoded.width * scale));
    const height = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");

    if (!context) return null;

    // A canvas starts transparent. A transparent PNG flattened onto transparency
    // reads as black text on black once the provider composites it, so the page is
    // laid on white first.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(decoded, 0, 0, width, height);

    // PNG stays PNG, because ringing around small type is what makes a model
    // misread a page of notes. It only drops to JPEG when keeping it lossless would
    // not fit the upload budget anyway.
    const png = canvas.toDataURL("image/png");
    const dataUrl = getDataUrlBytes(png) <= MAX_AI_ATTACHMENT_BYTES
      ? png
      : canvas.toDataURL("image/jpeg", IMAGE_JPEG_QUALITY);

    return { dataUrl, width, height, ...original };
  } catch {
    return null;
  } finally {
    if (typeof decoded.close === "function") decoded.close();
  }
}

// pdf.js is loaded here rather than at the top of the module so it stays out of the
// main bundle. Someone who only ever types notes should not download it.
export async function extractPdfText(file) {
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

// Same shape on both paths, so the endpoint receives one contract whichever mode
// made the request. sourceNumber and answerSource are carried through untouched:
// they are the only record of what the paper actually printed, and losing them would
// turn an imported exam into an indistinguishable generated one.
export function normalizeReviewerJson(reviewer, options = {}) {
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
    const sourceNumber = Number(question.sourceNumber);

    return {
      ...question,
      id: question.id || index + 1,
      type,
      difficulty: ["easy", "medium", "hard"].includes(question.difficulty) ? question.difficulty : "medium",
      style: getQuestionStyle(question),
      topic: question.topic || "Generated Reviewer",
      question: question.question || "",
      choices: normalizedChoices,
      correctAnswer,
      answerText: question.answerText || normalizedChoices[correctAnswer] || "",
      explanation: question.explanation || "",
      ...(Number.isFinite(sourceNumber) && sourceNumber > 0 ? { sourceNumber } : {}),
      ...(ANSWER_SOURCE_VALUES.includes(question.answerSource) ? { answerSource: question.answerSource } : {})
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
    instructions: reviewer?.instructions || DEFAULT_INSTRUCTIONS,
    questions: normalizedQuestions
  };
}

export function countAnswerProvenance(questions) {
  return (questions || []).reduce((counts, question) => {
    if (question?.answerSource === "paper") counts.paper += 1;
    else if (question?.answerSource === "solved") counts.solved += 1;
    return counts;
  }, { paper: 0, solved: 0 });
}

// This is a courtesy limiter, not the real one. The server keeps the count that
// matters, in a table, keyed on the account. This one exists so the person is told
// the number without a round trip.
export function checkAiRateLimit(userId = "", options = {}) {
  const key = options.key || "reviewer_ai_request_window";
  const windowMs = options.windowMs || 10 * 60 * 1000;
  const maxRequests = options.maxRequests || 8;
  const now = Date.now();
  const storageKey = `${key}:${userId}`;

  try {
    const current = JSON.parse(localStorage.getItem(storageKey) || "null");

    if (!current || now - current.windowStart >= windowMs) {
      localStorage.setItem(storageKey, JSON.stringify({ windowStart: now, count: 1 }));
      return null;
    }

    if (current.count >= maxRequests) {
      const retryMinutes = Math.max(1, Math.ceil((windowMs - (now - current.windowStart)) / 60000));
      return `AI generation is limited to ${maxRequests} requests every 10 minutes. Try again in about ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`;
    }

    localStorage.setItem(storageKey, JSON.stringify({ ...current, count: current.count + 1 }));
    return null;
  } catch {
    return null;
  }
}

// The endpoint names no provider in anything it sends to the browser, so this only
// ever sees its own wording. The size case is worth its own line because there is
// something the person can do about it.
export function getFriendlyGenerationError(error) {
  const message = error?.message || "";
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes("expected pattern") ||
    lowerMessage.includes("function_payload_too_large") ||
    lowerMessage.includes("payload too large") ||
    lowerMessage.includes("413") ||
    lowerMessage.includes("cannot read the uploaded file") ||
    lowerMessage.includes("cannot read the file") ||
    lowerMessage.includes("unavailable")
  ) {
    return "That file could not be sent to the AI, or it is too large to send after browser encoding. Compress or split it, use fewer images, or paste the study material as text and try again.";
  }

  return message || "Could not generate a reviewer.";
}

export function isUnreadableFileError(message) {
  return /paste the study material as text|cannot read the uploaded file|cannot read the file|could not be sent to this provider|too large to send to the ai|no answer key could be read/i.test(message || "");
}