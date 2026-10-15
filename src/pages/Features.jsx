import { Link } from "react-router-dom";
import PublicFooter from "../components/PublicFooter.jsx";

const GENERATOR_TYPES = [
  ["Multiple Choice", "Four options, one correct answer, an explanation for each. The default and the most exam-like."],
  ["Identification", "A definition, term, or diagram and you identify it. Good for vocabulary-heavy material."],
  ["True / False", "Two options. Useful as a fast warm-up and for statements that are subtly wrong."],
  ["Flashcards", "Prompt on one side, answer on the other, and you decide whether you remembered it."]
];

const GENERATOR_COUNTS = ["20", "50", "75", "100", "Comprehensive"];

const QUIZ_MODES = [
  ["Practice Mode", "Every answer is checked and explained as you go, and a question you miss comes back later in the same quiz until you get it right. The mode to use while you are still learning the material."],
  ["Exam Mode", "Answer, go back, change your mind if you need to, and see nothing until you submit. The closest thing Hachi has to the real thing."],
  ["Timed Mode", "Exam mode with a countdown that submits automatically when it reaches zero. Useful for finding out how much you can actually finish."],
  ["Mistakes-Only Mode", "Only the questions you got wrong in your most recent completed attempt. By far the highest-value session in the app once you have taken something once already."],
  ["Flashcard Mode", "The prompt first, the answer revealed after, and you mark whether you remembered it. Fast, and honest about what you actually know."]
];

const STEPS = [
  ["Bring the material", "Typed notes, a PDF, a photo of a page, or any combination. Up to six files at once, and the budget is across all of them, so a three-page paper can be three photos."],
  ["Choose the shape", "Pick a question type, a count, and how the questions should read. Twenty questions from one section is a targeted drill; Comprehensive from a whole module is a revision set."],
  ["Generate", "Hachi reads the source first and then writes questions, answers, and an explanation against it, so the questions stay attached to your material rather than to general knowledge about the topic."],
  ["Check before you revise", "Open the reviewer and read a sample. Correct anything wrong in the editor. A generated question that is confidently incorrect is worse than no question, because you will revise the wrong thing."],
  ["Revise", "Take it in whichever mode fits. Use Mistakes-Only after the first attempt, and come back to the same reviewer a week later."]
];

