// Guards the exam paper import, end to end.
//
// The import is the one path in the generator whose output is not the AI's to
// decide. Everywhere else the model authors questions and its mistakes are one
// reviewer's worth of noise. Here the paper already exists, the learner is drilling
// that paper, and the failures are silent ones: an invented item, a choice moved to
// a different letter, an answer the paper never printed that is then impossible to
// tell apart from a real key entry. Nothing in the app goes wrong when those slip
// through, so they need a test rather than a code review.
//
// The handler is driven for real, with auth, the rate-limit RPC, and the model
// endpoint stubbed, rather than one function at a time. The prompt, the provenance
// rules, the split that drops what cannot be answered honestly, and the response
// shape only mean anything together.
//
// Run with `npm test`. No dependencies, matching the other check scripts.

import { pathToFileURL } from "node:url";

const APP_URL = (relativePath) => pathToFileURL(new URL(relativePath, import.meta.url).pathname.replace(/^\//, "")).href;

// The other check scripts stub this because storageUtils reads it at import time.
// This one only needs the modules loaded, not exercised against real storage.
globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  key: () => null,
  get length() {
    return 0;
  }
};

let checks = 0;
let failures = 0;

function section(title) {
  console.log(`\n${title}`);
}

function check(label, actual, expected) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) {
    console.log(`        expected ${JSON.stringify(expected)}`);
    console.log(`        actual   ${JSON.stringify(actual)}`);
  }
}

const SUPABASE_URL = "https://stub-project.supabase.co";
process.env.SUPABASE_URL = SUPABASE_URL;
process.env.SUPABASE_ANON_KEY = "stub-anon-key";
process.env.GEMINI_API_KEY = "stub-gemini-key";
delete process.env.OPENROUTER_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.AI_UPSTREAM_CALL_BUDGET;

const handler = (await import(APP_URL("../api/generate-reviewer.js"))).default;
const { normalizeReviewerJson, countAnswerProvenance } = await import(APP_URL("../src/pages/generator/generatorShared.js"));
const { validateReviewer } = await import(APP_URL("../src/data/reviewerRegistry.js"));

// One paper, three items: one the paper answers, one the AI answers, one that was
// cut off by the scan. Every case below reads from this.
const PAPER_ITEMS = [
  {
    sourceNumber: 1,
    type: "multiple_choice",
    difficulty: "medium",
    style: "direct",
    topic: "Wireless Security",
    question: "Which standard secures a wireless network?",
    choices: { A: "WEP", B: "WPA3", C: "WPA", D: "CCMP" },
    correctAnswer: "B",
    answerText: "WPA3",
    explanation: "WPA3 is the current wireless security standard.",
    answerSource: "paper"
  },
  {
    sourceNumber: 2,
    type: "multiple_choice",
    difficulty: "medium",
    style: "direct",
    topic: "Wireless Security",
    question: "Which tool captures a wireless handshake?",
    choices: { A: "Aircrack-ng", B: "Wireshark", C: "Nmap", D: "Metasploit" },
    correctAnswer: "A",
    answerText: "Aircrack-ng",
    explanation: "It captures and cracks wireless handshakes.",
    answerSource: "solved"
  },
  {
    sourceNumber: 3,
    type: "multiple_choice",
    difficulty: "medium",
    style: "direct",
    topic: "Wireless Security",
    question: "Which item was cut off on the scan?",
    choices: { A: "Krone", B: "Deauth", C: "Smurf", D: "Sybil" },
    correctAnswer: "",
    answerText: "",
    explanation: "The page is cut off here.",
    answerSource: "unresolved"
  }
];

function makePaperReviewer() {
  return {
    title: "IT2511 - Information Technology 2",
    subject: "Information Technology",
    coverage: ["Wireless Security"],
    questionCount: PAPER_ITEMS.length,
    questionType: "multiple_choice",
    choicesPerQuestion: 4,
    instructions: "Answer every item.",
    questions: PAPER_ITEMS.map((item) => ({ ...item }))
  };
}

// What the stubbed model returns. Swapped per case, because "the model answered
// nothing" is only testable if the stub can be made to do that.
let modelReviewer = makePaperReviewer();

let lastModelRequest = null;

