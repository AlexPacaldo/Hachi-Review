import { useId, useRef } from "react";
import { FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import {
  MAX_AI_ATTACHMENT_BYTES,
  MAX_AI_SOURCE_TEXT_LENGTH,
  MAX_SOURCE_FILES,
  SOURCE_ACCEPT,
  formatBytes
} from "./generatorShared.js";

const KIND_ICONS = {
  image: ImageIcon,
  pdf: FileText,
  upload: Paperclip
};

// The upload control both generator modes use. It owns the file input, the attached
// file list with previews, and the budget readout; it knows nothing about what the
// files are going to be used for.
export default function SourceFileField({
  label,
  uploadTitle = "Upload study material",
  hint,
  emptyHint,
  notesLabel,
  notesPlaceholder,
  attachments,
  notes,
  setNotes,
  usedBytes,
  isReading,
  notice,
  errors,
  addFiles,
  removeAttachment,
  clearAttachments,
  notesOptional = true,
  notesHint
}) {
  const inputId = useId();
  const inputRef = useRef(null);

  const handleChange = (event) => {
    addFiles(event.target.files);
    // Reset so choosing the same file twice in a row still fires a change event.
    event.target.value = "";
  };

  const budgetUsed = Math.round((usedBytes / MAX_AI_ATTACHMENT_BYTES) * 100);

  return (
    <>
      <div className="source-field">
        <span className="source-field-label" id={`${inputId}-label`}>{label}</span>
        <label className="upload-zone ai-upload-zone" htmlFor={inputId}>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            multiple
            accept={SOURCE_ACCEPT}
            onChange={handleChange}
          />
          {isReading ? <Loader2 className="spinner" size={30} aria-hidden="true" /> : <Upload size={30} aria-hidden="true" />}
          <strong>{isReading ? "Reading files..." : uploadTitle}</strong>
          <span>{hint}</span>
        </label>
        {emptyHint ? <p className="generation-hint">{emptyHint}</p> : null}

        {attachments.length ? (
          <div className="attachment-list">
            <div className="attachment-list-head">
              <span>
                {attachments.length} of {MAX_SOURCE_FILES} attached &middot; {formatBytes(usedBytes)} of {formatBytes(MAX_AI_ATTACHMENT_BYTES)} upload budget used
              </span>
              <button className="link-button" type="button" onClick={clearAttachments}>
                Remove all
              </button>
            </div>
            <ul className="attachment-grid">
              {attachments.map((attachment) => {
                const Icon = KIND_ICONS[attachment.kind] || Paperclip;
                const wasResized = attachment.kind === "image" && attachment.originalSize > attachment.size;

                return (
                  <li key={attachment.id} className="attachment-card">
                    {attachment.previewUrl ? (
                      <img className="attachment-thumb" src={attachment.previewUrl} alt="" />
                    ) : (
                      <span className="attachment-icon" aria-hidden="true"><Icon size={22} /></span>
                    )}
                    <span className="attachment-name" title={attachment.name}>{attachment.name}</span>
                    <span className="attachment-meta">
                      {formatBytes(attachment.size)}
                      {wasResized ? ` (resized from ${formatBytes(attachment.originalSize)})` : ""}
                      {attachment.width ? ` \u00b7 ${attachment.width}\u00d7${attachment.height}` : ""}
                    </span>
                    <button
                      className="attachment-remove"
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      aria-label={`Remove ${attachment.name}`}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {notice ? <p className="source-field-notice" role="status">{notice}</p> : null}
        {errors.length ? (
          <div className="generator-errors" role="alert">
            {errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        ) : null}

        {budgetUsed >= 100 ? (
          <p className="generation-hint">The upload budget is full. Remove a file before adding another.</p>
        ) : null}
      </div>

      <label className="prompt-box">
        <span>
          {notesLabel}
          {/* The explicit space is load-bearing. JSX drops whitespace-only lines
              between expressions, so without it the label and the tag join into
              "Paper textoptional" for anything reading the text content. */}
          {notesOptional ? <> <em className="optional-tag">optional</em></> : null}
        </span>
        <textarea
          value={notes}
          maxLength={MAX_AI_SOURCE_TEXT_LENGTH}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={notesPlaceholder}
        />
        {notesHint ? <span className="source-field-hint">{notesHint}</span> : null}
      </label>
    </>
  );
}