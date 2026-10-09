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

section("a reviewer named from the material, not from a fallback string");
{
  const { buildPrompt, buildCompletionPrompt } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  // A blank Title field used to put the literal string "Generated Reviewer" into the
  // prompt as the title, which the model then echoed, so a reviewer made from a module
  // came back titled "Generated Reviewer" and had to be renamed by hand. The fallback
  // has to read as an instruction to name it from the material, never as a value.
  const blank = buildPrompt({
    sourceText: "WADWANI Module 1 content",
    title: "",
    subject: "",
    instructions: "",
    questionCount: 20,
    difficulty: "mixed",
    questionType: "multiple_choice"
  });

  check("a blank title asks for the document's own name", /- Title: The document's own name, as the material prints it/.test(blank), true);
  check("a blank subject asks for the subject the material words it", /- Subject: The subject or course the material belongs to/.test(blank), true);
  check("no literal generic title is passed as a value", /- Title: Generated Reviewer/.test(blank), false);
  check("no literal generic subject is passed as a value", /- Subject: Generated\s*$/m.test(blank), false);
  check("it is told to name them from the material", blank.includes("title and subject are named from the material, not invented and not generic"), true);
  check("it is told never to return a generic reviewer title", blank.includes('Never return "Generated Reviewer" as a title'), true);
  check("it is told to keep the material's own terminology", blank.includes("Keep the material's own terminology"), true);
  check("it is given real naming examples", blank.includes("WADWANI Module 1") && blank.includes("IT2511 - Information Technology 2"), true);
  check("a derived id is told to stay short", blank.includes("three or four words taken from the title"), true);

  const named = buildPrompt({
    sourceText: "notes",
    title: "My Biology Set",
    subject: "Biology",
    instructions: "",
    questionCount: 20,
    difficulty: "mixed",
    questionType: "multiple_choice"
  });

  check("a typed title is still used as given", /- Title: My Biology Set/.test(named), true);
  check("a typed subject is still used as given", /- Subject: Biology/.test(named), true);

  // The top-up prompt carries the finished reviewer's own values, so it has to agree
  // with the first prompt about what a blank one means.
  const topUp = buildCompletionPrompt({
    sourceText: "notes",
    title: "",
    subject: "",
    instructions: "",
    difficulty: "mixed",
    questionType: "multiple_choice",
    requestedCount: 50,
    missingCount: 20,
    existingQuestions: []
  });

  check("the top-up prompt asks for the document's own name too", /- Title: The document's own name, as the material prints it/.test(topUp), true);
  check("the top-up prompt passes no literal generic title", /- Title: Generated Reviewer/.test(topUp), false);
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

// The standout-answer filter is the only thing standing between a give-away item and
// a learner, because nothing on screen tells them the shape gave it away. Two sets of
// fixtures decide how far it reaches: questions a reader picked out by hand as
// guessable, and the option sets of a real preliminary examination, which must not be
// swept up with them.
//
// The exam set is the constraint that matters. Every rule added here has to leave the
// paper clean, because the paper is what this generator is trying to imitate: sibling
// option sets that differ in one token, one option vocabulary rotated across items,
// stems that hand over a technical fingerprint, and items where the correct answer is
// legitimately the most detailed one all have to survive.
section("hand-picked give-aways are reported");
{
  const { getChoiceBalanceIssue } = await import(
    pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  // Each of these was answered correctly by reading the shape of the options rather
  // than the material. The reason recorded first is the one that gives it away.
  const GIVE_AWAYS = [
    {
      label: "the correct answer is the only choice built from the stem's own words",
      topic: "Customer Problem Fit",
      question: "What does 'Customer Problem Fit' measure in a startup's development journey?",
      choices: {
        A: "How well the startup's idea aligns with real customer needs and urgent challenges",
        B: "The technical speed of software code execution on mobile servers",
        C: "The exact amount of venture capital funding secured from investors",
        D: "The number of social media followers acquired during product launch"
      },
      correctAnswer: "A"
    },
    {
      label: "the correct answer restates the topic heading and is the only positive option",
      topic: "Macro Perspective",
      question: "A family retail business owner wants to protect the company against unexpected technological disruptions and changing consumer shopping habits. What approach should be applied?",
      choices: {
        A: "Focus exclusively on internal employee attendance records.",
        B: "Reduce spending on software tools and increase manual bookkeeping.",
        C: "Ignore online trends and rely solely on local foot traffic.",
        D: "Adopt a macro perspective to spot external threats and identify digital expansion opportunities."
      },
      correctAnswer: "D"
    },
    {
      label: "three distractors share one tone and the correct answer does not",
      topic: "Technopreneurship Characteristics",
      question: "Which of the following best describes the market reach of technopreneurship compared to traditional entrepreneurship?",
      choices: {
        A: "Strictly local or regional unless physical expansion occurs",
        B: "Limited exclusively to municipal town boundaries",
        C: "Restricted by physical inventory and store locations",
        D: "Global reach through online platforms and digital distribution"
      },
      correctAnswer: "D"
    },
    {
      label: "the correct answer and a distractor are the same option twice",
      topic: "Technopreneur Contributions",
      question: "What notable contribution was made by Ron Hose in the Philippine technopreneurship landscape?",
      choices: {
        A: "Pioneered mobile content and led an Initial Public Offering with Xurpas",
        B: "Popularized blockchain-based financial services and digital wallets through Coins.ph",
        C: "Innovated online journalism using data analytics through Rappler",
        D: "Expanded digital payments and financial inclusion through PayMaya"
      },
      correctAnswer: "B"
    },
    {
      label: "the correct answer is the only list",
      topic: "Customer Personas",
      question: "What information forms the foundation of a semi-fictional customer persona in technopreneurship?",
      choices: {
        A: "Demographics, psychographics, goals, pain points, jobs-to-be-done, and behavior patterns",
        B: "Randomly generated fictional names and arbitrary office addresses",
        C: "Server hardware specifications and cloud database schemas",
        D: "Corporate stock prices and quarterly dividend declarations"
      },
      correctAnswer: "A"
    },
    {
      // The reason is the absolute claim, not the length. Three of the four are real
      // listed benefits stated plainly, so nothing about the shape is unusual.
      label: "the correct answer is the only one claiming something absolute",
      topic: "Customer Segmentation Benefits",
      question: "Which among the following is NOT listed as a direct benefit of effective customer segmentation?",
      choices: {
        A: "Improved long-term profitability",
        B: "Lower marketing and operational costs",
        C: "Elimination of all startup financial risks",
        D: "Stronger product-market fit"
      },
      correctAnswer: "C"
    }
  ];

  GIVE_AWAYS.forEach((giveaway) => {
    const issue = getChoiceBalanceIssue(giveaway);
    check(giveaway.label, Boolean(issue), true);
    check(`  ... and says why (${giveaway.label})`, (issue?.reasons || []).length > 0, true);
  });

  // A question the detector must not report, so a rule cannot be loosened into
  // "flag anything that looks unusual". Four siblings of one vocabulary, one of which
  // the scenario names.
  const SEGMENTATION = {
    topic: "Customer Segmentation",
    question: "A startup divides its customers by age, income, and education level before running a survey. Which segmentation method is being used?",
    choices: {
      A: "Demographic segmentation",
      B: "Behavioral segmentation",
      C: "Geographic segmentation",
      D: "Psychographic segmentation"
    },
    correctAnswer: "A"
  };

  check("four siblings of one vocabulary are not reported", getChoiceBalanceIssue(SEGMENTATION), null);
}

section("the exam's own option sets are not reported as give-aways");
{
  const { getChoiceBalanceIssue } = await import(
    pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  // Option sets transcribed from the same 35-item preliminary examination the style
  // fixtures above come from. Four of these are longer or shorter than the rest on
  // purpose: they pin down that the length rules are unchanged, so a rule added here
  // can be told apart from the behaviour that was already there.
  const EXAM_OPTION_SETS = [
    ["sibling labels differing in one digit", "Wireless Standards",
      "This wireless standards guides prioritizing data, voice, and video transmissions, enabling QoS.",
      ["802.11e", "802.11g", "802.11n", "802.11d"], "A"],
    ["sibling labels of different lengths", "Wireless Standards",
      "It defines standards for a wireless personal area network (WPAN) and describes the specifications for wireless connectivity with fixed or portable devices.",
      ["802.12", "802.15", "802.11i", "802.15.4"], "B"],
    ["sibling tools sharing a suffix", "Attacking Tools",
      "This tool creates a virtual tunnel interface to monitor encrypted traffic and inject arbitrary traffic into a network.",
      ["Airtun-ng", "Aircrack-ng", "Easside-ng", "Packetforge-ng"], "A"],
    ["sibling risk categories", "Mobile Risk Categories",
      "This mobile risk category covers the misuse of a platform feature or the failure to use platform security controls.",
      ["Client Code Quality", "Improper Platform Usage", "Extraneous Functionality", "Insufficient Cryptography"], "B"],
    ["sibling categories where the stem names a code's subject", "Mobile Security Risks",
      "Joan, a software developer, unintentionally included a password as a comment in a hybrid mobile application that was developed for internal purposes and not expected to be released into a production environment. Which of the following mobile security risks is demonstrated?",
      ["M8 - Code Tampering", "M9 - Reverse Engineering", "M4 - Insecure Authentication", "M10 - Extraneous Functionality"], "C"],
    ["a stem that hands over a technical fingerprint", "Wireless Protocols",
      "Ashley, a security professional, analyzed the authentication and wireless encryption techniques implemented in her organization to support its BYOD policy. While doing so, she noticed that certain techniques were outdated. In this regard, she implemented a Wi-Fi security protocol using GCMP-256 for encryption and HMAC-SHA-384 for authentication. Which of the following protocols is employed?",
      ["WEP", "LEAP", "WPA3", "CCMP"], "C"],
    ["sibling attacks sharing a word", "Attacking Tools",
      "Jack, a professional hacker, has performed an attack on Bluetooth paired devices. He leveraged a vulnerability in Bluetooth and breached the security mechanisms to eavesdrop on all the data being shared. Which of the following attacks did Jack perform?",
      ["BlueSniff", "BluePrinting", "KNOB Attack", "MAC Spoofing Attack"], "A"],
    ["two constraints, one option that meets both", "Bluetooth Hardening",
      "A user wants the device hidden from discovery scans but still connectable by paired devices. What should the user do next with the Bluetooth device?",
      ["Enable non-discoverable mode", "Block all requests for pairing", "Set the device to limited discoverable", "Disable all the connected Bluetooth devices"], "C"],
    ["sibling attacks, one of which is a joke", "Phishing Defence",
      "A user receives a text message claiming to be from their bank, containing a link that steals login credentials when clicked. Which of the following actions BEST prevents this?",
      ["Block all incoming network traffic", "Ignore links from unknown senders", "Update the browser cache manually", "Change the phone's wallpaper to reset the link"], "B"],
    ["real practices, one of which is the answer", "Mobile Data Protection",
      "Which of the following guidelines helps users identify and protect sensitive data on their mobile devices?",
      ["Maintain configuration control and management", "Do not install applications from trusted application stores", "Securely keep the data when disposing of the device", "Load too many applications, and avoid auto-upload of photos to social networks"], "C"],
    ["sibling answers where the correct one names the standard's parts", "Wireless Protocols",
      "A company handling classified data wants to prevent brute-force attacks and ensure stronger encryption against its Wi-Fi network. Which protocol should be implemented?",
      ["WPA with TKIP", "WPA2 using AES", "WEP with 128-bit keys", "WPA3 using GCMP-256 and HMAC-SHA-384"], "D"],
    ["sibling attacks, none of them a joke", "Attacking Tools",
      "In which of the following attacks does an attacker create a soft AP, typically on a laptop, by running a tool that makes the laptop's NIC appear as a legitimate AP?",
      ["Rogue AP Attack", "AP MAC Spoofing", "Unauthorized Association", "Ad-hoc Connection Attack"], "A"],
    // These three are what the length rules used to get wrong. The correct answer is
    // the longest in each of them, but the option right behind it is nearly as long,
    // so a reader comparing lengths sees nothing unusual. Measuring against the middle
    // of the set instead of the runner-up flagged all three and would have sent them
    // to the repair pass, which is the expensive kind of wrong: it rewrites a good
    // question and reports a fix.
    ["the longest choice with the runner-up right behind it", "Wireless Hardening",
      "Which of the following practices can make mobile devices vulnerable to online attacks?",
      ["Maintain configuration control and management", "Always share the information within GPS-enabled apps", "Disable wireless access, such as Wi-Fi and Bluetooth, if not in use", "Never connect two separate networks, such as Wi-Fi and Bluetooth, simultaneously"], "C"],
    ["the longest choice one word clear of the runner-up", "Password Handling",
      "Employees store company passwords in plain-text notes on their smartphones. Which guideline should the organization enforce?",
      ["Set custom enforcement", "Use SMS instead of encrypted messaging", "Keep sensitive data off shared or personal mobile devices", "Store credentials in browser history for quick access"], "C"],
    // Two of the three options above are real settings changes a learner might make,
    // so nothing here is absurd and nothing is absolute. A stem that names both
    // alternatives cannot be solved by tone, only by reading it.
    ["defensible wrong options with no absolute and no joke", "Mobile Data Protection",
      "Which of the following guidelines helps users identify and protect sensitive data on their mobile devices?",
      ["Maintain configuration control and management", "Do not install applications from trusted application stores", "Securely keep the data when disposing of the device", "Load too many applications, and avoid auto-upload of photos to social networks"], "C"],
    ["sibling practices, one of them the answer", "Wireless Hardening",
      "Which of the following practices should be followed while configuring a wireless network to defend against potential wireless attacks?",
      ["Enable SSID broadcasts", "Enable MAC address filtering on AP's or routers", "Keep the default ID as it is after WLAN configuration", "Enable remote router login and wireless administration"], "B"],
    // "Non-pairable Mode" against "Non-discoverable Mode" and "Limited Discoverable
    // Mode". Splitting a compound on its hyphen puts the bare negation in front of both,
    // so the two options share "non" and "mode" and the item reads as having two
    // answers. Grammatical prefixes are not topical content, which is the same reason
    // the digits in 802.11e are not.
    ["sibling modes whose names share a negation prefix", "Bluetooth Hardening",
      "This Bluetooth mode rejects connection requests sent by any device in the vicinity.",
      ["Discoverable", "Non-pairable Mode", "Non-discoverable Mode", "Limited Discoverable Mode"], "B"]
  ];

  EXAM_OPTION_SETS.forEach(([label, topic, question, choices, correctAnswer]) => {
    check(label, getChoiceBalanceIssue({ topic, question, choices: { A: choices[0], B: choices[1], C: choices[2], D: choices[3] }, correctAnswer }), null);
  });

  // Two items the paper does get wrong, kept here so a future change cannot quietly
  // make them pass by loosening a threshold. Each has a correct answer that is a clear
  // length outlier against the other three, which is exactly the pick a test-wise
  // learner makes, so reporting them is the intended answer rather than an accident.
  // The repair pass would shorten or lengthen them, which is an improvement to the
  // paper rather than damage to it.
  const SHAPE_OUTLIERS = [
    ["the correct answer is the shortest of four long options", "Wireless Hardening",
      "Which of the following practices should be followed while configuring a wireless network to defend against potential wireless network attacks?",
      ["Disable SSID broadcasts", "Enable unused ports to prevent attacks on APs", "Disable MAC ports to prevent attacks on APs or routers", "Enable remote router login and wireless administration"], "A"],
    ["the correct answer is the longest of four short options", "Mobile Data Protection",
      "A finance app stores session tokens locally in plain text. A stolen phone reveals tokens and allows account takeover. Which of the following offers the BEST resolution?",
      ["Use longer usernames", "Disable push notifications", "Increase screen brightness and lock timeout", "Store sensitive data encrypted and minimize local storage of secrets"], "D"]
  ];

  SHAPE_OUTLIERS.forEach(([label, topic, question, choices, correctAnswer]) => {
    check(label, getChoiceBalanceIssue({ topic, question, choices: { A: choices[0], B: choices[1], C: choices[2], D: choices[3] }, correctAnswer })?.kinds.length > 0, true);
  });
}

section("the wording rules match every inflection of the word they name");
{
  const { getChoiceBalanceIssue } = await import(
    pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  // The tone and absolute rules name base words, so each of these has to be caught by
  // the ending it actually appears with. "exclusively" went missing from the list once
  // already, and nothing reported it: the detector simply stopped seeing that fault on
  // every item where it was the only one present.
  const tone = (distractors) => getChoiceBalanceIssue({
    topic: "Wireless Hardening",
    question: "Which of the following practices should be followed while configuring a wireless network?",
    choices: { A: "Enable scheduled firmware reviews", B: distractors[0], C: distractors[1], D: distractors[2] },
    correctAnswer: "A"
  })?.kinds.includes("polarity") === true;

  const neutrals = ["Ignore online trends", "Reduce spending on software tools", "Focus exclusively on internal records"];

  check("a base form is caught", tone(["Strictly local operations", "Limited to one site", "Restricted by inventory levels"]), true);
  check("an adverb is caught", tone(["Strictly local operations", "Solely a local footprint", "Exclusively within one region"]), true);
  check("a past participle is caught", tone(["Limited to one site", "Restricted by inventory levels", "Narrowed to a single office"]), true);
  check("a gerund is caught", tone(["Ignoring every online channel", "Reducing all software spend", "Overlooking cloud adoption"]), true);
  check("a negation is caught", tone(["Never connected to a supplier", "Never advertising online", "Never running a test order"]), true);

  // The negative has to be on the three distractors, not on the answer, or the rule
  // would fire on every item whose answer happens to be phrased carefully.
  check("a carefully worded answer is not reported",
    getChoiceBalanceIssue({
      topic: "Wireless Hardening",
      question: "Which of the following practices should be followed while configuring a wireless network?",
      choices: { A: "Never connect to an unverified network", B: "Strictly local operations", C: "Solely a local footprint", D: "Exclusively within one region" },
      correctAnswer: "A"
    })?.kinds.includes("polarity"),
    false);

  // The absolute rule has the same obligation. Q48 was previously reported for its
  // length, which was a coincidence of wording and stopped applying the moment the
  // length rule was corrected.
  const absolute = (choice, distractors) => getChoiceBalanceIssue({
    topic: "Customer Segmentation Benefits",
    question: "Which among the following is NOT listed as a direct benefit of effective customer segmentation?",
    choices: { A: distractors[0], B: distractors[1], C: choice, D: distractors[2] },
    correctAnswer: "C"
  })?.kinds.includes("absolutist") === true;

  const realBenefits = ["Improved long-term profitability", "Lower marketing and operational costs", "Stronger product-market fit"];

  check("an absolute noun is caught", absolute("Elimination of all startup financial risks", realBenefits), true);
  check("an absolute verb form is caught", absolute("Guarantees a return on every campaign", realBenefits), true);
  check("an absolute adverb is caught", absolute("Completely removes operational risk", realBenefits), true);
  check("a plainly overstated option is caught", absolute("Every segment converts at the same rate", realBenefits), true);

  // One absolute among four is a signal only when the others are plain. If a
  // distractor also claims something absolute, none of them stands out on this.
  check("an absolute shared with a distractor is not reported",
    absolute("Elimination of all startup financial risks", ["Improved profitability on every account", "Lower costs", "Stronger product-market fit"]),
    false);
}

section("the length rules compare against the runner-up, not the middle");
{
  const { getChoiceBalanceIssue } = await import(
    pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const shape = (choices, correctAnswer) => getChoiceBalanceIssue({
    topic: "Wireless Hardening",
    question: "Which of the following practices should be followed while configuring a wireless network?",
    choices,
    correctAnswer
  });

  const kinds = (issue) => (issue?.kinds || []);

  // Twelve words against eleven and seven is an outlier on the median and not an
  // outlier to a reader. This is the case a ratio or a median gets wrong.
  check("a runner-up one word behind is not a length give-away",
    kinds(shape({
      A: "Disable wireless access, such as Wi-Fi and Bluetooth, if not in use",
      B: "Never connect two separate networks, such as Wi-Fi and Bluetooth, simultaneously",
      C: "Maintain configuration control and management",
      D: "Always share the information within GPS-enabled apps"
    }, "A")),
    []);

  // Four words clear of the runner-up is not wording variance, which is what the old
  // gap of three against the median was unable to tell apart from the case above. The
  // distractors are deliberately neutral, so this checks the length rule alone and
  // cannot pass or fail because a wording rule also fires.
  check("a runner-up four words behind is a length give-away",
    kinds(shape({
      A: "Rotate credentials on a fixed schedule and audit each account that holds production access",
      B: "Upgrade the firmware on the building controllers",
      C: "Record the serial number of each handset",
      D: "Publish the quarterly support schedule"
    }, "A")),
    ["overlong"]);

  // The same test in the other direction: a correct answer that is the short one is a
  // tell for the same reason a long one is.
  check("a correct answer that is the short one is reported",
    kinds(shape({
      A: "Disable SSID broadcasts",
      B: "Enable unused ports to prevent attacks on AP's or routers",
      C: "Disable MAC ports to prevent attacks on AP's or routers and on the access points themselves",
      D: "Enable remote router login and wireless administration of every device on the network"
    }, "A")),
    ["overshort"]);

  // Ties are the sibling-label case and must never be reported, which is what makes a
  // set of part numbers safe.
  check("a set of equal-length siblings is not reported",
    kinds(shape({ A: "802.11e", B: "802.11g", C: "802.11n", D: "802.11d" }, "A")),
    []);

  check("a correct answer tied with a distractor is not reported",
    kinds(shape({ A: "802.12", B: "802.15", C: "802.11i", D: "802.15.4" }, "B")),
    []);
}

section("the repair pass is handed the worst items first");
{
  const { getChoiceBalanceIssue, findChoiceBalanceIssues } = await import(
    pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  // An item with two defensible answers costs a learner more than one that merely
  // looks long, because there is nothing on screen to warn them, so it has to win the
  // place when the pass can only take a fixed number of items.
  const long = {
    id: 1,
    topic: "Security Controls",
    question: "Which control should the team put in place first?",
    choices: {
      A: "Rotate credentials on a fixed schedule and audit each account that holds production access",
      B: "Patch the operating system",
      C: "Enable multi-factor authentication",
      D: "Restrict access to the backup console"
    },
    correctAnswer: "A"
  };

  const ambiguous = {
    id: 2,
    topic: "Technopreneur Contributions",
    question: "What notable contribution was made by Ron Hose in the Philippine technopreneurship landscape?",
    choices: {
      A: "Pioneered mobile content and led an Initial Public Offering with Xurpas",
      B: "Popularized blockchain-based financial services and digital wallets through Coins.ph",
      C: "Innovated online journalism using data analytics through Rappler",
      D: "Expanded digital payments and financial inclusion through PayMaya"
    },
    correctAnswer: "B"
  };

  check("the long item is a give-away", getChoiceBalanceIssue(long)?.kinds, ["overlong"]);
  check("the ambiguous item is a give-away", getChoiceBalanceIssue(ambiguous)?.kinds, ["near-duplicate"]);
  check("the ambiguous item ranks above the long one",
    getChoiceBalanceIssue(ambiguous).severity > getChoiceBalanceIssue(long).severity, true);
  check("issues come back worst first",
    findChoiceBalanceIssues([long, ambiguous]).map((issue) => issue.id),
    [2, 1]);
  check("a clean reviewer has no issues to repair",
    findChoiceBalanceIssues([
      { ...long, choices: { A: "Demographic segmentation", B: "Behavioral segmentation", C: "Geographic segmentation", D: "Psychographic segmentation" } },
      ambiguous
    ]).map((issue) => issue.id),
    [2]);
  check("a missing reviewer has no issues to repair", findChoiceBalanceIssues(undefined), []);
}

section("the repair work order names the faults it was given");
{
  const { getChoiceBalanceIssue, findChoiceBalanceIssues } = await import(
    pathToFileURL(new URL("../src/utils/quizUtils.js", import.meta.url).pathname.replace(/^\//, "")).href
  );
  const { buildChoiceRepairPrompt, getChoiceBalanceWarning } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const question = (id, topic, stem, choices, correctAnswer) => ({
    id, topic, question: stem,
    choices: { A: choices[0], B: choices[1], C: choices[2], D: choices[3] },
    correctAnswer
  });

  const issues = findChoiceBalanceIssues([
    question(1, "Macro Perspective", "A retail owner wants to guard against disruption. What should be applied?",
      ["Focus exclusively on internal employee attendance records", "Reduce spending on software tools and increase manual bookkeeping", "Ignore online trends and rely solely on local foot traffic", "Adopt a macro perspective to spot external threats and identify digital expansion opportunities"], "D"),
    question(2, "Technopreneur Contributions", "What notable contribution was made by Ron Hose in the Philippine technopreneurship landscape?",
      ["Pioneered mobile content and led an Initial Public Offering with Xurpas", "Popularized blockchain-based financial services and digital wallets through Coins.ph", "Innovated online journalism using data analytics through Rappler", "Expanded digital payments and financial inclusion through PayMaya"], "B"),
    question(3, "Customer Personas", "What information forms the foundation of a semi-fictional customer persona in technopreneurship?",
      ["Demographics, psychographics, goals, pain points, jobs-to-be-done, and behavior patterns", "Randomly generated fictional names and arbitrary office addresses", "Server hardware specifications and cloud database schemas", "Corporate stock prices and quarterly dividend declarations"], "A")
  ]);

  check("three of the three are reported", issues.length, 3);

  const workOrder = buildChoiceRepairPrompt(issues, "");

  // The work order states the measured reason per item. It used to open with a single
  // sentence about the correct choice being "visibly longer", which was simply false
  // for every item where the tone or the ambiguity was the actual fault.
  check("each item carries its own reason", issues.every((issue) => workOrder.includes(issue.reasons[0])), true);
  check("the work order names the item's topic heading", workOrder.includes('The topic heading shown above this question is "Macro Perspective"'), true);

  // One bullet per family of fault present, and none for a fault that is not there.
  check("the length fault is described", workOrder.includes("visibly different shape"), true);
  check("the tone fault is described", workOrder.includes("three distractors negative"), true);
  check("the ambiguity fault is described", workOrder.includes("two possible answers"), true);
  check("a fault that was not found is not described", workOrder.includes("claiming something absolute"), false);
  check("it asks for exactly the items it listed", workOrder.includes("return exactly the 3 question(s) listed above"), true);

  // A single-fault reviewer gets a single bullet rather than a list of the others, so
  // the model is not sent looking for problems that are not there.
  const oneFault = buildChoiceRepairPrompt([getChoiceBalanceIssue(question(
    9, "Customer Personas", "What information forms the foundation of a semi-fictional customer persona in technopreneurship?",
    ["Demographics, psychographics, goals, pain points, jobs-to-be-done, and behavior patterns", "Randomly generated fictional names and arbitrary office addresses", "Server hardware specifications and cloud database schemas", "Corporate stock prices and quarterly dividend declarations"], "A"
  ))], "");

  check("a single-fault work order describes only that fault", oneFault.includes("visibly different shape"), true);
  check("a single-fault work order omits the others", oneFault.includes("two possible answers"), false);

  // The learner is told about whatever survived the pass, in words that fit every rule
  // rather than only the length one it used to name.
  check("nothing left to report says nothing", getChoiceBalanceWarning(3, 0), null);
  check("what survived is reported without a repair count", getChoiceBalanceWarning(0, 1), "1 question still has an answer you could guess just by looking at the choices, without knowing the material. You can make a new set or edit them under Edit Questions.");
  check("what survived is reported with a repair count", getChoiceBalanceWarning(2, 3), "We fixed 2 of them, but 3 questions still have an answer you could guess just by looking at the choices, without knowing the material. You can make a new set or edit them under Edit Questions.");
}

section("attachments are pooled, trimmed, and capped");
{
  const { normalizeAttachments } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  // A paper that runs to three pages arrives as three photos. Pooling rather than
  // preferring one field means a caller cannot lose an attachment by sending both.
  check("both fields are pooled, not one preferred",
    normalizeAttachments({
      file: { name: "a.png", mimeType: "image/png", data: "AAA" },
      files: [{ name: "b.pdf", mimeType: "application/pdf", data: "BBB" }]
    }).map((attachment) => attachment.name),
    ["b.pdf", "a.png"]);

  check("the singular field alone still works",
    normalizeAttachments({ file: { name: "legacy.pdf", mimeType: "application/pdf", data: "L" } }).length, 1);

  check("an attachment with no data is dropped",
    normalizeAttachments({ files: [{ name: "empty.png", mimeType: "image/png" }, { name: "ok.png", mimeType: "image/png", data: "A" }] }).length, 1);

  check("a stray field name is trimmed away",
    normalizeAttachments({ files: [{ name: "  spaced.png  ", mimeType: "image/png", data: "A" }] })[0].name, "spaced.png");

  check("seven attachments are capped at six",
    normalizeAttachments({
      files: Array.from({ length: 7 }, (_, index) => ({ name: `${index}.png`, mimeType: "image/png", data: `D${index}` }))
    }).length, 6);

  check("nothing attached yields nothing", normalizeAttachments({}), []);
  check("an empty array yields nothing", normalizeAttachments({ files: [] }), []);
}

section("the exam import prompt says the two answer sources apart");
{
  const { buildExamImportPrompt } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const base = { sourceText: "", title: "", subject: "", instructions: "" };
  const solve = buildExamImportPrompt({ ...base, answerSource: "solve" });
  const extract = buildExamImportPrompt({ ...base, answerSource: "extract" });

  // Transcription is the whole job. Every one of these protects the learner's
  // correspondence with the printed page, and none of them is negotiable.
  check("both forbid shuffling the choices", solve.includes("Never shuffle the choices") && extract.includes("Never shuffle the choices"), true);
  check("both forbid inventing an item", solve.includes("never create an item the paper does not contain") && extract.includes("never create an item the paper does not contain"), true);
  check("both forbid paraphrasing a stem", solve.includes("Do not rewrite, tidy, reword") && extract.includes("Do not rewrite, tidy, reword"), true);
  check("both ask for the printed number", solve.includes("sourceNumber") && extract.includes("sourceNumber"), true);
  check("both forbid page furniture becoming an item", solve.includes("page furniture") && extract.includes("page furniture"), true);

  // The two sources differ by consequence, not by wording, so each has to forbid the
  // other's behaviour explicitly.
  check("solve says to work the answers out", solve.includes("WORK THEM OUT"), true);
  check("solve does not include the key-only section", solve.includes("USE THE PAPER'S OWN KEY"), false);
  check("solve credits an answer read off the paper", solve.includes('answerSource to "paper" when you read the answer off the paper'), true);
  check("extract says to use the printed key", extract.includes("USE THE PAPER'S OWN KEY"), true);
  check("extract does not include the solve section", extract.includes("WORK THEM OUT"), false);
  check("extract refuses to use outside knowledge", extract.includes("do not use outside knowledge"), true);
  check("extract leaves an unanswered item empty rather than filled in", extract.includes('leave its correctAnswer and answerText as empty strings'), true);
  check("extract refuses to shift the key after a skipped item", extract.includes("Do not shift the whole key by one"), true);

  // A paper handed back with the answers ringed on it is one of the commonest real
  // inputs there is, and this prompt once talked the model out of reading one. It
  // predicted the give-up case, described its output, and called an empty answer the
  // correct response, so a model that was only mildly unsure about a thin red curve
  // took the exit. All three are locked out here.
  check("extract does not predict giving up on the whole paper", extract.includes("every item is unresolved"), false);
  check("extract does not call an empty answer the correct response", extract.includes("empty field is the correct answer"), false);
  check("extract says a marked-up paper is a key", extract.includes("A marked-up paper IS a key"), true);
  check("extract defaults to assuming the paper is marked", extract.includes("Assume the paper is marked unless an item plainly shows no mark"), true);
  check("extract describes a ring drawn around a letter", extract.includes("ring, circle or oval drawn around, enclosing, or drawn next to the LETTER"), true);
  check("extract warns the ring is thin and crosses the text", extract.includes("thin, uneven, and often crosses the letter or the text beside it"), true);
  check("extract says to read which letter the ring encloses", extract.includes("Read which letter it encloses"), true);
  check("extract says to transcribe the mark, not its own judgement", extract.includes("transcribe the mark, not your own judgement"), true);
  check("extract says faintness is not grounds to skip an item", extract.includes("is NOT a reason to mark an item unresolved"), true);
  check("extract scopes unresolved to a plainly absent mark", extract.includes('ONLY for an item that plainly carries no mark'), true);
  check("extract still forbids filling in a letter", extract.includes("Never pick a letter to fill the shape of the JSON"), true);

  check("an unrecognised answer source falls back to solving", buildExamImportPrompt({ ...base, answerSource: "nonsense" }).includes("WORK THEM OUT"), true);
  check("the uploaded files are named", buildExamImportPrompt({ ...base, answerSource: "solve", attachmentNames: "page1.png, page2.png" }).includes("page1.png, page2.png"), true);
  check("no attachments still reads as a paper", buildExamImportPrompt({ ...base, answerSource: "solve" }).includes("[The paper was uploaded as a file"), true);
  check("pasted text is passed through", buildExamImportPrompt({ ...base, answerSource: "solve", sourceText: "1. Which is NOT a threat?" }).includes("1. Which is NOT a threat?"), true);
}

section("an imported item keeps the paper's numbering and where its answer came from");
{
  const { normalizeImportedExamReviewer, splitImportedExamQuestions, getExamAnswerKeyStats } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const raw = {
    title: "IT2511 - Information Technology 2",
    subject: "Information Technology",
    questionType: "multiple_choice",
    coverage: ["Wireless Security"],
    questions: [
      { sourceNumber: 1, topic: "Wireless Security", question: "Which standard secures a wireless network?", choices: { A: "WEP", B: "WPA3", C: "WPA", D: "WEP2" }, correctAnswer: "B", answerText: "WPA3", explanation: "WPA3 is the current standard.", answerSource: "solved" },
      { sourceNumber: 2, topic: "Wireless Security", question: "Which tool captures handshake traffic?", choices: { A: "Aircrack-ng", B: "Wireshark", C: "Nmap", D: "Metasploit" }, correctAnswer: "A", answerText: "Aircrack-ng", explanation: "It captures and cracks handshakes.", answerSource: "paper" },
      { sourceNumber: 3, topic: "Wireless Security", question: "Which attack replays a captured handshake?", choices: { A: "Krone", B: "Deauth", C: "Smurf", D: "Sybil" }, correctAnswer: "", answerText: "", explanation: "The bottom of the page is cut off.", answerSource: "unresolved" }
    ]
  };

  const imported = normalizeImportedExamReviewer(raw, { answerSource: "solve" });

  check("the paper's numbering is kept", imported.questions.map((question) => question.sourceNumber), [1, 2, 3]);
  check("provenance survives normalisation", imported.questions.map((question) => question.answerSource), ["solved", "paper", "unresolved"]);
  check("the question type comes from the paper", imported.questionType, "multiple_choice");
  check("choices are reported per question", imported.choicesPerQuestion, 4);
  check("questionCount matches", imported.questionCount, 3);
  check("ids are sequential from one", imported.questions.map((question) => question.id), [1, 2, 3]);

  // The whole point of the unresolved marker. An empty field is deliberately left
  // empty rather than coerced to "A", which is what the generation path would do.
  const unresolved = imported.questions[2];
  check("an unresolved item keeps an empty correctAnswer", unresolved.correctAnswer, "");
  check("an unresolved item keeps an empty answerText", unresolved.answerText, "");
  check("an unresolved item keeps its choices for review", unresolved.choices.A, "Krone");

  const { ready, unresolved: dropped } = splitImportedExamQuestions(imported.questions);
  check("only the unresolved item is split out", dropped.map((question) => question.sourceNumber), [3]);
  check("the answerable items are kept in order", ready.map((question) => question.sourceNumber), [1, 2]);
  check("provenance is counted for what was kept", getExamAnswerKeyStats(ready), { fromPaper: 1, solved: 1, total: 2 });
}

section("an imported item is never given a provenance it did not claim");
{
  const { normalizeImportedAnswerSource, normalizeExamAnswerSource } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  check("solve is the fallback request", normalizeExamAnswerSource(undefined), "solve");
  check("an unknown request falls back to solve", normalizeExamAnswerSource("generate_answers"), "solve");
  check("extract is kept", normalizeExamAnswerSource("extract"), "extract");

  // Scoped to the request, not just to the vocabulary. Under extract the only claim
  // worth believing is that the paper printed the answer, so anything else is an item
  // the mode cannot honestly fill in.
  check("an omitted source under extract is unresolved, not paper",
    normalizeImportedAnswerSource(undefined, "extract"), "unresolved");
  check("a solved claim under extract is unresolved", normalizeImportedAnswerSource("solved", "extract"), "unresolved");
  check("an unknown claim under extract is unresolved", normalizeImportedAnswerSource("inferred", "extract"), "unresolved");
  check("a paper claim under extract is kept", normalizeImportedAnswerSource("paper", "extract"), "paper");

  check("an omitted source under solve is solved", normalizeImportedAnswerSource(undefined, "solve"), "solved");
  check("an unknown source under solve is solved", normalizeImportedAnswerSource("inferred", "solve"), "solved");
  check("a stated source under solve is kept as stated", normalizeImportedAnswerSource("paper", "solve"), "paper");
  check("a solved claim under solve is kept", normalizeImportedAnswerSource("solved", "solve"), "solved");
  check("an unresolved claim stays unresolved under solve", normalizeImportedAnswerSource("unresolved", "solve"), "unresolved");
  check("an unresolved claim stays unresolved under extract", normalizeImportedAnswerSource("unresolved", "extract"), "unresolved");
  check("a stated source is case and space insensitive", normalizeImportedAnswerSource("  PAPER ", "solve"), "paper");
}

section("a true/false paper keeps its own choices");
{
  const { normalizeImportedExamReviewer } = await import(
    pathToFileURL(new URL("../api/generate-reviewer.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const imported = normalizeImportedExamReviewer({
    questionType: "true_false",
    questions: [
      { sourceNumber: 1, question: "The sky appears blue.", choices: { A: "True", B: "False" }, correctAnswer: "A", answerText: "True", explanation: "Shorter wavelengths scatter more.", answerSource: "paper" }
    ]
  });

  check("the paper's type is adopted", imported.questionType, "true_false");
  check("choices per question follows the type", imported.choicesPerQuestion, 2);
  check("A and B are filled in", [imported.questions[0].choices.A, imported.questions[0].choices.B], ["True", "False"]);
  check("C and D stay empty", [imported.questions[0].choices.C, imported.questions[0].choices.D], ["", ""]);
  check("the answer text matches the marked choice", imported.questions[0].answerText, "True");
}

section("a person's initials come from their first and last real name");
{
  const { getProfileInitials, getProfileName, getProfileAvatarUrl } = await import(
    pathToFileURL(new URL("../src/utils/userProfile.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  check("first and last", getProfileInitials("Alex Pacaldo"), "AP");
  check("a middle name is skipped", getProfileInitials("Sophia Gail Santos"), "SS");
  check("a compound surname uses the last real name", getProfileInitials("Maria Dela Cruz Santos"), "MS");
  check("a one word name gives its first two letters", getProfileInitials("Cher"), "CH");

  // A suffix is not a surname, and taking the last word gave "MJ" for Maria Cristina
  // Dela Cruz Santos Jr, which is both wrong and unflattering on someone's row.
  check("a suffix is not the last name", getProfileInitials("Maria Cristina Dela Cruz Santos Jr"), "MS");
  check("Sr is peeled the same way", getProfileInitials("Alex Pacaldo Sr"), "AP");
  check("a roman numeral suffix is peeled", getProfileInitials("Juan Dela Cruz III"), "JC");
  check("only the trailing suffix is peeled", getProfileInitials("Jr Alexander Santos"), "JS");
  check("a suffix is never stripped from a single name", getProfileInitials("Prince"), "PR");

  check("trailing punctuation is ignored", getProfileInitials("Alex Pacaldo,"), "AP");
  check("surrounding whitespace is ignored", getProfileInitials("  Alex   Pacaldo  "), "AP");
  check("case does not matter", getProfileInitials("ALEX PACALDO"), "AP");
  check("an empty name gives nothing to draw", getProfileInitials("   "), "");
  check("a one letter name still draws", getProfileInitials("X"), "X");

  // A hidden profile, which is what RLS returns when the row is not readable.
  check("a missing profile is called a Hachi user", getProfileName(null), "Hachi user");
  check("a blank name is called a Hachi user", getProfileName({ display_name: "   " }), "Hachi user");
  // Initials are not invented from the placeholder. A row RLS has hidden has no name
  // we may show, and "HU" would imply an identity we do not have.
  check("a missing profile draws a person icon", getProfileInitials(null), "");
  check("a blank name draws a person icon", getProfileInitials({ display_name: "  " }), "");
  check("a hidden row does not borrow the placeholder's initials", getProfileInitials({}), "");
  check("a missing avatar url is an empty string", getProfileAvatarUrl(null), "");
  check("a padded avatar url is trimmed", getProfileAvatarUrl({ avatar_url: "  https://x/y.png " }), "https://x/y.png");
  check("a profile object works as well as a string", getProfileInitials({ display_name: "Alex Pacaldo" }), "AP");
}

section("suggestions only come from relationships the reader already has");
{
  const { collectSuggestionCandidates, toSuggestions } = await import(
    pathToFileURL(new URL("../src/services/social.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const ME = "me";
  const GROUPS = [{ id: "g1", name: "BSCS 4-101" }, { id: "g2", name: "IT Club" }];
  const MEMBERS = [
    { group_id: "g1", user_id: "me" },
    { group_id: "g1", user_id: "classmate" },
    { group_id: "g2", user_id: "classmate" },
    { group_id: "g2", user_id: "clubmate" }
  ];
  const SHARES = [
    { owner_id: "me", recipient_id: "classmate", title: "Anatomy Prelim" },
    { owner_id: "sharer", recipient_id: "me", title: "Calculus Quiz" }
  ];
  const PROFILES = [
    { id: "classmate", display_name: "Lorak Tabio", avatar_url: "https://x/l.png" },
    { id: "clubmate", display_name: "Sophia Gail Santos", avatar_url: null },
    { id: "sharer", display_name: "Maria Santos Jr", avatar_url: null }
  ];

  const candidates = collectSuggestionCandidates({ userId: ME, groups: GROUPS, coMembers: MEMBERS, shares: SHARES });
  const suggestions = toSuggestions(candidates, PROFILES, 6);

  // The whole point of the feature. A suggestion panel that could name anybody with an
  // account is the account directory, which is the leak the profiles policy exists to
  // prevent, so there is no "list everyone" path to test and only these sources exist.
  check("only permitted relationships produce a candidate", [...candidates.keys()], ["classmate", "clubmate", "sharer"]);
  check("you are never suggested to yourself", candidates.has(ME), false);
  check("a shared group is the reason given", candidates.get("classmate"), { reason: "group", detail: "BSCS 4-101" });
  check("a group outranks a reviewer share for the same person", candidates.get("classmate").reason, "group");
  check("a second shared group does not add a second reason", candidates.size, 3);
  check("a reviewer share is the reason when there is no group", candidates.get("sharer"), { reason: "reviewer", detail: "Calculus Quiz" });
  check("a share you sent is the same signal as one you received", [...candidates.keys()].includes("classmate"), true);

  check("the suggestion order follows the candidates", suggestions.map((item) => item.id), ["classmate", "clubmate", "sharer"]);
  check("the profile supplies the name and picture", suggestions[0].display_name, "Lorak Tabio");
  check("a missing picture is carried through as null", suggestions[1].avatar_url, null);
  check("the reason survives into the rendered card", suggestions[2].reason, "reviewer");

  // Someone already in the caller's relationships must not be offered back.
  const excluded = collectSuggestionCandidates({
    userId: ME,
    groups: GROUPS,
    coMembers: MEMBERS,
    shares: SHARES,
    excludeIds: ["classmate"]
  });
  check("an excluded id is never suggested", excluded.has("classmate"), false);
  check("excluding one leaves the others", [...excluded.keys()], ["clubmate", "sharer"]);

  // The policy can still withhold a profile row, so a candidate without one has to
  // disappear rather than render as a nameless card.
  const partial = toSuggestions(candidates, [PROFILES[0]], 6);
  check("a candidate the policy withheld is dropped", partial.map((item) => item.id), ["classmate"]);

  // An unnamed group cannot explain anybody, so it explains nobody.
  const unnamed = collectSuggestionCandidates({
    userId: ME,
    groups: [{ id: "g1", name: "   " }],
    coMembers: MEMBERS,
    shares: []
  });
  check("an unnamed group suggests nobody", unnamed.size, 0);

  check("the cap is applied to rendered rows", toSuggestions(candidates, PROFILES, 2).length, 2);
  check("a cap larger than the list is harmless", toSuggestions(candidates, PROFILES, 50).length, 3);
  check("no groups and no shares suggests nobody", collectSuggestionCandidates({ userId: ME }).size, 0);
  check("a share with no title still suggests the person", collectSuggestionCandidates({
    userId: ME,
    shares: [{ owner_id: "peer", recipient_id: ME, title: null }]
  }).get("peer"), { reason: "reviewer", detail: "" });
}

section("friends of friends, as a suggestion, stays inside the policy");
{
  const { collectSuggestionCandidates, toSuggestions } = await import(
    pathToFileURL(new URL("../src/services/social.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const ME = "me";
  const FOF = [
    { id: "two-mutual", display_name: "Rizal Bonaparte", avatar_url: null, mutual_count: 2 },
    { id: "one-mutual", display_name: "Delos Santos", avatar_url: "https://x/d.png", mutual_count: 1 }
  ];
  const PROFILES = FOF.map((row) => ({ id: row.id, display_name: row.display_name, avatar_url: row.avatar_url }));

  const candidates = collectSuggestionCandidates({ userId: ME, friendsOfFriends: FOF });
  const suggestions = toSuggestions(candidates, PROFILES, 6);

  check("a mutual friend is a candidate", [...candidates.keys()], ["two-mutual", "one-mutual"]);
  check("the reason is a count, not a name", candidates.get("two-mutual"), { reason: "mutual", detail: 2 });
  check("the count reaches the card", suggestions[0].detail, 2);
  check("a single mutual friend counts", candidates.get("one-mutual").detail, 1);
  check("no name is carried on a mutual reason", typeof candidates.get("two-mutual").detail, "number");

  // A person with no mutual friend is not a friends-of-friends, whatever came back.
  const noMutual = collectSuggestionCandidates({
    userId: ME,
    friendsOfFriends: [{ id: "x", display_name: "X", mutual_count: 0 }, { id: "y", display_name: "Y", mutual_count: null }]
  });
  check("a zero count is not a suggestion", noMutual.size, 0);
  check("a missing id is not a suggestion", collectSuggestionCandidates({ userId: ME, friendsOfFriends: [{ mutual_count: 3 }] }).size, 0);
  check("you are not your own mutual friend", collectSuggestionCandidates({ userId: ME, friendsOfFriends: [{ id: ME, mutual_count: 4 }] }).size, 0);
  check("an excluded mutual friend is not suggested", collectSuggestionCandidates({ userId: ME, friendsOfFriends: FOF, excludeIds: ["two-mutual"] }).has("two-mutual"), false);

  // Strongest reason first, so a shared group still wins over a mutual friend.
  const ranked = collectSuggestionCandidates({
    userId: ME,
    groups: [{ id: "g1", name: "BSCS 4-101" }],
    coMembers: [{ group_id: "g1", user_id: "two-mutual" }],
    friendsOfFriends: FOF,
    shares: [{ owner_id: "peer", recipient_id: ME, title: "Anatomy" }]
  });
  check("a shared group outranks a mutual friend", ranked.get("two-mutual").reason, "group");
  check("a mutual friend outranks a reviewer share", ranked.get("one-mutual").reason, "mutual");
  check("a reviewer share is still the last resort", ranked.get("peer").reason, "reviewer");

  // The two-hop source is optional, because it is a separate migration. A database that
  // has not had it run must still produce a section from the other two.
  check("the other sources work without it", collectSuggestionCandidates({
    userId: ME,
    groups: [{ id: "g1", name: "IT Club" }],
    coMembers: [{ group_id: "g1", user_id: "clubmate" }],
    friendsOfFriends: [],
    shares: [{ owner_id: "peer", recipient_id: ME, title: "Anatomy" }]
  }).size, 2);
}

// Telling other users that a reviewer was edited. The rule decides whether
// somebody is interrupted about their own reading, so both directions matter:
// missing a real edit leaves them studying against a key that moved, and firing on
// something that was not an edit teaches them to ignore the app.
section("an edited reviewer is announced once, and only for a real edit");
{
  const { collectReviewerEdits } = await import(
    pathToFileURL(new URL("../src/services/social.js", import.meta.url).pathname.replace(/^\//, "")).href
  );

  const ME = "me";
  const PEER = "peer";
  const V1 = "2026-10-01T09:00:00.000Z";
  const V2 = "2026-10-02T09:00:00.000Z";

  const row = (over = {}) => ({
    reviewer_id: "r1",
    owner_id: PEER,
    title: "Anatomy",
    ownerName: "Sam",
    questionsUpdatedAt: V1,
    ...over
  });

  // First poll. The device has no baseline, so a reviewer it has never recorded
  // cannot be one it watched change, and announcing it would greet every reader
  // with a backlog of edits from before they ever opened the app.
  const first = collectReviewerEdits([row()], { userId: ME, seen: {}, seeded: true });
  check("a first sighting is silent", first.edits.length, 0);
  check("but the baseline is recorded", first.next.r1, V1);

  // Same stamp again: nothing happened.
  const unchanged = collectReviewerEdits([row()], { userId: ME, seen: first.next, seeded: true });
  check("an unchanged reviewer is silent", unchanged.edits.length, 0);

  // The stamp moved. This is the edit.
  const edited = collectReviewerEdits([row({ questionsUpdatedAt: V2 })], { userId: ME, seen: first.next, seeded: true });
  check("a moved stamp is announced", edited.edits.length, 1);
  check("naming the reviewer", edited.edits[0].reviewerId, "r1");
  check("naming the title", edited.edits[0].title, "Anatomy");
  check("naming who edited it", edited.edits[0].ownerName, "Sam");
  check("and recording the new stamp", edited.next.r1, V2);

  // Announced once. A poll every minute must not re-announce the same edit.
  const again = collectReviewerEdits([row({ questionsUpdatedAt: V2 })], { userId: ME, seen: edited.next, seeded: true });
  check("it is not announced twice", again.edits.length, 0);

  // The editor is not the audience. The owner is told by the save they just made.
  const ownEdit = collectReviewerEdits(
    [row({ owner_id: ME, questionsUpdatedAt: V2 })],
    { userId: ME, seen: { r1: V1 }, seeded: true }
  );
  check("your own reviewer is not announced to you", ownEdit.edits.length, 0);

  // A device that has never polled records a baseline and announces nothing, so
  // the first poll after signing in is not a wall of historical edits.
  const unseeded = collectReviewerEdits([row({ questionsUpdatedAt: V2 })], { userId: ME, seen: { r1: V1 }, seeded: false });
  check("an unseeded device announces nothing", unseeded.edits.length, 0);
  check("but still advances the baseline", unseeded.next.r1, V2);

  // A database without the migration has no stamp on any row. Without this every
  // reviewer would look permanently edited and notify on every poll forever.
  const noMigration = collectReviewerEdits(
    [row({ questionsUpdatedAt: null }), row({ reviewer_id: "r2", questionsUpdatedAt: undefined })],
    { userId: ME, seen: { r1: V1, r2: V1 }, seeded: true }
  );
  check("a database without the column announces nothing", noMigration.edits.length, 0);
  check("and records the absence rather than dropping the entry", noMigration.next.r1, null);

  // The caller's saved state must survive, since the watcher keeps it for the
  // length of a poll and writes it back afterwards.
  const seen = { r1: V1 };
  const mutated = collectReviewerEdits([row({ questionsUpdatedAt: V2 })], { userId: ME, seen, seeded: true });
  check("the saved state is not mutated in place", seen.r1, V1);
  check("a new object comes back instead", mutated.next !== seen, true);

  // A row the account cannot read never reaches the poll at all, so there is
  // nothing to guard here beyond the owner check above.
  check("a row with no id is skipped", collectReviewerEdits(
    [{ owner_id: PEER, questionsUpdatedAt: V2 }],
    { userId: ME, seen: {}, seeded: true }
  ).edits.length, 0);

  // Several reviewers edited at once are each announced, not merged.
  const many = collectReviewerEdits(
    [row({ reviewer_id: "r1", questionsUpdatedAt: V2 }), row({ reviewer_id: "r2", questionsUpdatedAt: V2 })],
    { userId: ME, seen: { r1: V1, r2: V1 }, seeded: true }
  );
  check("each edited reviewer is announced", many.edits.map((edit) => edit.reviewerId).sort(), ["r1", "r2"]);
}

section("a database without the question-edit column still announces nothing");
{
  const fs = await import("node:fs");
  const files = [
    "../supabase-schema.sql",
    "../supabase-migration-2026-10-question-edit-notifications.sql"
  ];

  for (const file of files) {
    const sql = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    const name = file.split("/").pop();

    check(`${name}: the column exists`, /questions_updated_at timestamptz/.test(sql), true);
    check(`${name}: existing rows are backfilled`, /set questions_updated_at = updated_at/.test(sql), true);

    // The signal has to be narrower than updated_at, or a rename or a share
    // reads as an edit and the notification becomes noise.
    const fn = sql.slice(sql.indexOf("function public.stamp_reviewer_question_edit"));
    check(`${name}: the trigger fires on update`, /before update on public\.reviewers/.test(sql), true);
    check(`${name}: only a change to the questions moves the stamp`, /new\.data->'questions' is distinct from old\.data->'questions'/.test(fn), true);
    check(`${name}: it is not written unconditionally`, /if new\.data->'questions' is distinct[\s\S]*?then[\s\S]*?end if/.test(fn), true);
    // A before trigger, so the value is part of the row that gets written.
    check(`${name}: it runs before the write`, /before update/.test(sql), true);
    // The view is recreated rather than altered, and it has to keep the original's
    // security posture: a view runs with its owner's rights by default, which
    // would bypass the reviewer read policies and hand over every reviewer.
    check(`${name}: the summary view carries the stamp`, /'questionsUpdatedAt', r\.questions_updated_at/.test(sql), true);
    check(`${name}: the view stays security_invoker`, /create or replace view public\.reviewer_summaries with \(security_invoker = true\)/.test(sql), true);

    // create or replace view can only append a column. One placed before summary
    // renames it and Postgres refuses the statement, which would leave the column
    // and the trigger in place and the view without the stamp, so an edit would
    // never be seen at all. Nothing in the client would say why.
    const view = sql.slice(sql.indexOf("create or replace view public.reviewer_summaries"));
    const summaryAt = view.indexOf(") as summary");
    const stampAt = view.lastIndexOf("r.questions_updated_at");
    check(`${name}: the stamp is appended after summary`, summaryAt > -1 && stampAt > summaryAt, true);
  }
}

// A session carries its own copy of the answer key, and that copy is what grades
// it. Nothing warns when the two disagree, so an owner who corrects a key while
// somebody has the reviewer open leaves that session silently marking the old one.
section("a corrected answer key reaches a quiz already in progress");
{
  const { refreshSessionAnswerKey, isAnswerCorrect } = await import(MODULE_URL);

  const stored = (id, correctAnswer) => ({
    id,
    topic: "T",
    question: `Q ${id}`,
    correctAnswer,
    answerText: correctAnswer,
    explanation: "why",
    choices: { A: "a", B: "b", C: "c", D: "d" }
  });

  // Only q1's key moved. q2 is deliberately identical in both, so it stands in
  // for the many questions an edit leaves alone.
  const reviewer = { questions: [stored("q1", "D"), stored("q2", "C")] };
  const session = {
    sessionId: "s1",
    // The learner already answered q1 correctly under the old key, and is partway
    // into q2. The choices are this session's own shuffle and must survive.
    questions: [
      { ...stored("q1", "B"), choices: [{ value: "C", label: "c" }, { value: "B", label: "b" }, { value: "D", label: "d" }, { value: "A", label: "a" }] },
      { ...stored("q2", "C"), choices: [{ value: "A", label: "a" }, { value: "C", label: "c" }, { value: "B", label: "b" }, { value: "D", label: "d" }] }
    ],
    answers: { q1: "B" },
    submittedQuestions: { q1: true },
    completed: false
  };

  const refreshed = refreshSessionAnswerKey(session, reviewer);
  check("the corrected key was picked up", refreshed.questions[0].correctAnswer, "D");
  check("so an answer given under the old key is marked wrong", isAnswerCorrect(refreshed.questions[0], "B"), false);
  check("and the new one is marked right", isAnswerCorrect(refreshed.questions[0], "D"), true);
  check("a question the owner did not touch is left alone", refreshed.questions[1].correctAnswer, "C");
  check("the answers already given are kept", refreshed.answers, { q1: "B" });
  check("the session's own choice order is kept", refreshed.questions[0].choices.map((c) => c.value), ["C", "B", "D", "A"]);
  check("practice reveals survive", refreshed.submittedQuestions, { q1: true });

  // The same session object has to come back when nothing moved, or the caller
  // cannot hand this to setState without re-rendering forever. Re-running it over
  // its own output is the case that matters: that is what a second render does.
  check("running it twice settles", refreshSessionAnswerKey(refreshed, reviewer) === refreshed, true);
  check("and a session matching the reviewer is untouched", refreshSessionAnswerKey(session, { questions: [stored("q1", "B"), stored("q2", "C")] }) === session, true);

  // A summary cannot rebuild anything, so a device that is offline keeps the key
  // its session already holds rather than losing the questions outright.
  check("a summary changes nothing", refreshSessionAnswerKey(session, { reviewerId: "x" }) === session, true);
  check("no session changes nothing", refreshSessionAnswerKey(null, reviewer), null);

  // A regenerated reviewer is a different set of questions under the same id, and
  // one of them may simply not exist any more. Dropping a question out from under
  // an attempt in progress loses the learner's place, so it is left as it was.
  const partial = refreshSessionAnswerKey(session, { questions: [stored("q1", "D")] });
  check("a question missing from the reviewer is not dropped", partial.questions.length, 2);
  check("and keeps the key it was given", partial.questions[1].correctAnswer, "C");

  // A typed question is graded against answerText, not a letter, so the text has
  // to move with the key or correcting the key would change nothing.
  const typed = {
    questions: [{ ...session.questions[0], id: "t1", type: "identification", correctAnswer: "TEXT", answerText: "old text" }]
  };
  const typedSession = { ...session, questions: [typed.questions[0]] };
  const typedFixed = refreshSessionAnswerKey(typedSession, {
    questions: [{ ...typed.questions[0], answerText: "new text" }]
  });
  check("a typed question's text follows the key", typedFixed.questions[0].answerText, "new text");
}

section("the friends-of-friends function cannot be turned into a directory");
{
  const fs = await import("node:fs");
  const files = [
    "../supabase-schema.sql",
    "../supabase-migration-2026-10-social-graph.sql"
  ];

  for (const file of files) {
    const sql = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    const start = sql.indexOf("create or replace function public.find_friends_of_friends");
    const end = sql.indexOf("$$;", start);
    const name = file.split("/").pop();
    check(`${name}: the function exists`, start > -1, true);
    if (start < 0) continue;
    const body = sql.slice(start, end);

    // A security definer function is the easiest way in a schema like this to hand out
    // the account directory by accident, so each of these is asserted rather than
    // trusted. Removing one is a security change, not a refactor.
    check(`${name}: it runs as the owner`, /security definer/.test(body), true);
    check(`${name}: search_path is pinned`, /set search_path = public/.test(body), true);
    check(`${name}: the subject is auth.uid() and not a parameter`, body.includes("v_uid uuid := auth.uid()"), true);
    check(`${name}: no user id is accepted as an argument`, /find_friends_of_friends\(p_user/.test(body), false);
    check(`${name}: only accepted friendships are walked`, (body.match(/status = 'accepted'/g) || []).length >= 1, true);
    check(`${name}: no unfiltered select star`, /select \*/.test(body), false);
    check(`${name}: the returned columns are named one by one`, /returns table \(id uuid, display_name text, avatar_url text, mutual_count integer\)/.test(body), true);
    check(`${name}: the limit is clamped`, /least\(greatest\(coalesce\(p_limit/.test(body), true);
    check(`${name}: known friends are excluded in sql`, /not exists \(select 1 from my_friends known/.test(body), true);
    check(`${name}: open requests are excluded in sql`, /f4\.status = 'pending'/.test(body), true);

    // Anonymous has no business here, and the grant for signed in accounts is not
    // optional: revoking from PUBLIC without regranting fails closed but silently.
    check(`${name}: revoked from public and anon`, /revoke all on function public\.find_friends_of_friends\(integer\) from public, anon;/.test(sql), true);
    check(`${name}: granted to authenticated`, /grant execute on function public\.find_friends_of_friends\(integer\) to authenticated;/.test(sql), true);
  }

  // The policies themselves must not move. Friends of friends arrives through a
  // function, and widening these two is what would turn it into a directory. The slice
  // is bounded by the next policy statement, because the same helper names appear in
  // several other policies further down the file.
  const schema = fs.readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8");
  const policyStart = schema.indexOf('create policy "Users can read profiles"');
  const policyEnd = schema.indexOf("create policy", policyStart + 10);
  const readPolicy = schema.slice(policyStart, policyEnd);

  check("the profiles read policy still exists", policyStart > -1, true);
  check("the profiles read policy has exactly four relationships",
    (readPolicy.match(/auth\.uid\(\) = id|is_friend|shares_group_with|owns_shared_reviewer_with/g) || []).length, 4);
  check("friends of friends was not smuggled into the policy", /find_friends_of_friends|mutual/.test(readPolicy), false);
  check("the friendships policy is not widened to the whole table",
    (schema.match(/create policy "Users can read own friendships"[\s\S]{0,400}?;/g) || []).some((text) => /using \(auth\.uid\(\) = requester_id or auth\.uid\(\) = addressee_id\)/.test(text)), true);
}

section("the group invite functions cannot be turned into a directory");
{
  const fs = await import("node:fs");
  const files = [
    "../supabase-schema.sql",
    "../supabase-migration-2026-10-group-invites.sql"
  ];
  const functions = ["get_group_invite_preview", "join_group_by_invite"];

  for (const file of files) {
    const sql = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    const name = file.split("/").pop();

    check(`${name}: the invite code column exists`, /invite_code text not null/.test(sql) || /add column if not exists invite_code text/.test(sql), true);
    check(`${name}: invite codes are random`, /encode\(gen_random_bytes/.test(sql), true);

    for (const fn of functions) {
      const start = sql.indexOf(`create or replace function public.${fn}`);
      const end = sql.indexOf("$$;", start);
      check(`${name}: ${fn} exists`, start > -1, true);
      if (start < 0) continue;
      const body = sql.slice(start, end);

      // Same reasoning as find_friends_of_friends: a security definer function is
      // one copy-paste away from handing out the whole groups table.
      check(`${name}: ${fn} runs as the owner`, /security definer/.test(body), true);
      check(`${name}: ${fn} pins search_path`, /set search_path = public/.test(body), true);
      check(`${name}: ${fn} derives the caller from auth.uid()`, body.includes("v_uid uuid := auth.uid()"), true);
      check(`${name}: ${fn} accepts no user id argument`, new RegExp(`${fn}\\(p_user`).test(body), false);
      check(`${name}: ${fn} has no unfiltered select star`, /select \*/.test(body.replace(/select \* into/, "")), false);
      check(`${name}: ${fn} is revoked from public and anon`, new RegExp(`revoke all on function public\\.${fn}\\(text\\) from public, anon;`).test(sql), true);
      check(`${name}: ${fn} is granted to authenticated`, new RegExp(`grant execute on function public\\.${fn}\\(text\\) to authenticated;`).test(sql), true);
    }
  }

  // The membership policy must stay the only way in without a code: no new
  // self-join path may appear on group_members.
  const schema = fs.readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8");
  const insertStart = schema.indexOf('create policy "Owners and admins can add members"');
  const insertEnd = schema.indexOf("create policy", insertStart + 10);
  const insertPolicy = schema.slice(insertStart, insertEnd);
  check("the members insert policy still requires an owner or admin", /is_group_owner_or_admin/.test(insertPolicy), true);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures) process.exitCode = 1;
