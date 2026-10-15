import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import App from "../../src/App.jsx";
import About from "../../src/pages/About.jsx";
import Contact from "../../src/pages/Contact.jsx";
import Privacy from "../../src/pages/Privacy.jsx";
import Terms from "../../src/pages/Terms.jsx";
import Features from "../../src/pages/Features.jsx";
import Faq from "../../src/pages/Faq.jsx";
import Guides from "../../src/pages/Guides.jsx";
import Guide from "../../src/pages/Guide.jsx";

const PAGES = {
  "/about": About,
  "/contact": Contact,
  "/privacy": Privacy,
  "/terms": Terms,
  "/features": Features,
  "/faq": Faq,
  "/guides": Guides
};

/**
 * The root is the app rather than a bare page component, because that is the
 * markup a real visitor gets. Rendering it here is what stops the site being,
 * to anything that does not run JavaScript, an empty div with a paragraph in a
 * noscript block on it.
 *
 * The guide slug is a route parameter, so it is registered as a route rather than
 * looked up in PAGES. Anything in PUBLIC_ROUTES that matches neither is an error
 * rather than a silently skipped page: a route that is added to the metadata but
 * not rendered here produces an empty HTML file and looks fine until a crawler
 * reads it.
 */
export function renderPage(route) {
  if (route === "/") {
    // AppShell reads the location to decide whether it is on the landing layout,
    // so the root has to be rendered inside a router. MemoryRouter rather than
    // BrowserRouter because there is no window.history to read at build time.
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    );
  }

  const guideSlug = route.startsWith("/guides/") ? route.slice("/guides/".length) : null;

  if (guideSlug) {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/guides/:slug" element={<Guide />} />
        </Routes>
      </MemoryRouter>
    );
  }

  const Page = PAGES[route];
  if (!Page) throw new Error(`No page registered for route: ${route}`);
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <Page />
    </MemoryRouter>
  );
}