/** Ranking, review and takedown rules for stamps. Shared by build (snapshot) and Worker (live check). */
import type { Hall } from "./rules";

export interface StampCounts {
  /** Distinct callers (hashed IPv4 / IPv6 /64) who marked it good / odd. Each caller counts once per entry, ever. */
  good: number;
  odd: number;
}

const oddShare = (c: StampCounts) => (c.good + c.odd > 0 ? c.odd / (c.good + c.odd) : 0);

/** A human should look: odd from >= 3 distinct callers and > 30% of marks. Applies to both halls. */
export const REVIEW_MIN_ODD = 3;
/** Hidden right away: moments only, odd from >= 5 distinct callers and > 30% of marks. */
export const TAKEDOWN_MIN_ODD = 5;
export const ODD_SHARE = 0.3;

export function needsReview(c: StampCounts | undefined): boolean {
  return !!c && c.odd >= REVIEW_MIN_ODD && oddShare(c) > ODD_SHARE;
}

/**
 * Gallery entries are never taken down by stamps — they were chosen by people, so a
 * handful of callers marking them odd only flags them for review.
 */
export function isTakenDown(c: StampCounts | undefined, hall: Hall): boolean {
  return hall === "moments" && !!c && c.odd >= TAKEDOWN_MIN_ODD && oddShare(c) > ODD_SHARE;
}

/** Weight for wander(). Grows slowly with `good` so a few stamps can't dominate. */
export function weightOf(c: StampCounts | undefined): number {
  if (!c) return 1;
  return 1 + Math.log2(1 + Math.max(0, c.good));
}
