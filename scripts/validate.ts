#!/usr/bin/env bun
/**
 * Hard-rule check over content/**.yaml. Exit 1 on any violation.
 * Output is file path + field + code (+ blocklist entry). It never prints content text,
 * so it is safe to run on submissions and paste the log anywhere.
 */
import { loadContent, loadRules } from "./lib";
import { validateEntry } from "../src/lib/rules";

const rules = loadRules();
const files = loadContent();
let bad = 0;
const ids = new Set<string>();
for (const f of files) {
  const problems = f.parseError
    ? [{ field: "*", code: "not_an_object" as const }]
    : validateEntry(rules, f.data, { id: f.id, hall: f.hall });
  if (ids.has(f.id)) problems.push({ field: "id", code: "bad_id" });
  ids.add(f.id);
  if (problems.length) {
    bad++;
    for (const p of problems)
      console.log(`✗ ${f.path}  ${p.field}: ${p.code}${"rule" in p && p.rule ? ` [blocklist: ${p.rule}]` : ""}`);
  }
}
console.log(`${files.length} files, ${bad} with problems`);
process.exit(bad ? 1 : 0);
