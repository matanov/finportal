/**
 * fersmath-feedback worker
 *
 * Receives feedback form submissions from fersmath.com, applies a honeypot
 * check + per-IP rate limit, and writes each accepted submission as its own
 * new file at feedback/inbox/<id>.json in the site's GitHub repo via the
 * Contents API. One file per submission (rather than appending to a shared
 * log) means concurrent submissions never race on a file's git blob SHA.
 *
 * A separate daily GitHub Actions workflow (consolidate-feedback.yml) rolls
 * inbox files up into feedback/log.jsonl and deletes them.
 *
 * No submitter IP is ever written to the repo (it's public) — IPs are only
 * held transiently in KV for rate-limiting, with a TTL.
 */

export interface Env {
  RATE_LIMIT: KVNamespace;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  ALLOWED_ORIGINS: string;
  RATE_LIMIT_MAX: string;
  RATE_LIMIT_WINDOW_SECONDS: string;
}

const MAX_MESSAGE_LENGTH = 900;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;
const MAX_BODY_BYTES = 20_000;

// Hidden field real users never see/fill. Any non-empty value here means
// whatever submitted the form is a bot filling every field it can find.
const HONEYPOT_FIELD = "website";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function corsHeaders(origin: string | null, allowedOrigins: string[]): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  });
  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function json(body: unknown, status: number, headers: Headers): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { status, headers: responseHeaders });
}

function base64EncodeUtf8(input: string): string {
  return btoa(unescape(encodeURIComponent(input)));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim());
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin, allowedOrigins);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, headers);
    }

    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (contentLength > MAX_BODY_BYTES) {
      return json({ error: "Payload too large" }, 413, headers);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400, headers);
    }

    // Honeypot check FIRST, before touching rate limiting or GitHub: bots
    // get a fake success so they have no signal they were caught.
    const honeypot = body[HONEYPOT_FIELD];
    if (typeof honeypot === "string" && honeypot.trim() !== "") {
      return json({ ok: true }, 200, headers);
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    const name =
      typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : "";
    const email =
      typeof body.email === "string" ? body.email.trim().slice(0, MAX_EMAIL_LENGTH) : "";

    if (!message || message.length > MAX_MESSAGE_LENGTH) {
      return json(
        { error: `Message is required and must be ${MAX_MESSAGE_LENGTH} characters or fewer.` },
        400,
        headers,
      );
    }
    if (email && !EMAIL_RE.test(email)) {
      return json({ error: "Email address looks invalid." }, 400, headers);
    }

    // Per-IP rate limit. Fixed window via a KV counter with a TTL — no IP
    // is ever persisted past the window, and nothing IP-derived is written
    // to the repo.
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const max = Number(env.RATE_LIMIT_MAX);
    const windowSeconds = Number(env.RATE_LIMIT_WINDOW_SECONDS);
    const rlKey = `rl:${ip}`;
    const current = Number((await env.RATE_LIMIT.get(rlKey)) ?? "0");

    if (current >= max) {
      return json({ error: "Too many submissions. Please try again later." }, 429, headers);
    }
    await env.RATE_LIMIT.put(rlKey, String(current + 1), { expirationTtl: windowSeconds });

    const now = new Date();
    const safeTimestamp = now.toISOString().replace(/[:.]/g, "-");
    const randomSuffix = crypto.randomUUID().slice(0, 8);
    const id = `${safeTimestamp}-${randomSuffix}`;

    const record = {
      id,
      timestamp: now.toISOString(),
      name: name || null,
      email: email || null,
      message,
    };

    const path = `feedback/inbox/${id}.json`;
    const content = base64EncodeUtf8(JSON.stringify(record, null, 2));

    const ghResponse = await fetch(
      `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "fersmath-feedback-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `feedback: new submission ${id}`,
          content,
          committer: {
            name: "feedback-bot",
            email: "feedback-bot@users.noreply.github.com",
          },
        }),
      },
    );

    if (!ghResponse.ok) {
      console.error("GitHub write failed:", ghResponse.status, await ghResponse.text());
      return json(
        { error: "Could not save feedback right now. Please try again later." },
        502,
        headers,
      );
    }

    return json({ ok: true }, 200, headers);
  },
};
