// Guards the question style classifier. The Direct Questions Only filter in the
// quiz setup drops every scenario and keeps every direct item, so a stem filed in
// the wrong bucket silently changes what a learner is asked to revise. Nothing
// fails loudly when it slips; the paper just stops resembling the exam.
//
// The fixtures are the 35 items of a real preliminary examination (IT2511, 1st
// Term SY 2026-2027), transcribed as written. That paper is the reference for
// the 34/66 exam-style mix the generator targets, which makes it the best
// available check that a classifier change did not quietly reshape the split.
//
// Run with `npm test`. No dependencies, matching the other check script.

import { pathToFileURL } from "node:url";

const MODULE_URL = pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href;

const { inferQuestionStyle, getQuestionStyle, countNegativeStemQuestions, getReviewerStyleCounts } = await import(MODULE_URL);

// [stem, expected style]. "direct" is recall of a term, definition, standard,
// category or recommended practice. "scenario" puts the concept in a situation
// and asks the learner to apply or identify it.
const PAPER = [
  ["It is a component of a wireless network used to connect wireless devices to a wireless/wired network and serves as a switch between a wired LAN and a wireless network.", "direct"],
  ["This wireless standards guides prioritizing data, voice, and video transmissions, enabling QoS.", "direct"],
  ["This type of mobile attack exploits vulnerabilities in dynamic web pages and injects malicious content that other users can view.", "direct"],
  ['This is the amount of information broadcast over a connection and is measured in terms of "number of bits per second (bps)".', "direct"],
  ["This mobile risk category covers the misuse of a platform feature or the failure to use platform security controls.", "direct"],
  ["It is a phishing fraud in which an attacker uses SMS to send text messages containing deceptive links to a malicious websites or telephone numbers to a victim.", "direct"],
  ["This network-based attack eavesdrops on existing network connections to intrude, read, and modify the data or insert fraudulent data into the intercepted communication.", "direct"],
  ["This is a Bluetooth attack where oversized ping packets crash the target system.", "direct"],
  ["It defines standards for a wireless personal area network (WPAN) and describes the specifications for wireless connectivity with fixed or portable devices.", "direct"],
  ["This tool creates a virtual tunnel interface to monitor encrypted traffic and inject arbitrary traffic into a network.", "direct"],
  ["This Bluetooth mode rejects connection requests sent by any device in the vicinity.", "direct"],
  ["This mobile risk category covers the analysis of the final core binary to determine its source code, libraries, algorithms, and other assets.", "direct"],
  ["This mobile risk category captures notions of authenticating the end user or bad session management.", "direct"],
  ["This method allows users to attain privileged control within Android's subsystem, resulting in sensitive data exposure.", "direct"],
  ["This mobile risk category covers binary patching, local resource modification, method hooking, method swizzling, and dynamic memory modification.", "direct"],
  ["A user believes they are clicking a harmless button on a mobile webpage, but the click performs a different action than expected. Which of the following attacks is demonstrated?", "scenario"],
  ["Which of the following mobile risks can be raised from failure to identify the user, failure to maintain the user's identity, or weaknesses in session management?", "direct"],
  ["A malicious page is embedded inside a legitimate web page using an iFrame, and users are tricked into clicking controls that steal their credentials. Which of the following attacks BEST matches the scenario?", "scenario"],
  ["Which of the following practices should be followed while configuring a wireless network to defend against potential wireless attacks?", "direct"],
  ["Joan, a software developer, unintentionally included a password as a comment in a hybrid mobile application that was developed for internal purposes and not expected to be released into a production environment. Which of the following mobile security risks is demonstrated?", "scenario"],
  ["Which of the following practices helps security professionals secure the network from wireless threats?", "direct"],
  ["Ashley, a security professional, analyzed the authentication and wireless encryption techniques implemented in her organization to support its BYOD policy. While doing so, she noticed that certain techniques were outdated. In this regard, she implemented a Wi-Fi security protocol using GCMP-256 for encryption and HMAC-SHA-384 for authentication. Which of the following protocols is employed?", "scenario"],
  ["Jack, a professional hacker, has performed an attack on Bluetooth paired devices. He leveraged a vulnerability in Bluetooth and breached the security mechanisms to eavesdrop on all the data being shared. Jack managed to intercept the data transfer between devices and gained access to chats and documents being shared. Which of the following attacks did Jack perform?", "scenario"],
  ["Walter, a professional hacker, was trying to exploit a technique to analyze the final core binary to determine its source code and libraries. He utilized a technique to analyze the final core binary to determine its source code and libraries. Further, this analysis gave him insights into the inner workings of the application. Which of the following mobile risks is exploited?", "scenario"],
  ["Which of the following guidelines helps users identify and protect sensitive data on their mobile devices?", "direct"],
  ["Which of the following practices can make mobile devices vulnerable to online attacks?", "direct"],
  ["In which of the following attacks do attackers exploit web page vulnerabilities to force an unsuspecting user's browser to send unintended malicious requests?", "direct"],
  ["James, a software developer at an organization, handed over a fully developed mobile application to the testing team for validation. During validation, the testing team disabled the two-factor authentication implemented on it and forgot to enable it before deployment. This oversight allowed attackers to penetrate the server just by cracking users' credentials, as the two-factor authentication was turned off on the application. Which of the following mobile security risks is demonstrated?", "scenario"],
  ["Which of the following practices should be followed while configuring a wireless network to defend against potential wireless network attacks?", "direct"],
  ["In which of the following attacks does an attacker create a soft AP, typically on a laptop, by running a tool that makes the laptop's NIC appear as a legitimate AP?", "direct"],
  ["A finance app stores session tokens locally in plain text. A stolen phone reveals tokens and allows account takeover. Which of the following offers the BEST resolution?", "scenario"],
  ["A user wants the device hidden from discovery scans but still connectable by paired devices. What should the user do next with the Bluetooth device?", "scenario"],
  ["A user receives a text message claiming to be from their bank, containing a link that steals login credentials when clicked. Which of the following actions BEST prevents this?", "scenario"],
  ["A company handling classified data wants to prevent brute-force attacks and ensure stronger encryption against its Wi-Fi network. Which protocol should be implemented?", "scenario"],
  ["Employees store company passwords in plain-text notes on their smartphones. Which guideline should the organization enforce?", "scenario"]
];

