/** 成语接龙：用上一个成语的最后一个字开头（同字，不算同音）。服务器带词表，接不上的算你赢。 */
import type { Game, Rng } from "./types";
import { pick } from "./types";
import { IDIOMS, IDIOM_LIST_VERSION } from "./idioms";

const INDEX = new Map<string, number>(IDIOMS.map((w, i) => [w, i]));
const BY_HEAD = new Map<string, number[]>();
IDIOMS.forEach((w, i) => {
  const h = Array.from(w)[0];
  const list = BY_HEAD.get(h);
  if (list) list.push(i);
  else BY_HEAD.set(h, [i]);
});
const first = (w: string) => Array.from(w)[0];
const last = (w: string) => Array.from(w).at(-1)!;

export const MAX_ROUNDS = 30;
const GIVE_UP = new Set(["认输", "放弃", "不会", "give up", "giveup", "pass"]);

export interface StateChain {
  last: number; // index of the idiom the agent must continue
  used: number[];
}

function candidates(char: string, used: Set<number>): number[] {
  return (BY_HEAD.get(char) ?? []).filter((i) => !used.has(i));
}

/** Server reply: prefer idioms the agent can continue from, so the game lasts a bit. */
function reply(char: string, used: Set<number>, rng: Rng): number | null {
  const c = candidates(char, used);
  if (!c.length) return null;
  const open = c.filter((i) => candidates(last(IDIOMS[i]), new Set([...used, i])).length > 0);
  return pick(open.length ? open : c, rng);
}

export const idiomChain: Game<StateChain> = {
  id: "idiom-chain",
  name: "成语接龙",
  summary: "用上一个成语的最后一个字开头，接一个新成语。",
  howToPlay:
    `play(game='idiom-chain') 开局，服务器先出一个成语。move 填一个四字成语，开头的字要和上一个成语的最后一个字相同（同字，不算同音），用过的不能再用。` +
    `我接不上就算你赢；你接不上可以 move='认输'，我告诉你几个能接的。最多 ${MAX_ROUNDS} 轮。词表有限（${IDIOMS.length} 条），有的成语我不认识，换一个就好。`,
  version: IDIOM_LIST_VERSION,
  start(rng) {
    const starters = IDIOMS.map((_, i) => i).filter((i) => candidates(last(IDIOMS[i]), new Set([i])).length > 0);
    const i = pick(starters, rng);
    return {
      state: { last: i, used: [i] },
      view: { mine: IDIOMS[i], your_turn_starts_with: last(IDIOMS[i]), round: 1 },
    };
  },
  move(st, move, rng) {
    const used = new Set(st.used);
    const prev = IDIOMS[st.last];
    const need = last(prev);
    const m = move.normalize("NFKC").replace(/\s+/g, "").trim();
    if (GIVE_UP.has(m.toLowerCase())) {
      const some = candidates(need, used).slice(0, 3).map((i) => IDIOMS[i]);
      return {
        state: null,
        view: { result: "gave_up", could_have_been: some, rounds: st.used.length, note: "这局结束了。再来一局就 play(game='idiom-chain')。" },
      };
    }
    const idx = INDEX.get(m);
    if (idx === undefined)
      return {
        state: st,
        view: { result: "unknown_idiom", why: "这个不在我的词表里（只认四字成语），换一个试试。", mine: prev, your_turn_starts_with: need },
      };
    if (first(m) !== need)
      return {
        state: st,
        view: { result: "wrong_start", why: `要用「${need}」字开头。`, mine: prev, your_turn_starts_with: need },
      };
    if (used.has(idx))
      return {
        state: st,
        view: { result: "already_used", why: "这个这局用过了。", mine: prev, your_turn_starts_with: need },
      };
    used.add(idx);
    const yours = IDIOMS[idx];
    const r = reply(last(yours), used, rng);
    if (r === null)
      return { state: null, view: { result: "you_win", yours, why: `我想不出「${last(yours)}」字开头的了。你赢了。`, rounds: used.size } };
    used.add(r);
    if (used.size >= MAX_ROUNDS * 2)
      return { state: null, view: { result: "finished", yours, mine: IDIOMS[r], why: `接了 ${MAX_ROUNDS} 轮，今天就到这儿。`, rounds: used.size } };
    return {
      state: { last: r, used: [...used] },
      view: { result: "ok", yours, mine: IDIOMS[r], your_turn_starts_with: last(IDIOMS[r]), round: Math.ceil(used.size / 2) },
    };
  },
};
