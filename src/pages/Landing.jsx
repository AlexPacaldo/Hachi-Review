import { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CloudOff,
  FileText,
  ListChecks,
  Menu,
  Moon,
  PawPrint,
  Sparkles,
  Sun,
  Target,
  TrendingUp,
  UsersRound,
  X
} from "lucide-react";
import appLogo from "../assets/Icon.png";
import hachiDogExcited from "../assets/hachi-dog-excited.png";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useOnlineCount } from "../hooks/useOnlineCount.js";
import useScrollReveal from "../hooks/useScrollReveal.js";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#preview", label: "Preview" },
  { href: "#faq", label: "FAQ" }
];

const HERO_PROOF = ["Free to use", "Works offline", "Syncs across devices"];

const FEATURES = [
  {
    icon: Sparkles,
    title: "Generate a reviewer with AI",
    text: "Paste your notes, drop in a PDF, or snap a photo of the page you are revising from. Hachi turns any of it into a complete reviewer with questions, answers, and explanations.",
    tone: "wide"
  },
  {
    icon: BookOpen,
    title: "Organize every reviewer",
    text: "One searchable library for quiz sets, notes, and explanations instead of scattered files and camera rolls."
  },
  {
    icon: FileText,
    title: "Import from anywhere",
    text: "PDFs, photos, or typed notes all go in the same way, and Hachi cleans up the formatting for you."
  },
  {
    icon: CloudOff,
    title: "Study fully offline",
    text: "Reviewers, progress, and history stay on your device, so Hachi keeps working when the network does not."
  },
  {
    icon: TrendingUp,
    title: "Watch real progress",
    text: "Scores, streaks, and a full mistake history turn every practice session into something you can actually measure."
  },
  {
    icon: UsersRound,
    title: "Study together",
    text: "Sign in to sync across devices and share reviewers with friends and groups."
  }
];

const STEPS = [
  {
    icon: ListChecks,
    title: "Drop in your material",
    text: "Notes, a PDF, or a photo of the page you are revising from."
  },
  {
    icon: Sparkles,
    title: "Let AI build the reviewer",
    text: "Questions, answers, and explanations, generated in one pass."
  },
  {
    icon: Target,
    title: "Quiz and close the gaps",
    text: "Practice, review what you missed, and watch the scores climb."
  }
];

const FAQS = [
  {
    question: "Do I need an account to start?",
    answer:
      "No. You can create reviewers and take quizzes before signing in. An account just adds cloud sync, sharing, and access across every device you own."
  },
  {
    question: "What can I turn into a reviewer?",
    answer:
      "Typed notes, an uploaded PDF, or a photo of your notes. Hachi reads the material first, then generates questions, answers, and explanations from it."
  },
  {
    question: "Does it work without internet?",
    answer:
      "Yes. Reviewers, progress, and history are stored on your device, so quizzes keep working offline. Cloud sync picks up again as soon as you reconnect."
  },
  {
    question: "Can I share reviewers with classmates?",
    answer:
      "Yes. Sign in to sync across devices, add friends, and share a reviewer or join a group study space with the people you revise with."
  },
  {
    question: "Is Hachi free?",
    answer:
      "Hachi is free to use, including the local library, AI generation, and quizzes."
  }
];

const PREVIEW_OPTIONS = [
  { label: "Right atrium", correct: false },
  { label: "Left ventricle", correct: true },
  { label: "Right ventricle", correct: false },
  { label: "Left atrium", correct: false }
];

function PrimaryLink({ user, className = "button primary", children }) {
  return (
    <Link className={className} to={user ? "/home" : "/account"}>
      {children}
    </Link>
  );
}

