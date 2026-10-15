import { Link } from "react-router-dom";

/**
 * The footer every public page ends with.
 *
 * It exists as a component because these pages are the only part of the site a
 * crawler can read, so the links in here are how the content is found: each new
 * page has to be reachable from the pages already indexed, not only from the
 * sitemap. Adding a page to the sitemap without adding it here leaves it
 * discoverable but unlinked, which is a weaker signal than either.
 */

const PUBLIC_LINKS = [
  { to: "/features", label: "Features" },
  { to: "/faq", label: "FAQ" },
  { to: "/guides", label: "Study Guides" },
  { to: "/about", label: "About Us" },
  { to: "/contact", label: "Contact Us" },
  { to: "/privacy", label: "Privacy Policy" },
  { to: "/terms", label: "Terms of Service" }
];

export default function PublicFooter() {
  return (
    <footer className="legal-footer">
      <Link className="back-link" to="/">Back to Hachi</Link>
      {PUBLIC_LINKS.map((link) => (
        <Link key={link.to} to={link.to}>{link.label}</Link>
      ))}
    </footer>
  );
}