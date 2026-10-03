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

## AI generation

The provider keys are on free tiers with no billing attached, so the harm from
abuse is not a bill. It is quota exhaustion: the provider starts refusing the
account, and then the owner's own generation breaks too. Free tiers also cap
requests per minute, which makes concurrency more damaging than total volume.

`api/generate-reviewer.js` is built around that:

- Anonymous callers may generate. There is no billing, so making people sign up to
  try the app is not worth it.
- A signed-in request is keyed on `auth.uid()`, which is derived inside
  `consume_ai_rate_limit` and cannot be supplied by the client. An anonymous request
  is keyed on a salted sha256 of the address, and gets a lower cap.
- The limit is enforced in Postgres through `consume_ai_rate_limit`, which requires
  `supabase-migration-2026-10-ai-abuse.sql` to have been run. Without it the function
  logs an error and falls back to a per-instance `Map`, which does not hold across the
  fleet.
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

Admin access is a row in `private.admin_emails`, or `app_metadata.admin = true`. Do not
add an address to a committed SQL file.