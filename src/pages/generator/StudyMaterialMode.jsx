import { useEffect, useState } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { logClientError } from "../../utils/errorLogger.js";
import GeneratedReviewerPanel from "./GeneratedReviewerPanel.jsx";
import SourceFileField from "./SourceFileField.jsx";
import { useGenerationProgress, useTaskProgress } from "./useGenerationProgress.js";
import { useSourceAttachments } from "./useSourceAttachments.js";
import {
  MORE_QUESTION_COUNT_OPTIONS,
  MAX_AI_SOURCE_TEXT_LENGTH,
  MAX_REVIEWER_QUESTIONS,
  MIN_EXTRACTED_TEXT_LENGTH,
  QUESTION_COUNT_OPTIONS,
  checkAiRateLimit,
  extractPdfText,
  getFriendlyGenerationError,
  isUnreadableFileError,
  normalizeReviewerJson
} from "./generatorShared.js";
import {
  assertValidReviewer,
  getSaveMessage,
  getSignInError,
  persistReviewer,
  postGenerationRequest
} from "./generatorApi.js";

// Study material in, new questions out. This is the mode the page has always had:
// write questions the source does not already contain, top them up if the model came
// back short of the count, and let the result be regenerated and extended.
//
// Exam paper import lives in its own mode because it is the opposite task. Here the
// model authors, and its own question-quality rules are the point; there it
// transcribes, and fidelity to the paper is the point. A shared form would mean every
// rule below had to be conditional on which mode was open.
export default function StudyMaterialMode({
  details,
  updateDetails,
  draft,
  onDraftChange,
  saveOfflineCopy,
  onSaveOfflineChange,
  isOnline,
  onReviewerPersisted,
  onNavigate,
}) {
  const { configured, session, user } = useAuth();
  const {
    attachments,
    notes,
    setNotes,
    errors: uploadErrors,
    notice,
    isReading,
    usedBytes,
    payloadFiles,
    addFiles,
    removeAttachment,
    clearAttachments
  } = useSourceAttachments({ initialNotes: draft.sourceText || "" });
  const progress = useGenerationProgress();
  const extendProgress = useTaskProgress();

  const [targetQuestionCount, setTargetQuestionCount] = useState(draft.targetQuestionCount || "50");
  const [moreQuestionCount, setMoreQuestionCount] = useState(draft.moreQuestionCount || "20");
  const [jsonText, setJsonText] = useState(draft.jsonText || "");
  const [errors, setErrors] = useState([]);
  const [jsonCheck, setJsonCheck] = useState(null);
  const [savedReviewer, setSavedReviewer] = useState(null);
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Difficulty and question type are not offered as controls on this form. The paper
  // mix this reviewer targets is decided by the prompt rather than by the person, and
  // the reviewer's own view is where a type gets changed after the fact. They stay in
  // the draft because the endpoint still expects them.
  const difficulty = draft.difficulty || "mixed";
  const questionType = draft.questionType || "multiple_choice";

  const sourceText = notes.trim().slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
  const signInError = getSignInError({ configured, session });
  const isBusy = progress.isRunning || extendProgress.isRunning;
  // Upload problems are reported by the upload field itself, next to the control
  // that caused them. Only generation problems belong in the block below, and
  // listing both here would show every upload error twice.
  const hasGenerationErrors = errors.length > 0;

  // Reported upwards rather than written here, so localStorage has exactly one owner.
  // Both modes persist into the same draft key, and two writers would race.
  useEffect(() => {
    onDraftChange?.({ sourceText: notes, targetQuestionCount, moreQuestionCount, jsonText });
  }, [notes, targetQuestionCount, moreQuestionCount, jsonText, onDraftChange]);

  function checkReviewerJson(rawJson) {
    try {
      const parsedReviewer = normalizeReviewerJson(JSON.parse(rawJson), { questionType });
      assertValidReviewer(parsedReviewer, "Paste valid reviewer JSON before checking.");
      setErrors([]);
      setJsonCheck({
        title: parsedReviewer.title,
        subject: parsedReviewer.subject,
        questions: parsedReviewer.questions.length,
        coverage: parsedReviewer.coverage.length
      });
    } catch (error) {
      setJsonCheck(null);
      setErrors([error?.message || "Paste valid reviewer JSON before checking."]);
    }
  }

  function getCurrentReviewerFromJson({ preserveReviewerId = false } = {}) {
    if (!jsonText) return null;
    return normalizeReviewerJson(JSON.parse(jsonText), { preserveReviewerId, questionType });
  }

  // Neither the AI nor this browser can read a scan, and both fail on it the same way.
  // Rather than report a generic failure, the PDF's own text layer is pulled into the
  // notes and the request is retried once. One retry and no more: a file with no text
  // layer will not grow one, so a second attempt spends quota to reach the same end.
  async function generate({ regenerate = false, triedTextFallback = false, sourceTextOverride, files, carriedMessage = "" } = {}) {
    const activeSourceText = (sourceTextOverride ?? sourceText).trim().slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
    const activeFiles = files === undefined ? payloadFiles : files;

    if (!isOnline) {
      setErrors(["Connect to the internet before using AI generation."]);
      return;
    }

    if (!activeFiles.length && activeSourceText.length < 100) {
      setErrors(["Upload a study file or paste more study material before generating a reviewer."]);
      return;
    }

    // Ahead of the local rate limiter, so a signed-out visitor is told to sign in
    // rather than spending a request they could never complete.
    const signInProblem = getSignInError({ configured, session });
    if (signInProblem) {
      setErrors([signInProblem]);
      return;
    }

    const rateLimitError = checkAiRateLimit(user?.id);
    if (rateLimitError) {
      setErrors([rateLimitError]);
      return;
    }

    progress.begin("Preparing study material");
    setErrors([]);
    setJsonCheck(null);
    setSavedReviewer(null);
    setStats(null);
    // The retry passes its explanation in, because the recursive call replaces the
    // message on the way in and the person would otherwise never hear why.
    setMessage(carriedMessage || (regenerate ? "Regenerating reviewer..." : "Generating reviewer..."));

    try {
      progress.recordStep("Sending material to the AI");
      const data = await postGenerationRequest({
        session,
        body: {
          sourceText: activeSourceText,
          files: activeFiles,
          title: details.title,
          subject: details.subject,
          instructions: details.instructions,
          questionCount: targetQuestionCount,
          difficulty,
          questionType
        },
        fallbackMessage: "The AI could not generate a reviewer."
      });
      progress.recordStep("Reading AI response");

      const reviewer = normalizeReviewerJson(data.reviewer, { questionType });
      assertValidReviewer(reviewer, "The AI generated an invalid reviewer.");

      progress.recordStep("Saving reviewer");
      const saveMode = await persistReviewer({ configured, user, reviewer, saveOffline: saveOfflineCopy });
      const nextJsonText = JSON.stringify(reviewer, null, 2);
      setJsonText(nextJsonText);
      checkReviewerJson(nextJsonText);
      onReviewerPersisted?.();

      setSavedReviewer({ reviewerId: reviewer.reviewerId, saveMode });
      setStats({
        requested: data.requestedQuestionCount || targetQuestionCount,
        generated: data.generatedQuestionCount || reviewer.questions.length,
        difficultyMix: data.difficultyMix || null
      });
      setMessage(data.warning
        ? `${data.warning} ${getSaveMessage(saveMode)}`
        : `Reviewer generated with ${reviewer.questions.length} questions. ${getSaveMessage(saveMode)}`);
      progress.recordStep("Done");
    } catch (error) {
      logClientError("generate-reviewer", error, {
        targetQuestionCount,
        difficulty,
        questionType,
        hasUploadedFile: activeFiles.length > 0,
        sourceLength: activeSourceText.length
      });
      setMessage("");

      // The local File is still held on the attachment, so extraction works even
      // though only the encoded bytes went over the wire.
      const localFile = attachments.find((attachment) => attachment.kind === "pdf")?.file;

      if (!triedTextFallback && localFile && isUnreadableFileError(error?.message)) {
        const extractedText = await extractPdfText(localFile).catch(() => "");

        if (extractedText.length >= MIN_EXTRACTED_TEXT_LENGTH) {
          setNotes(extractedText);
          // Awaited, so the outer finally does not release the busy hold while the
          // retry is still running.
          await generate({
            regenerate,
            triedTextFallback: true,
            sourceTextOverride: extractedText,
            files: [],
            carriedMessage: "The AI could not read the uploaded file, so its text was extracted into Extra Notes. Retrying..."
          });
          return;
        }
      }

      setErrors([getFriendlyGenerationError(error)]);
    } finally {
      progress.end();
    }
  }

  async function makeMoreQuestions() {
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

    if (currentReviewer.questions.length >= MAX_REVIEWER_QUESTIONS) {
      setErrors([`This reviewer already has ${MAX_REVIEWER_QUESTIONS} questions, which is the current maximum.`]);
      return;
    }

    const signInProblem = getSignInError({ configured, session });
    if (signInProblem) {
      setErrors([signInProblem]);
      return;
    }

    const rateLimitError = checkAiRateLimit(user?.id);
    if (rateLimitError) {
      setErrors([rateLimitError]);
      return;
    }

    extendProgress.begin();
    setErrors([]);
    setMessage(`Making ${moreQuestionCount} more questions...`);

    try {
      const data = await postGenerationRequest({
        session,
        body: {
          mode: "extend",
          sourceText,
          files: payloadFiles,
          title: currentReviewer.title || details.title,
          subject: currentReviewer.subject || details.subject,
          instructions: currentReviewer.instructions || details.instructions,
          difficulty,
          questionType: currentReviewer.questionType || questionType,
          additionalCount: moreQuestionCount,
          existingReviewer: currentReviewer
        },
        fallbackMessage: "The AI could not make more questions."
      });

      const reviewer = normalizeReviewerJson(data.reviewer, {
        preserveReviewerId: true,
        questionType: currentReviewer.questionType || questionType
      });
      assertValidReviewer(reviewer, "The AI generated invalid additional questions.");

      const saveMode = await persistReviewer({ configured, user, reviewer, saveOffline: saveOfflineCopy });
      const nextJsonText = JSON.stringify(reviewer, null, 2);
      setJsonText(nextJsonText);
      checkReviewerJson(nextJsonText);
      onReviewerPersisted?.();

      setSavedReviewer({ reviewerId: reviewer.reviewerId, saveMode });
      setStats({
        requested: data.requestedQuestionCount || reviewer.questions.length,
        generated: data.generatedQuestionCount || reviewer.questions.length,
        difficultyMix: data.difficultyMix || null
      });
      setMessage(data.warning
        ? `${data.warning} ${getSaveMessage(saveMode)}`
        : `Added ${data.addedQuestionCount || moreQuestionCount} questions. ${getSaveMessage(saveMode)}`);
    } catch (error) {
      logClientError("extend-reviewer", error, {
        moreQuestionCount,
        difficulty,
        questionType: currentReviewer?.questionType || questionType,
        sourceLength: sourceText.length
      });
      setMessage("");
      setErrors([getFriendlyGenerationError(error)]);
    } finally {
      extendProgress.end();
    }
  }

  async function saveJson(rawJson) {
    try {
      const parsedReviewer = normalizeReviewerJson(JSON.parse(rawJson), { questionType });
      assertValidReviewer(parsedReviewer, "Paste valid reviewer JSON before saving.");

      setIsSaving(true);
      const saveMode = await persistReviewer({ configured, user, reviewer: parsedReviewer, saveOffline: saveOfflineCopy });
      onReviewerPersisted?.();
      setSavedReviewer({ reviewerId: parsedReviewer.reviewerId, saveMode });
      setMessage(getSaveMessage(saveMode));
    } catch (error) {
      setErrors([error?.message || "Paste valid reviewer JSON before saving."]);
    } finally {
      setIsSaving(false);
    }
  }

  function resetMode() {
    setTargetQuestionCount("50");
    setMoreQuestionCount("20");
    setJsonText("");
    setErrors([]);
    setJsonCheck(null);
    setSavedReviewer(null);
    setStats(null);
    setMessage("");
    setNotes("");
    clearAttachments();
  }

  return (
    <>
      <div className="ai-prompt-panel">
        <div className="generator-form-grid">
          <label>
            <span>Reviewer Title</span>
            <input value={details.title} onChange={(event) => updateDetails("title", event.target.value)} placeholder="Optional: named from your material" />
          </label>
          <label>
            <span>Subject</span>
            <input value={details.subject} onChange={(event) => updateDetails("subject", event.target.value)} placeholder="Optional: named from your material" />
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

        <SourceFileField
          label="Study material"
          hint="PDF, image, or TXT, MD, CSV, JSON. A photo of your notes works, and images are resized before sending."
          emptyHint="Attach up to six files. Images are read as pictures, PDFs as documents, and text files fill the notes box instead."
          notesLabel="Extra Notes"
          notesPlaceholder="Optional: paste notes here, or use this instead of uploading a file."
          attachments={attachments}
          notes={notes}
          setNotes={setNotes}
          usedBytes={usedBytes}
          isReading={isReading}
          notice={notice}
          errors={uploadErrors}
          addFiles={addFiles}
          removeAttachment={removeAttachment}
          clearAttachments={clearAttachments}
        />

        <label className="generator-checkbox">
          <input type="checkbox" checked={saveOfflineCopy} onChange={(event) => onSaveOfflineChange(event.target.checked)} />
          <span>Also save an offline copy on this device</span>
        </label>
        {configured && !user ? <p className="generation-hint">{signInError}</p> : null}

        <div className="button-row">
          <button className="button primary" type="button" onClick={() => generate()} disabled={isBusy || !isOnline}>
            {progress.isRunning ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}
            {progress.isRunning ? "Generating..." : "Generate with AI"}
          </button>
          {message ? <span className="template-message">{message}</span> : null}
        </div>

        {progress.steps.length ? (
          <ol className="generation-progress" aria-label="Generation progress">
            {progress.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        ) : null}

        {progress.isRunning ? (
          <p className="generation-hint">
            Working for {progress.elapsed}s{progress.elapsed >= 30 ? " — AI generation can take a minute or two, especially for larger counts." : " — hang tight."}
          </p>
        ) : null}
      </div>

      {hasGenerationErrors ? (
        <div className="generator-errors" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      ) : null}

      {jsonText ? (
        <GeneratedReviewerPanel
          jsonCheck={jsonCheck}
          stats={stats}
          isRegenerating={progress.isRunning}
          isAdding={extendProgress.isRunning}
          isSaving={isSaving}
          savedReviewer={savedReviewer}
          saveLabel={configured && user ? "Save to Cloud" : "Save Offline"}
          onRegenerate={() => generate({ regenerate: true })}
          onOpen={() => onNavigate?.(savedReviewer?.reviewerId)}
          onEdit={() => onNavigate?.(savedReviewer?.reviewerId, { edit: true })}
          onSave={() => saveJson(jsonText)}
          makeMoreControl={
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
              <button className="button subtle" type="button" onClick={makeMoreQuestions} disabled={isBusy || !isOnline}>
                {extendProgress.isRunning ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}
                {extendProgress.isRunning ? "Adding..." : "Add Questions"}
              </button>
            </div>
          }
        />
      ) : null}

      <div className="generator-panel-foot">
        <button className="link-button" type="button" onClick={resetMode} disabled={isBusy}>
          Clear this mode
        </button>
      </div>
    </>
  );
}