// Written by the generator rather than copied from a paper, so they cover shapes
// the paper does not happen to use.
const SYNTHETIC = [
  ["Which among the following is NOT a subfactor of reliability?", "scenario"],
  ["Which of the following is least likely to describe a rogue access point?", "scenario"],
  ["What is Problem-Solution Fit?", "direct"],
  ["Which term is used for the practice of intercepting traffic between two parties?", "direct"],
  ["Define phishing.", "direct"],
  ["Identify the layer of the OSI model that handles routing.", "direct"],
  ["In the material, which standard specifies wireless connectivity between fixed devices?", "direct"],
  ["A startup divides its customers by age, income, and education level before running a survey. Which segmentation method is being used?", "scenario"],
  ["A retailer's site crashes whenever its database runs out of connections. Which component should be the first to be investigated?", "scenario"]
];

// Statement forms. These are what a true/false, identification or flashcard
// reviewer is made of, so every one of them is direct by definition, and they are
// the shapes that catch a classifier reading too much into an opening noun
// phrase. "A firewall filters inbound traffic ..." is a definition, not an agent
// acting in a situation.
const STATEMENTS = [
  ["The standard that specifies wireless connectivity between fixed and portable devices is 802.11.", "direct"],
  ["A firewall filters inbound traffic according to a rule set.", "direct"],
  ["Encryption in transit protects data while it moves between two endpoints.", "direct"],
  ["The OSI model separates the transport layer from the network layer.", "direct"],
  ["Problem-Solution Fit measures whether a solution addresses the root cause of a problem.", "direct"],
  ["A startup pivots when its core hypothesis is falsified.", "direct"],
  ["Scalability refers to how well a system handles increased load.", "direct"]
];

// A demonstrative opener does not make a stem direct. Both of these read like a
// definition until the trailing question is noticed.
const DEMONSTRATIVE_SCENARIOS = [
  ["This is a serious flaw: any employee can approve their own expense claim. Which risk is demonstrated?", "scenario"],
  ["It has been three weeks and the pilot has no sign-ups. What should the team conclude?", "scenario"]
];

let failures = 0;
let checks = 0;

function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${ok ? "" : `\n          got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`);
}

function section(title) {
  console.log(`\n${title}`);
}

section("every item of a real 35-item preliminary examination is filed correctly");
PAPER.forEach(([stem, expected], index) => {
  check(`Q${index + 1} ${expected}`, inferQuestionStyle(stem), expected);
});

