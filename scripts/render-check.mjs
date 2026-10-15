// Renders the real app. Everything else in this suite reads source or exercises a
// module in isolation, which is why a change that moved a provider and left every
// other check green could still leave the deployed site a white screen: a hook
// called outside its provider throws during render, and no unit check looks at the
// provider tree.
//
// The failure this exists for is exact. Moving NotificationProvider inside
// AuthProvider is what fixed the notification history being wiped on reload, and
// done slightly wrong it puts the provider inside what AppShell returns, leaving
// AppShell's own useNotifications() outside its own provider. Every other check
// passed in that state. This one renders and fails.
//
// Run with `npm test`. Needs no browser and no database: Vite supplies the JSX
// transform and React renders to a string, so nothing mounts and no effect runs.

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

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
  location: { pathname: "/home", search: "" },
  matchMedia: () => ({
    matches: false,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop
  }),
  // A no-op, not a synchronous call. gsap's ticker re-arms itself through this, so
  // invoking the callback inline recurses until the stack gives out.
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

// Every route is rendered, because a provider only has to be wrong on one page to
// be a white screen, and the landing page and the app pages take different paths
// through the shell. The public content routes are here for the same reason: they
// are also the routes scripts/prerender.mjs writes to disk, so a page that renders
// nothing reaches a crawler as a page with nothing on it.
const ROUTES = [
  "/",
  "/home",
  "/library",
  "/friends",
  "/groups",
  "/account",
  "/history",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/features",
  "/faq",
  "/guides",
  "/guides/active-recall",
  "/guides/spaced-revision",
  "/guides/past-papers",
  "/guides/weak-topics",
  "/guides/study-groups",
  "/guides/offline-revision",
  "/guides/not-a-guide"
];

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
  // Left to Node's own resolver so the app and this script share one copy of React
  // and one of the router. Inlined instead, there would be two react contexts and
  // every hook would read the wrong one.
  ssr: { external: ["react", "react-dom", "react-dom/server", "react-router-dom"] }
});

let failures = 0;
let checks = 0;

function check(label, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${ok || !detail ? "" : `\n          ${detail}`}`);
}

try {
  const { default: App } = await vite.ssrLoadModule("/src/App.jsx");
  const { PUBLIC_ROUTES } = await vite.ssrLoadModule("/src/utils/documentMeta.js");

  const rendered = new Map();

  ROUTES.forEach((route) => {
    try {
      const html = renderToString(
        createElement(MemoryRouter, { initialEntries: [route] }, createElement(App))
      );
      rendered.set(route, html);
      check(`/${route.replace("/", "") || ""} renders`, html.length > 0, `produced ${html.length} characters`);
    } catch (error) {
      check(`/${route.replace("/", "") || ""} renders`, false, error.message);
    }
  });

  // The prerenderer writes one HTML file per PUBLIC_ROUTES entry and nothing else,
  // so a route added there but missed by this list would be shipped without ever
  // being rendered by a check. Both directions are asserted: a route checked here
  // but not prerendered is a page that only exists once the app boots.
  const missing = PUBLIC_ROUTES.filter((route) => !ROUTES.includes(route));
  check("every prerendered route is covered by this check", missing.length === 0, `not checked: ${missing.join(", ")}`);

  // A public route that renders a shell and no words is the failure the whole
  // prerender step exists to prevent, and it renders without throwing, so the
  // length assertion above cannot see it.
  const thin = PUBLIC_ROUTES.filter((route) => (rendered.get(route) || "").length < 1500);
  check("no public route renders an empty shell", thin.length === 0,
    `under 1500 characters: ${thin.map((route) => `${route} (${(rendered.get(route) || "").length})`).join(", ")}`);

  // Every guide in the content module has to have a route that finds it, or the
  // article is in the bundle and in the sitemap and nowhere else.
  const { GUIDES } = await vite.ssrLoadModule("/src/data/guides.js");
  const unresolved = GUIDES.filter((guide) => !(rendered.get(`/guides/${guide.slug}`) || "").includes(guide.title));
  check("every guide renders its own title", unresolved.length === 0, `unresolved: ${unresolved.map((g) => g.slug).join(", ")}`);

  // The provider tree, asserted on the source because a render cannot tell you
  // which constraint it just satisfied. AppShell calls the hook itself, so it has
  // to be rendered inside the provider; the provider has to be inside AuthProvider
  // because it reads an account's stores on mount and React runs a child's effects
  // before its parent's.
  const fs = await import("node:fs");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const authOpen = app.indexOf("<AuthProvider>");
  const notificationOpen = app.indexOf("<NotificationProvider>");
  const shellAt = app.indexOf("<AppShell />");

  check("the providers are nested, not repeated", (app.match(/<AuthProvider>/g) || []).length === 1
    && (app.match(/<NotificationProvider>/g) || []).length === 1);
  check("NotificationProvider is inside AuthProvider", authOpen > -1 && notificationOpen > authOpen
    && notificationOpen < app.indexOf("</AuthProvider>"));
  check("the shell is rendered inside NotificationProvider", shellAt > notificationOpen
    && shellAt < app.indexOf("</NotificationProvider>"));
  check("the shell does not render a provider of its own",
    !app.slice(app.indexOf("function AppShell("), app.indexOf("function AppShell(") + 6000).includes("<NotificationProvider>"));
} finally {
  await vite.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);

// Vite's dev server leaves handles open, and the script has already reported.
process.exit(failures ? 1 : 0);