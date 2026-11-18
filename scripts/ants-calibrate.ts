#!/usr/bin/env bun
/**
 * Run each Jev ant over test/fixtures/calibration.yaml (+ gallery seeds for event/instruction)
 * (+ relatable_bad fixtures and published moments for the relatable ant)
 * and print P(ok) per item, to choose rules/ants.yaml `threshold`. Needs TYPESAFE_API_KEY.
 *   --ant <name>   only run that ant
 * Prints fixture ids and numbers only. ~600 tokens per call.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { ROOT, loadContent } from "./lib";
import { loadAnts, realBackend } from "./ants-lib";
import type { Entry, Submission } from "../src/lib/rules";

type Item = Submission & { id: string; expect?: string };
const fx = parse(readFileSync(join(ROOT, "test/fixtures/calibration.yaml"), "utf8"));
const asSub = (x: Item): Item => ({ ...x, flavor: x.flavor ?? "ease" });
const good: Item[] = fx.good.map(asSub);
const bad: Item[] = fx.bad.map(asSub);
const relBad: Item[] = (fx.relatable_bad ?? []).map(asSub);
const moments: Item[] = loadContent()
  .filter((f) => f.hall === "moments" && !f.id.startsWith("example-"))
  .map((f) => asSub({ ...(f.data as Entry), expect: "relatable?" } as Item));
const seeds: Item[] = fx.good_gallery
  ? loadContent().filter((f) => f.hall === "gallery").map((f) => asSub({ ...(f.data as Entry) }))
  : [];

const cfg = loadAnts();
const onlyAnt = process.argv.includes("--ant") ? process.argv[process.argv.indexOf("--ant") + 1] : undefined;
if (onlyAnt) cfg.ants = cfg.ants.filter((a) => a.name === onlyAnt);
const backend = realBackend(cfg);
const rows: string[] = [];
async function run(set: string, items: Item[], ants = cfg.ants) {
  for (const it of items)
    for (const ant of ants) {
      let v;
      try {
        v = await backend(ant, it);
      } catch (e) {
        v = { verdict: "fail", reason_code: "call_failed", p_ok: NaN, flavor: null };
      }
      rows.push(`${set}\t${it.id}\t${it.expect ?? "-"}\t${ant.name}\t${v.p_ok}\t${v.verdict}\t${v.reason_code}\t${v.flavor}`);
    }
}
await run("good", good);
await run("bad", bad);
await run("seed", seeds, cfg.ants.filter((a) => a.name !== "privacy"));
const only = (n: string) => cfg.ants.filter((a) => a.name === n);
await run("relbad", relBad, only("relatable"));
await run("moment", moments, only("relatable"));
console.log("set\tid\texpect\tant\tp_ok\tverdict\treason\tflavor\n" + rows.join("\n"));
