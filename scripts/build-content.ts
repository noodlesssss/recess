#!/usr/bin/env bun
/**
 * Bundle content + rules into src/generated/bundle.json for the Worker.
 *   --exclude-examples      drop ids starting with "example-" (used by deploy)
 *   --stamps <file.json>    snapshot {id: {good, odd}} → weights + takedowns
 * Refuses to build if any file fails the hard rules.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadContent, loadRules, ROOT } from "./lib";
import { validateEntry, type Entry } from "../src/lib/rules";
import { isTakenDown, weightOf, type StampCounts } from "../src/lib/scoring";

const args = process.argv.slice(2);
const excludeExamples = args.includes("--exclude-examples");
const si = args.indexOf("--stamps");
const stamps: Record<string, StampCounts> = si >= 0 ? JSON.parse(readFileSync(args[si + 1], "utf8")) : {};

const rules = loadRules();
const entries: Array<Entry & { weight: number }> = [];
let failed = 0;
let takenDown = 0;
for (const f of loadContent()) {
  const v = f.parseError ? [1] : validateEntry(rules, f.data, { id: f.id, hall: f.hall });
  if (v.length) {
    failed++;
    continue;
  }
  const e = f.data as Entry;
  if (excludeExamples && e.id.startsWith("example-")) continue;
  if (isTakenDown(stamps[e.id], e.hall)) {
    takenDown++;
    continue;
  }
  entries.push({ ...e, weight: weightOf(stamps[e.id]) });
}
if (failed) {
  console.error(`${failed} content files fail the hard rules; run \`bun run validate\`. Not building.`);
  process.exit(1);
}
const version = createHash("sha256").update(JSON.stringify({ entries, rules })).digest("hex").slice(0, 12);
mkdirSync(join(ROOT, "src/generated"), { recursive: true });
writeFileSync(join(ROOT, "src/generated/bundle.json"), JSON.stringify({ version, rules, entries }, null, 1) + "\n");
console.log(`bundle ${version}: ${entries.length} entries (${takenDown} taken down by stamps)`);
