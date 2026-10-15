import { Link } from "react-router-dom";
import PublicFooter from "../components/PublicFooter.jsx";

const QUESTIONS = [
  {
    question: "Do I need an account to use Hachi?",
    answer: [
      "No. You can create reviewers, take quizzes, and keep your progress before signing in to anything.",
      "An account adds three things: your material syncs across every device you own, you can share reviewers with friends and groups, and nothing is lost if you clear your browser data. Without one, everything stays on the device you used it on."
    ]
  },
  {
    question: "Is Hachi free?",
    answer: [
      "Yes, and there is no paid tier, no subscription, and nothing locked behind one. The site is funded by the advertising shown on it, which is why the <Link to=\"/privacy\">privacy policy</Link> is specific about keeping advertising separate from your study material."
    ]
  },
  {
    question: "What can I turn into a reviewer?",
    answer: [
      "Typed notes pasted into the form, a document such as a PDF or Markdown file, or a photograph of the page you are revising from. Any combination of those in one request, up to six files.",
      "If an image is in the upload it is read as an image rather than ignored, even if notes were pasted next to it. Large photos are shrunk on your device before they are uploaded, and a photo that is already small enough is sent exactly as it is."
    ]
  },
  {
    question: "What is the difference between the two generator modes?",
    answer: [
      "Study Material writes questions your source does not contain. Exam Paper copies a paper that already exists, in order, and adds nothing.",
      "They are opposites rather than one form with switches. If you already have the paper, you want Exam Paper. If you have notes and want practice built from them, you want Study Material."
    ]
  },
  {
    question: "Can I import a past paper that has no answer key?",
    answer: [
      "Yes. Exam Paper asks how it should treat answers, and you choose whether Hachi works them out itself or uses only the key printed in the upload.",
      "Under the second option an item the paper does not answer is left out of the reviewer and reported back as a count, rather than being guessed. A guessed answer teaches you something false and is indistinguishable from a real key entry once it is in the quiz, so leaving it out is the safer failure."
    ]
  },
  {
    question: "Can I trust the questions Hachi generates?",
    answer: [
      "Treat them as a draft to check, not as a source. They are generated from your material, but a generated question can be subtly wrong, and a confidently wrong question is worse than no question because you will revise the wrong thing.",
      "Open the reviewer and read a sample before you take a full run on it. Anything wrong can be corrected in the question editor, and the correction is saved to the reviewer itself rather than to the session, so it holds for every later attempt."
    ]
  },
  {
    question: "How many questions can a reviewer hold?",
    answer: [
      "Generation offers 20, 50, 75, 100, or a Comprehensive pass that covers everything important in the source rather than stopping at a number. A reviewer can hold up to 150 questions in total, and one that comes back short can be extended without regenerating what is already there.",
      "A hand-written reviewer has no such limit, which is one of the reasons the manual builder is worth knowing about."
    ]
  },
  {
    question: "What is the difference between the five quiz modes?",
    answer: [
      "Practice checks and explains each answer as you go and brings missed questions back later in the same quiz. Exam lets you change your answers and shows nothing until you submit. Timed is Exam with a countdown. Mistakes-Only replays just what you got wrong in your last attempt. Flashcard shows the answer after the prompt and asks you to judge yourself.",
      "All five keep your progress. The one that repays the effort is Mistakes-Only, once you have taken something once already. <Link to=\"/features\">The features page</Link> walks through each one in detail."
    ]
  },
  {
    question: "Does it work without an internet connection?",
    answer: [
      "Mostly, and more than most apps. Reviewers, quizzes, scores, and history are all held on your device, so revising works with no signal at all.",
      "Three things need a connection: AI generation, sharing, and cloud sync. Work done offline is not lost, and syncs the next time you are online. <Link to=\"/guides/offline-revision\">The offline guide</Link> sets out what stops working and how to prepare a device before travelling."
    ]
  },
  {
    question: "Where is my data stored?",
    answer: [
      "On your device, in your browser's own storage. Signing in adds a copy under your account so you can use more than one device, and so a cleared cache does not take your reviewers with it.",
      "Hachi does not publish or sell personal data, and none of your reviewers, answers, or attempt history can be read through the ad networks. The <Link to=\"/privacy\">privacy policy</Link> has the detail."
    ]
  },
  {
    question: "What happens if I clear my browser data?",
    answer: [
      "Without an account, that deletes your reviewers. This is the single most common way people lose a set of work, and the reason signing in is worth doing before you build anything large.",
      "Signing in makes your material a cloud copy rather than a device copy. You can also remove device data and cloud data yourself from Account Settings, and sharing a reviewer hands a copy to the other person, so a backup you have given away may remain with them after you delete it."
    ]
  },
  {
    question: "Can I share a reviewer with a friend?",
    answer: [
      "Yes, once you are signed in. Add friends, share a reviewer with them, or put reviewers into a group everyone in your course can see in one place.",
      "Sharing is a copy, not a link. Once it has been given away it stays with the person you gave it to, so it is worth being deliberate about what you send. When the questions of a shared reviewer are corrected, the people using it are told rather than left revising the old version."
    ]
  },
  {
    question: "Does Hachi have spaced repetition?",
    answer: [
      "Not built in. Hachi records when you last attempted something, which is the information a schedule needs, but it does not decide what you should revise today.",
      "That is a deliberate line rather than an omission: <Link to=\"/guides/spaced-revision\">the spaced revision guide</Link> lays out a schedule you can apply to your own History page."
    ]
  },
  {
    question: "Who can see my reviewers?",
    answer: [
      "Nobody, unless you share them. A reviewer is private by default and is never published, indexed, or shown to anyone else.",
      "The one exception is content you paste into an AI generation request, which is sent to the service that processes it so the questions can be written. The <Link to=\"/privacy\">privacy policy</Link> covers what that involves and what is never sent."
    ]
  },
  {
    question: "How do I report a wrong answer or a problem?",
    answer: [
      "Use the address on the <Link to=\"/contact\">contact page</Link>. It reaches the person who runs the site, and reports of a wrong answer are the fastest thing to act on.",
      "It is worth saying which reviewer and which question, since a screenshot of the question and the explanation is usually enough to fix it."
    ]
  },
  {
    question: "How is Hachi funded, and does that affect anything?",
    answer: [
      "Entirely by advertising. There is no subscription and no paywall.",
      "Advertising is kept away from your study material. Your reviewers, answers, and history cannot be read through the ad networks, and no payment is accepted in exchange for placing an ad. The <Link to=\"/about\">about page</Link> explains how the site is run and by whom."
    ]
  }
];

export default function Faq() {
  return (
    <div className="page narrow">
      <section className="legal-panel">
        <p className="eyebrow">FAQ</p>
        <h1>Frequently asked questions</h1>
        <p>
          The things people ask first, answered properly rather than briefly. If something here is still
          unclear, the <Link to="/contact">contact page</Link> is the way to ask.
        </p>

        {QUESTIONS.map((item) => (
          <div key={item.question}>
            <h2>{item.question}</h2>
            {item.answer.map((paragraph) => (
              <p key={paragraph.slice(0, 32)}>{paragraph}</p>
            ))}
          </div>
        ))}

        <h2>Still stuck on something?</h2>
        <p>
          The <Link to="/guides">study guides</Link> go into the method behind the app rather than the buttons:
          why rereading does not work, how to space your revisits, how to find the topic you keep getting
          wrong, and how to run a group that does not quietly fork the same reviewer four ways.
        </p>

        <PublicFooter />
      </section>
    </div>
  );
}