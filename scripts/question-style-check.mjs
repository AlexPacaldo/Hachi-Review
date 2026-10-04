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

const { inferQuestionStyle, countNegativeStemQuestions, getReviewerStyleCounts } = await import(MODULE_URL);

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

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures) process.exitCode = 1;
