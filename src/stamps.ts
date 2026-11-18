import type { Hall } from "./lib/rules";
import { needsReview, type StampCounts } from "./lib/scoring";

export type StampResult =
  | { recorded: true; counts: StampCounts; flagForReview: boolean }
  | { recorded: false; reason: "already_stamped" | "store_unavailable" };

/**
 * One mark per caller per entry, ever — so counts are distinct callers.
 * `flagForReview` is true exactly once per entry: the first time it crosses the review line.
 * KV is last-write-wins: concurrent stamps on one entry can lose a count. Acceptable here.
 */
export async function recordStamp(kv: KVNamespace, id: string, hall: Hall, caller: string, mark: "good" | "odd"): Promise<StampResult> {
  const voterKey = `voter:${id}:${caller}`;
  try {
    if (await kv.get(voterKey)) return { recorded: false, reason: "already_stamped" };
    const cur = (await kv.get<StampCounts>(`stamp:${id}`, "json")) ?? { good: 0, odd: 0 };
    const before = needsReview(cur);
    cur[mark] += 1;
    await kv.put(voterKey, mark);
    await kv.put(`stamp:${id}`, JSON.stringify(cur));
    let flagForReview = false;
    if (!before && needsReview(cur) && !(await kv.get(`flagged:${id}`))) {
      await kv.put(`flagged:${id}`, hall);
      flagForReview = true;
    }
    return { recorded: true, counts: cur, flagForReview };
  } catch {
    return { recorded: false, reason: "store_unavailable" };
  }
}
