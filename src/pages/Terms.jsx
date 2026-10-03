import { Link } from "react-router-dom";

export default function Terms() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">Terms</p>
        <h1>Terms of Service</h1>
        <p>Hachi is a study companion for creating, saving, sharing, and practicing reviewers. Use it responsibly and check important answers against your official study materials.</p>
        <h2>Your Content</h2>
        <p>You are responsible for the files, notes, reviewers, and shared materials you add to the app. Only upload or share content you are allowed to use.</p>
        <h2>AI Output</h2>
        <p>AI-generated questions can contain mistakes. Review generated reviewers before relying on them for exams or graded work.</p>
        <h2>Limits</h2>
        <p>AI generation has file size, question count, and request rate limits to keep the app reliable. Requests may be blocked temporarily if those limits are reached.</p>
        <h2>Availability</h2>
        <p>Offline features depend on browser storage on your device. Cloud features depend on Supabase, Google sign-in, and network availability.</p>
        <h2>Account Data</h2>
        <p>You can remove device data and app cloud data from Account Settings. Shared reviewers or backups you gave to other people may remain with them.</p>
        <p>Last updated: 1 October 2026</p>

        <footer className="legal-footer">
          <Link className="back-link" to="/">Back to Hachi</Link>
          <Link to="/contact">Contact Us</Link>
          <Link to="/privacy">Privacy Policy</Link>
        </footer>
      </section>
    </div>
  );
}
