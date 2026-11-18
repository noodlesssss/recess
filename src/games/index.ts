import type { Game } from "./types";
import { twentyFour } from "./twentyfour";
import { idiomChain } from "./idiomchain";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAMES: Record<string, Game<any>> = {
  [twentyFour.id]: twentyFour,
  [idiomChain.id]: idiomChain,
};
