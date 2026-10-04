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