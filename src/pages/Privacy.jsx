import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy Policy</h1>
        <p>This privacy policy describes how we handle data for our website and advertising services.</p>
        <p>Hachi stores reviewer data on this device for offline use and, when you sign in, can sync your reviewers to your Supabase account.</p>
        
        <h2>Advertising & Tracking</h2>
        <p>We work with third-party advertising networks (such as Monetag and PropellerAds) to display ads on our website. These networks may:</p>
        <ul>
          <li>Collect anonymous information about your visit (including IP address, browser type, and pages viewed).</li>
          <li>Use cookies and similar technologies to deliver targeted advertising.</li>
          <li>Report aggregated metrics to us about ad performance.</li>
        </ul>
        <p>You can opt-out of targeted advertising by visiting <a href="https://optout.aboutads.info/" target="_blank" rel="noreferrer">About Ads Opt-out</a> or <a href="https://www.youronlinechoices.com/" target="_blank" rel="noreferrer">Your Online Choices</a>.</p>
        
        <h3>Cookies</h3>
        <p>Our website uses cookies to enhance user experience. These cookies may be essential for the site to function, or may be used for analytics and advertising purposes. You can control cookie preferences through your browser settings.</p>
        
        <h2>Google Analytics</h2>
        <p>We use Google Analytics to understand how visitors interact with our website. Google Analytics collects anonymous information such as IP address, browser type, and page visits. You can opt-out of Google Analytics <a href="https://tools.google.com/dl/gaoptout" target="_blank" rel="noreferrer">here</a>.</p>
        
        <h2>Changes to This Privacy Policy</h2>
        <p>We may update our Privacy Policy from time to time. We will post any changes on this page. You are advised to review this Privacy Policy periodically.</p>
        
        <p>Last updated: 1 October 2026</p>
        
        <h2>Contact</h2>
        <p>For privacy or account questions, contact the app owner through the support email shown on the Google OAuth consent screen.</p>

        <footer className="legal-footer">
          <Link className="back-link" to="/">Back to Hachi</Link>
          <Link to="/terms">Terms of Service</Link>
        </footer>
      </section>
    </div>
  );
}
