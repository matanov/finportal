# fersmath-feedback worker

A Cloudflare Worker that receives submissions from the floating feedback
form on fersmath.com (`src/components/FeedbackWidget.tsx`) and writes each
one straight into the site's GitHub repo — no database, no third-party
storage. See the [root README's Feedback Widget section](../../README.md#feedback-widget)
for how this fits into the rest of the site; this file covers the worker
itself in operational detail.

## Architecture

```
Browser (fersmath.com)
  │  POST { name?, email?, message, website }   (website = honeypot)
  ▼
Cloudflare Worker (this project)
  │  1. Honeypot check       — non-empty `website` → fake 200, nothing written
  │  2. Validation           — message required, ≤900 chars, email format
  │  3. Rate limit            — Workers KV, per-IP, fixed window (default 5/hr)
  │  4. GitHub Contents API  — PUT one new file, authenticated with a
  │                             repo-scoped fine-grained PAT (a Worker secret)
  ▼
feedback/inbox/<timestamp>-<random>.json   (one file per submission, on `main`)
  │
  │  .github/workflows/consolidate-feedback.yml — daily cron
  ▼
feedback/log.jsonl   (all submissions, one JSON object per line, inbox cleared)
```

**Why one file per submission instead of appending to a shared log
directly:** the GitHub Contents API write requires the current file's blob
SHA, so two submissions arriving close together would race for it and one
would fail. A new file per submission has no such conflict — every write is
independent. The daily consolidation job (`scripts/consolidate-feedback.mjs`,
runs from the repo root) then rolls everything up into one readable log and
deletes the individual files.

**Why a feedback commit doesn't trigger a site redeploy:** this worker
authenticates with a real PAT, not the default `GITHUB_TOKEN` GitHub Actions
uses internally — so GitHub's usual anti-recursion guard (which stops a
workflow's own commits from re-triggering `on: push` workflows) does not
apply here. `.github/workflows/deploy.yml` has an explicit
`paths-ignore: feedback/**` for exactly this reason. Don't remove it, or
every single feedback submission will trigger a full site rebuild.

**Privacy:** this repo is public. No submitter IP address is ever written
to it — the worker only holds an IP transiently in Workers KV for rate
limiting, with a TTL (`RATE_LIMIT_WINDOW_SECONDS`), and that KV store isn't
part of the repo at all.

## Local development

```sh
npm install
npx wrangler dev
```

This runs the worker locally with an emulated (local, ephemeral) KV
namespace — rate limiting works, but there's no real `GITHUB_TOKEN` unless
you set one, so the GitHub write step will fail with a 502. That's expected;
it's enough to exercise the honeypot, validation, and rate-limit logic:

```sh
curl -X POST http://localhost:8787 \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:4321" \
  -d '{"message":"test"}'
```

## Deployment

```sh
npx wrangler deploy
```

Deploys to `https://fersmath-feedback.<your-cloudflare-subdomain>.workers.dev`
(no custom domain/DNS involved — see `ALLOWED_ORIGINS` in `wrangler.toml` for
CORS instead). Wrangler prints the URL; if it ever changes (e.g. the worker
is renamed or redeployed under a different account), update
`FEEDBACK_ENDPOINT` in `src/components/FeedbackWidget.tsx` to match.

### One-time setup (already done for the current deployment)

1. **KV namespace** — `npx wrangler kv namespace create RATE_LIMIT`, then
   paste the printed `id` into `wrangler.toml`'s `[[kv_namespaces]]` block.
2. **GitHub token** — see below.

## The GitHub token — what it is, and rotating it

`GITHUB_TOKEN` is a **fine-grained GitHub personal access token**, scoped to:

- **Repository access**: only `matanov/finportal` — no other repos.
- **Permissions**: `Contents: Read and write` — nothing else (not Actions,
  not Issues, not admin). This is the minimum needed to create files via the
  Contents API.

It's stored as a Cloudflare Worker secret (`wrangler secret put
GITHUB_TOKEN`), never in `wrangler.toml`, never committed anywhere. Only the
worker's own outbound API calls to GitHub can use it.

### ⚠️ It can expire

Fine-grained PATs can be created with an expiration date (up to 1 year, or
no expiration). **Check what this one is set to** at
https://github.com/settings/personal-access-tokens — find the token used
here and look at its "Expires on" date.

If it has an expiration date, **GitHub emails the token owner about a week
before it expires.** Treat that email as the signal to rotate — there's no
other alerting on this. If the token silently expires without being
rotated, every feedback submission will start failing with a generic
"Could not save feedback right now" (the worker's GitHub API call gets a
401, which it turns into a 502 to the visitor) — the form will look broken
to anyone using it, with no obvious cause from the outside. It's worth
occasionally checking `npx wrangler tail` or the Worker's logs in the
Cloudflare dashboard if feedback volume unexpectedly drops to zero.

### How to rotate it

1. Go to https://github.com/settings/personal-access-tokens, find the
   existing token, and click **Regenerate token** (this keeps the same
   repository/permission scope and just issues a new value with a fresh
   expiration — simplest option). If you'd rather create a brand new token
   instead, give it the exact same scope described above (only
   `matanov/finportal`, `Contents: Read and write`).
2. Copy the new token value — GitHub only shows it once.
3. From `workers/feedback-worker/`, run:
   ```sh
   npx wrangler secret put GITHUB_TOKEN
   ```
   and paste the new value when prompted. This takes effect immediately —
   no redeploy needed.
4. If you created a brand new token rather than regenerating, delete the
   old one from the GitHub tokens page.
5. Verify it worked — send a real test submission and confirm a new file
   shows up in `feedback/inbox/` on GitHub:
   ```sh
   curl -X POST https://fersmath-feedback.<your-subdomain>.workers.dev \
     -H "Content-Type: application/json" \
     -H "Origin: https://fersmath.com" \
     -d '{"message":"token rotation test — safe to delete"}'
   ```
   Then delete that test file from `feedback/inbox/` before the next daily
   consolidation run picks it up (`.github/workflows/consolidate-feedback.yml`,
   12:00 UTC), so it doesn't end up permanently in `feedback/log.jsonl`.

## Configuration reference (`wrangler.toml`)

| Key | Meaning |
| :--- | :--- |
| `GITHUB_OWNER`, `GITHUB_REPO` | Where submissions get committed |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to call this worker from a browser (CORS only — see below) |
| `RATE_LIMIT_MAX` | Max submissions per IP per window (default 5) |
| `RATE_LIMIT_WINDOW_SECONDS` | Window length in seconds (default 3600) |
| `[[kv_namespaces]] RATE_LIMIT` | Workers KV binding used for the rate-limit counters |

**Note on CORS vs. abuse prevention:** `ALLOWED_ORIGINS` only affects
browsers — it stops a random website's JavaScript from calling this worker
using a visitor's browser session. It does **not** stop a bot or script
POSTing directly (CORS is a browser-enforced mechanism with nothing to
enforce it outside one). The honeypot and rate limit are the actual abuse
defenses; CORS is just there so the real form works correctly.

## Anti-spam design

Two layers, chosen deliberately over adding Cloudflare Turnstile (a CAPTCHA)
to keep setup simple — see the root README for the tradeoff discussion:

1. **Honeypot** (`website` field): invisible to real users (off-screen
   positioning, not `display:none`, so naive bots still find and fill it),
   never sent by the real form UI. Anything that fills it gets a fake `200
   {"ok":true}` response and nothing is written or rate-limited — it doesn't
   even learn it was caught.
2. **Rate limit**: per-IP, fixed window, via Workers KV (`RATE_LIMIT_MAX`
   per `RATE_LIMIT_WINDOW_SECONDS`). Not perfectly atomic under heavy
   concurrent load from a single IP (KV read-then-write isn't transactional),
   but sufficient against casual abuse at the volume this form expects.

If spam becomes a real problem, Cloudflare Turnstile is the natural next
layer — free, and a native fit since this is already a Cloudflare Worker.
