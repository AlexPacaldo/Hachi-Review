import { Link } from "react-router-dom";

export default function Privacy() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy Policy</h1>
        <p>This privacy policy describes how we handle data for our website and advertising services.</p>
        <p>Hachi stores reviewer data on this device for offline use and, when you sign in, can sync your reviewers to your Supabase account. When you are signed in, quiz progress and completed attempt history are also uploaded to your account so they follow you to your other devices.</p>
        <p>Your account also keeps a study streak. It is stored as a few counters and the dates you studied, holding nothing about the questions themselves. Unlike your answer history, which is deleted after two weeks, these figures are kept so your streak and your longest run stay accurate.</p>

        <h2>Who Can See What</h2>
        <p>Your reviewers, quiz progress, attempt history, and study streak are private to your account. Nobody else can read them, and they are not shared with other users.</p>
        <p>Your display name and avatar are visible to people you already have a connection with: your friends, members of your groups, and anyone you have shared a reviewer with directly. People you have not met are not able to see your profile.</p>
        <p>Hachi does not store your email address in its own user table. It is held by our sign-in provider, Supabase, and is used only to sign you in. Looking somebody up by their email address confirms whether they have an account here and shows their display name; it does not reveal the address itself or anyone else's.</p>
        <p>Data kept in this browser is readable by anything with access to your browser profile or by an extension with permission to read site storage. If you use a shared computer, sign out when you are finished.</p>

        <h2>Advertising & Tracking</h2>
        <p>This site carries advertising. We use Google AdSense and Monetag. These networks may:</p>
        <ul>
          <li>Use cookies and similar technologies to serve and measure ads.</li>
          <li>Collect your IP address, browser type, and the pages you view.</li>
          <li>Build an interest profile from that activity and share it with their partners.</li>
        </ul>
        <p>Neither reads your reviewers, your quiz answers, or your account, and we do not send them anything about your study activity.</p>
        <p>You can opt-out of targeted advertising by visiting <a href="https://optout.aboutads.info/" target="_blank" rel="noreferrer">About Ads Opt-out</a> or <a href="https://www.youronlinechoices.com/" target="_blank" rel="noreferrer">Your Online Choices</a>.</p>

        <h3>Cookies</h3>
        <p>Our website uses cookies to enhance user experience. These cookies may be essential for the site to function, or may be used for analytics and advertising purposes. You can control cookie preferences through your browser settings.</p>

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
