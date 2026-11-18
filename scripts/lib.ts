import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { parse } from "yaml";
import { compileRules, type CompiledRules, type Hall, HALLS } from "../src/lib/rules";

export const ROOT = join(import.meta.dir, "..");

export function loadRules(root = ROOT): CompiledRules {
  const bl = parse(readFileSync(join(root, "rules/blocklist.yaml"), "utf8"));
  const lm = parse(readFileSync(join(root, "rules/limits.yaml"), "utf8"));
  return compileRules(bl, lm);
}

export interface ContentFile {
  path: string; // repo-relative
  hall: Hall;
  id: string; // from filename
  data: unknown;
  parseError?: boolean;
}

export function loadContent(root = ROOT): ContentFile[] {
  const out: ContentFile[] = [];
  for (const hall of HALLS) {
    const dir = join(root, "content", hall);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const rel = `content/${hall}/${name}`;
      if (!name.endsWith(".yaml")) {
        out.push({ path: rel, hall, id: name, data: undefined, parseError: true });
        continue;
      }
      try {
        // Plain YAML only: no custom tags, no aliases blowing up into huge docs.
        const data = parse(readFileSync(join(dir, name), "utf8"), { maxAliasCount: 0, customTags: [] });
        out.push({ path: rel, hall, id: basename(name, ".yaml"), data });
      } catch {
        out.push({ path: rel, hall, id: basename(name, ".yaml"), data: undefined, parseError: true });
      }
    }
  }
  return out;
}
