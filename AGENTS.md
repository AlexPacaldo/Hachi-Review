# Agent Notes

When the user mentions the "Hachi design language", read and follow:

```text
docs/hachi-design-language.md
```

Preserve the existing app behavior and React logic unless the user explicitly asks for functional changes.

For new frontend UI, including notifications, keep the Hachi design language in mind: soft rounded Nunito typography, subtle borders, generous spacing, and shadows only for temporary overlays such as drawers, popovers, and toasts.

## Secrets

Anything without a `VITE_` prefix is server-only. Vite only exposes `VITE_*` to the
bundle, and `vite.config.js` deliberately has no `define:` block and no `envPrefix`
override, so that is the boundary. Never move a provider key into `VITE_`, into
`index.html`, into a file under `public/`, or into a literal in `src/`.

The Supabase publishable key and project URL are meant to be public. Everything that
authorizes a paid call is not.

## Changing the inline script in index.html

`vercel.json` pins the inline ad-technology script in `index.html` by sha256 and does
not allow `'unsafe-inline'` for scripts. Editing that inline block without updating
the hash makes it fail silently in the browser while still working locally.

A CSP source hash is base64, not hex. Recompute it from the exact bytes of the inline
script:

```powershell
$html = Get-Content index.html -Raw
$match = [regex]::Match($html, '(?s)<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>')
$bytes = [System.Text.Encoding]::UTF8.GetBytes($match.Groups[1].Value)
$digest = [System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes, 0, $bytes.Length)
"'sha256-" + [System.Convert]::ToBase64String($digest) + "'"
```

Then replace the existing `sha256-...` value in the `script-src` directive in
`vercel.json`. Verify the pair still agrees before committing:

```powershell
(Get-Content vercel.json -Raw) -match [regex]::Escape($computed)
```

## Ad networks and the CSP

Three networks are loaded from `index.html`: Google AdSense, and two popunder
networks (`nap5k.com` and `5gvci.com`). Each one needs its own hosts in
`vercel.json`, and getting this wrong is silent, so the rule is that a network is
only considered working once a real browser shows its beacons returning 200.

What each directive actually permits, because it decides how wide a grant has to
be:

- `script-src` lets a host run arbitrary JavaScript on the page. This is the only
  directive that grants code execution, so keep it as narrow as possible.
- `connect-src` only allows `fetch`, XHR, beacons and websockets. It can send
  data out but cannot execute anything.
- `img-src` only allows image loads. Useful for tracking pixels, harmless
  otherwise.
- `frame-src` only allows framing, and the framed document stays on its own
  origin.

Ad creatives are served as images from `*.googlesyndication.com` and
`*.doubleclick.net`, so an `img-src` without them renders a filled ad as an
empty box. The popunder tags cannot report anything at all unless their beacon
hosts are in `connect-src`; `my.rtmark.net` is a fingerprinting library and
`jhnwr.com` is a zone beacon, and both were blocked at one point, which is why
the tag loaded but no ad ever appeared.

AdSense also injects a runtime inline script that cannot be pinned by hash,
because its contents are generated per page load. It stays blocked. That is
expected and is not worth adding `'unsafe-inline'` for.

The AdSense grants are kept even while the account is unapproved, so the site is
ready the moment approval lands. Do not assume the presence of these hosts means
AdSense is earning: the account has to be approved and Auto ads enabled, and
`ads.txt` only authorises Google, not the popunder networks.

## AI generation

The provider keys are on free tiers with no billing attached, so the harm from
abuse is not a bill. It is quota exhaustion: the provider starts refusing the
account, and then the owner's own generation breaks too. Free tiers also cap
requests per minute, which makes concurrency more damaging than total volume.

`api/generate-reviewer.js` is built around that:

- Generation requires a signed-in account. There is no billing, so abuse costs
  quota rather than money, and a per-address cap cannot protect that: an address is
  not an identity, `x-forwarded-for` rotates for free, and a shared network puts many
  people behind one address. Do not reintroduce an anonymous path to reduce sign-up
  friction without also adding a bot challenge, or the cap is decorative.
- The limit is enforced in Postgres through `consume_ai_rate_limit`, keyed on
  `auth.uid()`, which is derived inside the function from the caller's own session.
  That requires `supabase-migration-2026-10-ai-abuse.sql` to have been run. Without it
  the function logs an error and falls back to a per-instance `Map`, which does not
  hold across the fleet.
- The RPC must be called on a client built with the caller's Authorization header, not
  a plain anon client. On a plain client the call resolves to the anon role, where
  `auth.uid()` is null, so the counter silently never engages. See
  `getCallerSupabaseClient`.
- `MAX_COMPLETION_ATTEMPTS` and `UPSTREAM_CALL_BUDGET` are quality settings first and
  safety settings second. The top-ups are what close the gap when a model returns
  short of the requested question count, so do not lower them to save quota; the
  budget is sized to stay clear of normal use and only catches a runaway loop.
- Nothing in a response should name a provider, a model, or an environment variable.
  Errors opt in to being shown with `isClientSafe`; everything else becomes
  `GENERIC_AI_FAILURE_MESSAGE`.

## The two generator modes

`/generator` has two modes and they are opposites. Study Material writes questions
the source does not contain. Exam Paper transcribes a paper that already exists.
They are separate components on purpose, not one form with switches, because every
rule in one of them is wrong in the other.

