import { Link, useParams } from "react-router-dom";
import PublicFooter from "../components/PublicFooter.jsx";
import { GUIDES, findGuide } from "../data/guides.js";

function formatDate(value) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * One component for every guide rather than a file per article.
 *
 * The route is a parameter and the prose lives in src/data/guides.js, which is
 * what lets the build write a real HTML file for each slug: the prerenderer reads
 * the same list and renders this component with a slug, so an article that is not
 * reachable from a hard load does not exist as far as a crawler is concerned.
 */

export default function Guide() {
  const { slug } = useParams();
  const guide = findGuide(slug);

  if (!guide) {
    return (
      <div className="page narrow">
        <section className="legal-panel">
          <p className="eyebrow">Guide</p>
          <h1>That guide does not exist</h1>
          <p>
            It may have been renamed. The full list of guides is on the <Link to="/guides">study guides
            page</Link>, and the questions people ask most are on the <Link to="/faq">FAQ</Link>.
          </p>
          <PublicFooter />
        </section>
      </div>
    );
  }

  const others = GUIDES.filter((other) => other.slug !== guide.slug);

  return (
    <div className="page narrow">
      <article className="legal-panel">
        <p className="eyebrow">Study guide</p>
        <h1>{guide.title}</h1>
        <p className="article-meta">
          {guide.minutes} min read &middot; last updated {formatDate(guide.updated)}
        </p>
        <p className="article-standfirst">{guide.blurb}</p>

        {guide.sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            {section.body?.map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}
            {section.bullets ? (
              <ul>
                {section.bullets.map((item) => (
                  <li key={item.slice(0, 40)}>{item}</li>
                ))}
              </ul>
            ) : null}
            {section.body2?.map((paragraph) => (
              <p key={paragraph.slice(0, 40)}>{paragraph}</p>
            ))}
          </section>
        ))}

        <h2>Try it</h2>
        <p>
          Every technique here works on a reviewer you already have, or on one built from your notes in a
          couple of minutes. The <Link to="/features">features page</Link> covers how, and the{" "}
          <Link to="/faq">FAQ</Link> covers the parts people usually get stuck on.
        </p>

        <h2>More guides</h2>
        <ul className="guide-index">
          {others.map((other) => (
            <li key={other.slug} className="guide-index-entry">
              <Link to={`/guides/${other.slug}`}>{other.title}</Link>
              <p>{other.blurb}</p>
            </li>
          ))}
        </ul>
        <p>
          <Link to="/guides">All guides</Link>
        </p>

        <PublicFooter />
      </article>
    </div>
  );
}