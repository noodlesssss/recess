/** Ant backends (jev / workers-ai / mock) and rules/ants.yaml loading. Shared by ants.ts and ants-calibrate.ts. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { ROOT } from "./lib";
import { FLAVORS, type Submission } from "../src/lib/rules";
import {
  ANT_JSON_SCHEMA,
  ANT_SYSTEM_PROMPT,
  antUserMessage,
  checkJevAnt,
  jevQuestions,
  jevState,
  parseJevVote,
  parseVote,
  type JevAntConfig,
  type Vote,
} from "../src/lib/ants";

// ---------- config ----------

export interface WorkersAiAnt {
  name: string;
  backend: "workers-ai";
  model: string;
}
export type AntConfig = JevAntConfig | WorkersAiAnt;
export interface AntsFile {
  jev: { endpoint: "typesafe" | "openrouter"; model: string; timeout_ms: number };
  threshold: number;
  ants: AntConfig[];
}

export const JEV_ENDPOINTS = {
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", key: "TYPESAFE_API_KEY" },
  openrouter: { url: "https://openrouter.ai/api/alpha/decisions", key: "OPENROUTER_API_KEY" },
} as const;

export function loadAnts(): AntsFile {
  const cfg = parse(readFileSync(join(ROOT, "rules/ants.yaml"), "utf8")) as AntsFile;
  if (!(cfg.threshold > 0 && cfg.threshold < 1)) throw new Error("ants: threshold must be in (0,1)");
  if (!JEV_ENDPOINTS[cfg.jev?.endpoint]) throw new Error("ants: jev.endpoint must be typesafe|openrouter");
  if (!Array.isArray(cfg.ants) || cfg.ants.length < 1) throw new Error("ants: no ants");
  for (const a of cfg.ants) {
    if (a.backend === "jev") checkJevAnt(a);
    else if (a.backend !== "workers-ai" || !a.model) throw new Error(`ants: ${a.name}: bad backend`);
  }
  return cfg;
}

// ---------- backends ----------

/** One attempt, hard timeout. Throws on anything but a 2xx JSON response. */
async function postJson(url: string, auth: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return res.json();
}

export type Backend = (ant: AntConfig, sub: Submission) => Promise<Vote>;

export function realBackend(cfg: AntsFile): Backend {
  const ep = JEV_ENDPOINTS[cfg.jev.endpoint];
  const model = cfg.jev.endpoint === "openrouter" && !cfg.jev.model.startsWith("~") ? `~typesafe/${cfg.jev.model}` : cfg.jev.model;
  return async (ant, sub) => {
    if (ant.backend === "jev") {
      const key = process.env[ep.key];
      if (!key) throw new Error("missing_key");
      const r = await postJson(process.env.RECESS_JEV_URL || ep.url, key, { model, state: jevState(sub), questions: jevQuestions(ant) }, cfg.jev.timeout_ms);
      return parseJevVote(ant, r, cfg.threshold);
    }
    const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!acct || !token) throw new Error("missing_key");
    const r = (await postJson(
      `https://api.cloudflare.com/client/v4/accounts/${acct}/ai/run/${ant.model}`,
      token,
      {
        messages: [
          { role: "system", content: ANT_SYSTEM_PROMPT },
          { role: "user", content: antUserMessage(sub) },
        ],
        response_format: { type: "json_schema", json_schema: ANT_JSON_SCHEMA },
        temperature: 0,
        max_tokens: 80,
      },
      cfg.jev.timeout_ms,
    )) as { success?: boolean; result?: { response?: unknown } };
    if (!r.success) throw new Error("not_success");
    return parseVote(ant.name, r.result?.response);
  };
}

/** Canned replies in each backend's real wire format, so parsing is exercised too. */
export function mockBackend(spec: string, cfg: AntsFile): Backend {
  const plan = spec.split(",").map((x) => x.trim());
  // One value for every ant, or exactly one per ant — never silently recycled.
  if (plan.length !== 1 && plan.length !== cfg.ants.length) throw new Error("mock_spec_mismatch");
  let i = 0;
  return async (ant, sub) => {
    const p = plan[i++ % plan.length] || "pass";
    if (p === "timeout") throw new Error("timeout");
    const flavor = (FLAVORS as readonly string[]).includes(p) ? p : sub.flavor ?? "ease";
    if (ant.backend === "workers-ai") {
      if (p === "garbage") return parseVote(ant.name, "Sure! PASS");
      const raw = p === "fail" ? { verdict: "fail", flavor, reason_code: "instruction" } : { verdict: "pass", flavor, reason_code: "ok" };
      return parseVote(ant.name, raw);
    }
    if (p === "garbage") return parseJevVote(ant, { answers: { verdict: { type: "choice", choice: "maybe" } } }, cfg.threshold);
    const other = Object.keys(ant.options).find((k) => k !== "ok")!;
    const pOk = p === "fail" ? 0.1 : 0.9;
    const fprobs = Object.fromEntries(FLAVORS.map((f) => [f, f === flavor ? 0.75 : 0.05]));
    return parseJevVote(
      ant,
      {
        answers: {
          verdict: { type: "choice", choice: pOk >= 0.5 ? "ok" : other, probabilities: { ok: pOk, [other]: 1 - pOk } },
          flavor: { type: "choice", choice: flavor, probabilities: fprobs },
        },
      },
      cfg.threshold,
    );
  };
}

