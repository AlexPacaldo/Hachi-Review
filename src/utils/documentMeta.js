import { GUIDES } from "../data/guides.js";

/**
 * One definition of what each public route claims to be about, shared by the
 * build-time prerenderer and the running app. scripts/prerender.mjs writes these
 * values into dist/<route>/index.html, and App applies the same values when the
 * router navigates. Keeping both on this module is what stops a hard load and a
 * click from disagreeing about the title.
 *
 * Everything in here is a route whose HTML is written to disk at build time. A
 * public route that is missing from this map is served as an empty root div and
 * is, to anything that does not run the app, a page with no content on it.
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
  },
  "/features": {
    title: "Features - Hachi Study Companion",
    description:
      "Everything Hachi does, in detail: generating reviewers from notes, a PDF or a photo, five ways to practise one, progress and mistake history, offline use, and sharing with friends and groups."
  },
  "/faq": {
    title: "Frequently Asked Questions - Hachi",
    description:
      "Answers about Hachi: whether an account is needed, what can be turned into a reviewer, how AI generation works, how offline use and sync behave, and how shared reviewers work."
  },
  "/guides": {
    title: "Study Guides - Hachi",
    description:
      "Practical guides on studying with Hachi: active recall, spaced revision, importing past papers, finding weak topics, running a study group, and revising offline."
  },
  ...Object.fromEntries(
    GUIDES.map((guide) => [
      `/guides/${guide.slug}`,
      {
        title: `${guide.title} - Hachi`,
        description: guide.metaDescription
      }
    ])
  )
};

/**
 * Every route the build writes its own HTML for, in the order they are written.
 * The root is included: it is the one page that has to carry the site's content
 * in its served HTML, because it is the page a crawler lands on first.
 */
export const PUBLIC_ROUTES = Object.keys(ROUTE_META);

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