section("shapes a paper does not happen to use");
SYNTHETIC.forEach(([stem, expected], index) => {
  check(`synthetic ${index + 1} ${expected}`, inferQuestionStyle(stem), expected);
});

section("statement forms stay direct");
STATEMENTS.forEach(([stem, expected], index) => {
  check(`statement ${index + 1} ${expected}`, inferQuestionStyle(stem), expected);
});

section("a demonstrative opener does not decide the style on its own");
DEMONSTRATIVE_SCENARIOS.forEach(([stem, expected], index) => {
  check(`demonstrative ${index + 1} ${expected}`, inferQuestionStyle(stem), expected);
});

section("the paper's own split is recoverable");
{
  const questions = PAPER.map(([stem]) => ({ question: stem }));
  const counts = getReviewerStyleCounts(questions);

  check("exam-style count", counts.scenario, 12);
  check("direct count", counts.direct, 23);
  check("negative stems", countNegativeStemQuestions(questions), 0);
}

section("an empty or missing stem is direct");
check("empty string", inferQuestionStyle(""), "direct");
check("undefined", inferQuestionStyle(undefined), "direct");

// The tag the generator returns is a claim, and a claim cannot be checked. The
// wording is the question, so a tag that disagrees is ignored rather than allowed
// to report a mix the reviewer does not have. A scenario the model filed as direct
// used to survive the Direct Questions Only filter, and a definition filed as
// scenario used to be hidden from it.
section("a wrong style tag cannot override the wording");
{
  const definition = PAPER[0][0];
  const scenario = PAPER[15][0];

  check("scenario tagged direct", getQuestionStyle({ question: scenario, style: "direct" }), "scenario");
  check("definition tagged scenario", getQuestionStyle({ question: definition, style: "scenario" }), "direct");
  check("garbage tag", getQuestionStyle({ question: scenario, style: "flavour" }), "scenario");
  check("no tag", getQuestionStyle({ question: scenario }), "scenario");
  check("empty question object", getQuestionStyle({}), "direct");

  const everyTagWrong = PAPER.map(([question]) => ({ question, style: "scenario" }));
  check("counts are unaffected by tags", getReviewerStyleCounts(everyTagWrong), { scenario: 12, direct: 23 });
}

// The mix plan is a request in the prompt, so the only thing standing between a
// model that ignored it and a learner who never finds out is this check. The band
// matters more than the warning: derived the way the difficulty check derives one
// it runs 17% to 84%, which passes the old scenario-heavy set at 65% untouched.
section("an off-plan mix is reported, an on-plan one is not");
{
  const { getStyleMixWarning, SCENARIO_MIX } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const reviewer = (scenario, total = 50) => ({
    questions: Array.from({ length: total }, (_, index) => ({
      question: index < scenario ? "A user clicks a link that installs software without asking. Which attack is demonstrated?" : "This is a component of a wireless network used to connect wireless devices to a wired LAN.",
      difficulty: "medium"
    }))
  });

  const warned = (reviewer) => Boolean(getStyleMixWarning(reviewer));

  check("plan target is 34%", SCENARIO_MIX, 0.34);
  check("35 items as measured on the paper", warned(reviewer(12, 35)), false);
  check("50 items exactly on the plan", warned(reviewer(17, 50)), false);
  check("rounding at a small size", warned(reviewer(8, 25)), false);
  check("too many scenarios", warned(reviewer(28, 50)), true);
  check("the old 65% scenario set", warned(reviewer(33, 50)), true);
  check("just inside the upper band", warned(reviewer(23, 50)), false);
  check("almost no scenarios", warned(reviewer(2, 50)), true);
  check("under the reporting floor", warned(reviewer(0, 8)), false);
}

