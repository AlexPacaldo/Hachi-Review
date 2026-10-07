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

## Scripts load and the CSP

`index.html` loads three third-party or same-origin script/security items today:
the Google AdSense external script, the Monetag tag, and Vercel Web Analytics served from this
deployment's own origin (`/_vercel/insights/script.js`). Do not reintroduce an inline
script block: the CSP pins no hash and allows no `'unsafe-inline'` for scripts, so one
would fail silently in the browser while still working locally. If a same-origin
asset is added, it is already allowed by `script-src 'self'`. A third-party host is
not; it must be added to the relevant directives in `vercel.json` and that change only
takes effect in production.

The AdSense script only runs because `script-src` lists
`https://pagead2.googlesyndication.com` and its siblings. AdSense also injects a
runtime inline script that cannot be pinned by hash, because its contents are
generated per page load, so it stays blocked. That is expected and is not worth
adding `'unsafe-inline'` for.

## Ad networks and the CSP

Google AdSense and a Monetag popunder are loaded. The Monetag tag is a plain
external script tag (`https://nap5k.com/tag.min.js`, zone 11915305) rather than the
vendor's inline bootstrap, because the CSP allows no inline scripts and an inline
block fails silently in the browser while "working" locally. Its hosts -
`https://nap5k.com`, `https://my.rtmark.net`, and `https://*.rtmark.net` - are granted
in `script-src`, `connect-src`, and `img-src`, since the tag executes remote code,
sends beacons, and loads pixels from those origins. Do not treat a
loaded-but-blocked tag as working: a real browser showing its beacons returning 200 is
the only definition of working.

What each directive actually permits, because it decides how wide a grant has to be:

- `script-src` is the only directive that grants code execution, so keep it as narrow
  as possible.
- `connect-src` only allows `fetch`, XHR, beacons and websockets. It can send data
  out but cannot execute anything.
- `img-src` only allows image loads. Useful for tracking pixels, harmless otherwise.
- `frame-src` only allows framing, and the framed document stays on its own origin.

Ad creatives are served as images from `*.googlesyndication.com` and
`*.doubleclick.net`, so an `img-src` without them renders a filled ad as an empty
box. The AdSense grants are kept even while the account is unapproved, so the site is
ready the moment approval lands. Do not assume the presence of these hosts means
AdSense is earning: the account has to be approved and Auto ads enabled, and
`ads.txt` only authorises Google.

## Vercel Web Analytics

`index.html` loads `/_vercel/insights/script.js` with `defer`. It answers the only
traffic question the database physically cannot: how many people visit. The app
cannot show those numbers itself — `public.presence_pings` is a live count of landing
page tabs with a ten minute self-destructing lifetime and no history, and nothing
else records a page view — so `src/pages/AdminStats.jsx` points at the Vercel
dashboard instead of pretending otherwise. When editing traffic or privacy copy,
remember that the numbers live in Vercel, not in Supabase, and are never mixed into
this database. The script and its beacons are same-origin, so no `vercel.json` change
is (or may ever be) needed for it; a `script-src` host that is not `'self'` must be
added deliberately.

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

The "People you may know" section on `/friends` is built from exactly three
relationships:

- someone in a group you are both in
- someone who shared a reviewer with you, or that you shared with them
- a friend of a friend, via `public.find_friends_of_friends`

The first two come from rows the `profiles` select policy already lets you read, and
a peer the policy withholds simply does not appear. A fifth "anybody" path on that
policy would be the leak it exists to prevent: the table once carried a duplicate email
column behind a `using (true)` policy, which let any signed-in account enumerate the
whole directory through the friend search. A suggestion panel is that same hole under
a friendlier label, except it needs no typing at all. So the policy is not widened, and
there is no migration for the first two sources.

**Friends of friends cannot be done from the client**, and that is the whole reason it
needs a function. The `friendships` policy only lets a caller read rows they are a
party to, so the middle step of the walk, one of your own friends' friendships, is
precisely the row you may not see. `find_friends_of_friends` is `security definer`,
which is the easiest way in a schema like this to hand out the whole directory by
accident, so each of these is deliberate and asserted in
`scripts/question-style-check.mjs` rather than trusted:

- the subject is `auth.uid()` and **there is no user-id parameter**, so there is no
  argument the caller could get wrong
- `set search_path = public` is pinned, or a caller who can create objects on the path
  can shadow `friendships` or `profiles` and read anything
- three columns come back, named one by one. Never `select *`, so a column added to
  `profiles` later cannot leak through this path by accident
- only `status = 'accepted'` is walked. `is_friend` does not check status, so without
  this a pending request would put someone in a list
- existing friends and open requests are excluded **in SQL**, so this cannot be used to
  re-read a profile the policy already permits
- the limit is clamped to twelve, so the result cannot be paged through
- only a **count** of mutual friends comes back, never their names. Naming them would
  tell the reader facts about the suggested person's own friendships.

What it still exposes is the existence, name and picture of anyone within two accepted
friendships. That is inherent to the feature rather than an oversight, and it is a much
larger surface than `find_people`, which only answers to a term the caller supplied. If
the two-hop neighbourhood is too much, drop the `supabase.rpc` call in
`listSuggestedPeople` and the other two sources keep working unchanged.

It needs `supabase-migration-2026-10-social-graph.sql`, and it is safe to deploy before
that migration: the RPC error is swallowed and the other two sources still populate the
section. That is why the call is not awaited into a failure.

`collectSuggestionCandidates` and `toSuggestions` in `src/services/social.js` are
split out and exported so the rules can be tested without a database, the same reason
`buildExamImportPrompt` and friends are exported from the endpoint. Three behaviours are
load-bearing and asserted there: a shared group outranks a mutual friend, which outranks
a reviewer share, and a candidate whose profile the policy withheld is dropped rather
than rendered as a nameless card.

The section is hidden when there is nobody to suggest. An always-present empty panel
teaches people to scroll past it, and for someone in no groups and no friendships it
could never be anything but empty.