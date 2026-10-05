import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import Navbar from "./components/Navbar.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";
import AdminUsageBanner from "./components/AdminUsageBanner.jsx";
import { NotificationToasts } from "./components/NotificationCenter.jsx";
import SocialNotificationWatcher from "./components/SocialNotificationWatcher.jsx";
import TopActions from "./components/TopActions.jsx";
import Landing from "./pages/Landing.jsx";
import Home from "./pages/Home.jsx";
import ReviewerSetup from "./pages/ReviewerSetup.jsx";
import Quiz from "./pages/Quiz.jsx";
import Results from "./pages/Results.jsx";
import ReviewAnswers from "./pages/ReviewAnswers.jsx";
import History from "./pages/History.jsx";
import Library from "./pages/Library.jsx";
import Generator from "./pages/Generator.jsx";
import Account from "./pages/Account.jsx";
import AdminStats from "./pages/AdminStats.jsx";
import Friends from "./pages/Friends.jsx";
import Groups from "./pages/Groups.jsx";
import GroupDetail from "./pages/GroupDetail.jsx";
import About from "./pages/About.jsx";
import Contact from "./pages/Contact.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { NotificationProvider, useNotifications } from "./contexts/NotificationContext.jsx";
import { getThemePreference, saveThemePreference } from "./utils/storageUtils.js";
import { subscribeBusyWork } from "./utils/busyWork.js";
import { applyDocumentMeta, resolveDocumentMeta } from "./utils/documentMeta.js";
import { logClientError } from "./utils/errorLogger.js";

// Long enough for a burst of update events to settle into one reload, short
// enough that an idle tab still picks the new version up without the user
// noticing it went stale.
const RELOAD_DELAY_MS = 1200;

function ScrollToTop() {
  const { pathname } = useLocation();

  // A client-side navigation never reloads the document, so the browser keeps
  // whatever scroll offset it had and a new route can open halfway down. Hash
  // links on the landing page are plain <a href="#...">, which do not change the
  // pathname, so in-page anchors are left alone.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function AppShell() {
  const [theme, setTheme] = useState(getThemePreference);
  const [updateReady, setUpdateReady] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const { notify } = useNotifications();
  const location = useLocation();
  // The public marketing page owns its full-height layout, so the app sidebar,
  // the floating account pill, and their reserved gutter are skipped there.
  const isLanding = location.pathname === "/";

  const toggleTheme = () => setTheme((current) => (current === "dark" ? "light" : "dark"));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveThemePreference(theme);
  }, [theme]);

  // The prerendered public pages already carry their own title in the served HTML,
  // but the router never reloads the document, so without this the title would stay
  // on whichever page was loaded first for the rest of the session.
  useEffect(() => {
    applyDocumentMeta(resolveDocumentMeta(location.pathname));
  }, [location.pathname]);

  useEffect(() => subscribeBusyWork(setIsBusy), []);

  // A new version normally takes over on its own: the service worker skips
  // waiting, so once the update lands the page reloads itself a moment later.
  // Work that only exists in memory, a running quiz or a generation in flight,
  // outlives that courtesy, so the reload is held and the banner is offered
  // instead. Letting the notice go as soon as the page goes idle is what keeps
  // it from outliving the reason for it.
  useEffect(() => {
    const showUpdateNotice = () => setUpdateReady(true);

    window.addEventListener("reviewhub:update-ready", showUpdateNotice);
    return () => window.removeEventListener("reviewhub:update-ready", showUpdateNotice);
  }, []);

  useEffect(() => {
    if (!updateReady || isBusy) return undefined;

    const id = window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [updateReady, isBusy]);

  useEffect(() => {
    const showOnlineNotice = () => {
      notify({
        type: "success",
        title: "Back online",
        message: "Cloud sync and Gemini generation are available again."
      });
    };
    const showOfflineNotice = () => {
      notify({
        type: "warning",
        title: "You are offline",
        message: "Hachi will keep local features available on this device."
      });
    };

    window.addEventListener("online", showOnlineNotice);
    window.addEventListener("offline", showOfflineNotice);
    return () => {
      window.removeEventListener("online", showOnlineNotice);
      window.removeEventListener("offline", showOfflineNotice);
    };
  }, [notify]);

  useEffect(() => {
    const handleError = (event) => {
      logClientError("window-error", event.error || event.message, {
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      });
    };
    const handleUnhandledRejection = (event) => {
      logClientError("unhandled-rejection", event.reason);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return (
    <AuthProvider>
      <ScrollToTop />
      <SocialNotificationWatcher />
      {isLanding ? null : <Navbar theme={theme} onToggleTheme={toggleTheme} />}
      {isLanding ? null : <TopActions />}
      <NotificationToasts />
      {updateReady && isBusy ? (
        <div className="update-banner" role="status">
          <span className="banner-icon" aria-hidden="true"><RefreshCw size={15} /></span>
          <span>Hachi updates when this is done.</span>
          <button className="button subtle" type="button" onClick={() => window.location.reload()}>
            Reload now
          </button>
        </div>
      ) : null}
      {isLanding ? null : <AdminUsageBanner />}
      {isLanding ? null : <div className="top-pill-spacer" aria-hidden="true" />}
      <main className={isLanding ? "landing-main" : undefined}>
        <ErrorBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<Landing theme={theme} onToggleTheme={toggleTheme} />} />
            <Route path="/home" element={<Home />} />
            <Route path="/reviewer/:reviewerId" element={<ReviewerSetup />} />
            <Route path="/quiz/:reviewerId" element={<Quiz />} />
            <Route path="/results/:reviewerId" element={<Results />} />
            <Route path="/review/:reviewerId" element={<ReviewAnswers />} />
            <Route path="/history" element={<History />} />
            <Route path="/library" element={<Library />} />
            <Route path="/friends" element={<Friends />} />
            <Route path="/groups" element={<Groups />} />
            <Route path="/groups/:groupId" element={<GroupDetail />} />
            <Route path="/generator" element={<Generator />} />
            <Route path="/account" element={<Account />} />
            <Route path="/admin/stats" element={<AdminStats />} />
            <Route path="/about" element={<About />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <NotificationProvider>
      <AppShell />
    </NotificationProvider>
  );
}
