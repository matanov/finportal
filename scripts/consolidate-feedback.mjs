#!/usr/bin/env node
/**
 * consolidate-feedback.mjs
 *
 * Rolls up individual feedback/inbox/*.json submissions (written one-per-file
 * by the Cloudflare Worker, so concurrent submissions never race on a git
 * blob SHA) into the single running feedback/log.jsonl, then removes the
 * consolidated inbox files. Run daily by
 * .github/workflows/consolidate-feedback.yml; a no-op when the inbox is
 * empty, so the workflow's commit step has nothing to push.
 */

import { readdirSync, readFileSync, appendFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const INBOX_DIR = "feedback/inbox";
const LOG_FILE = "feedback/log.jsonl";

if (!existsSync(INBOX_DIR)) {
  console.log("No inbox directory — nothing to consolidate.");
  process.exit(0);
}

const files = readdirSync(INBOX_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.log("Inbox is empty — nothing to consolidate.");
  process.exit(0);
}

const entries = [];
for (const file of files) {
  const path = join(INBOX_DIR, file);
  try {
    entries.push(JSON.parse(readFileSync(path, "utf-8")));
  } catch (err) {
    console.error(`Skipping unparseable file ${file}: ${err.message}`);
  }
}

entries.sort((a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? ""));

for (const entry of entries) {
  appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
}

for (const file of files) {
  unlinkSync(join(INBOX_DIR, file));
}

console.log(`Consolidated ${entries.length} feedback submission(s) into ${LOG_FILE}.`);
