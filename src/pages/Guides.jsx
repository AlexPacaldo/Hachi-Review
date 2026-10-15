import { Link } from "react-router-dom";
import PublicFooter from "../components/PublicFooter.jsx";
import { GUIDES } from "../data/guides.js";

function formatDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function Guides() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">Study guides</p>
        <h1>How to actually use this</h1>
        <p>
          Hachi is a tool, and a tool does not tell you how to use it well. These guides are the method: what
          the research says about what works, and what each of those things looks like as something you do in
          the app.
        </p>
        <p>
          They are written for people revising, not for people evaluating software. Nothing here asks you to
          install anything.
        </p>

        <h2>The guides</h2>
        <ul className="guide-index">
          {GUIDES.map((guide) => (
            <li key={guide.slug} className="guide-index-entry">
              <Link to={`/guides/${guide.slug}`}>{guide.title}</Link>
              <p>{guide.blurb}</p>
              <span className="guide-index-meta">
                {guide.minutes} min read &middot; updated {formatDate(guide.updated)}
              </span>
            </li>
          ))}
        </ul>

        <h2>Where to start</h2>
        <p>
          If you have never used active recall deliberately, start with{" "}
          <Link to="/guides/active-recall">active recall beats rereading</Link>, because everything else in here
          assumes you have stopped rereading. If you already do that and want to fix a specific problem, go
          straight to <Link to="/guides/weak-topics">finding the topic you keep getting wrong</Link>, which is
          the highest-value session in the app once you have something to look at.
        </p>
        <p>
          If you are revising for something in the next fortnight, <Link to="/guides/spaced-revision">the
          spaced revision guide</Link> is the one with a schedule in it.
        </p>

        <PublicFooter />
      </section>
    </div>
  );
}