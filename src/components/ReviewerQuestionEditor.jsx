import { useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";
import { getChoiceBalanceIssue, getQuestionDifficulty, getQuestionStyle } from "../utils/quizUtils.js";
import {
  choiceLettersFor,
  DIFFICULTY_OPTIONS,
  isTypedQuestion,
  normalizeQuestionForSave,
  normalizeQuestionType,
  QUESTION_TYPE_OPTIONS,
  questionProblems,
  setChoiceValue,
  setCorrectAnswer
} from "../utils/questionEditor.js";

export default function ReviewerQuestionEditor({ reviewer, saving, error, onClose, onSave }) {
  const sourceQuestions = Array.isArray(reviewer?.questions) ? reviewer.questions : [];
  const [draft, setDraft] = useState(() => sourceQuestions.map((question) => ({ ...question })));
  const [selectedId, setSelectedId] = useState(() => sourceQuestions[0]?.id ?? null);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");

  // Recomputed from the draft rather than from the saved questions, so the flag on
  // a question appears and disappears as its choices are edited. Checking the saved
  // copy would only ever tell the owner what they already knew.
  const flagged = useMemo(() => {
    const byId = new Map();
    draft.forEach((question) => {
      const issue = getChoiceBalanceIssue(question);
      if (issue) byId.set(question.id, issue);
    });
    return byId;
  }, [draft]);

  const problemsById = useMemo(() => {
    const byId = new Map();
    draft.forEach((question) => {
      const problems = questionProblems(question);
      if (problems.length) byId.set(question.id, problems);
    });
    return byId;
  }, [draft]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return draft.filter((question, index) => {
      if (filter === "flagged" && !flagged.has(question.id)) return false;
      if (!needle) return true;
      return [question.topic, question.question, question.explanation, index + 1]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [draft, filter, flagged, query]);

  // Always one of the visible questions. When a filter or a search hides the one
  // being edited, the form follows the list rather than showing a question that is
  // not in it.
  const selected = visible.find((question) => question.id === selectedId) || visible[0] || null;
  const selectedIndex = selected ? visible.indexOf(selected) : -1;
  const selectedIssue = selected ? flagged.get(selected.id) : null;
  const selectedProblems = selected ? problemsById.get(selected.id) : null;
  const brokenCount = problemsById.size;

  function patchQuestion(id, patch) {
    setDraft((current) => current.map((question) => (
      question.id === id ? { ...question, ...patch } : question
    )));
  }

  function replaceQuestion(id, next) {
    setDraft((current) => current.map((question) => (
      question.id === id ? next : question
    )));
  }

  function stepSelected(offset) {
    const next = visible[selectedIndex + offset];
    if (next) setSelectedId(next.id);
  }

  function submit(event) {
    event.preventDefault();
    if (saving || brokenCount) return;
    onSave(draft.map(normalizeQuestionForSave));
  }

  const type = selected?.type || "multiple_choice";
  const letters = choiceLettersFor(type);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal question-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="question-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2 id="question-editor-title">Edit questions</h2>
            <p className="muted">
              {reviewer?.title} · {draft.length} question{draft.length === 1 ? "" : "s"}
            </p>
          </div>
          <button className="icon-button small" type="button" onClick={onClose} aria-label="Close">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="question-editor-filters">
          <div className="reviewer-menu-seg">
            <button
              type="button"
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              All {draft.length}
            </button>
            <button
              type="button"
              className={filter === "flagged" ? "active" : ""}
              onClick={() => setFilter("flagged")}
            >
              Gives itself away {flagged.size}
            </button>
          </div>

          <label className="question-editor-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search topic or wording"
              aria-label="Search questions"
            />
          </label>
        </div>

        <div className="question-editor-body">
          <ol className="question-editor-list">
            {visible.length ? visible.map((question) => {
              const index = draft.findIndex((entry) => entry.id === question.id);
              const issue = flagged.get(question.id);
              const problems = problemsById.get(question.id);

              return (
                <li key={question.id}>
                  <button
                    type="button"
                    className={`question-editor-row${question.id === selected?.id ? " active" : ""}`}
                    onClick={() => setSelectedId(question.id)}
                    aria-current={question.id === selected?.id}
                  >
                    <span className="question-editor-number">{index + 1}</span>
                    <span className="question-editor-row-copy">
                      <strong>{question.topic || "No topic"}</strong>
                      <small>{question.question || "No question text"}</small>
                    </span>
                    {problems ? (
                      <span className="question-editor-flag broken" title={problems.join(" ")}>
                        <AlertTriangle size={14} aria-hidden="true" />
                        <span className="sr-only">Incomplete</span>
                      </span>
                    ) : null}
                    {issue ? (
                      <span className="question-editor-flag" title={issue.reasons.join("; ")}>
                        <AlertTriangle size={14} aria-hidden="true" />
                        <span className="sr-only">Gives itself away</span>
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            }) : (
              <li className="question-editor-empty">
                <p className="reviewer-menu-note">
                  {filter === "flagged"
                    ? "No question gives itself away right now."
                    : "Nothing matches that search."}
                </p>
              </li>
            )}
          </ol>

          {selected ? (
            <form className="question-editor-form modal-form" id="question-editor-form" onSubmit={submit}>
              <div className="question-editor-form-head">
                <div>
                  <span className="question-editor-position">
                    Question {draft.findIndex((question) => question.id === selected.id) + 1} of {draft.length}
                  </span>
                  <span className="question-editor-style">
                    Reads as {getQuestionStyle(selected) === "scenario" ? "a scenario" : "a direct question"}
                  </span>
                </div>
                <div className="question-editor-step">
                  <button
                    className="icon-button small"
                    type="button"
                    onClick={() => stepSelected(-1)}
                    disabled={selectedIndex <= 0}
                    aria-label="Previous question"
                  >
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <button
                    className="icon-button small"
                    type="button"
                    onClick={() => stepSelected(1)}
                    disabled={selectedIndex < 0 || selectedIndex >= visible.length - 1}
                    aria-label="Next question"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <label htmlFor="question-editor-topic">Topic</label>
              <input
                id="question-editor-topic"
                value={selected.topic || ""}
                onChange={(event) => patchQuestion(selected.id, { topic: event.target.value })}
              />

              <label htmlFor="question-editor-question">Question</label>
              <textarea
                id="question-editor-question"
                rows={3}
                value={selected.question || ""}
                onChange={(event) => patchQuestion(selected.id, { question: event.target.value })}
              />

              {isTypedQuestion(type) ? (
                <>
                  <label htmlFor="question-editor-answer">Answer</label>
                  <textarea
                    id="question-editor-answer"
                    rows={2}
                    value={selected.answerText || ""}
                    onChange={(event) => patchQuestion(selected.id, { answerText: event.target.value })}
                  />
                </>
              ) : (
                <>
                  <span className="question-editor-legend">Choices</span>
                  {letters.map((letter) => {
                    const isCorrect = String(selected.correctAnswer || "").toUpperCase() === letter;
                    return (
                      <div className={`question-editor-choice${isCorrect ? " correct" : ""}`} key={letter}>
                        <button
                          type="button"
                          className="question-editor-correct"
                          onClick={() => replaceQuestion(selected.id, setCorrectAnswer(selected, letter))}
                          aria-pressed={isCorrect}
                          aria-label={`Mark choice ${letter} correct`}
                        >
                          {isCorrect ? <Check size={14} aria-hidden="true" /> : null}
                          <span>{letter}</span>
                        </button>
                        <input
                          value={selected.choices?.[letter] || ""}
                          onChange={(event) => replaceQuestion(selected.id, setChoiceValue(selected, letter, event.target.value))}
                          aria-label={`Choice ${letter}`}
                        />
                      </div>
                    );
                  })}
                </>
              )}

              <label htmlFor="question-editor-explanation">Explanation</label>
              <textarea
                id="question-editor-explanation"
                rows={3}
                value={selected.explanation || ""}
                onChange={(event) => patchQuestion(selected.id, { explanation: event.target.value })}
              />

              <div className="question-editor-selects">
                <div>
                  <label htmlFor="question-editor-type">Type</label>
                  <select
                    id="question-editor-type"
                    value={type}
                    onChange={(event) => replaceQuestion(selected.id, normalizeQuestionType(selected, event.target.value))}
                  >
                    {QUESTION_TYPE_OPTIONS.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="question-editor-difficulty">Difficulty</label>
                  <select
                    id="question-editor-difficulty"
                    value={getQuestionDifficulty(selected)}
                    onChange={(event) => patchQuestion(selected.id, { difficulty: event.target.value })}
                  >
                    {DIFFICULTY_OPTIONS.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedIssue ? (
                <p className="question-editor-warning">
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span>
                    <strong>This one gives itself away.</strong>{" "}
                    {selectedIssue.reasons.join("; ")}.
                  </span>
                </p>
              ) : null}

              {selectedProblems ? (
                <p className="reviewer-menu-note error">{selectedProblems.join(" ")}</p>
              ) : null}
            </form>
          ) : (
            <div className="question-editor-form question-editor-no-selection">
              <p className="reviewer-menu-note">Select a question to edit it.</p>
            </div>
          )}
        </div>

        {error ? <p className="sync-message error">{error}</p> : null}
        {brokenCount ? (
          <p className="reviewer-menu-note error">
            {brokenCount} question{brokenCount === 1 ? "" : "s"} cannot be saved until the fields marked above are filled in.
          </p>
        ) : null}

        <div className="modal-actions">
          <button className="button subtle" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" form="question-editor-form" disabled={saving || brokenCount > 0 || !selected}>
            {saving ? <Loader2 className="spinner" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </section>
    </div>
  );
}