export default function Landing({ theme, onToggleTheme }) {
  const { user, loading } = useAuth();
  const pageRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);
  const onlineCount = useOnlineCount();

  useScrollReveal(pageRef);

  useEffect(() => {
    const updateScrolled = () => setNavScrolled(window.scrollY > 12);

    updateScrolled();
    window.addEventListener("scroll", updateScrolled, { passive: true });
    return () => window.removeEventListener("scroll", updateScrolled);
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  // The landing page is for signed-out visitors only, so an existing session skips
  // straight to the dashboard instead of rendering marketing copy first.
  if (!loading && user) {
    return <Navigate to="/home" replace />;
  }

  return (
    <div className="landing-page" ref={pageRef}>
      <header className={`landing-nav ${navScrolled ? "is-scrolled" : ""} ${menuOpen ? "is-open" : ""}`}>
        <div className="landing-nav-inner">
          <Link to="/" className="landing-brand" aria-label="Hachi home">
            <span className="landing-brand-mark">
              <img src={appLogo} alt="" width={26} height={26} />
            </span>
            <span className="landing-brand-name">Hachi</span>
          </Link>

          <nav className="landing-nav-links" aria-label="Landing sections">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>

          <div className="landing-nav-actions">
            <button
              className="icon-button landing-theme-toggle"
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            >
              {theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
            </button>
            {user ? null : (
              <Link className="landing-nav-signin" to="/account">
                Sign in
              </Link>
            )}
            <PrimaryLink user={user} className="button primary landing-nav-cta">
              {user ? "Open Hachi" : "Start studying"}
            </PrimaryLink>
            <div className="landing-online" aria-live="polite">
              {onlineCount ? (
                <>
                  <span className="landing-online-dot" aria-hidden="true" />
                  {onlineCount}+ online now
                </>
              ) : null}
            </div>
            <button
              className="icon-button landing-nav-burger"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
            </button>
          </div>
        </div>

        <div className="landing-nav-sheet">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          ))}
          {user ? null : (
            <Link to="/account" onClick={() => setMenuOpen(false)}>
              Sign in
            </Link>
          )}
        </div>
      </header>

      <section className="landing-hero">
        <div className="hero-paws" aria-hidden="true">
          <PawPrint className="hero-paw paw-a" size={26} />
          <PawPrint className="hero-paw paw-b" size={18} />
          <PawPrint className="hero-paw paw-c" size={22} />
          <PawPrint className="hero-paw paw-d" size={14} />
          <PawPrint className="hero-paw paw-e" size={20} />
          <PawPrint className="hero-paw paw-f" size={15} />
          <PawPrint className="hero-paw paw-g" size={24} />
          <PawPrint className="hero-paw paw-h" size={16} />
          <PawPrint className="hero-paw paw-i" size={19} />
          <PawPrint className="hero-paw paw-j" size={13} />
          <PawPrint className="hero-paw paw-k" size={17} />
          <PawPrint className="hero-paw paw-l" size={21} />
          <PawPrint className="hero-paw paw-m" size={12} />
          <PawPrint className="hero-paw paw-n" size={16} />
          <PawPrint className="hero-paw paw-o" size={18} />
          <PawPrint className="hero-paw paw-p" size={15} />
        </div>

        <div className="landing-hero-inner">
          <div className="landing-hero-copy">
            <p className="landing-badge" data-reveal>
              <Sparkles size={14} aria-hidden="true" />
              Your study companion
            </p>

            <h1 className="landing-title" data-reveal style={{ "--reveal-delay": "80ms" }}>
              Hachi turns your notes into a <span className="landing-title-accent">study machine.</span>
            </h1>

            <p className="landing-lede" data-reveal style={{ "--reveal-delay": "160ms" }}>
              Hachi is a study companion for organizing notes and reviewers, practicing with quizzes, and
              tracking progress, online or offline.
            </p>

            <div className="landing-actions" data-reveal style={{ "--reveal-delay": "240ms" }}>
              <PrimaryLink user={user}>
                {user ? "Open Hachi" : "Start studying"}
                <ArrowRight size={18} aria-hidden="true" />
              </PrimaryLink>
              {user ? null : (
                <Link className="button subtle" to="/account">
                  Log In with Google
                </Link>
              )}
            </div>

            <ul className="landing-proof" data-reveal style={{ "--reveal-delay": "320ms" }}>
              {HERO_PROOF.map((item) => (
                <li key={item}>
                  <Check size={15} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="landing-art" aria-hidden="true">
            <img src={hachiDogExcited} alt="" />
            <span className="hero-note">You can do it!</span>
          </div>
        </div>
      </section>

      <div className="landing-body">
        <p className="landing-promise" data-reveal>
          Bring notes from any class. Leave with quizzes, clear explanations, and a study
          plan you can actually keep up with.
        </p>

        <section className="landing-section" id="features" aria-labelledby="landing-features-heading">
          <div className="landing-section-head" data-reveal>
            <p className="eyebrow">Features</p>
            <h2 id="landing-features-heading">Everything you need to revise</h2>
            <p>Hachi is free to use, and you can start studying before creating an account.</p>
          </div>

          <ul className="landing-features">
            {FEATURES.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <li
                  className={`landing-feature ${feature.tone === "wide" ? "landing-feature-wide" : ""}`}
                  key={feature.title}
                  data-reveal
                  style={{ "--reveal-delay": `${(index % 3) * 90}ms` }}
                >
                  <span className="landing-feature-icon" aria-hidden="true">
                    <Icon size={22} />
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                  {feature.tone === "wide" ? (
                    <div className="landing-feature-demo" aria-hidden="true">
                      <span className="landing-demo-line landing-demo-line-long" />
                      <span className="landing-demo-line" />
                      <span className="landing-demo-line landing-demo-line-short" />
                      <div className="landing-demo-card">
                        <Sparkles size={15} />
                        <span>Question 1 of 10 generated</span>
                        <span className="landing-demo-check">
                          <Check size={13} />
                        </span>
                      </div>
                      <div className="landing-demo-card">
                        <span>Answer + explanation ready</span>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="landing-section" id="how-it-works" aria-labelledby="landing-steps-heading">
          <div className="landing-section-head" data-reveal>
            <p className="eyebrow">How it works</p>
            <h2 id="landing-steps-heading">Three steps, then you are revising</h2>
            <p>No setup marathon. Bring the material you already have and Hachi does the rest.</p>
          </div>

          <div className="landing-steps-wrap">
            <ol className="landing-steps">
              {STEPS.map((step, index) => {
                const Icon = step.icon;
                return (
                  <li className="landing-step" key={step.title} data-reveal style={{ "--reveal-delay": `${index * 120}ms` }}>
                    <span className="landing-step-icon" aria-hidden="true">
                      <Icon size={22} />
                    </span>
                    <span className="landing-step-index">{String(index + 1).padStart(2, "0")}</span>
                    <h3>{step.title}</h3>
                    <p>{step.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="landing-preview" id="preview" aria-labelledby="landing-preview-heading">
          <div className="landing-preview-copy" data-reveal>
            <p className="eyebrow">Practice mode</p>
            <h2 id="landing-preview-heading">Quizzes that tell you what to fix</h2>
            <p>
              Hachi marks every answer, explains the ones you got wrong, and keeps a history you can actually
              use before the next exam.
            </p>
            <ul className="landing-preview-points">
              <li>
                <Check size={16} aria-hidden="true" />
                Instant right or wrong feedback
              </li>
              <li>
                <Check size={16} aria-hidden="true" />
                Explanations for every missed answer
              </li>
              <li>
                <Check size={16} aria-hidden="true" />
                Streaks and scores that stay on your device
              </li>
            </ul>
          </div>

          <div className="landing-preview-stage" data-reveal style={{ "--reveal-delay": "120ms" }}>
            <div className="landing-preview-card">
              <div className="landing-preview-meta">
                <span className="landing-preview-course">BIO 201 · Human Anatomy</span>
                <span className="landing-preview-count">Question 4 of 12</span>
              </div>
              <div className="landing-preview-bar">
                <span />
              </div>
              <p className="landing-preview-question">
                Which chamber of the heart pumps oxygenated blood into the systemic circulation?
              </p>
              <ul className="landing-preview-options">
                {PREVIEW_OPTIONS.map((option) => (
                  <li className={option.correct ? "is-correct" : ""} key={option.label}>
                    <span className="landing-preview-key">{option.label.slice(0, 1)}</span>
                    {option.label}
                    {option.correct ? <Check size={16} aria-hidden="true" /> : null}
                  </li>
                ))}
              </ul>
              <div className="landing-preview-foot">
                <span className="landing-preview-verdict">Correct. The left ventricle drives systemic circulation.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="faq" aria-labelledby="landing-faq-heading">
          <div className="landing-section-head" data-reveal>
            <p className="eyebrow">FAQ</p>
            <h2 id="landing-faq-heading">Good questions</h2>
            <p>Still curious? The answers below cover the things people ask first.</p>
          </div>

          <div className="landing-faq">
            {FAQS.map((item, index) => (
              <details className="landing-faq-item" key={item.question} data-reveal style={{ "--reveal-delay": `${index * 70}ms` }}>
                <summary>
                  <span>{item.question}</span>
                  <ChevronDown size={19} aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-cta" data-reveal>
          <h2>Ready when you are</h2>
          <p>Build a reviewer, take a quiz, and see your progress the moment you open Hachi.</p>
          <div className="landing-actions">
            <PrimaryLink user={user}>
              {user ? "Open Hachi" : "Start studying"}
              <ArrowRight size={18} aria-hidden="true" />
            </PrimaryLink>
            {user ? null : (
              <Link className="button subtle" to="/account">
                Log In with Google
              </Link>
            )}
          </div>
        </section>

        <footer className="landing-footer">
          <div className="landing-footer-brand">
            <Link className="landing-brand" to="/">
              <span className="landing-brand-mark">
                <img src={appLogo} alt="" width={24} height={24} />
              </span>
              <span className="landing-brand-name">Hachi</span>
            </Link>
            <p>
              Hachi is a study companion for organizing notes and reviewers, practicing with quizzes, and
              tracking progress, online or offline.
            </p>
          </div>

          <nav className="landing-footer-links" aria-label="Legal">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/account">Account</Link>
          </nav>

          <span className="landing-footer-copy">&copy; {new Date().getFullYear()} Hachi</span>
        </footer>
      </div>
    </div>
  );
}