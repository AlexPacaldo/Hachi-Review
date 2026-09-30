import { Link } from "react-router-dom";
import { BookOpen, CloudOff, Sparkles, UsersRound } from "lucide-react";
import hachiDogExcited from "../assets/hachi-dog-excited.png";
import { useAuth } from "../contexts/AuthContext.jsx";

const FEATURES = [
  {
    icon: BookOpen,
    title: "Organize your reviewers",
    text: "Keep every quiz set, note, and explanation in one searchable library instead of scattered files and photos."
  },
  {
    icon: Sparkles,
    title: "Generate with AI",
    text: "Turn notes, a PDF, or a photo into a complete reviewer with questions, answers, and explanations."
  },
  {
    icon: CloudOff,
    title: "Study offline",
    text: "Reviewers, progress, and history stay on your device, so Hachi keeps working when the network does not."
  },
  {
    icon: UsersRound,
    title: "Study together",
    text: "Sign in to sync across devices and share reviewers with friends and groups."
  }
];

export default function Landing() {
  const { user } = useAuth();

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <p className="eyebrow">Study companion</p>
          <h1>Hachi</h1>
          <p className="landing-tagline">Your study companion.</p>
          <p className="landing-lede">
            Hachi is a study companion for organizing notes and reviewers, practicing with quizzes, and tracking
            progress, online or offline.
          </p>
          <div className="landing-actions">
            <Link className="button primary" to={user ? "/home" : "/account"}>
              {user ? "Open Hachi" : "Get Started"}
            </Link>
            {user ? null : (
              <Link className="button subtle" to="/account">
                Log In with Google
              </Link>
            )}
          </div>
        </div>

        <div className="landing-art" aria-hidden="true">
          <span className="hero-note">You can do it!</span>
          <img src={hachiDogExcited} alt="" />
        </div>
      </section>

      <section className="landing-section" aria-labelledby="landing-features-heading">
        <div className="landing-section-head">
          <h2 id="landing-features-heading">Everything you need to revise</h2>
          <p>Hachi is free to use, and you can start studying before creating an account.</p>
        </div>
        <ul className="landing-features">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <li className="landing-feature" key={feature.title}>
                <span className="landing-feature-icon" aria-hidden="true">
                  <Icon size={22} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="landing-cta">
        <h2>Ready when you are</h2>
        <p>Build a reviewer, take a quiz, and see your progress the moment you open Hachi.</p>
        <div className="landing-actions">
          <Link className="button primary" to={user ? "/home" : "/account"}>
            {user ? "Open Hachi" : "Get Started"}
          </Link>
          {user ? null : (
            <Link className="button subtle" to="/account">
              Log In with Google
            </Link>
          )}
        </div>
      </section>

      <footer className="landing-footer">
        <span className="landing-footer-brand">Hachi</span>
        <nav className="landing-footer-links" aria-label="Legal">
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </nav>
        <span className="landing-footer-copy">&copy; {new Date().getFullYear()} Hachi</span>
      </footer>
    </div>
  );
}