- `src/pages/Generator.jsx` is the shell: the mode tabs, the single writer for the
  draft, and the manual builder. Both modes stay mounted and the inactive one is
  hidden, so a tab switch cannot throw away a half-finished form.
- `src/pages/generator/` holds the rest. `generatorShared.js` is everything both
  modes read, `useSourceAttachments.js` is every rule about turning a dropped file
  into something the endpoint will accept, and the two mode components own only
  their own form.

**Exam Paper import is a transcription job, not a generation job.** So it has none
of the post-processing: no top-ups, because adding items would invent paper that
does not exist, and no `rebalanceReviewerChoices`, because that pass rewrites
choices and can move a correct answer to a different letter, which invalidates the
very key the learner is checking themselves against. It also skips the difficulty
and style mix warnings, since a real paper is uneven by nature and was never
planned against those targets. Do not "fix" an imported reviewer by making it look
more like a generated one.

The one decision that mode asks for is `answerSource`, and the two are not
interchangeable. `solve` works the answers out and credits an answer read off the
paper when there is one. `extract` uses only what the upload shows and treats
anything else as unanswered. An item the model marks `unresolved` is dropped from
the reviewer and reported back as a count, because a guessed answer teaches
something false and is indistinguishable from a real key entry once it is in the
quiz. `normalizeImportedAnswerSource` enforces this, and it is scoped to the
requested source on purpose: under `extract`, a model claiming it solved an item is
treated as unanswered, and an explicit `unresolved` is honoured in both modes. Do
not loosen it back to a plain vocabulary check.

## Attachments

A request carries `files`, an array. `file` is still accepted on its own and both
are pooled, so a paper that runs to three pages can be three photos. The budget is
the total across the array, not per file, and it is checked in the browser before
encoding as well as on the server: `MAX_AI_ATTACHMENT_BYTES` is decoded bytes and
`MAX_FILE_BASE64_LENGTH` is the base64 character count it corresponds to. Those two
must not drift, or a request passes in the browser and is rejected after the person
has already waited for the encoding.

An image always routes to a vision-capable provider, even when notes were pasted
alongside it. `requiresVision` in `getConfiguredProviders` is what makes that true,
and the earlier bug it fixed is the reason not to key it off "no text was pasted
too": with that key, attaching a photo next to some notes excluded every vision-only
provider, so the chain answered from the notes and the photo was read by nobody.

In the browser, an image over 2000px on its long edge is downscaled, and one that is
already small enough is sent untouched. That second half matters as much as the
first: a small JPEG re-encoded through a canvas comes out larger than it went in, so
the round trip would spend upload budget and lose quality to arrive at the same
picture. HEIC is listed in the picker on purpose and rejected with a message, since
a file the picker silently hides looks like the app is broken.

`scripts/exam-import-check.mjs` drives the endpoint for real with auth, the
rate-limit RPC, and the model stubbed. The import's failures are silent ones, an
invented item or a moved choice, so this needs to stay a test rather than a code
review. It also round-trips the response through the browser's own normaliser and
the app's own validator, which is the gap that would otherwise show up only as a
failed save.

## Sharing

Friends and groups are two independent audiences on one `visibility` column, with
`'friends+groups'` naming both. The read policy is the only thing that enforces
it, so `'friends+groups'` needs `supabase-migration-2026-10-visibility-toggles.sql`.
Without it the value writes fine and then reads as owner-only, because both
policy branches still test for their own single value. The vocabulary lives in
`src/services/reviewerVisibility.js`; read it from there rather than testing the
string, so an unrecognised value cannot be mistaken for private.

That policy is also the reason the migration exists as its own file rather than
only as part of `supabase-schema.sql`. Postgres stops a multi-statement script at
the first error, so one unrelated failure in the long schema file leaves the
policy unapplied with nothing on screen to say so.

Admin access is `app_metadata.admin = true` on the account. A row in
`private.admin_emails` is the alternative, but an address is public the moment it is
written down, so prefer the flag. Do not add an address to a committed SQL file.

## Suggesting people

The "People you may know" section on `/friends` is built from exactly two
relationships, and that is a privacy constraint rather than a limitation of the idea:

- someone in a group you are both in
- someone who shared a reviewer with you, or that you shared with them

The `profiles` select policy permits reading a row for exactly four relationships,
and a fifth "anybody" path would be the leak the policy exists to prevent: the table
once carried a duplicate email column behind a `using (true)` policy, which let any
signed-in account enumerate the whole directory through the friend search. A
suggestion panel is that same hole under a friendlier label, except it needs no
typing at all. So it is assembled only from relationships the policy already allows,
and a peer the policy withholds simply does not appear. Nothing here loosens a
policy, which is why it needs no migration.

Friends of friends is absent for the same reason: a friend of a friend satisfies none
of the four predicates, so no row comes back. Adding them means widening the policy,
so treat it as a schema decision rather than a UI one.

`collectSuggestionCandidates` and `toSuggestions` in `src/services/social.js` are
split out and exported so the rules can be tested without a database, the same reason
`buildExamImportPrompt` and friends are exported from the endpoint. Two behaviours are
load-bearing and asserted in `scripts/question-style-check.mjs`: a shared group
outranks a reviewer share as the stated reason, and a candidate whose profile the
policy withheld is dropped rather than rendered as a nameless card.

The section is hidden when there is nobody to suggest. An always-present empty panel
teaches people to scroll past it, and for someone in no groups it could never be
anything but empty.