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

const { getChoiceBalanceIssue, inferQuestionStyle, getQuestionStyle, countNegativeStemQuestions, getReviewerStyleCounts } = await import(MODULE_URL);

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

// A learner picks the longest choice without reading, so a choice set that gives
// the answer away by shape is a broken question however correct it is. The repair
// pass used to be all or nothing, so a rewrite that improved an item without
// clearing the threshold was discarded and the original give-away was shipped
// instead, with the learner told to regenerate.
section("a repair is kept only when it is strictly better");
{
  const { applyChoiceRepairs } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const flat = ["Association", "Access Point", "BSSID"];
  const question = (correct, distractors = flat) => ({
    id: 1,
    question: "This is the amount of information broadcast over a connection.",
    choices: { A: correct, B: distractors[0], C: distractors[1], D: distractors[2] },
    correctAnswer: "A",
    answerText: correct,
    explanation: "Bandwidth is the rate of data."
  });

  // Twelve words against one-word distractors, and the only choice carrying two
  // ideas, so it gives itself away twice over.
  const original = question("Bandwidth expressed as bits per second, measured over the connection, every second");
  const reviewer = { questions: [original] };
  const repair = (choices, correctAnswer = "A") => ({ questions: [{ id: 1, choices, correctAnswer, explanation: "Bandwidth is the rate of data." }] });

  const apply = (correct, distractors = flat, correctAnswer = "A") => {
    const result = applyChoiceRepairs(reviewer, repair({ A: correct, B: distractors[0], C: distractors[1], D: distractors[2] }, correctAnswer), []);
    return { kept: result.reviewer.questions[0].choices.A, count: result.repairedCount };
  };

  check("a rewrite that clears it is kept", apply("Bandwidth", flat).count, 1);
  check("a partial improvement is kept", apply("Bandwidth expressed in bits per second, measured over the air").count, 1);
  check("a same-length rewrite is kept when it drops a tell", apply("Throughput expressed as bits per second, measured over the air").count, 1);

  const worse = "The bandwidth of a wireless link expressed as bits per second over the air interface every day";
  check("a longer rewrite is rejected", apply(worse).kept, original.choices.A);
  check("a blank choice is rejected", apply("").kept, original.choices.A);
  check("an answer letter outside A-D is rejected", apply("Bandwidth", flat, "Z").kept, original.choices.A);
  check("nothing repaired means nothing counted", applyChoiceRepairs(reviewer, repair({ A: worse, B: flat[0], C: flat[1], D: flat[2] }), []).repairedCount, 0);
}

// The second round used to replay the first round's prompt word for word against
// the same material. It reproduced the same failure, fixed nothing, and still
// cost an upstream call, so the retry has to ask for a different tactic.
section("the retry round asks for a different tactic, not the same answer again");
{
  const { buildChoiceRepairPrompt } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const issue = {
    id: 7,
    question: "This is the use of entrepreneurial methods to create a new venture.",
    choices: { A: "Technopreneurship applied to a new venture creation process", B: "Entrepreneurship", C: "Intrapreneurship", D: "Innovation" },
    correctAnswer: "A",
    explanation: "Technopreneurship applies entrepreneurship to a new venture.",
    reasons: ["the correct answer is 7 words while the other choices sit around 1 word"],
    correctWords: 7,
    medianDistractorWords: 1
  };

  const first = buildChoiceRepairPrompt([issue], "material");
  const second = buildChoiceRepairPrompt([issue], "material", { retry: true });

  check("the first round is not the retry", first === second, false);
  check("the retry says the first attempt failed", /previous attempt/i.test(second), true);
  check("the retry names a different tactic", /different tactic/i.test(second), true);

  for (const [label, prompt] of [["first", first], ["retry", second]]) {
    check(`${label}: move the distractors`, /Bring the three wrong choices UP/i.test(prompt), true);
    check(`${label}: never cut the correct answer`, /Never cut the correct answer/i.test(prompt), true);
    check(`${label}: counts words`, /Count the words/i.test(prompt), true);
    check(`${label}: carries the work order`, prompt.includes("id 7:"), true);
  }
}

// Balanced lengths were never the whole story. These three came back with the
// lengths even, which is all the check above could see, and were still decided
// on sight because the wrong choices were claims nobody would weigh. Q10 and Q19
// are catchable from wording; Q48 is not, and is here to pin that down rather
// than to pretend the check covers it.
section("give-away wrong choices are caught even when the lengths match");
{
  const item = (question, choices, correctAnswer) => ({ id: 1, question, choices, correctAnswer, explanation: "" });

  const q10 = item(
    "Why is problem identification considered an essential pillar of technopreneurship?",
    {
      A: "Identifying real-world problems drives meaningful technological innovation and market relevance.",
      B: "It replaces the need for customer segmentation and target personas.",
      C: "It allows startups to operate without any financial capital requirements.",
      D: "It ensures that founders never have to pivot their initial product ideas."
    },
    "A"
  );
  const q19 = item(
    "What is a major strategic advantage of adopting a macro industry perspective for technopreneurs?",
    {
      A: "It enables entrepreneurs to anticipate changes and launch proactive solutions before competitors.",
      B: "It allows founders to ignore customer interviews and focus solely on coding.",
      C: "It restricts business operations to local brick-and-mortar storefronts.",
      D: "It removes market uncertainties and guarantees absolute financial immunity."
    },
    "A"
  );
  const q48 = item(
    "Which among the following best describes what customer personas provide to technopreneurial teams during product design?",
    {
      A: "A macroeconomic report detailing regional industry trends and supply chains",
      B: "A semi-fictional representation that gives broad segments a human face and guides product development",
      C: "A quantitative spreadsheet tracking financial metrics and venture capital runway",
      D: "A legal framework for protecting proprietary software source code and patents"
    },
    "B"
  );

  const q10Reasons = getChoiceBalanceIssue(q10).reasons;
  const q19Reasons = getChoiceBalanceIssue(q19).reasons;

  check("Q10 flagged", Boolean(getChoiceBalanceIssue(q10)), true);
  check("Q10 blames the unweighable choices", q10Reasons.some((reason) => /no learner would seriously consider/.test(reason)), true);
  check("Q10 also caught the odd frame", q10Reasons.some((reason) => /open with "it"/.test(reason)), true);
  check("Q19 flagged", Boolean(getChoiceBalanceIssue(q19)), true);

  // The lengths in all three are within a word or two of each other, which is
  // exactly why the old check passed them. Assert that directly, so this test
  // fails loudly if someone ever widens the length thresholds back out.
  check("Q10 has no length complaint", q10Reasons.filter((reason) => /\bwords?\b/.test(reason)).length, 0);
  check("Q19 has no length complaint", q19Reasons.filter((reason) => /\bwords?\b/.test(reason)).length, 0);

  // A distractor that is merely long is still the original fault; a distractor
  // nobody would weigh is the new one.
  check("Q19 blames the unweighable choices", q19Reasons.some((reason) => /no learner would seriously consider/.test(reason)), true);

  // Q48's wrong choices are all the wrong kind of thing rather than absurd ones,
  // and nothing in the wording gives that away. Pinned here so the gap stays
  // visible instead of being assumed away.
  check("Q48 is not detectable by this check", getChoiceBalanceIssue(q48), null);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures) process.exitCode = 1;
