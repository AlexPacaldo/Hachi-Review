import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import About from "../../src/pages/About.jsx";
import Contact from "../../src/pages/Contact.jsx";
import Privacy from "../../src/pages/Privacy.jsx";
import Terms from "../../src/pages/Terms.jsx";

const PAGES = {
  "/about": About,
  "/contact": Contact,
  "/privacy": Privacy,
  "/terms": Terms
};

export function renderPage(route) {
  const Page = PAGES[route];
  if (!Page) throw new Error(`No page registered for route: ${route}`);
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <Page />
    </MemoryRouter>
  );
}