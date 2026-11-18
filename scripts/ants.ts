#!/usr/bin/env bun
/**
 * 蚂蚁审核 CLI。一条投稿进去 → 硬规则 → rules/ants.yaml 里的每只蚂蚁（现在 4 只）→ 汇总。
 *
 *   bun scripts/ants.ts --file sub.json [--mock pass | --mock pass,pass,fail,pass] [--emit-yaml out.yaml]
 *   bun scripts/ants.ts --issue-event "$GITHUB_EVENT_PATH" [...]      # inside the GitHub Action
 *
 * Input JSON (--file): {"id"?: "...", "flavor","lang","title","cause","course","result"}
 * Backends per ant (rules/ants.yaml):
 *   jev        (default) TYPESAFE_API_KEY, or OPENROUTER_API_KEY when jev.endpoint = openrouter
 *   workers-ai CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
 * RECESS_JEV_URL overrides the Jev endpoint (tests).
 * --mock replaces every backend with canned replies: one value for all ants, or exactly one per ant in order:
 *   pass | fail | garbage | timeout | <flavor> (= pass with that flavor)
 *
 * One attempt per ant, no retries. A failed / slow / malformed call is that ant's fail vote,
 * which sends the submission to needs-human. Nothing blocks or loops.
 *
 * stdout: one JSON report containing ONLY ids, enums, probabilities and counts — never submission text.
 * Exit code: 0 merge, 10 needs-human, 20 reject, 1 usage/config error.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { loadRules } from "./lib";
import { validateSubmission, validateEntry, publicViolations, type Submission, type Flavor } from "../src/lib/rules";
import { decide, type Vote } from "../src/lib/ants";
import { loadAnts, mockBackend, realBackend, JEV_ENDPOINTS, type AntConfig } from "./ants-lib";

const SOUVENIR_MARKER = "recess-souvenir/v1";
const ID_RE = /^s-\d{8}-[0-9a-f]{8}$/;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function die(code: string): never {
  console.log(JSON.stringify({ decision: "error", error: code }));
  process.exit(1);
  throw new Error("unreachable");
}

// ---------- input ----------

interface Input {
  id: string;
  sub: Record<string, unknown>;
  issue?: number;
}

function fromIssueEvent(path: string): Input {
  const ev = JSON.parse(readFileSync(path, "utf8"));
  const issue = ev.issue;
  if (!issue) die("no_issue_in_event");
  // Only issues opened by our own GitHub App count as submissions. Anyone can open an issue.
  const expected = process.env.RECESS_BOT_LOGIN;
  if (!expected) die("missing_bot_login");
  if (issue.user?.login !== expected) die("issue_not_from_bot");
  const body: string = issue.body ?? "";
  const m = body.match(/```json\n([\s\S]*?)\n```/);
  if (!m) die("no_payload_block");
  let rec: Record<string, unknown>;
  try {
    rec = JSON.parse(m[1]);
  } catch {
    die("payload_not_json");
  }
  if (rec.marker !== SOUVENIR_MARKER || typeof rec.id !== "string" || !ID_RE.test(rec.id)) die("payload_bad_marker");
  if (typeof rec.submission !== "object" || rec.submission === null) die("payload_no_submission");
  return { id: rec.id, sub: rec.submission as Record<string, unknown>, issue: issue.number };
}

function fromFile(path: string): Input {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const { id, ...sub } = raw;
  return { id: typeof id === "string" && ID_RE.test(id) ? id : "s-00000000-00000000", sub };
}

// ---------- main ----------

const evPath = arg("--issue-event");
const file = arg("--file");
if (!evPath && !file) die("usage");
const input = evPath ? fromIssueEvent(evPath) : fromFile(file!);
const rules = loadRules();

const hard = publicViolations(validateSubmission(rules, input.sub));
const report: Record<string, unknown> = { id: input.id, issue: input.issue ?? null };
if (hard.length) {
  report.decision = "reject";
  report.hard_rules = { passed: false, problems: hard };
  console.log(JSON.stringify(report, null, 2));
  process.exit(20);
}
report.hard_rules = { passed: true };

const mock = process.argv.find((a: string) => a.startsWith("--mock"));
const mockSpec = mock === "--mock" ? arg("--mock") ?? "pass" : mock?.split("=")[1];
const antsCfg = loadAnts();
if (!mockSpec) {
  const needJev = antsCfg.ants.some((a) => a.backend === "jev");
  const needCf = antsCfg.ants.some((a) => a.backend === "workers-ai");
  if (needJev && !process.env[JEV_ENDPOINTS[antsCfg.jev.endpoint].key]) die("missing_jev_key");
  if (needCf && (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN)) die("missing_cloudflare_credentials");
}
let backend: ReturnType<typeof realBackend>;
try {
  backend = mockSpec ? mockBackend(mockSpec, antsCfg) : realBackend(antsCfg);
} catch {
  die("mock_spec_mismatch");
}
const sub = input.sub as unknown as Submission;
const votes: Vote[] = await Promise.all(
  antsCfg.ants.map(async (a: AntConfig) => {
    try {
      return await backend(a, sub);
    } catch {
      return { ant: a.name, verdict: "fail", flavor: null, reason_code: "call_failed" } as Vote;
    }
  }),
);
const { decision, flavor } = decide(votes, antsCfg.ants.length);
Object.assign(report, {
  decision,
  flavor,
  mock: !!mockSpec,
  votes,
  tally: {
    pass: votes.filter((v) => v.verdict === "pass").length,
    fail: votes.filter((v) => v.verdict === "fail").length,
  },
});

const out = arg("--emit-yaml");
if (decision === "merge" && out) {
  const slug = input.id; // our own id, never derived from submitted text
  const entry = { id: slug, hall: "moments", flavor: flavor as Flavor, lang: sub.lang, title: sub.title, cause: sub.cause, course: sub.course, result: sub.result };
  const v = validateEntry(rules, entry, { id: slug, hall: "moments" });
  if (v.length) {
    report.decision = "needs-human";
    report.emit = { written: false, problems: publicViolations(v) };
  } else {
    writeFileSync(out, `# souvenir ${slug} — passed hard rules + ant review\n` + stringify(entry, { lineWidth: 0 }));
    report.emit = { written: true };
  }
}
console.log(JSON.stringify(report, null, 2));
process.exit(report.decision === "merge" ? 0 : 10);
