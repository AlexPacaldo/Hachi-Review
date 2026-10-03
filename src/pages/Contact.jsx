import { Link } from "react-router-dom";
import { Mail, Flag, ShieldCheck, Megaphone } from "lucide-react";

const CONTACT_EMAIL = "alexpacaldo1105@gmail.com";

const CONTACT_METHODS = [
  {
    icon: Mail,
    title: "General questions and support",
    body: "Anything about Hachi itself: how a feature works, what something means, or a report of something that is not working."
  },
  {
    icon: Flag,
    title: "Bug reports and feature requests",
    body: "If something is broken, a description of what you did, what you expected, and which device and browser you were on is the most useful thing you can send."
  },
  {
    icon: ShieldCheck,
    title: "Privacy, copyright and takedown requests",
    body: "Requests concerning personal data, or material you own that you want removed, are handled by the same address."
  },
  {
    icon: Megaphone,
    title: "Advertising enquiries",
    body: "Questions about advertising on Hachi are welcome. Advertisers can also use Google's advertising platform directly."
  }
];

export default function Contact() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">Contact</p>
        <h1>Contact Us</h1>
        <p>
          Hachi is run by one person, so email goes straight to the person who builds and looks after the app.
          There is no support desk and no ticket system, which means replies are genuine but may not be immediate.
          Most messages get an answer within a few days.
        </p>
        <p>
          If you are writing about advertising or about Hachi in general, please use the address below. It is the
          only mailbox for this site.
        </p>

        <div className="contact-email">
          <Mail size={18} aria-hidden="true" />
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </div>

        <p>
          Please check the address carefully before sending. It is not monitored by a support contractor, and
          messages sent to any other Hachi address will not arrive.
        </p>

        <h2>What To Write About</h2>
        <div className="contact-methods">
          {CONTACT_METHODS.map(({ icon: Icon, title, body }) => (
            <div className="contact-method" key={title}>
              <span className="contact-method-icon" aria-hidden="true">
                <Icon size={18} />
              </span>
              <strong>{title}</strong>
              <p>{body}</p>
            </div>
          ))}
        </div>

        <h2>Before You Write</h2>
        <p>
          Some things are answered faster in the app than by email, and a few are self-serve. Signing in and removing
          data is done from Account Settings on the account page. The Privacy Policy explains what is stored and
          where, and the Terms of Service explains what Hachi does and does not promise.
        </p>
        <p>
          Hachi cannot recover a lost account or a lost password. Signing in uses Google, so the address and
          password are Google's to restore, not Hachi's. Reviewers deleted from an account cannot be brought back
          once the deletion has run.
        </p>
        <p>
          Please do not send passwords, sign-in tokens, or study material you would rather keep private. There is no
          need to, and Hachi will not ask for them.
        </p>

        <h2>Advertising On This Site</h2>
        <p>
          Ads on Hachi come from Google AdSense and a small number of other ad networks. Hachi does not control
          which ads are shown or the content of the pages they link to. If you have a query about a specific advert,
          use the advertising choice icon beside it, which takes you to Google's own controls.
        </p>

        <p>Last updated: 3 October 2026</p>

        <footer className="legal-footer">
          <Link className="back-link" to="/">Back to Hachi</Link>
          <Link to="/about">About Us</Link>
          <Link to="/privacy">Privacy Policy</Link>
          <Link to="/terms">Terms of Service</Link>
        </footer>
      </section>
    </div>
  );
}