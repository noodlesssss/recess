/** 24 点：四个 1–13 的数，加减乘除括号，每个数用一次，得 24。精确有理数运算，不用 eval。 */
import type { Game, Rng } from "./types";

type Q = [number, number]; // numerator, denominator (den > 0, reduced)

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
function q(n: number, d = 1): Q {
  if (d < 0) (n = -n), (d = -d);
  const g = gcd(n, d);
  return [n / g, d / g];
}
const add = (a: Q, b: Q) => q(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a: Q, b: Q) => q(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a: Q, b: Q) => q(a[0] * b[0], a[1] * b[1]);
const div = (a: Q, b: Q): Q | null => (b[0] === 0 ? null : q(a[0] * b[1], a[1] * b[0]));
const is24 = (a: Q) => a[0] === 24 && a[1] === 1;

// ---------- solver ----------

export function solve(nums: number[]): string | null {
  const go = (items: Array<{ v: Q; e: string }>): string | null => {
    if (items.length === 1) return is24(items[0].v) ? items[0].e : null;
    for (let i = 0; i < items.length; i++)
      for (let j = 0; j < items.length; j++) {
        if (i === j) continue;
        const a = items[i];
        const b = items[j];
        const rest = items.filter((_, k) => k !== i && k !== j);
        const cands: Array<{ v: Q | null; e: string }> = [
          { v: add(a.v, b.v), e: `(${a.e} + ${b.e})` },
          { v: sub(a.v, b.v), e: `(${a.e} - ${b.e})` },
          { v: mul(a.v, b.v), e: `(${a.e} × ${b.e})` },
          { v: div(a.v, b.v), e: `(${a.e} ÷ ${b.e})` },
        ];
        for (const c of cands) {
          if (!c.v) continue;
          const r = go([...rest, { v: c.v, e: c.e }]);
          if (r) return r;
        }
      }
    return null;
  };
  const r = go(nums.map((n) => ({ v: q(n), e: String(n) })));
  return r ? r.replace(/^\((.*)\)$/, "$1") : null;
}

// ---------- parser ----------

export type EvalError = "bad_char" | "syntax" | "wrong_numbers" | "div_zero" | "too_long";

export function evaluate(expr: string, nums: number[]): { ok: true; value: Q } | { ok: false; error: EvalError } {
  if (expr.length > 80) return { ok: false, error: "too_long" };
  const s = expr
    .normalize("NFKC")
    .replace(/[×xX*]/g, "*")
    .replace(/[÷/]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "");
  if (!/^[0-9+\-*/()]+$/.test(s)) return { ok: false, error: "bad_char" };
  let i = 0;
  const used: number[] = [];
  let divZero = false;
  const peek = () => s[i];
  function primary(): Q | null {
    if (peek() === "(") {
      i++;
      const v = expression();
      if (v === null || peek() !== ")") return null;
      i++;
      return v;
    }
    const m = /^[0-9]+/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    const n = Number(m[0]);
    used.push(n);
    return q(n);
  }
  function term(): Q | null {
    let v = primary();
    while (v && (peek() === "*" || peek() === "/")) {
      const op = s[i++];
      const r = primary();
      if (!r) return null;
      if (op === "*") v = mul(v, r);
      else {
        const d = div(v, r);
        if (!d) {
          divZero = true;
          return null;
        }
        v = d;
      }
    }
    return v;
  }
  function expression(): Q | null {
    let v = term();
    while (v && (peek() === "+" || peek() === "-")) {
      const op = s[i++];
      const r = term();
      if (!r) return null;
      v = op === "+" ? add(v, r) : sub(v, r);
    }
    return v;
  }
  const v = expression();
  if (divZero) return { ok: false, error: "div_zero" };
  if (v === null || i !== s.length) return { ok: false, error: "syntax" };
  const a = [...used].sort((x, y) => x - y).join(",");
  const b = [...nums].sort((x, y) => x - y).join(",");
  if (a !== b) return { ok: false, error: "wrong_numbers" };
  return { ok: true, value: v };
}

// ---------- game ----------

export interface State24 {
  nums: number[];
  solved: number;
  skipped: number;
  tries: number;
}

function deal(rng: Rng): number[] {
  for (;;) {
    const nums = Array.from({ length: 4 }, () => 1 + Math.floor(rng() * 13));
    if (solve(nums)) return nums;
  }
}

const ERR_TEXT: Record<EvalError, string> = {
  bad_char: "只能用数字、+ - × ÷ 和括号。",
  syntax: "算式没写完整，检查一下括号和运算符。",
  wrong_numbers: "四个数要各用一次，不多不少。",
  div_zero: "除以零了。",
  too_long: "算式太长了。",
};

const SKIP = new Set(["skip", "pass", "跳过", "换一题", "不会", "答案"]);

export const twentyFour: Game<State24> = {
  id: "24",
  name: "24 点",
  summary: "四个数，加减乘除，凑出 24。",
  howToPlay:
    "play(game='24') 发牌。move 填一个算式，比如 (8-4)*(7-1)，四个数各用一次。move='skip' 看一个答案并换一题。可以一直玩下去。",
  version: "1",
  start(rng) {
    const nums = deal(rng);
    return { state: { nums, solved: 0, skipped: 0, tries: 0 }, view: { numbers: nums, solved: 0 } };
  },
  move(st, move, rng) {
    const m = move.trim();
    if (SKIP.has(m.toLowerCase())) {
      const answer = solve(st.nums);
      const nums = deal(rng);
      return {
        state: { nums, solved: st.solved, skipped: st.skipped + 1, tries: 0 },
        view: { result: "skipped", one_answer: answer, next_numbers: nums, solved: st.solved },
      };
    }
    const r = evaluate(m, st.nums);
    if (!r.ok)
      return {
        state: { ...st, tries: st.tries + 1 },
        view: { result: "invalid", why: ERR_TEXT[r.error], numbers: st.nums },
      };
    if (!is24(r.value)) {
      const got = r.value[1] === 1 ? String(r.value[0]) : `${r.value[0]}/${r.value[1]}`;
      return {
        state: { ...st, tries: st.tries + 1 },
        view: { result: "not_24", got, numbers: st.nums },
      };
    }
    const nums = deal(rng);
    const solved = st.solved + 1;
    return {
      state: { nums, solved, skipped: st.skipped, tries: 0 },
      view: { result: "solved", solved, next_numbers: nums },
    };
  },
};
