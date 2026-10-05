import { FileJson, ListChecks, Loader2, RotateCcw, Save } from "lucide-react";

// The panel both modes show once a reviewer exists: what came back, whether it passed
// the app's own structure check, and where to go next. Presentational on purpose, so
// the two modes cannot end up showing a different set of facts about the same
// reviewer.
export default function GeneratedReviewerPanel({
  jsonCheck,
  stats,
  extraStats,
  isRegenerating,
  isAdding = false,
  isSaving = false,
  savedReviewer,
  saveLabel,
  onRegenerate,
  onMakeMore,
  makeMoreControl,
  onOpen,
  onEdit,
  onSave
}) {
  return (
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
          {stats ? <span>Requested {stats.requested}; generated {stats.generated}</span> : null}
          {stats?.difficultyMix ? (
            <span>
              {stats.difficultyMix.easy} easy / {stats.difficultyMix.medium} medium / {stats.difficultyMix.hard} hard &middot; {stats.difficultyMix.scenario} exam-style / {stats.difficultyMix.direct} direct
            </span>
          ) : null}
          {extraStats}
        </div>
      ) : null}

      {makeMoreControl}

      <div className="button-row">
        <button
          className="button subtle"
          type="button"
          onClick={onRegenerate}
          disabled={isRegenerating || isAdding}
        >
          {isRegenerating ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <RotateCcw size={17} aria-hidden="true" />}
          Regenerate
        </button>
        {savedReviewer ? (
          <button className="button subtle" type="button" onClick={onEdit}>
            <ListChecks size={17} aria-hidden="true" />
            Edit Questions
          </button>
        ) : null}
        {savedReviewer ? (
          <button className="button primary" type="button" onClick={onOpen}>
            Open Reviewer
          </button>
        ) : (
          <button className="button primary" type="button" onClick={onSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="spinner" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
            {isSaving ? "Saving..." : saveLabel}
          </button>
        )}
      </div>
    </div>
  );
}