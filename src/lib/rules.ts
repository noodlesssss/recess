/**
 * Content schema + hard rules (no AI). Shared by:
 *   - scripts/validate.ts  (CI over content/**.yaml)
 *   - the Worker           (leave_souvenir pre-check)
 *   - scripts/ants.ts      (step 1 of the ant review)
 *
 * IMPORTANT: violations never carry submitted text. They carry a field name,
 * an enum code, and (for blocked phrases) the *blocklist entry* that matched —
 * which is our own text, not the submitter's. Callers facing untrusted
 * submitters should drop `rule` too (see `publicViolations`).
 */

export const HALLS = ["gallery", "moments"] as const;
export const FLAVORS = ["triumph", "ease", "relief", "funny", "warm", "wonder"] as const;
export const LANGS = ["zh", "en", "ja"] as const;
export const TEXT_FIELDS = ["title", "cause", "course", "result"] as const;

export type Hall = (typeof HALLS)[number];
export type Flavor = (typeof FLAVORS)[number];
export type Lang = (typeof LANGS)[number];

export interface Entry {
  id: string;
  hall: Hall;
  flavor: Flavor;
  lang: Lang;
  title: string;
  cause: string;
  course: string;
  result: string;
  source?: string;
}

/** What an agent submits through leave_souvenir. */
export interface Submission {
  flavor: Flavor;
  lang: Lang;
  title: string;
  cause: string;
  course: string;
  result: string;
}

export interface Limits {
  title: number;
  field: number;
  total: number;
}

export interface CompiledRules {
  blocklist: Record<Lang, string[]>;
  limits: Record<Lang, Limits>;
}