// A hand-edited question is written straight to the row, and a reviewer whose
// answerText disagrees with its correct choice, or whose choices do not match its
// type, is a reviewer the setup page then refuses to open. Neither failure is
// visible at the moment of editing, so the rules that prevent them are checked
// here rather than left to the editor component.
section("editing a question keeps the shape the validator demands");
{
  const {
    choiceLettersFor,
    isTypedQuestion,
    normalizeQuestionForSave,
    normalizeQuestionType,
    questionProblems,
    setChoiceValue,
    setCorrectAnswer
  } = await import(
    pathToFileURL(new URL("../src/utils/questionEditor.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const mc = {
    id: 1,
    type: "multiple_choice",
    difficulty: "medium",
    topic: "Segmentation",
    question: "Which method groups buyers by age and income?",
    choices: { A: "Demographic", B: "Behavioral", C: "Geographic", D: "Psychographic" },
    correctAnswer: "A",
    answerText: "Demographic",
    explanation: "Age and income are who the buyer is, not what they did."
  };

  const valid = (question) => questionProblems(question).length === 0;
  // The condition validateReviewer states as answerText === choices[correctAnswer],
  // which is the one an owner breaks by typing into one field and not the other.
  const mirrors = (question) => question.answerText === question.choices[question.correctAnswer];

  check("a whole question as generated is valid", valid(mc), true);

  check("typing into the correct choice mirrors answerText",
    mirrors(setChoiceValue(mc, "A", "Demographic segmentation")),
    true);

  check("typing into a distractor leaves answerText alone",
    mirrors(setChoiceValue(mc, "B", "Behavioural")),
    true);

  check("marking another choice moves answerText with it",
    mirrors(setCorrectAnswer(mc, "C")),
    true);

  check("a type switch to true/false leaves two choices",
    Object.values(normalizeQuestionType(mc, "true_false").choices).filter(Boolean),
    ["True", "False"]);

  check("a type switch to true/false keeps a valid answer",
    mirrors(normalizeQuestionType(mc, "true_false")),
    true);

  check("a type switch to a typed question answers with TEXT",
    normalizeQuestionType(mc, "flashcard").correctAnswer,
    "TEXT");

  check("a type switch away from typed reports the empty choices it left",
    questionProblems(normalizeQuestionType({ ...mc, type: "flashcard", choices: {} }, "multiple_choice")).length > 0,
    true);

  check("a typed question is not asked for choices",
    [isTypedQuestion("flashcard"), isTypedQuestion("multiple_choice")],
    [true, false]);

  check("true/false stores two choices, multiple choice four",
    [choiceLettersFor("true_false").length, choiceLettersFor("multiple_choice").length],
    [2, 4]);

  const padded = { ...mc, topic: "  Segmentation  ", explanation: "  Padded.  " };
  check("saving trims the text fields",
    [normalizeQuestionForSave(padded).topic, normalizeQuestionForSave(padded).explanation],
    ["Segmentation", "Padded."]);

  check("saving leaves answerText equal to the trimmed correct choice",
    mirrors(normalizeQuestionForSave({ ...mc, choices: { ...mc.choices, A: "  Demographic  " } })),
    true);

  check("saving is idempotent",
    normalizeQuestionForSave(normalizeQuestionForSave(mc)),
    normalizeQuestionForSave(mc));

  section("what the editor refuses to save");
  check("an empty topic", questionProblems({ ...mc, topic: "  " }).length, 1);
  check("an empty explanation", questionProblems({ ...mc, explanation: "" }).length, 1);
  check("an empty choice", questionProblems({ ...mc, choices: { ...mc.choices, C: "" } }).length, 1);
  check("a repeated choice", questionProblems({ ...mc, choices: { ...mc.choices, C: "demographic" } }).length, 1);
  check("a correct answer that is not a choice", questionProblems({ ...mc, correctAnswer: "Z" }).length, 1);
  check("a typed question with no answer", questionProblems({ ...mc, type: "flashcard", answerText: " " }).length, 1);
  check("a whole question reports nothing", questionProblems(mc).length, 0);

  // The filter the editor offers is this same check, so what it reports is what
  // the owner is shown, and a balanced question must not be swept up with it.
  section("the standout answer filter finds the give-aways and leaves the rest");
  const { getChoiceBalanceIssue } = await import(
    pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const giveaway = {
    ...mc,
    choices: {
      A: "Demographic segmentation, which groups buyers by age and income and spending power",
      B: "Behavioral",
      C: "Geographic",
      D: "Psychographic"
    },
    correctAnswer: "A"
  };

  check("a long correct answer is reported",
    getChoiceBalanceIssue({ ...giveaway, answerText: giveaway.choices.A }) !== null,
    true);

  check("the report says why",
    getChoiceBalanceIssue({ ...giveaway, answerText: giveaway.choices.A }).reasons.length > 0,
    true);

  check("a balanced question is not reported", getChoiceBalanceIssue(mc), null);

  check("a repeated choice is left to the save check, not the filter",
    getChoiceBalanceIssue({ ...mc, choices: { ...mc.choices, C: "Demographic" } }),
    null);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures) process.exitCode = 1;
