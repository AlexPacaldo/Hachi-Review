import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import Navbar from "./components/Navbar.jsx";
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
import Friends from "./pages/Friends.jsx";
import Groups from "./pages/Groups.jsx";
import GroupDetail from "./pages/GroupDetail.jsx";
import Privacy from "./pages/Privacy.jsx";
import Terms from "./pages/Terms.jsx";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import { NotificationProvider, useNotifications } from "./contexts/NotificationContext.jsx";
import { getThemePreference, saveThemePreference } from "./utils/storageUtils.js";
import { logClientError } from "./utils/errorLogger.js";

function AppShell() {
  const [theme, setTheme] = useState(getThemePreference);
  const [updateReady, setUpdateReady] = useState(false);
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

  useEffect(() => {
    const showUpdateNotice = () => {
      setUpdateReady(true);
      notify({
        type: "info",
        title: "Offline update ready",
        message: "A fresh version of Hachi is ready to load."
      });
    };

    window.addEventListener("reviewhub:update-ready", showUpdateNotice);
    return () => window.removeEventListener("reviewhub:update-ready", showUpdateNotice);
  }, [notify]);

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
      <SocialNotificationWatcher />
      {isLanding ? null : <Navbar theme={theme} onToggleTheme={toggleTheme} />}
      {isLanding ? null : <TopActions />}
      <NotificationToasts />
      {updateReady ? (
        <div className="update-banner" role="status">
          <span className="banner-icon" aria-hidden="true"><RefreshCw size={15} /></span>
          <span>New offline version ready.</span>
          <button className="button subtle" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      ) : null}
      {isLanding ? null : <AdminUsageBanner />}
      {isLanding ? null : <div className="top-pill-spacer" aria-hidden="true" />}
      <main className={isLanding ? "landing-main" : undefined}>
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
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
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
