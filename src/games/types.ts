export type Rng = () => number;

export interface MoveResult<S> {
  /** New state, or null when the game is over (no token is issued). */
  state: S | null;
  /** Structured view returned to the agent. Only server-generated text — never echoes the move. */
  view: Record<string, unknown>;
}

export interface Game<S> {
  id: string;
  name: string;
  summary: string;
  howToPlay: string;
  /** Changes whenever saved state would be misread (e.g. word list reordered). */
  version: string;
  start(rng: Rng): MoveResult<S>;
  move(state: S, move: string, rng: Rng): MoveResult<S>;
}

export function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}
