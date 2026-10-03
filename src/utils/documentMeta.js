/**
 * One definition of what each public route claims to be about, shared by the
 * build-time prerenderer and the running app. scripts/prerender.mjs writes these
 * values into dist/<route>/index.html, and App applies the same values when the
 * router navigates. Keeping both on this module is what stops a hard load and a
 * click from disagreeing about the title.
 */

export const SITE_ORIGIN = "https://hachi-review.site";

export const DEFAULT_META = {
  title: "Hachi - Your Study Companion",
  description:
    "Hachi is a study companion for organizing notes and reviewers, practicing with quizzes, and tracking progress, online or offline."
};

export const ROUTE_META = {
  "/": DEFAULT_META,
  "/about": {
    title: "About Us - Hachi",
    description:
      "Hachi is an independent study companion for turning notes into quizzes, tracking progress, and revising online or offline. See who runs the site and how it is funded."
  },
  "/contact": {
    title: "Contact Us - Hachi",
    description:
      "Get in touch about Hachi support, bug reports, privacy and takedown requests, or advertising on the site."
  },
  "/privacy": {
    title: "Privacy Policy - Hachi",
    description:
      "How Hachi handles your data: what stays on your device, what syncs to your account, and how advertising is kept separate from your study material."
  },
  "/terms": {
    title: "Terms of Service - Hachi",
    description:
      "The terms covering your use of Hachi, including your content, AI-generated questions, and app availability."
  }
};

function normalise(pathname) {
  if (!pathname) return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed || "/";
}

export function resolveDocumentMeta(pathname) {
  const known = ROUTE_META[normalise(pathname)];

  if (known) {
    return { ...known, url: `${SITE_ORIGIN}${normalise(pathname)}` };
  }

  // Everything behind the account screen keeps the shell's own metadata, including
  // a canonical pointing at the root. That is what a hard load of those routes
  // already returns, so navigating in-app must not leave a stale canonical behind.
  return { ...DEFAULT_META, url: `${SITE_ORIGIN}/` };
}

function ensureMeta(doc, attribute, key, content) {
  let element = doc.head.querySelector(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = doc.createElement("meta");
    element.setAttribute(attribute, key);
    doc.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function ensureCanonical(doc, href) {
  let element = doc.head.querySelector('link[rel="canonical"]');
  if (!element) {
    element = doc.createElement("link");
    element.setAttribute("rel", "canonical");
    doc.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

export function applyDocumentMeta(meta) {
  if (typeof document === "undefined") return;

  document.title = meta.title;
  ensureMeta(document, "name", "description", meta.description);
  ensureMeta(document, "property", "og:title", meta.title);
  ensureMeta(document, "property", "og:description", meta.description);
  ensureMeta(document, "property", "og:url", meta.url);
  ensureMeta(document, "name", "twitter:title", meta.title);
  ensureMeta(document, "name", "twitter:description", meta.description);
  ensureCanonical(document, meta.url);
}