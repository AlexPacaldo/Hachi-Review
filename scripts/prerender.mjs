import path from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Google treats every SPA route as the same page unless the served HTML differs.
 * Vercel rewrites every path to one index.html, so /about and /contact were being
 * served byte-identical to the homepage and dropped from the index as duplicates.
 *
 * This step emits a real static index.html per public route, each with its own
 * title, description, canonical URL, and rendered body text. Vercel serves static
 * files ahead of the rewrite, so the generated files win with no config change,
 * and the existing catch-all keeps serving the client-rendered app as before.
 */

const ROOT = process.cwd();
const ORIGIN = "https://hachi-review.site";
const SSR_OUT_DIR = path.join(ROOT, ".prerender");
const ENTRY = path.join(ROOT, "scripts", "prerender", "entry.jsx");

const ROUTES = [
  {
    route: "/about",
    title: "About Us - Hachi",
    description:
      "Hachi is an independent study companion for turning notes into quizzes, tracking progress, and revising online or offline. See who runs the site and how it is funded."
  },
  {
    route: "/contact",
    title: "Contact Us - Hachi",
    description:
      "Get in touch about Hachi support, bug reports, privacy and takedown requests, or advertising on the site."
  },
  {
    route: "/privacy",
    title: "Privacy Policy - Hachi",
    description:
      "How Hachi handles your data: what stays on your device, what syncs to your account, and how advertising is kept separate from your study material."
  },
  {
    route: "/terms",
    title: "Terms of Service - Hachi",
    description:
      "The terms covering your use of Hachi, including your content, AI-generated questions, and app availability."
  }
];

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
  const pattern = /<div id="root"><\/div>/;
  if (!pattern.test(html)) {
    throw new Error("Could not find <div id=\"root\"></div> in the built index.html");
  }
  return html.replace(pattern, () => `<div id="root">${markup}</div>`);
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

  for (const { route, title, description } of ROUTES) {
    const url = `${ORIGIN}${route}`;
    let html = template;
    html = setTitle(html, title);
    html = setMeta(html, "name", "description", description);
    html = setMeta(html, "property", "og:title", title);
    html = setMeta(html, "property", "og:description", description);
    html = setMeta(html, "property", "og:url", url);
    html = setCanonical(html, url);
    html = upsertTwitter(html, title, description);
    html = injectRoot(html, renderPage(route));

    const dir = path.join(ROOT, "dist", route.slice(1));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), html, "utf8");
    console.log(`prerendered ${route} -> dist${route}/index.html`);
  }

  await rm(SSR_OUT_DIR, { recursive: true, force: true });
}

await main();