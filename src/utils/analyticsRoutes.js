// Which route a page view is recorded against.
//
// The stored value is a route name from a fixed list, never the URL. Every route
// in this app that takes a parameter takes an identifier: a reviewer id, a group
// id, a guide slug, an invite code. Sending `location.pathname` would write
// those into a table the owner can read, which is a per-account record built by
// accident and the reason the invite code matters most, since it is the one that
// is a capability rather than an address.
//
// So a pathname is matched against an allowlist here and anything that does not
// match is dropped rather than normalised. A new route is not recorded at all
// until somebody has decided it should be and added it to both this list and
// record_page_view in supabase-migration-2026-10-page-views.sql, which is the
// point: forgetting is the safe direction to fail in.
//
// This module deliberately imports nothing, so the check script can read the
// list and the matching rules without standing up a Supabase client.

const STATIC_ROUTES = [
  "/",
  "/home",
  "/history",
  "/library",
  "/friends",
  "/groups",
  "/groups/join",
  "/generator",
  "/account",
  "/admin/stats",
  "/about",
  "/contact",
  "/privacy",
  "/terms",
  "/features",
  "/faq",
  "/guides"
];

// Ordered, because more than one can match: /groups/join/abc is both a
// /groups/join and a /group, and which one it is changes what the route chart
// means. The head is written the way a pathname splits, without the leading
// slash, which is what the comparison below is against. The parameterised routes
// collapse to a name that reads like a page rather than like a URL, so a row read
// in the statistics page does not carry a wildcard the reader has to interpret.
const NESTED_ROUTES = [
  { head: ["groups", "join"], label: "/groups/join" },
  { head: ["groups"], label: "/group" },
  { head: ["guides"], label: "/guide" },
  { head: ["reviewer"], label: "/reviewer" },
  { head: ["quiz"], label: "/quiz" },
  { head: ["results"], label: "/results" },
  { head: ["review"], label: "/review" }
];

// What the database accepts. Kept in step with the array inside
// record_page_view, which enforces the same list server side, and with
// ANALYTICS_PATHS below so the statistics page can render a name for a route the
// database chose.
export const ANALYTICS_PATHS = [
  ...STATIC_ROUTES,
  ...NESTED_ROUTES.map((route) => route.label)
].filter((path, index, all) => all.indexOf(path) === index);

const STATIC_SET = new Set(STATIC_ROUTES);

// The page name behind a stored route, for the statistics page. Reads as a
// sentence rather than as a path, because the reader of that page is the owner
// looking at what people use and not a debugger.
const ROUTE_NAMES = {
  "/": "Home",
  "/home": "Dashboard",
  "/history": "History",
  "/library": "Library",
  "/friends": "Friends",
  "/groups": "Groups",
  "/group": "A group",
  "/groups/join": "A group invite",
  "/generator": "Generator",
  "/reviewer": "Reviewer setup",
  "/quiz": "A quiz",
  "/results": "Results",
  "/review": "Review answers",
  "/account": "Account",
  "/admin/stats": "Statistics",
  "/about": "About",
  "/contact": "Contact",
  "/privacy": "Privacy",
  "/terms": "Terms",
  "/features": "Features",
  "/faq": "FAQ",
  "/guides": "Guides",
  "/guide": "A guide"
};

export function routeName(path) {
  return ROUTE_NAMES[path] || path;
}

// null means "do not record this", and the caller sends nothing.
//
// Only a pathname is recognised. Anything carrying a query string or a fragment
// is not a pathname, and a value that was not expected to arrive is dropped
// rather than cleaned up: stripping a query off an unexpected value would mean
// deciding which half of it to trust.
export function analyticsPath(pathname) {
  if (typeof pathname !== "string" || pathname.charAt(0) !== "/") return null;

  // A trailing slash is the same page. React Router treats /library and
  // /library/ as the same route, so counting them as two would be an artefact of
  // how a link was written.
  const trimmed = pathname.replace(/\/+$/, "") || "/";

  if (STATIC_SET.has(trimmed)) return trimmed;

  const segments = trimmed.split("/").filter(Boolean);

  for (const route of NESTED_ROUTES) {
    // Longer than the head, so the head itself is not the match. /groups alone
    // is the groups index and is in STATIC_ROUTES under its real name.
    if (segments.length <= route.head.length) continue;
    if (route.head.every((part, index) => segments[index] === part)) return route.label;
  }

  return null;
}