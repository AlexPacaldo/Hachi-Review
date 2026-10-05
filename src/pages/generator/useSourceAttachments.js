import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_AI_ATTACHMENT_BYTES,
  MAX_AI_SOURCE_TEXT_LENGTH,
  MAX_SINGLE_FILE_BYTES,
  MAX_SOURCE_FILES,
  MIN_EXTRACTED_TEXT_LENGTH,
  extractPdfText,
  formatBytes,
  getDataUrlBytes,
  isHeicFile,
  isImageFile,
  isPdfFile,
  isTextFile,
  prepareImageForUpload,
  readFileAsDataUrl,
  readFileAsText
} from "./generatorShared.js";

// One attachment, whatever it came from. kind decides what the picker draws, and
// size is what actually goes over the wire, not the size of the file on disk, since
// an image has usually been downscaled by the time it gets here.
function createAttachment({ name, mimeType, size, data, kind, file, width, height, originalSize }) {
  return {
    id: `${name}-${size}-${mimeType}`,
    name,
    mimeType,
    size,
    data,
    kind,
    width: width || 0,
    height: height || 0,
    // Kept so the interface can say what it did, which matters when a photo arrived
    // at 4 MB and is about to be sent as 300 KB.
    originalSize: originalSize || size,
    // The preview points at the original file on disk rather than at the encoded
    // bytes: an object URL of the File is free, while rebuilding one out of base64
    // means decoding megabytes of it just to draw a thumbnail.
    previewUrl: kind === "image" && file && typeof URL?.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : ""
  };
}

