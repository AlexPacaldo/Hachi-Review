import { useEffect, useState } from "react";
import { FileCheck2, HelpCircle, Loader2, Sparkles, Upload } from "lucide-react";
import { useAuth } from "../../contexts/AuthContext.jsx";
import { logClientError } from "../../utils/errorLogger.js";
import GeneratedReviewerPanel from "./GeneratedReviewerPanel.jsx";
import SourceFileField from "./SourceFileField.jsx";
import { useGenerationProgress } from "./useGenerationProgress.js";
import { useSourceAttachments } from "./useSourceAttachments.js";
import {
  DEFAULT_EXAM_INSTRUCTIONS,
  EXAM_ANSWER_OPTIONS,
  MAX_AI_SOURCE_TEXT_LENGTH,
  MAX_REVIEWER_QUESTIONS,
  checkAiRateLimit,
  countAnswerProvenance,
  formatBytes,
  getFriendlyGenerationError,
  normalizeReviewerJson
} from "./generatorShared.js";
import {
  assertValidReviewer,
  getSaveMessage,
  getSignInError,
  persistReviewer,
  postGenerationRequest
} from "./generatorApi.js";

const MODE_HINT = "The paper is copied as it is: original wording, original A/B/C/D positions, original numbering. Nothing is rewritten and no item is invented.";