globalThis.fetch = async (url, options = {}) => {
  const target = String(url);

  if (target.startsWith(`${SUPABASE_URL}/auth/v1/user`)) {
    return jsonResponse({ id: "user-1", email: "someone@example.com" });
  }

  if (target.includes("/rest/v1/rpc/consume_ai_rate_limit")) {
    return jsonResponse([{ allowed: true, remaining: 7, resetMs: 600000 }]);
  }

  if (target.includes("generativelanguage.googleapis.com")) {
    lastModelRequest = JSON.parse(options.body);
    return jsonResponse({ candidates: [{ content: { parts: [{ text: JSON.stringify(modelReviewer) }] } }] });
  }

  throw new Error(`unstubbed fetch to ${target}`);
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function call(body, { token = "bearer-token" } = {}) {
  const captured = {};
  const response = {
    setHeader: (key, value) => { captured[key] = value; },
    status(code) { captured.statusCode = code; return response; },
    json(payload) { captured.payload = payload; return response; }
  };

  await handler({ method: "POST", headers: { authorization: `Bearer ${token}` }, body, socket: {} }, response);
  return captured;
}

const ONE_PHOTO = [{ name: "page1.png", mimeType: "image/png", data: "aGVsbG8=" }];
// Pasted text has to clear the endpoint's own minimum, which is why this is longer
// than a single item would be. Anything under it is a 400, and a 400 checked only
// for absent warnings would pass for the wrong reason.
const PAPER_TEXT = [
  "IT2511 - Information Technology 2 - First Term Preliminary Examination",
  "INSTRUCTIONS: Choose the letter of the correct answer for each item.",
  "1. Which standard secures a wireless network?",
  "A. WEP",
  "B. WPA3",
  "C. WPA",
  "D. CCMP",
  "2. Which tool captures a wireless handshake?",
  "A. Aircrack-ng",
  "B. Wireshark",
  "C. Nmap",
  "D. Metasploit",
  "3. Which attack replays a captured handshake?",
  "A. Krone",
  "B. Deauth",
  "C. Smurf",
  "D. Sybil"
].join("\n");

section("importing a paper keeps only the items whose answer is honest");
{
  const response = await call({
    mode: "exam_import",
    answerSource: "extract",
    sourceText: "",
    files: ONE_PHOTO,
    title: "",
    subject: "",
    instructions: ""
  });

  check("the request succeeds", response.statusCode, 200);
  check("the answer source is echoed back", response.payload.answerKeySource, "extract");
  // Under extract, only "paper" is believed. The second item claimed to be solved,
  // which is the one thing this mode promises not to do, so it is treated as
  // unanswered rather than quietly accepted.
  check("only the item the paper printed is kept", response.payload.generatedQuestionCount, 1);
  check("both other items are counted unresolved", response.payload.answerKeyStats.unresolved, 2);
  check("the kept item is the first one", response.payload.reviewer.questions.map((question) => question.sourceNumber), [1]);
  check("the kept item keeps its provenance", response.payload.reviewer.questions[0].answerSource, "paper");
  check("the paper's wording survives", response.payload.reviewer.questions[0].question, "Which standard secures a wireless network?");
  check("the choice letters are not moved", response.payload.reviewer.questions[0].choices, { A: "WEP", B: "WPA3", C: "WPA", D: "CCMP" });
  check("the requested count is reported as the paper", response.payload.requestedQuestionCount, "exam-paper");
  check("the loss is reported in words", /no answer printed in the paper/.test(response.payload.warning || ""), true);

  const prompt = lastModelRequest.contents[0].parts[0].text;
  check("the exam prompt was used", prompt.startsWith("TRANSCRIBE AN EXISTING EXAM PAPER"), true);
  check("the prompt forbids solving under extract", prompt.includes("do not use outside knowledge"), true);
  check("the prompt names the attachment", prompt.includes("page1.png"), true);
  check("the photo reached the model", lastModelRequest.contents[0].parts[1].inline_data.mime_type, "image/png");
  check("one call, no top-ups", lastModelRequest.contents.length, 1);
}

section("working the answers out still refuses what the model cannot answer");
{
  // The third item says it could not be settled. That is a claim about the model's
  // own certainty, not about the paper, so asking for worked answers does not
  // override it: a guess promoted to an answer is the failure this exists to stop.
  const response = await call({
    mode: "exam_import",
    answerSource: "solve",
    sourceText: PAPER_TEXT,
    files: [{ name: "paper.pdf", mimeType: "application/pdf", data: "aGVsbG8=" }]
  });

  check("the request succeeds", response.statusCode, 200);
  check("the answerable items are kept", response.payload.generatedQuestionCount, 2);
  check("one from the paper and one worked out",
    [response.payload.answerKeyStats.fromPaper, response.payload.answerKeyStats.solved, response.payload.answerKeyStats.unresolved],
    [1, 1, 1]);
  check("the dropped item is reported", /could not be answered with confidence/.test(response.payload.warning || ""), true);
  check("the prompt tells it to work them out", lastModelRequest.contents[0].parts[0].text.includes("WORK THEM OUT"), true);
}

section("an imported paper is not judged against the generation mix targets");
{
  const response = await call({ mode: "exam_import", answerSource: "solve", sourceText: PAPER_TEXT });

  // A real paper is uneven by nature, and a 400 here would make every "no warning"
  // assertion below pass for the wrong reason, so the status is checked first.
  check("the request succeeded before the warnings are read", response.statusCode, 200);
  check("the import actually produced items", response.payload.generatedQuestionCount, 2);
  check("no difficulty mix warning", /Difficulty mix came back thin/.test(response.payload.warning || ""), false);
  check("no exam-style mix warning", /Exam-style mix came back/.test(response.payload.warning || ""), false);
  check("no give-away choices warning", /you could guess just by looking at the choices/.test(response.payload.warning || ""), false);
}

section("a paper with nothing to answer says so instead of failing blankly");
{
  modelReviewer = {
    ...makePaperReviewer(),
    questions: makePaperReviewer().questions.map((question) => ({
      ...question,
      correctAnswer: "",
      answerText: "",
      answerSource: "unresolved"
    }))
  };

  const response = await call({ mode: "exam_import", answerSource: "extract", files: [{ name: "key.pdf", mimeType: "application/pdf", data: "aGVsbG8=" }] });

  check("an empty import is a 422", response.statusCode, 422);
  check("the message names the fix", /Work out the answers/.test(response.payload.error || ""), true);
  check("the message names no provider", /gemini|openrouter|groq/i.test(response.payload.error || ""), false);

  modelReviewer = makePaperReviewer();
}

section("attachments arrive however the caller sent them");
{
  const response = await call({ mode: "exam_import", answerSource: "solve", file: ONE_PHOTO[0] });
  check("the singular field still works", response.statusCode, 200);
  check("it reached the model as one part", lastModelRequest.contents[0].parts.length, 2);

  await call({
    mode: "exam_import",
    answerSource: "solve",
    files: Array.from({ length: 9 }, (_, index) => ({ name: `page${index}.png`, mimeType: "image/png", data: "aGk=" }))
  });
  check("nine attachments are capped rather than refused", response.statusCode, 200);
  check("only six reached the model", lastModelRequest.contents[0].parts.length - 1, 6);
}

section("guards that are not about the paper still hold");
{
  check("no token is a 401", (await call({ sourceText: "x".repeat(200) }, { token: "" })).statusCode, 401);
  check("no material at all is a 400", (await call({})).statusCode, 400);

  const unknownMode = await call({ sourceText: "x".repeat(200), mode: "wat" });
  check("an unknown mode falls back to generate", unknownMode.statusCode, 200);

  const oversize = await call({ mode: "exam_import", files: [{ name: "a.png", mimeType: "image/png", data: "A".repeat(5000000) }] });
  check("an oversized attachment set is a 413", oversize.statusCode, 413);
  check("and suggests pasting instead", /paste the important notes/i.test(oversize.payload.error || ""), true);
}

section("what the handler returns is what the app can save");
{
  // The round trip that actually matters. The response the browser receives, put
  // through the browser's own normaliser, has to satisfy the app's own reviewer
  // validator. A gap here would show up only as a failed save, with nothing else
  // pointing at it.
  const response = await call({ mode: "exam_import", answerSource: "solve", sourceText: PAPER_TEXT });
  const reviewer = normalizeReviewerJson(response.payload.reviewer);
  const validation = validateReviewer(reviewer);

  // Asserted before anything else, because an empty reviewer also satisfies the
  // validator and would let the checks below pass while testing nothing.
  check("the request succeeded", response.statusCode, 200);
  check("the response carried questions", Array.isArray(response.payload.reviewer?.questions), true);
  check("the normalised reviewer validates", validation.isValid, true);
  if (!validation.isValid) console.log(`        ${validation.errors.join(", ")}`);

  check("the answerable items survive the round trip", reviewer.questions.map((question) => question.sourceNumber), [1, 2]);
  check("provenance survives the round trip", reviewer.questions.map((question) => question.answerSource), ["paper", "solved"]);
  check("the provenance counts line up", countAnswerProvenance(reviewer.questions), { paper: 1, solved: 1 });
  check("questionCount matches the array", reviewer.questionCount, 2);
  check("the paper's title survived", reviewer.title, "IT2511 - Information Technology 2");
  check("the paper's choices were not shuffled", reviewer.questions[0].choices, { A: "WEP", B: "WPA3", C: "WPA", D: "CCMP" });

  // The singular-field response shape has to keep working too, so a request sent by
  // an older cached bundle is unaffected by the array form.
  const singular = await call({ mode: "exam_import", answerSource: "solve", file: ONE_PHOTO[0] });
  check("the singular attachment path validates too", validateReviewer(normalizeReviewerJson(singular.payload.reviewer)).isValid, true);
}

console.log(`\n${checks - failures}/${checks} checks passed`);

if (failures) process.exitCode = 1;