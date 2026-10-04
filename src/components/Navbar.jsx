import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { History, Home, Hourglass, Library, Menu, Moon, PlayCircle, Sparkles, Sun, Shield, Users, UsersRound, WifiOff } from "lucide-react";
import appLogo from "../assets/Icon.png";
import { REVIEWER_DATA_CHANGED_EVENT, getAllProgress, getAttemptHistory } from "../utils/storageUtils.js";
import { getAllReviewers } from "../data/reviewerRegistry.js";

const MAX_RECENT_ITEMS = 4;

function getRecentReviewerLinks() {
  const items = [];
  const seen = new Set();

  const existingReviewerIds = new Set(getAllReviewers().map((reviewer) => reviewer.reviewerId));

  const progressSessions = Object.values(getAllProgress())
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  for (const session of progressSessions) {
    if (!session?.reviewerId || !existingReviewerIds.has(session.reviewerId) || seen.has(session.reviewerId)) continue;
    seen.add(session.reviewerId);
    items.push({
      key: `progress-${session.reviewerId}`,
      to: `/quiz/${session.reviewerId}`,
      kind: "progress",
      title: session.reviewerTitle || "In-progress quiz",
      meta: session.subject || "Keep studying",
      badge: "In progress"
    });
    if (items.length >= MAX_RECENT_ITEMS) break;
  }

  if (items.length < MAX_RECENT_ITEMS) {
    for (const attempt of getAttemptHistory()) {
      if (!attempt?.reviewerId || !existingReviewerIds.has(attempt.reviewerId) || seen.has(attempt.reviewerId)) continue;
      seen.add(attempt.reviewerId);
      items.push({
        key: `attempt-${attempt.attemptId}`,
        to: `/reviewer/${attempt.reviewerId}`,
        kind: "attempt",
        title: attempt.reviewerTitle || "Completed quiz",
        meta: attempt.subject || "Completed",
        badge: attempt.percentage != null ? `${attempt.percentage}%` : "Done"
      });
      if (items.length >= MAX_RECENT_ITEMS) break;
    }
  }

  return items;
}

