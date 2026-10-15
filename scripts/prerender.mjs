import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { resolveDocumentMeta, PUBLIC_ROUTES } from "../src/utils/documentMeta.js";

/**
 * Google treats every SPA route as the same page unless the served HTML differs.
 * Vercel rewrites every path to one index.html, so /about and /contact were being
 * served byte-identical to the homepage and dropped from the index as duplicates.
 *
 * This step emits a real static index.html per public route, each with its own
 * title, description, canonical URL, and rendered body text. Vercel serves static
 * files ahead of the rewrite, so the generated files win with no config change,
 * and the existing catch-all keeps serving the client-rendered app as before.
 *
 * The root is in this list too, and it is the one that matters most. Everything
 * else on this site is behind a sign-in, so the homepage is the only part of Hachi
 * a crawler can read at all. Served as the built shell it was a 3.5 KB document
 * whose entire body was an empty div, which is indistinguishable from a site with
 * nothing on it.
 */

const ROOT = process.cwd();
const SSR_OUT_DIR = path.join(ROOT, ".prerender");
const ENTRY = path.join(ROOT, "scripts", "prerender", "entry.jsx");

// A page that renders to almost nothing is a page that is not there. This is the
// check that catches a route added to ROUTE_META whose component renders an empty
// shell, which otherwise ships as a valid-looking HTML file that says nothing.
const MIN_MARKUP_LENGTH = 1500;

const ROUTES = PUBLIC_ROUTES.map((route) => ({ route, ...resolveDocumentMeta(route) }));

/**
 * The browser globals the app touches while rendering.
 *
 * renderToStaticMarkup runs the render phase and nothing else, so effects never
 * fire and nothing here has to behave. What does run is AppShell reading the saved
 * theme, NotificationProvider reading its history, and gsap arming a ticker at
 * import. This is the same shim scripts/render-check.mjs uses for the same
 * reason, and the render is verified by `npm test` rather than trusted.
 */
function installBrowserShims() {
  const noop = () => {};
  const store = new Map();

  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    key: (index) => [...store.keys()][index] ?? null,
    get length() { return store.size; }
  };

  globalThis.window = {
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    location: { pathname: "/", search: "" },
    matchMedia: () => ({
      matches: false,
      addEventListener: noop,
      removeEventListener: noop,
      addListener: noop,
      removeListener: noop
    }),
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: noop,
    scrollTo: noop
  };

  globalThis.document = {
    documentElement: { dataset: {} },
    addEventListener: noop,
    removeEventListener: noop,
    querySelector: () => null,
    querySelectorAll: () => []
  };

  Object.defineProperty(globalThis, "navigator", {
    value: { onLine: true, userAgent: "node" },
    configurable: true
  });
  globalThis.requestAnimationFrame = () => 0;
  globalThis.cancelAnimationFrame = noop;
  globalThis.matchMedia = globalThis.window.matchMedia;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function setMeta(html, attribute, key, value) {
  const pattern = new RegExp(
    `(<meta\\s+${attribute}=["']${escapeRegExp(key)}["']\\s+content=["'])([^"']*)(["'])`,
    "i"
  );
  if (!pattern.test(html)) {
    throw new Error(`Could not find <meta ${attribute}="${key}"> in the built index.html`);
  }
  const [, open, , close] = pattern.exec(html);
  return html.replace(pattern, () => `${open}${escapeAttribute(value)}${close}`);
}

function setCanonical(html, url) {
  const pattern = /(<link\s+rel=["']canonical["']\s+href=["'])([^"']*)(["'])/i;
  if (!pattern.test(html)) {
    throw new Error("Could not find <link rel=\"canonical\"> in the built index.html");
  }
  const [, open, , close] = pattern.exec(html);
  return html.replace(pattern, () => `${open}${escapeAttribute(url)}${close}`);
}

function setTitle(html, title) {
  const pattern = /<title>[\s\S]*?<\/title>/i;
  if (!pattern.test(html)) throw new Error("Could not find <title> in the built index.html");
  return html.replace(pattern, () => `<title>${escapeAttribute(title)}</title>`);
}

function upsertTwitter(html, title, description) {
  if (/<meta\s+name=["']twitter:title["']/i.test(html)) return html;
  const card = /<meta\s+name=["']twitter:card["'][^>]*>/i;
  if (!card.test(html)) return html;
  const tags = [
    `<meta name="twitter:title" content="${escapeAttribute(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttribute(description)}" />`
  ].join("\n    ");
  const [match] = card.exec(html);
  return html.replace(card, () => `${match}\n    ${tags}`);
}

function injectRoot(html, markup) {
  // Anchored on the noscript block rather than on the closing div, because the
  // markup being injected has divs of its own nested inside the root and a lazy
  // match to the first </div> would truncate it. The lookahead also makes a second
  // run over an already-prerendered dist/ correct rather than corrupting it, which
  // matters now that the root itself is written back over the file it came from.
  const pattern = /<div id="root">[\s\S]*?(?=<noscript)/;
  if (!pattern.test(html)) {
    throw new Error("Could not find <div id=\"root\"> in the built index.html");
  }
  return html.replace(pattern, () => `<div id="root">${markup}</div>\n    `);
}

async function buildSsrBundle() {
  await build({
    configFile: false,
    root: ROOT,
    logLevel: "warn",
    plugins: [react()],
    ssr: { noExternal: true },
    build: {
      ssr: ENTRY,
      outDir: SSR_OUT_DIR,
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        output: { entryFileNames: "entry.mjs", format: "es" }
      }
    }
  });
  return path.join(SSR_OUT_DIR, "entry.mjs");
}

async function main() {
  let template;
  try {
    template = await readFile(path.join(ROOT, "dist", "index.html"), "utf8");
  } catch {
    throw new Error("dist/index.html was not found. Run `vite build` before this script.");
  }

  const bundle = await buildSsrBundle();
  const { renderPage } = await import(pathToFileURL(bundle).href);

  for (const { route } of ROUTES) {
    const { title, description, url } = resolveDocumentMeta(route);
    const markup = renderPage(route);

    if (markup.length < MIN_MARKUP_LENGTH) {
      throw new Error(
        `${route} rendered ${markup.length} characters of body markup, which is under the ${MIN_MARKUP_LENGTH} minimum. `
          + "A public route that renders to almost nothing is served as a page with no content on it."
      );
    }

    let html = template;
    html = setTitle(html, title);
    html = setMeta(html, "name", "description", description);
    html = setMeta(html, "property", "og:title", title);
    html = setMeta(html, "property", "og:description", description);
    html = setMeta(html, "property", "og:url", url);
    html = setCanonical(html, url);
    html = upsertTwitter(html, title, description);
    html = injectRoot(html, markup);

    // The root is written back over the file it was read from, which is safe
    // because the template was read into memory before the loop began.
    const destination = route === "/" ? path.join(ROOT, "dist", "index.html") : path.join(ROOT, "dist", route.slice(1), "index.html");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, html, "utf8");
    console.log(`prerendered ${route} -> dist${route === "/" ? "" : route}/index.html (${markup.length} characters of body)`);
  }

  await rm(SSR_OUT_DIR, { recursive: true, force: true });
}

installBrowserShims();
await main();

// The landing page pulls in the animation library, which arms a ticker at import
// and keeps a timer on the loop. Every file is written by this point, so the
// process is ended rather than left waiting on a ticker that will never tick
// against the requestAnimationFrame stub above.
process.exit(0);