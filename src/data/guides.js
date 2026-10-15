/**
 * The written guides, as data rather than as components.
 *
 * Two reasons it is a module and not a folder of .jsx files. Google can only see
 * a page if the HTML it fetches contains the words on it, and every public route
 * here is prerendered from this content by scripts/prerender.mjs, so a guide that
 * lived inside a component would render fine and still be invisible to a crawler
 * that does not run the app. And the guide index, the route metadata and the
 * article page all need the same list, so it is defined once and read from three
 * places rather than kept in step by hand.
 */

export const GUIDES = [
  {
    slug: "active-recall",
    title: "Active recall beats rereading, and you can prove it on yourself",
    metaDescription:
      "Why reading your notes again feels productive and is not, what active recall actually means, and how to practise it with a Hachi reviewer until the weak parts are obvious.",
    blurb:
      "Rereading feels like studying because it is easy and it feels familiar. It is also close to useless on an exam. Here is the difference, and what to do instead.",
    minutes: 6,
    updated: "2026-10-12",
    sections: [
      {
        heading: "The comfortable version of studying is not the useful one",
        body: [
          "Open your notes, read a section, feel that it is going in, close the notebook. Do it again tomorrow. This is the default for almost everyone, and it is the reason people who revise for weeks walk into an exam unable to produce a single definition they read forty times.",
          "The reason is not effort. It is that reading is a recognition task, and an exam is a retrieval task. Reading tells you the answer looks familiar. Retrieving an answer forces you to rebuild it. Those are different skills, and only one of them is the one being tested.",
          "The effect is easy to see on yourself without any study science. Take a section you have read twice. Close it. Write down everything you remember, in any order, without checking. Then compare. The gap between what you remembered and what is on the page is your real starting point, and it is almost always much bigger than it felt."
        ]
      },
      {
        heading: "What active recall is, in practice",
        body: [
          "Active recall is any attempt to produce information from memory, checked afterwards. Quizzing is the obvious version. It is not the only one.",
          "The four forms that work, roughly in order of how uncomfortable they feel:"
        ],
        bullets: [
          "Free recall: write down everything you remember about a topic, then check it against the source. Hardest, and the most informative.",
          "Self-testing: a reviewer or quiz, taken without the notes open.",
          "Elaboration: for each fact, write why it is true and what would happen if it were false.",
          "Self-explanation: explain a concept out loud, as if to someone who has never seen the topic, and notice where you run out of words."
        ],
        body2: [
          "All four share the same shape: produce, then check. The checking step is the one people skip, and it is the one that makes the effort stick. An answer recalled wrongly and left uncorrected is worse than no answer at all, because it is stored."
        ]
      },
      {
        heading: "Doing it in Hachi without turning it into a chore",
        body: [
          "Take a reviewer in Multiple Choice mode with the notes closed. Answer every question before looking at any feedback. Do not stop at the ones you are unsure of, because the uncertain ones are the ones carrying information.",
          "Afterwards, open Review Answers rather than re-taking the quiz. Review Answers shows you what you picked next to what was correct, with the explanation attached, and that is where the actual revision happens. Re-taking a quiz you already failed mostly measures your memory for the answer key.",
          "If you want the harder version, use Free Recall mode: it shows you the answer and asks you to reproduce it from the question alone, which is what an exam does. If you want to check whether you actually understand rather than recognise, use Learn mode, which puts an explanation in front of you before you commit to an answer."
        ]
      },
      {
        heading: "When it stops working",
        body: [
          "Recall has diminishing returns once you are reliably correct, and grinding through a reviewer you score 100% on teaches you almost nothing. That is a good moment to stop, not a moment to increase the count.",
          "The other failure is treating the score as the goal. A reviewer you score 80% on twice is worth more than one you score 100% on once, because the second session is scheduled after you had recovered. See the spaced revision guide for how to time the second one."
        ]
      }
    ]
  },
  {
    slug: "spaced-revision",
    title: "A revision schedule you will actually keep",
    metaDescription:
      "How to space revision sessions so a topic is remembered at the moment it is examined, what to do when a schedule slips, and how to use Hachi's attempt history to decide what to revise today.",
    blurb:
      "Revising everything the night before is a way of feeling organised. Spacing is what makes it work. Here is a schedule you can keep, including for the nights when it slips.",
    minutes: 7,
    updated: "2026-10-12",
    sections: [
      {
        heading: "Why the same hour a day before the exam is worth less",
        body: [
          "Memory fades fast, and the rate is not constant. Whatever you learn settles noticeably within a day, then more slowly, then flattens out. Revisiting a topic just before it fades costs almost nothing to learn and tops it back up. Revisiting it after it has gone costs much more.",
          "That asymmetry is the whole argument for spacing, and it is why the advice sounds so strange: the harder a session feels at the time, the more efficient it is, provided you find the topic again slightly after the point where it started slipping."
        ]
      },
      {
        heading: "A schedule that survives contact with a real week",
        body: [
          "Three passes over the same material, spread out, beats six passes crammed together. The exact intervals matter less than the shape, so this one is deliberately modest:"
        ],
        bullets: [
          "Pass one, the day you finish the material. Get it in once while it is fresh, so you know what you are dealing with.",
          "Pass two, two to three days later. This is the session that does the work. Expect it to be harder than pass one and that is the point.",
          "Pass three, a week later. By now you should only be looking at the things you got wrong.",
          "After that, only revisit what is still wrong. A topic you have answered correctly three times across three separate weeks does not need a fourth."
        ],
        body2: [
          "If you only have one more session before an exam, do not split it evenly. Cover less material and cover it twice, with a break in between, rather than touching everything once."
        ]
      },
      {
        heading: "When the schedule slips",
        body: [
          "It will slip, and the usual response is to give up on the schedule entirely and return to cramming. A better response is to shorten the material rather than compress the time.",
          "Pick the reviewers you have touched least recently, take them in one sitting, and mark everything you got wrong for the next session. A reviewer you have already taken twice and still fail on is a signal, not a scheduling problem: either you do not understand it yet, or the reviewer is testing something the notes never covered. Both are worth a look before you queue it again."
        ]
      },
      {
        heading: "Using attempt history to pick today's session",
        body: [
          "Hachi's History page records every attempt with the reviewer, the mode, the score, and the date. Read it as a to-do list rather than a scoreboard.",
          "The useful signals, in order:"
        ],
        bullets: [
          "Scored badly and long ago. The highest value session available, because the decay has had time to work.",
          "Scored badly recently. Read the explanations rather than re-quizzing. You do not need more attempts, you need the material you missed.",
          "Scored well long ago. Due for a top-up. One pass now is much cheaper than relearning it the night before.",
          "Never attempted. The only genuine blind spot in the list."
        ],
        body2: [
          "Streaks count days, not topics, so treat them as a nudge rather than a target. A day spent reviewing one weak section honestly is worth more than a day spent opening five reviewers and closing them."
        ]
      }
    ]
  },
  {
    slug: "past-papers",
    title: "Turning a past paper into a reviewer you can revise from",
    metaDescription:
      "How to import an existing exam paper into Hachi, when to let Hachi work out the answers and when to only read the ones printed on the paper, and how to check the result.",
    blurb:
      "Exam Paper mode transcribes a paper that already exists instead of inventing one. That changes what you can trust, and how you should use it.",
    minutes: 6,
    updated: "2026-10-12",
    sections: [
      {
        heading: "Import is a transcription job, not a writing job",
        body: [
          "Hachi has two generator modes and they are opposites. Study Material writes questions your notes do not contain. Exam Paper copies a paper that already exists, question for question, in order.",
          "Import therefore adds nothing. If a question is not on the paper you uploaded, it will not appear. That is deliberate, and it is why an imported reviewer is a faithful revision copy rather than extra practice.",
          "Pick Exam Paper whenever you already have the paper, and Study Material whenever you have notes and want questions built from them."
        ]
      },
      {
        heading: "Two ways to handle the answers, and they are not interchangeable",
        body: [
          "The import asks you how it should treat the answer key, and the choice changes the meaning of every question in the reviewer."
        ],
        bullets: [
          "Solve the answers: Hachi works out the answers itself, and credits an answer it can read off the paper. Use this when your copy has no key, and you want to attempt the paper.",
          "Extract only what is shown: Hachi uses only what appears in the upload and treats anything else as unanswered. Use this when you have checked a key yourself, or when the paper came with a mark scheme you trust."
        ],
        body2: [
          "Under extract, Hachi will not answer an item it cannot see an answer to, even if it could reason it out. That is the correct behaviour: the point of the mode is to transcribe, not to solve. An item it genuinely cannot resolve is dropped from the reviewer and reported back as a count, rather than guessed at."
        ]
      },
      {
        heading: "Getting the paper in cleanly",
        body: [
          "Paper runs long, and a three-page paper is three photos rather than one. Drop them all onto the upload area together and Hachi pools them into a single request. Keep the pages in order and in good light; the most common import failures are a shadow across the question and a crop that cuts off the options.",
          "A photo or a PDF always routes to a vision-capable provider even if you also paste some typed notes, so a mixed upload is fine. Photographs are downscaled before they are sent if they are larger than about 2000 pixels on the long edge, which is enough resolution to read a printed question and small enough to upload quickly."
        ]
      },
      {
        heading: "Check the first few before you revise from it",
        body: [
          "An imported reviewer is a transcription, and transcriptions have failure modes: a question split across two pages can merge badly, a table can come out garbled, and an option list can pick up a stray line. Open the reviewer and read the first five questions against the paper before you sit a full practice run on it.",
          "Edit anything wrong before revising. The question editor lets you change the question, the options, the correct answer and the explanation in place, and the edit is saved to the reviewer itself rather than to the session, so the correction holds for every future attempt."
        ]
      },
      {
        heading: "What to do with it afterwards",
        body: [
          "Treat an imported paper as your measure. A generated reviewer is practice; a real paper is the closest thing to the exam you will get, and the score on one is worth more than several high scores on generated material.",
          "Run it once without notes, look at which questions you got wrong rather than at the total, and then use Review Answers to work through those. If you want to retake it later to see whether the gaps closed, that is exactly what the spaced revision guide is for."
        ]
      }
    ]
  },
  {
    slug: "weak-topics",
    title: "Find the topic you keep getting wrong",
    metaDescription:
      "How to read Hachi's mistake history, why the average score across all your reviewers is misleading, and what to do once you have found the weak section.",
    blurb:
      "An overall percentage hides the one topic that costs you marks every time. Here is how to find it and what to do about it.",
    minutes: 5,
    updated: "2026-10-12",
    sections: [
      {
        heading: "The average is the wrong number",
        body: [
          "Most people look at a score, see a percentage, and move on. A percentage is an average, and an average of uneven parts tells you very little. Ninety percent across a whole reviewer can mean you know nine topics well and one badly, or that you know all of them equally and are near the top everywhere. Those need completely different amounts of work.",
          "The same applies across reviewers. A healthy average across eight reviewers can be hiding one subject where you score below chance because you have never properly learned it."
        ]
      },
      {
        heading: "Read the misses, not the score",
        body: [
          "Hachi keeps a full record of what you chose on every question, not just whether it was right. Review Answers shows your answer next to the correct one with the explanation attached, and it stays available after the session ends."
        ],
        bullets: [
          "Group the misses by topic rather than by reviewer. Questions carry the topic they came from, so the same weakness usually shows up in more than one reviewer.",
          "Look at the shape of the error. Missing every question on one narrow topic is a gap in the material. Getting one option wrong across a whole topic is usually a wording problem.",
          "Count the repeats. A question you have missed on three separate attempts is not bad luck and is not a schedule problem."
        ]
      },
      {
        heading: "Distinguish not-known from not-understood",
        body: [
          "These look identical in a score and need opposite treatment.",
          "Not known means the information was never in front of you, or it was there once and did not survive. The fix is retrieval: quiz the topic until it sticks.",
          "Not understood means the information is there and you keep choosing the wrong option anyway. That is usually a sign you are pattern-matching on the shape of the question rather than reading it. The fix is slower: read the explanation for those questions slowly and restate the rule in your own words until the distractor stops being tempting."
        ],
        body2: [
          "One useful diagnostic: if you would have picked differently had you read the question twice, it is a reading problem rather than a knowledge gap, and a smaller question set on that topic will fix it faster than a larger one."
        ]
      },
      {
        heading: "Fixing the weak topic",
        body: [
          "Build a reviewer for the weak topic alone rather than re-taking the big one. Generation makes this easy: give the generator your notes for that one section, ask for a focused question count, and you have a short, targeted reviewer in a couple of minutes.",
          "Then take it until you are consistently correct, and go back to the original reviewer a week later to check the fix held. A weak topic that has been repaired is one of the few changes in revision that reliably moves an overall score."
        ]
      }
    ]
  },
  {
    slug: "study-groups",
    title: "Running a study group that actually turns up",
    metaDescription:
      "How to share Hachi reviewers with friends, organise a group study space, and set the ground rules that stop a shared reviewer from drifting away from the original.",
    blurb:
      "Shared material goes stale fast unless someone owns it. Here is how to share reviewers and groups without ending up with four slightly wrong copies.",
    minutes: 6,
    updated: "2026-10-12",
    sections: [
      {
        heading: "What sharing actually does",
        body: [
          "Sharing a reviewer hands a copy of it to the people you share it with. You own your material and can delete it, but once a copy has been given away it stays with the person you gave it to, which is why it is worth being deliberate about what you share.",
          "Groups work the same way with more people. A group gives everyone one place to see the reviewers that belong to it, rather than a private link that expires or a chat thread full of attachments nobody can find again."
        ]
      },
      {
        heading: "Set up the group before you share anything",
        body: [
          "The thing that makes a group work is a name that means something to everyone in it. A group called Test Prep 1 will be abandoned. Name it after the module or the paper.",
          "Then agree two things before the first session: who edits shared reviewers, and what happens when someone gets a question wrong. Those two questions are where groups normally go wrong, and agreeing them up front costs five minutes."
        ],
        bullets: [
          "One person edits questions and answers; everyone else reports. A group where five people rewrite the same reviewer produces a reviewer nobody trusts.",
          "Corrections go in the reviewer itself, not into the chat. A correction in a chat message helps nobody who was not there that day.",
          "Shared reviewers are drafts until checked, exactly like generated ones. Treat anything in a group the same way you treat an AI-generated question: verify it against your own material before revising from it."
        ]
      },
      {
        heading: "One shared reviewer per topic",
        body: [
          "The failure mode is four people making four reviewers for the same section. Nobody wants to be the fifth, and the group ends up with more material than anyone would revise anyway.",
          "Make one reviewer, share it, and improve it in place. Because Hachi records when the questions of a shared reviewer are edited, the people using it are told the material changed rather than quietly revising an older version."
        ]
      },
      {
        heading: "Use the session for the hard part",
        body: [
          "Meeting up to each person reading a reviewer alone is a worse version of studying alone. The time is worth spending on the things a group is genuinely better at: arguing about which answer is right, splitting a topic up between people who each take a section, and covering the parts nobody has read yet.",
          "A structure that works is a short individual attempt first, then the group session working only through what people got wrong. The individual attempt gives everyone something to contribute, and the group does not waste time on the easy half."
        ]
      }
    ]
  },
  {
    slug: "offline-revision",
    title: "Revising with no signal",
    metaDescription:
      "How much of Hachi works without a connection, what syncs when you get one back, and how to set up a device for a commute or a flight.",
    blurb:
      "Most of Hachi runs on your device, which means a bad connection is much less of a problem than it sounds. Here is exactly what stops working.",
    minutes: 5,
    updated: "2026-10-12",
    sections: [
      {
        heading: "What is on your device",
        body: [
          "Reviewers, notes, quiz attempts, scores, streak history and mistake history are all stored in your browser. Quizzes do not contact a server to run, so a reviewer you built last week is still there and still works on a train with no signal.",
          "Hachi also installs as an app. Added to your home screen it opens in its own window, keeps working offline, and gets new versions in the background rather than needing a reinstall."
        ]
      },
      {
        heading: "What genuinely needs a connection",
        body: [
          "Three things, and it is worth knowing them in advance rather than finding them out mid-journey."
        ],
        bullets: [
          "AI generation. Turning notes or a photo into a reviewer is a call to an outside service, so it needs a connection.",
          "Sharing. Sending a reviewer to a friend, creating a group, or joining one all go through the server.",
          "Cloud sync. Signing in keeps everything on your account and across your devices, which only means anything when there is a connection to sync over."
        ],
        body2: [
          "Everything else, including generating questions by hand in the editor, works the same offline as it does online."
        ]
      },
      {
        heading: "What happens when you come back",
        body: [
          "Work done offline is not lost. It saves locally as you go and syncs to your account the next time the connection is there, so closing the app on a plane does not cost you a session.",
          "If you have never signed in, that work stays on that device and that device only. Clearing your browser data deletes it, which is the single most common way people lose a set of reviewers."
        ]
      },
      {
        heading: "Setting a device up before you leave",
        body: [
          "Worth doing while you still have a connection, because none of it works once you are out."
        ],
        bullets: [
          "Add Hachi to your home screen so it launches without a browser address bar.",
          "Open the reviewers you plan to use once, so any first-run work is already done.",
          "Sign in if you want the session to survive a cleared cache. Generation is the one thing you cannot prepare offline, so download or generate the material before you travel."
        ]
      }
    ]
  }
];

export function findGuide(slug) {
  return GUIDES.find((guide) => guide.slug === slug) || null;
}

export function guideSlugs() {
  return GUIDES.map((guide) => guide.slug);
}