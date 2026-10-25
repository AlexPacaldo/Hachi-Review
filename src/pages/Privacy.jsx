import PublicFooter from "../components/PublicFooter.jsx";

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
        <p>This site carries advertising, and this is how it is kept separate from your study data.</p>
        <p>We use Monetag to serve ads. Its script has to run on this page to load an ad. We limit that as far as we can, but not completely:</p>
        <ul>
          <li>A Content Security Policy lists every script host we permit. Anything not on that list is refused by your browser before it runs, so an advert cannot quietly load additional code of its own.</li>
          <li>Hachi does not intentionally send your reviewers, answers, history, or streak to ad networks. Ad scripts run in the page, however, and can access browser data available to page scripts.</li>
          <li>Signing in keeps a session token in your browser's storage, which any script on the page is able to read. That is how the app stays signed in without asking you every visit. If you are on a shared or untrusted computer, sign out when you are finished.</li>
        </ul>
        <p>These networks may still:</p>
        <ul>
          <li>Use cookies and similar technologies to serve and measure ads.</li>
          <li>Collect your IP address, browser type, and the pages you view.</li>
          <li>Build an interest profile from that activity and share it with their partners.</li>
        </ul>
        <p>You can opt-out of targeted advertising by visiting <a href="https://optout.aboutads.info/" target="_blank" rel="noreferrer">About Ads Opt-out</a> or <a href="https://www.youronlinechoices.com/" target="_blank" rel="noreferrer">Your Online Choices</a>.</p>

        <h3>Site analytics</h3>
        <p>To know how many people visit and which pages they use, this site counts page views itself. Each view is recorded in this site's own database as one page name and one random value generated for that browser tab.</p>
        <ul>
          <li>It is cookie-free. Nothing is set in your browser that survives the tab, and the random value is generated fresh and discarded when the tab closes.</li>
          <li>It does not record your IP address, your browser, where you came from, your account, or anything in a page address. A reviewer, a group and a guide are each counted only as their own page.</li>
          <li>It never sees your reviewers, answers, history, streak, display name, or email address, and a page view cannot be traced back to your account because no account is attached to it.</li>
          <li>The figures are shown to the person who runs this site as counts only, such as views today and which pages are opened most. They are not shared with anyone.</li>
        </ul>
        <p>Nothing is sent to an outside analytics company. These counts stay in this site's database, and pages older than six months are deleted automatically.</p>

        <h3>Cookies</h3>
        <p>Our website uses cookies to enhance user experience. These cookies may be essential for the site to function, or may be used for analytics and advertising purposes. You can control cookie preferences through your browser settings.</p>

        <h2>Changes to This Privacy Policy</h2>
        <p>We may update our Privacy Policy from time to time. We will post any changes on this page. You are advised to review this Privacy Policy periodically.</p>
        
        <p>Last updated: 25 October 2026</p>
        
        <h2>Contact</h2>
        <p>For privacy or account questions, use the contact address published on the Contact Us page. It reaches the app owner directly.</p>

        <PublicFooter />
      </section>
    </div>
  );
}