// An exam paper in, the same exam paper out as a reviewer.
//
// This is a transcription job, not a generation job, and the two are kept apart on
// purpose. Everything generation mode does to a reviewer's questions afterwards is
// wrong here: topping up would invent items the paper does not have, and rebalancing
// choices would move answers off the letters the paper's own key printed, which
// breaks the one thing the learner is checking themselves against.
//
// The one decision this mode asks for is where the answers come from, and it is asked
// up front rather than guessed at, because the two are not interchangeable. Working
// them out can be right or wrong. Using the paper's key is either faithful or there
// is no key, and there is no middle ground where a missing answer gets invented.
export default function ExamPaperMode({
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
  } = useSourceAttachments({ initialNotes: draft.notes || "" });
  const progress = useGenerationProgress();

  const [answerSource, setAnswerSource] = useState(draft.answerSource || "solve");
  const [instructions, setInstructions] = useState(draft.instructions || DEFAULT_EXAM_INSTRUCTIONS);
  const [jsonText, setJsonText] = useState(draft.jsonText || "");
  const [errors, setErrors] = useState([]);
  const [jsonCheck, setJsonCheck] = useState(null);
  const [savedReviewer, setSavedReviewer] = useState(null);
  const [stats, setStats] = useState(null);
  const [answerStats, setAnswerStats] = useState(null);
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const sourceText = notes.trim().slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
  const signInError = getSignInError({ configured, session });
  const selectedAnswerOption = EXAM_ANSWER_OPTIONS.find((option) => option.value === answerSource);
  // Upload problems are reported by the upload field itself, next to the control
  // that caused them. Only import problems belong in the block below, and listing
  // both here would show every upload error twice.
  const hasImportErrors = errors.length > 0;

  useEffect(() => {
    onDraftChange?.({ notes, answerSource, instructions, jsonText });
  }, [notes, answerSource, instructions, jsonText, onDraftChange]);

  function buildReviewerFromJson(rawJson, { preserveReviewerId = false } = {}) {
    const reviewer = normalizeReviewerJson(JSON.parse(rawJson), { preserveReviewerId });
    assertValidReviewer(reviewer, "Paste valid reviewer JSON before checking.");
    setErrors([]);
    setJsonCheck({
      title: reviewer.title,
      subject: reviewer.subject,
      questions: reviewer.questions.length,
      coverage: reviewer.coverage.length
    });
    return reviewer;
  }

  async function importPaper() {
    if (!isOnline) {
      setErrors(["Connect to the internet before importing an exam paper."]);
      return;
    }

    if (!payloadFiles.length && sourceText.length < 100) {
      setErrors(["Upload the exam paper, or paste its questions as text, before importing it."]);
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

    progress.begin("Reading the paper");
    setErrors([]);
    setJsonCheck(null);
    setSavedReviewer(null);
    setStats(null);
    setAnswerStats(null);
    setMessage("Transcribing the paper...");

    try {
      progress.recordStep(`Answer source: ${selectedAnswerOption.label}`);
      progress.recordStep("Sending the paper to the AI");
      const data = await postGenerationRequest({
        session,
        body: {
          mode: "exam_import",
          answerSource,
          sourceText,
          files: payloadFiles,
          title: details.title,
          subject: details.subject,
          instructions
        },
        fallbackMessage: "The AI could not import that paper."
      });
      progress.recordStep("Reading AI response");

      const reviewer = normalizeReviewerJson(data.reviewer);
      assertValidReviewer(reviewer, "The imported paper did not pass the reviewer structure check.");

      progress.recordStep("Saving reviewer");
      const saveMode = await persistReviewer({ configured, user, reviewer, saveOffline: saveOfflineCopy });
      const nextJsonText = JSON.stringify(reviewer, null, 2);
      setJsonText(nextJsonText);
      buildReviewerFromJson(nextJsonText);
      onReviewerPersisted?.();

      const provenance = countAnswerProvenance(reviewer.questions);
      setSavedReviewer({ reviewerId: reviewer.reviewerId, saveMode });
      setStats({
        requested: "the whole paper",
        generated: data.generatedQuestionCount || reviewer.questions.length,
        difficultyMix: data.difficultyMix || null
      });
      setAnswerStats({ ...provenance, reported: data.answerKeyStats || null });

      const imported = reviewer.questions.length;
      const total = imported + (data.answerKeyStats?.unresolved || 0);
      setMessage(data.warning
        ? `${data.warning} ${getSaveMessage(saveMode)}`
        : `Imported ${imported}${total > imported ? ` of ${total}` : ""} items from the paper. ${getSaveMessage(saveMode)}`);
      progress.recordStep("Done");
    } catch (error) {
      logClientError("import-exam-paper", error, {
        answerSource,
        hasUploadedFile: payloadFiles.length > 0,
        sourceLength: sourceText.length
      });
      setMessage("");
      setErrors([getFriendlyGenerationError(error)]);
    } finally {
      progress.end();
    }
  }

  async function saveJson(rawJson) {
    try {
      const parsedReviewer = buildReviewerFromJson(rawJson);

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
    setAnswerSource("solve");
    setInstructions(DEFAULT_EXAM_INSTRUCTIONS);
    setJsonText("");
    setErrors([]);
    setJsonCheck(null);
    setSavedReviewer(null);
    setStats(null);
    setAnswerStats(null);
    setMessage("");
    setNotes("");
    clearAttachments();
  }

  return (
    <>
      <div className="ai-prompt-panel exam-prompt-panel">
        <p className="exam-mode-hint">{MODE_HINT}</p>

        <div className="generator-form-grid">
          <label>
            <span>Reviewer Title</span>
            <input value={details.title} onChange={(event) => updateDetails("title", event.target.value)} placeholder="Optional: taken from the paper" />
          </label>
          <label>
            <span>Subject</span>
            <input value={details.subject} onChange={(event) => updateDetails("subject", event.target.value)} placeholder="Optional: taken from the paper" />
          </label>
        </div>

        <fieldset className="generator-option-group">
          <legend>Where should the answers come from?</legend>
          <div className="answer-source-options" role="radiogroup" aria-label="Answer source">
            {EXAM_ANSWER_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`answer-source-card${answerSource === option.value ? " active" : ""}`}
              >
                <input
                  type="radio"
                  name="exam-answer-source"
                  value={option.value}
                  checked={answerSource === option.value}
                  onChange={() => setAnswerSource(option.value)}
                />
                <span className="answer-source-label">
                  {option.value === "solve" ? <Sparkles size={17} aria-hidden="true" /> : <FileCheck2 size={17} aria-hidden="true" />}
                  {option.label}
                </span>
                <span className="answer-source-description">{option.description}</span>
              </label>
            ))}
          </div>
          <p className="generator-note">
            <HelpCircle size={15} aria-hidden="true" />
            {answerSource === "extract"
              ? "Items the paper does not answer are left out of the reviewer and reported back as a count, because a guessed answer is indistinguishable from a real one once it is in the quiz."
              : "Items the AI is not confident about are left out and reported back as a count rather than guessed at."}
          </p>
        </fieldset>

        <SourceFileField
          label="Exam paper"
          uploadTitle="Upload the exam paper"
          hint="PDF, image, or TXT, MD, CSV, JSON — click to browse or drag files here. Photograph the pages, or attach the PDF. Up to six files."
          emptyHint="A paper that runs to several pages can be attached as several photos, in page order. Include the answer key pages if you chose to use the paper's own answers."
          notesLabel="Paper text"
          notesPlaceholder="Optional: paste the paper's questions here, or use this instead of uploading a file."
          notesHint={`Pasted text is sent alongside the attached files, never instead of them. ${MAX_AI_SOURCE_TEXT_LENGTH.toLocaleString()} characters max.`}
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
          <button className="button primary" type="button" onClick={importPaper} disabled={progress.isRunning || !isOnline}>
            {progress.isRunning ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Upload size={17} aria-hidden="true" />}
            {progress.isRunning ? "Importing..." : "Import Exam Paper"}
          </button>
          {message ? <span className="template-message">{message}</span> : null}
        </div>

        {progress.steps.length ? (
          <ol className="generation-progress" aria-label="Import progress">
            {progress.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
        ) : null}

        {progress.isRunning ? (
          <p className="generation-hint">
            Working for {progress.elapsed}s{progress.elapsed >= 30 ? " — reading a whole paper can take a minute or two." : " — hang tight."}
          </p>
        ) : null}
      </div>

      {hasImportErrors ? (
        <div className="generator-errors" role="alert">
          {errors.map((error) => <p key={error}>{error}</p>)}
        </div>
      ) : null}

      {jsonText ? (
        <GeneratedReviewerPanel
          jsonCheck={jsonCheck}
          stats={stats}
          extraStats={answerStats ? (
            <>
              <span>
                Answers from the paper: {answerStats.paper} &middot; worked out by the AI: {answerStats.solved}
                {answerStats.reported?.unresolved ? ` \u00b7 left out as unanswerable: ${answerStats.reported.unresolved}` : ""}
              </span>
              {answerStats.reported?.droppedForLength ? (
                <span>The paper runs past {MAX_REVIEWER_QUESTIONS} items, so the remainder was not imported.</span>
              ) : null}
            </>
          ) : null}
          isRegenerating={progress.isRunning}
          isSaving={isSaving}
          savedReviewer={savedReviewer}
          saveLabel={configured && user ? "Save to Cloud" : "Save Offline"}
          onRegenerate={importPaper}
          onOpen={() => onNavigate?.(savedReviewer?.reviewerId)}
          onEdit={() => onNavigate?.(savedReviewer?.reviewerId, { edit: true })}
          onSave={() => saveJson(jsonText)}
          makeMoreControl={null}
        />
      ) : null}

      {/* Demoted, because the field it holds is not an input to the import. It is the
          line the learner reads under the title on the reviewer's own page, and a
          bare "Instructions" box sitting above the import button read as though it
          were a prompt to the AI. The default is right for almost everyone, so it
          does not belong in the path between choosing a paper and importing it. */}
      <details className="advanced-panel">
        <summary>Reviewer details</summary>
        <label className="prompt-box">
          <span>Instructions for the learner</span>
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            placeholder="Shown under the title when someone opens this reviewer."
          />
          <span className="source-field-hint">
            This is read by the learner before they start the quiz. It is not an instruction to the AI, so changing it
            only changes that line.
          </span>
        </label>
      </details>

      <div className="generator-panel-foot">
        <span className="generation-hint">
          {selectedAnswerOption.label} &middot; {usedBytes ? `${formatBytes(usedBytes)} attached` : "Nothing attached yet"}
        </span>
        <button className="link-button" type="button" onClick={resetMode} disabled={progress.isRunning}>
          Clear this mode
        </button>
      </div>
    </>
  );
}