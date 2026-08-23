/**
 * FeedbackWidget.tsx
 *
 * Unobtrusive floating feedback form — a small mail icon fixed to the
 * bottom-right corner of every page. Click opens a compact panel with
 * optional name/email and a feedback message.
 *
 * Submissions POST to the fersmath-feedback Cloudflare Worker
 * (workers/feedback-worker/), which writes each one as its own file to
 * feedback/inbox/ in this repo via the GitHub API. A daily GitHub Action
 * rolls the inbox up into feedback/log.jsonl.
 *
 * Also includes a honeypot field (`website`) — hidden from real users,
 * bots that auto-fill every input tend to fill it. The worker silently
 * fakes a success for anything that fills it in, rather than rejecting
 * it, so scripts get no signal that they were caught.
 */

import { useEffect, useRef, useState, type FormEvent } from "react";
import ErrorBoundary from "./ErrorBoundary";

type SubmitState = "idle" | "sending" | "sent" | "error";

const MAX_MESSAGE_LENGTH = 900;

// Public endpoint — not a secret. The worker's own honeypot and rate
// limiting are what guard it, not obscurity.
const FEEDBACK_ENDPOINT = "https://fersmath-feedback.panto-matanov.workers.dev";

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

async function submitFeedback(payload: {
  name: string;
  email: string;
  message: string;
  website: string; // honeypot — always empty for real users
}): Promise<void> {
  const res = await fetch(FEEDBACK_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Feedback submission failed (${res.status})`);
  }
}

// ---------------------------------------------------------------------------
// Icons — dependency-free inline SVG, matching the rest of the site
// ---------------------------------------------------------------------------

function MailIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="5"
        width="19"
        height="14"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M3.5 6.5L12 13L20.5 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 5L19 19M19 5L5 19"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="#1A7F4E" strokeWidth="1.8" />
      <path
        d="M7.5 12.5L10.5 15.5L16.5 9"
        stroke="#1A7F4E"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Main widget
// ---------------------------------------------------------------------------

export default function FeedbackWidget() {
  return (
    <ErrorBoundary name="Feedback Widget">
      <FeedbackWidgetInner />
    </ErrorBoundary>
  );
}

function FeedbackWidgetInner() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the message field when the panel opens
  useEffect(() => {
    if (open && state === "idle") {
      messageRef.current?.focus();
    }
  }, [open, state]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const reset = () => {
    setName("");
    setEmail("");
    setMessage("");
    setWebsite("");
    setErrorMessage("");
    setState("idle");
  };

  const handleClose = () => {
    setOpen(false);
    // Give the close transition a moment before resetting a "sent" state
    setTimeout(reset, 200);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!message.trim() || state === "sending") return;

    setState("sending");
    try {
      await submitFeedback({
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        website,
      });
      setState("sent");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setState("error");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        zIndex: 9999,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Send feedback"
          style={{
            position: "absolute",
            bottom: "calc(100% + 0.75rem)",
            right: 0,
            width: "min(400px, calc(100vw - 3rem))",
            background: "#fff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.75rem",
            boxShadow: "0 12px 32px rgba(15, 34, 68, 0.18)",
            padding: "1.25rem",
            animation: "feedback-panel-in 0.15s ease-out",
          }}
        >
          <style>{`
            @keyframes feedback-panel-in {
              from { opacity: 0; transform: translateY(6px); }
              to { opacity: 1; transform: translateY(0); }
            }
          `}</style>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "0.9rem",
            }}
          >
            <div style={{ fontWeight: 700, color: "#0F2244", fontSize: "0.95rem" }}>
              {state === "sent" ? "Thank you" : "Send Feedback"}
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: "0.25rem",
                borderRadius: "0.25rem",
                lineHeight: 0,
              }}
            >
              <CloseIcon />
            </button>
          </div>

          {state === "sent" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "0.75rem 0 0.25rem",
                gap: "0.6rem",
              }}
            >
              <CheckIcon />
              <p style={{ margin: 0, fontSize: "0.85rem", color: "#64748b", lineHeight: 1.5 }}>
                Your feedback was sent. We read every note — thanks for helping improve
                the site.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              {/* Honeypot — hidden from real users, bots that auto-fill every
                  field tend to fill this. Off-screen rather than display:none
                  so it still "exists" to a naive scraper. */}
              <input
                type="text"
                name="website"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1}
                autoComplete="off"
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: "-9999px",
                  width: "1px",
                  height: "1px",
                  opacity: 0,
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                <input
                  type="text"
                  placeholder="Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={inputStyle}
                />
                <textarea
                  ref={messageRef}
                  placeholder="Appreciate the feedback"
                  required
                  maxLength={MAX_MESSAGE_LENGTH}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  style={{ ...inputStyle, resize: "vertical", minHeight: "8rem" }}
                />
                <div
                  style={{
                    textAlign: "right",
                    fontSize: "0.75rem",
                    color: message.length >= MAX_MESSAGE_LENGTH ? "#dc2626" : "#94a3b8",
                  }}
                >
                  {message.length} / {MAX_MESSAGE_LENGTH}
                </div>
              </div>

              {state === "error" && (
                <p style={{ margin: "0.6rem 0 0", fontSize: "0.8rem", color: "#dc2626" }}>
                  {errorMessage || "Something went wrong sending that. Please try again."}
                </p>
              )}

              <button
                type="submit"
                disabled={!message.trim() || state === "sending"}
                style={{
                  marginTop: "0.9rem",
                  width: "100%",
                  padding: "0.6rem",
                  background: !message.trim() || state === "sending" ? "#e8c35d" : "#C9A035",
                  color: "#0F2244",
                  fontWeight: 700,
                  fontSize: "0.85rem",
                  border: "none",
                  borderRadius: "0.5rem",
                  cursor: !message.trim() || state === "sending" ? "not-allowed" : "pointer",
                }}
              >
                {state === "sending" ? "Sending…" : "Send"}
              </button>
            </form>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close feedback form" : "Send feedback"}
        aria-expanded={open}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "3rem",
          height: "3rem",
          borderRadius: "50%",
          background: "#0F2244",
          color: "#fff",
          border: "none",
          boxShadow: "0 4px 14px rgba(15, 34, 68, 0.35)",
          cursor: "pointer",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.06)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        {open ? <CloseIcon /> : <MailIcon />}
      </button>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.6rem",
  border: "1px solid #e2e8f0",
  borderRadius: "0.375rem",
  fontSize: "0.85rem",
  fontFamily: "inherit",
  color: "#1e293b",
  background: "#fff",
  boxSizing: "border-box",
};