export default function Features() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">Features</p>
        <h1>Everything Hachi does</h1>
        <p>
          Hachi is a study companion built around one loop: take material you already have, turn it into
          questions, practise them properly, and find the parts you keep getting wrong. This page is the
          whole of it, in more detail than the homepage manages.
        </p>
        <p>
          It is free to use, there is no subscription, and nothing is behind a paywall. An account adds cloud
          sync and sharing; it is not required to build a reviewer or take a quiz.
        </p>

        <h2>Turning material into a reviewer</h2>
        <p>
          There are two generator modes and they are opposites, which is why they are separate rather than one
          form with switches.
        </p>
        <ul>
          <li>
            <strong>Study Material</strong> writes questions your source does not contain. Paste notes, upload a
            PDF, or photograph a page, and Hachi builds a full reviewer with questions, answers, and an
            explanation for each one.
          </li>
          <li>
            <strong>Exam Paper</strong> transcribes a paper that already exists, question for question and in
            order. It adds nothing, and it never invents an item. See{" "}
            <Link to="/guides/past-papers">turning a past paper into a reviewer</Link> for the difference that
            makes, and for how to handle a paper that has no answer key.
          </li>
        </ul>
        <p>
          For Study Material you choose the question type and how many questions you want. The count can be{" "}
          {GENERATOR_COUNTS.slice(0, 4).join(", ")}, or{" "}
          {GENERATOR_COUNTS[4].toLowerCase()}, which covers everything important in the source rather than
          stopping at a number. If a reviewer comes back shorter than you asked for, you can extend it without
          regenerating what you already have.
        </p>

        <h3>Question types</h3>
        <ul>
          {GENERATOR_TYPES.map(([name, text]) => (
            <li key={name}><strong>{name}</strong>: {text}</li>
          ))}
        </ul>

        <h3>What it accepts</h3>
        <ul>
          <li>Typed notes pasted straight into the form.</li>
          <li>Documents: PDF, TXT, Markdown, CSV, JSON, and the usual document formats.</li>
          <li>Images, which can be mixed in alongside anything else.</li>
          <li>Up to six files in one request, with the size limit applying across all of them rather than per file.</li>
        </ul>
        <p>
          Any upload containing an image is routed to a provider that can actually look at it, even when notes
          were pasted alongside, so a mixed upload reads both. Large photographs are downscaled on your device
          before they are sent, and a photograph that is already small is passed through untouched rather than
          re-encoded larger than it started. HEIC is listed and then refused with an explanation, because a file
          the picker silently hides looks like a broken app.
        </p>

        <h2>Building questions by hand</h2>
        <p>
          Generation is optional. The question editor writes a reviewer from nothing: a topic, a question,
          choices, the correct answer, and an explanation. It is slower than pasting in notes and much better
          for the questions that came out of a lecture, a marking comment, or a past paper you disagree with.
        </p>
        <p>
          An editor saved from a shared reviewer updates that reviewer rather than creating a copy, so a
          correction everyone can see does not quietly split off into your private version.
        </p>

        <h2>Five ways to practise the same reviewer</h2>
        <p>
          A reviewer is not a quiz you take once. The same questions can be practised five different ways, and
          your progress is kept whichever you choose.
        </p>
        <ul>
          {QUIZ_MODES.map(([name, text]) => (
            <li key={name}><strong>{name}</strong>: {text}</li>
          ))}
        </ul>
        <p>
          If you only take one suggestion from this page, take it: sit something in Exam Mode with the notes
          shut, then open Review Answers afterwards and work through what you missed. That pairing is what
          {" "}<Link to="/guides/active-recall">active recall</Link> actually looks like in practice.
        </p>

        <h2>Your library</h2>
        <p>
          Every reviewer you build, whether generated or written by hand, lands in one searchable library with
          its subject, its topic, and how many questions it holds. Search across titles and question text, so
          &ldquo;where was that thing about the cardiac cycle&rdquo; is a question the library can answer.
        </p>
        <p>
          Edit, duplicate, rename, or delete any of them. Renaming a reviewer rewrites it from the copy on
          screen rather than from a summary, so a rename can never quietly take the questions with it.
        </p>

        <h2>Progress, streaks, and mistakes</h2>
        <ul>
          <li>
            <strong>History</strong> records every attempt: which reviewer, which mode, what you scored, and
            when. Read it as a list of what to do next rather than as a scoreboard.
          </li>
          <li>
            <strong>Mistakes</strong> keeps what you chose next to what was correct, with the explanation
            attached, long after the session ended.
          </li>
          <li>
            <strong>Study days</strong> counts the days you actually practised, which is a different number from
            the days the app was open.
          </li>
        </ul>
        <p>
          None of this is uploaded anywhere. It lives on your device until you sign in, and then it syncs to
          your own account. There is no leaderboard and nothing is compared to other people.
        </p>

        <h2>Offline, and installing it</h2>
        <p>
          Reviewers, quizzes, scores, and history all run from your device, so a bad connection costs you
          generation and sharing but not revision. Add Hachi to your home screen and it launches in its own
          window and keeps working with no signal at all.{" "}
          <Link to="/guides/offline-revision">What works offline, in detail</Link>.
        </p>

        <h2>Friends and groups</h2>
        <p>
          Signing in lets you sync across devices, add friends, and share reviewers. Sharing hands a copy to
          the people you share it with, which is worth knowing before you send something you might later want
          to delete. Groups give everyone one place to see the reviewers that belong to a module rather than a
          chat thread full of attachments.
        </p>
        <p>
          When the questions of a shared reviewer change, the people using it are told, so nobody revises an
          old version by accident.{" "}
          <Link to="/guides/study-groups">Running a group that works</Link> covers how to avoid five people
          making five slightly different reviewers for the same section.
        </p>

        <h2>What it does not do</h2>
        <p>
          Being straight about the limits is more useful than a longer feature list. Hachi does not have
          spaced repetition scheduling built in, so the timing of your revisits is yours to arrange;{" "}
          <Link to="/guides/spaced-revision">the spaced revision guide</Link> is how. It does not check your
          answers against an official mark scheme unless you give it one. It does not use a leaderboard or
          contact anyone who used it. And nothing it generates is authoritative: treat a generated reviewer as
          a draft to check against your own material, which is also what the{" "}
          <Link to="/terms">terms</Link> say.
        </p>

        <PublicFooter />
      </section>
    </div>
  );
}