export default function Navbar({ theme, onToggleTheme }) {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [isScrolled, setIsScrolled] = useState(() => window.scrollY > 24);
  const [recentItems, setRecentItems] = useState(getRecentReviewerLinks);
  const menuCloseTimer = useRef(null);
  const touchStart = useRef(null);

  useEffect(() => {
    const refreshRecentItems = () => setRecentItems(getRecentReviewerLinks());

    window.addEventListener(REVIEWER_DATA_CHANGED_EVENT, refreshRecentItems);
    window.addEventListener("storage", refreshRecentItems);
    return () => {
      window.removeEventListener(REVIEWER_DATA_CHANGED_EVENT, refreshRecentItems);
      window.removeEventListener("storage", refreshRecentItems);
    };
  }, []);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);

    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);
    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    const closeOnResize = () => {
      // 900px, where the navbar becomes the fixed sidebar. Below that the drawer
      // is the navigation, so the menu has to close when it stops being one.
      if (window.innerWidth > 899) {
        setMenuOpen(false);
        setMenuClosing(false);
      }
    };

    window.addEventListener("resize", closeOnResize);
    return () => window.removeEventListener("resize", closeOnResize);
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (menuCloseTimer.current) window.clearTimeout(menuCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    const updateScrolled = () => setIsScrolled(window.scrollY > 24);

    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  function openMenu() {
    if (menuCloseTimer.current) window.clearTimeout(menuCloseTimer.current);
    setMenuClosing(false);
    setMenuOpen(true);
  }

  function closeMenu() {
    if (!menuOpen || menuClosing) return;
    setMenuClosing(true);
    if (menuCloseTimer.current) window.clearTimeout(menuCloseTimer.current);
    menuCloseTimer.current = window.setTimeout(() => {
      setMenuOpen(false);
      setMenuClosing(false);
    }, 260);
  }

  function handleTouchStart(event) {
    if (!menuOpen) return;
    const touch = event.touches[0];
    touchStart.current = {
      x: touch.clientX,
      y: touch.clientY
    };
  }

  function handleTouchEnd(event) {
    if (!menuOpen || !touchStart.current) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.current.x;
    const deltaY = touch.clientY - touchStart.current.y;
    touchStart.current = null;

    if (deltaX < -48 && Math.abs(deltaY) < 80) {
      closeMenu();
    }
  }

  const drawerVisible = menuOpen || menuClosing;
  const swipeHandlers = {
    onTouchStart: handleTouchStart,
    onTouchEnd: handleTouchEnd
  };

  return (
    <>
      {drawerVisible ? (
        <button
          className={`nav-backdrop ${menuClosing ? "closing" : ""}`}
          type="button"
          aria-label="Close menu"
          onClick={closeMenu}
          {...swipeHandlers}
        />
      ) : null}
      <header
        className={`navbar ${menuOpen ? "menu-open" : ""} ${menuClosing ? "menu-closing" : ""} ${isScrolled ? "scrolled" : ""}`}
        {...swipeHandlers}
      >
        <Link to="/home" className="brand" aria-label="Hachi home" onClick={closeMenu}>
          <span className="brand-icon-wrap">
            <img src={appLogo} alt="Hachi logo" width={28} height={28} />
          </span>
          <span>Hachi</span>
        </Link>

        <nav className="nav-links" aria-label="Main navigation" id="main-navigation">
          <NavLink to="/home" onClick={closeMenu}>
            <Home size={17} aria-hidden="true" />
            Home
          </NavLink>
          <NavLink to="/generator" onClick={closeMenu}>
            <Sparkles size={17} aria-hidden="true" />
            Generator
          </NavLink>
          <NavLink to="/history" onClick={closeMenu}>
            <History size={17} aria-hidden="true" />
            History
          </NavLink>
          <NavLink to="/library" onClick={closeMenu}>
            <Library size={17} aria-hidden="true" />
            Library
          </NavLink>
          <NavLink to="/friends" onClick={closeMenu}>
            <Users size={17} aria-hidden="true" />
            Friends
          </NavLink>
          <NavLink to="/groups" onClick={closeMenu}>
            <UsersRound size={17} aria-hidden="true" />
            Groups
          </NavLink>
        </nav>

        <div className="sidebar-decks" aria-label="Recently studied">
          <div className="sidebar-decks-head">
            <strong>Recently studied</strong>
          </div>
          {recentItems.length ? (
            recentItems.map((item) => (
              <Link className="recent-link" key={item.key} to={item.to} onClick={closeMenu}>
                <span className="recent-icon">
                  {item.kind === "progress" ? <Hourglass size={17} aria-hidden="true" /> : <History size={17} aria-hidden="true" />}
                </span>
                <span className="recent-label">
                  <strong>{item.title}</strong>
                  <small>{item.meta}</small>
                </span>
                <span className="recent-badge">{item.badge}</span>
              </Link>
            ))
          ) : (
            <Link to="/home" onClick={closeMenu}>
              <PlayCircle size={17} aria-hidden="true" />
              Start studying
            </Link>
          )}
          <Link to="/history" onClick={closeMenu}>
            <History size={17} aria-hidden="true" />
            View history
          </Link>
        </div>

        <div className="navbar-controls">
          {!isOnline ? (
            <span className="offline-pill" role="status">
              <WifiOff size={16} aria-hidden="true" />
              Offline
            </span>
          ) : null}

          <button
            className="icon-button menu-toggle"
            type="button"
            onClick={openMenu}
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="main-navigation"
          >
            <Menu size={19} aria-hidden="true" />
          </button>

          <button className="icon-button theme-toggle" type="button" onClick={onToggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>
    </>
  );
}