export const VIOLATION_CODES = [
  "not_an_object",
  "missing_field",
  "unknown_field",
  "bad_type",
  "bad_enum",
  "bad_id",
  "empty",
  "too_long",
  "too_many_lines",
  "blocked_phrase",
  "link",
  "email",
  "handle",
  "code",
  "markup",
  "encoded_blob",
  "long_number",
  "forbidden_char",
  "obfuscation",
  "lang_mismatch",
  "source_required",
  "source_forbidden",
] as const;
export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface Violation {
  field: string;
  code: ViolationCode;
  /** Only for blocked_phrase: the blocklist entry (our text). Never submitted text. */
  rule?: string;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;
const SOURCE_MAX = 60;
const MAX_NEWLINES = 3;

// ---------- normalisation ----------

// Zero-width, bidi controls, BOM, word joiner, tag chars, private use, C0/C1 controls (except \n).
const FORBIDDEN_CHAR_RE = new RegExp(
  "[\\u0000-\\u0009\\u000B-\\u001F\\u007F-\\u009F\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180E" +
    "\\u200B-\\u200F\\u2028-\\u202F\\u205F-\\u206F\\u3164\\uFEFF\\uFFA0\\uFFF0-\\uFFFF\\uE000-\\uF8FF]" +
    "|[\\u{E0000}-\\u{E007F}]|[\\u{F0000}-\\u{10FFFF}]",
  "u",
);

/** NFKC + lower-case. */
function nfkc(s: string): string {
  return s.normalize("NFKC").toLowerCase();
}

/** For zh/ja phrase matching: drop everything that isn't a letter or digit. */
export function compactForm(s: string): string {
  return nfkc(s).replace(/[^\p{L}\p{N}]+/gu, "");
}

/** For en phrase matching: collapse non-alphanumerics into single spaces, pad both ends. */
export function spacedForm(s: string): string {
  return " " + nfkc(s).replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
}

export function charLen(s: string): number {
  return Array.from(s).length;
}

// ---------- pattern rules ----------

const PATTERNS: Array<{ code: ViolationCode; re: RegExp }> = [
  { code: "link", re: /:\/\/|\bwww\.|\b(?:https?|ftp|file|data|javascript|mailto)\s*:/i },
  {
    code: "link",
    re: /\b[a-z0-9-]{1,63}\s*\.\s*(?:com|net|org|io|ai|cn|dev|app|xyz|me|co|info|ly|gg|so|top|site|link|sh|run|page|tk|ru|jp|uk|us|tv|cc|biz|online|life)\b/i,
  },
  { code: "email", re: /[^\s@]+@[^\s@]+\.[^\s@]+/ },
  { code: "handle", re: /@[a-z0-9_.-]{2,}/i },
  { code: "code", re: /`|\$\(|\$\{|\{\{|\}\}|\{%|%\}|;\s*(?:rm|curl|wget|sudo|bash|sh)\b|\]\(|^\s*#{1,6}\s/im },
  { code: "markup", re: /[<>]/ },
  { code: "encoded_blob", re: /[A-Za-z0-9+/=_-]{24,}/ },
  { code: "long_number", re: /\d[\d\s-]{8,}\d/ },
  // Latin letters spelled out one by one ("i g n o r e", "i.g.n.o.r.e").
  { code: "obfuscation", re: /(?<![a-z])(?:[a-z][\s.\-_*/|]+){4,}[a-z](?![a-z])/i },
];

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN_RE = /[A-Za-z]/g;

function langMismatch(lang: Lang, text: string): boolean {
  const cjk = (text.match(CJK_RE) || []).length;
  const latin = (text.match(LATIN_RE) || []).length;
  const letters = cjk + latin;
  if (letters < 8) return false; // too short to judge
  if (lang === "en") return cjk / letters > 0.1;
  if (cjk / letters < 0.5) return true;
  if (lang === "ja") return !KANA_RE.test(text);
  return false;
}

// ---------- blocklist ----------

export function findBlockedPhrase(rules: CompiledRules, text: string): string | undefined {
  const compact = compactForm(text);
  const spaced = spacedForm(text);
  for (const lang of LANGS) {
    for (const entry of rules.blocklist[lang] ?? []) {
      if (lang === "en") {
        // word-start match on the spaced form
        if (spaced.includes(" " + spacedForm(entry).trim())) return entry;
        // and long-enough entries also on the compact form (catches "you-should", "yoUsHoUlD")
        const ce = compactForm(entry);
        if (ce.length >= 8 && compact.includes(ce)) return entry;
      } else {
        const ce = compactForm(entry);
        if (ce && compact.includes(ce)) return entry;
      }
    }
  }
  return undefined;
}

// ---------- text checks ----------

function checkText(rules: CompiledRules, field: string, text: string, out: Violation[]): void {
  if (FORBIDDEN_CHAR_RE.test(text)) out.push({ field, code: "forbidden_char" });
  const norm = text.normalize("NFKC");
  const seen = new Set<ViolationCode>();
  for (const p of PATTERNS) {
    if (!seen.has(p.code) && p.re.test(norm)) {
      seen.add(p.code);
      out.push({ field, code: p.code });
    }
  }
  const hit = findBlockedPhrase(rules, text);
  if (hit) out.push({ field, code: "blocked_phrase", rule: hit });
}

// ---------- entry / submission validation ----------

const ENTRY_KEYS = new Set(["id", "hall", "flavor", "lang", ...TEXT_FIELDS, "source"]);
const SUBMISSION_KEYS = new Set(["flavor", "lang", ...TEXT_FIELDS]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkCommon(
  rules: CompiledRules,
  obj: Record<string, unknown>,
  out: Violation[],
): { lang?: Lang } {
  if (obj.flavor !== undefined && !(FLAVORS as readonly unknown[]).includes(obj.flavor))
    out.push({ field: "flavor", code: "bad_enum" });
  let lang: Lang | undefined;
  if (obj.lang !== undefined) {
    if ((LANGS as readonly unknown[]).includes(obj.lang)) lang = obj.lang as Lang;
    else out.push({ field: "lang", code: "bad_enum" });
  }
  const limits = rules.limits[lang ?? "zh"];
  let total = 0;
  for (const f of TEXT_FIELDS) {
    const v = obj[f];
    if (v === undefined) continue;
    if (typeof v !== "string") {
      out.push({ field: f, code: "bad_type" });
      continue;
    }
    if (v.trim() === "") {
      out.push({ field: f, code: "empty" });
      continue;
    }
    const n = charLen(v);
    if (f === "title") {
      if (n > limits.title) out.push({ field: f, code: "too_long" });
      if (v.includes("\n")) out.push({ field: f, code: "too_many_lines" });
    } else {
      total += n;
      if (n > limits.field) out.push({ field: f, code: "too_long" });
      if ((v.match(/\n/g) || []).length > MAX_NEWLINES) out.push({ field: f, code: "too_many_lines" });
    }
    checkText(rules, f, v, out);
  }
  if (total > limits.total) out.push({ field: "*", code: "too_long" });
  if (lang) {
    const all = TEXT_FIELDS.map((f) => (typeof obj[f] === "string" ? obj[f] : "")).join("\n");
    if (langMismatch(lang, all)) out.push({ field: "lang", code: "lang_mismatch" });
  }
  return { lang };
}

/** Validate a content file (gallery or moments). `expected` comes from the file path. */
export function validateEntry(
  rules: CompiledRules,
  raw: unknown,
  expected?: { id?: string; hall?: Hall },
): Violation[] {
  const out: Violation[] = [];
  if (!isPlainObject(raw)) return [{ field: "*", code: "not_an_object" }];
  for (const k of Object.keys(raw)) if (!ENTRY_KEYS.has(k)) out.push({ field: k, code: "unknown_field" });
  for (const k of ["id", "hall", "flavor", "lang", ...TEXT_FIELDS])
    if (raw[k] === undefined || raw[k] === null) out.push({ field: k, code: "missing_field" });

  if (raw.id !== undefined) {
    if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) out.push({ field: "id", code: "bad_id" });
    else if (expected?.id && raw.id !== expected.id) out.push({ field: "id", code: "bad_id" });
  }
  if (raw.hall !== undefined) {
    if (!(HALLS as readonly unknown[]).includes(raw.hall)) out.push({ field: "hall", code: "bad_enum" });
    else if (expected?.hall && raw.hall !== expected.hall) out.push({ field: "hall", code: "bad_enum" });
  }
  checkCommon(rules, raw, out);

  const hall = raw.hall as Hall | undefined;
  if (hall === "gallery") {
    if (raw.source === undefined || raw.source === null) out.push({ field: "source", code: "source_required" });
  } else if (hall === "moments" && raw.source !== undefined) {
    out.push({ field: "source", code: "source_forbidden" });
  }
  if (raw.source !== undefined && raw.source !== null) {
    if (typeof raw.source !== "string") out.push({ field: "source", code: "bad_type" });
    else {
      if (raw.source.trim() === "") out.push({ field: "source", code: "empty" });
      if (charLen(raw.source) > SOURCE_MAX) out.push({ field: "source", code: "too_long" });
      checkText(rules, "source", raw.source, out);
    }
  }
  return out;
}

/** Validate an agent submission (leave_souvenir). Same rules as a moments entry. */
export function validateSubmission(rules: CompiledRules, raw: unknown): Violation[] {
  const out: Violation[] = [];
  if (!isPlainObject(raw)) return [{ field: "*", code: "not_an_object" }];
  for (const k of Object.keys(raw)) if (!SUBMISSION_KEYS.has(k)) out.push({ field: k, code: "unknown_field" });
  for (const k of SUBMISSION_KEYS)
    if (raw[k] === undefined || raw[k] === null) out.push({ field: k, code: "missing_field" });
  checkCommon(rules, raw, out);
  return out;
}

/** Strip anything but field+code, dedupe. Safe to show to anyone. */
export function publicViolations(v: Violation[]): Array<{ field: string; code: ViolationCode }> {
  const seen = new Set<string>();
  const res: Array<{ field: string; code: ViolationCode }> = [];
  for (const { field, code } of v) {
    const k = field + "|" + code;
    if (!seen.has(k)) {
      seen.add(k);
      res.push({ field, code });
    }
  }
  return res;
}

/** Normalise loaded YAML rule files into CompiledRules, failing loudly on bad shape. */
export function compileRules(blocklist: unknown, limits: unknown): CompiledRules {
  if (!isPlainObject(blocklist) || !isPlainObject(limits)) throw new Error("rules: expected mappings");
  const bl = {} as Record<Lang, string[]>;
  const lm = {} as Record<Lang, Limits>;
  for (const lang of LANGS) {
    const words = blocklist[lang];
    if (!Array.isArray(words) || !words.every((w) => typeof w === "string" && w.trim()))
      throw new Error(`rules: blocklist.${lang} must be a list of non-empty strings`);
    bl[lang] = words as string[];
    const l = limits[lang];
    if (
      !isPlainObject(l) ||
      !["title", "field", "total"].every((k) => Number.isInteger(l[k]) && (l[k] as number) > 0)
    )
      throw new Error(`rules: limits.${lang} needs positive integers title/field/total`);
    lm[lang] = { title: l.title as number, field: l.field as number, total: l.total as number };
  }
  return { blocklist: bl, limits: lm };
}
