import { Link } from "react-router-dom";

export default function About() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">About</p>
        <h1>About Hachi</h1>
        <p>
          Hachi is a study companion that runs at hachi-review.site. It is built for students who have a lot of
          material to get through and not enough time to sit with it: Hachi keeps your notes and reviewers in one
          place, turns them into quizzes you can actually practice with, and shows you what you have covered and
          what you keep getting wrong.
        </p>
        <p>
          The site and the app work online and offline. Reviewers, progress, and attempt history stay on your
          device by default, and sync to your own account only when you sign in.
        </p>

        <h2>Who Runs Hachi</h2>
        <p>
          Hachi is an independent personal project, run and maintained by one individual developer. It is not
          operated by a company, a school, or a university, and it is not affiliated with any exam board or
          publisher. It is funded entirely by the advertising shown on the site, so there is no subscription and
          nothing is behind a paywall.
        </p>
        <p>
          Because it is a one-person project, replies to email may take a little while, and new features arrive when
          there is time rather than on a schedule. Bugs and feature requests are genuinely welcome and are the
          fastest things to act on.
        </p>

        <h2>What Hachi Does</h2>
        <ul>
          <li>Stores notes and reviewers so your study material stays in one place.</li>
          <li>Builds practice quizzes from that material, either by hand or generated from a file you upload.</li>
          <li>Records your attempts so you can see weak areas and track progress over time.</li>
          <li>Works offline, so you can keep studying when the connection is unreliable.</li>
        </ul>
        <p>
          Hachi is a study aid. It does not replace official course notes, past papers, or a lecturer, and nothing
          in it should be treated as an authoritative answer to an exam question.
        </p>

        <h2>How Hachi Is Funded</h2>
        <p>
          Hachi is supported by advertising, served through Google AdSense and a small number of other ad networks.
          Advertising is what pays for the hosting and the running costs of the site.
        </p>
        <p>
          Advertising is kept separate from your study data. Your reviewers, answers, attempt history, and study
          streak are held in your browser and behind your own account, and none of it can be read through the ad
          networks. Hachi does not sell personal data, does not broker contact lists, and does not accept payment
          in exchange for placing ads. The full detail is in the Privacy Policy.
        </p>

        <h2>How Reviews And Content Are Checked</h2>
        <p>
          Hachi does not publish articles, so there is no editorial desk. What appears in a review is material
          somebody chose to upload, which means quality varies. A few things are worth knowing:
        </p>
        <ul>
          <li>AI-generated questions can be wrong. Treat generated reviewers as a draft to check, not as a source.</li>
          <li>Questions shared by other users have not been verified by Hachi. Check them against your own materials.</li>
          <li>If an answer looks wrong, it is probably worth checking, and worth reporting.</li>
        </ul>

        <h2>Data And Ownership</h2>
        <p>
          You own the material you add to Hachi. You can remove device data and cloud data from Account Settings.
          Sharing a reviewer with someone else hands a copy to them, so a backup you have given away may remain
          with them after you delete it.
        </p>

        <h2>Getting In Touch</h2>
        <p>
          Questions about Hachi, a bug report, a takedown request, or an advertising enquiry can all go to the
          contact address on the Contact Us page, which reaches the person who runs the site directly.
        </p>
        <p>Last updated: 3 October 2026</p>

        <footer className="legal-footer">
          <Link className="back-link" to="/">Back to Hachi</Link>
          <Link to="/contact">Contact Us</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </footer>
      </section>
    </div>
  );
}