// Holds the attached files and the pasted notes for one generator mode, and owns
// every rule about turning a dropped file into something the endpoint will accept:
// what the file is, whether it fits, and whether it can be sent as bytes or has to
// be read into the notes box instead.
//
// Both modes use this, because that decision tree is identical whether the material
// is a module to write questions from or a paper to transcribe. Only what happens
// afterwards differs, and that belongs to the mode.
export function useSourceAttachments({ initialNotes = "" } = {}) {
  const [attachments, setAttachments] = useState([]);
  const [notes, setNotes] = useState(initialNotes);
  const [errors, setErrors] = useState([]);
  const [notice, setNotice] = useState("");
  const [isReading, setIsReading] = useState(false);
  // A ref rather than a dependency, because revoking on unmount must see the final
  // list without re-running the effect (and revoking) on every change.
  const attachmentsRef = useRef(attachments);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // A leaked blob URL keeps its file alive for the life of the document, which is
  // the memory a page of notes is already short of.
  useEffect(() => () => {
    attachmentsRef.current.forEach((attachment) => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
  }, []);

  const addAttachment = useCallback((attachment) => {
    setAttachments((current) => {
      // Re-picking the same file is a no-op rather than a second copy, because the
      // duplicate spends upload budget to arrive at the same page twice.
      if (current.some((existing) => existing.id === attachment.id)) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        return current;
      }
      return [...current, attachment];
    });
  }, []);

  const usedBytes = useMemo(
    () => attachments.reduce((total, attachment) => total + attachment.size, 0),
    [attachments]
  );

  const acceptFile = useCallback(async (file) => {
    const dataUrl = await readFileAsDataUrl(file);
    const data = dataUrl.split(",")[1] || "";

    if (!data) throw new Error(`Could not read ${file.name}.`);

    if (isImageFile(file)) {
      // An empty dataUrl means the image is already small enough, so the original
      // bytes are used. That avoids re-encoding it and arriving at a bigger payload.
      const prepared = await prepareImageForUpload(file);
      const chosen = prepared?.dataUrl || dataUrl;

      return createAttachment({
        name: file.name,
        mimeType: chosen.slice(5, chosen.indexOf(";")) || file.type || "image/png",
        size: getDataUrlBytes(chosen),
        data: chosen.split(",")[1] || "",
        kind: "image",
        file,
        width: prepared?.width || 0,
        height: prepared?.height || 0,
        originalSize: file.size
      });
    }

    return createAttachment({
      name: file.name,
      mimeType: file.type || "application/pdf",
      size: file.size,
      data,
      kind: isPdfFile(file) ? "pdf" : "upload",
      file
    });
  }, []);

  const addFiles = useCallback(async (fileList) => {
    const incoming = Array.from(fileList || []);

    if (!incoming.length) return;

    setErrors([]);
    setNotice("");
    setIsReading(true);

    const nextErrors = [];
    const addedNames = [];
    let budget = MAX_AI_ATTACHMENT_BYTES - usedBytes;
    let currentCount = attachments.length;
    let notesText = notes;

    try {
      for (const file of incoming) {
        const label = file.name || "That file";

        // Checked on disk size first, before anything reads the file into memory.
        // What this guards against is the tab dying, which is not recoverable.
        if (file.size > MAX_SINGLE_FILE_BYTES) {
          nextErrors.push(`${label} is ${formatBytes(file.size)}. A browser cannot read a file over ${formatBytes(MAX_SINGLE_FILE_BYTES)} reliably; compress it or paste the text instead.`);
          continue;
        }

        if (isHeicFile(file)) {
          nextErrors.push(`${label} is a HEIC photo, which no browser here can display and no AI provider can read. Save or export it as JPG or PNG first.`);
          continue;
        }

        if (currentCount >= MAX_SOURCE_FILES) {
          nextErrors.push(`You can attach up to ${MAX_SOURCE_FILES} files. Remove one before adding another.`);
          break;
        }

        if (isTextFile(file)) {
          const text = await readFileAsText(file);
          notesText = [notesText, text].filter(Boolean).join("\n\n").slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
          addedNames.push(`${label} (text loaded)`);
          continue;
        }

        // A file that will not fit as bytes is not necessarily a dead end: a PDF
        // carries a text layer that can be read here and sent as text instead.
        if (file.size > budget) {
          if (!isPdfFile(file)) {
            nextErrors.push(`${label} is ${formatBytes(file.size)} and does not fit in the ${formatBytes(MAX_AI_ATTACHMENT_BYTES)} upload budget alongside what is already attached. Remove a file, use fewer or smaller images, or paste the text instead.`);
            continue;
          }

          const extracted = await extractPdfText(file).catch(() => "");

          if (extracted.length >= MIN_EXTRACTED_TEXT_LENGTH) {
            notesText = [notesText, extracted].filter(Boolean).join("\n\n").slice(0, MAX_AI_SOURCE_TEXT_LENGTH);
            addedNames.push(`${label} (text extracted)`);
            continue;
          }

          nextErrors.push(`${label} is too large to upload and has no readable text, so it may be a scan. Split it, compress it, or paste the important notes.`);
          continue;
        }

        const attachment = await acceptFile(file);

        // Re-checked on the encoded size. An image only shrinks, but only sometimes:
        // a small PNG can come out of the canvas larger than it went in.
        if (attachment.size > budget) {
          nextErrors.push(`${attachment.name} is ${formatBytes(attachment.size)} after resizing, which does not fit in the ${formatBytes(MAX_AI_ATTACHMENT_BYTES)} upload budget alongside what is already attached. Remove a file, use a smaller image, or paste the text instead.`);
          continue;
        }

        budget -= attachment.size;
        currentCount += 1;
        addAttachment(attachment);
        addedNames.push(label);
      }

      if (notesText !== notes) setNotes(notesText);

      if (addedNames.length) {
        const summary = addedNames.length === 1 ? addedNames[0] : `${addedNames.length} files ready`;
        setNotice(`${summary}. ${formatBytes(Math.max(0, budget))} of upload budget left.`);
      }

      setErrors(nextErrors);
    } catch (error) {
      setErrors([...(nextErrors.length ? nextErrors : []), error?.message || "Could not read that file."]);
    } finally {
      setIsReading(false);
    }
  }, [acceptFile, addAttachment, attachments.length, notes, usedBytes]);

  const removeAttachment = useCallback((id) => {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return current.filter((attachment) => attachment.id !== id);
    });
    setNotice("");
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return [];
    });
    setNotice("");
    setErrors([]);
  }, []);

  return {
    attachments,
    notes,
    setNotes,
    errors,
    notice,
    isReading,
    usedBytes,
    hasAttachments: attachments.length > 0,
    // The endpoint's contract. Always an array, whichever mode built it, so the
    // request shape cannot depend on which form the person filled in.
    payloadFiles: useMemo(
      () => attachments.map((attachment) => ({ name: attachment.name, mimeType: attachment.mimeType, data: attachment.data })),
      [attachments]
    ),
    addFiles,
    removeAttachment,
    clearAttachments
  };
}