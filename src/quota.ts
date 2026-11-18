/**
 * Souvenir quotas, reserved BEFORE the issue is opened. Fails closed: if KV can't be read
 * or written (e.g. the daily write quota is used up), the submission is refused.
 *
 * KV has no atomic increment, so under heavy concurrency a few extra submissions can slip
 * past the global cap. The RL_SOUVENIR rate-limit binding (global key) bounds that burst.
 */
export interface SouvenirCaps {
  perCaller: number;
  global: number;
}

export type QuotaResult = { ok: true } | { ok: false; code: "daily_limit" | "global_daily_limit" | "quota_unavailable" };

const TTL = 2 * 86400;

export async function reserveSouvenirQuota(kv: KVNamespace, caller: string, day: string, caps: SouvenirCaps): Promise<QuotaResult> {
  const callerKey = `cap:souvenir:${day}:${caller}`;
  const globalKey = `cap:souvenir:${day}:_global`;
  let mine: number;
  let all: number;
  try {
    [mine, all] = (await Promise.all([kv.get(callerKey), kv.get(globalKey)])).map((v) => Number(v ?? 0));
  } catch {
    return { ok: false, code: "quota_unavailable" };
  }
  if (!Number.isFinite(mine) || !Number.isFinite(all)) return { ok: false, code: "quota_unavailable" };
  if (all >= caps.global) return { ok: false, code: "global_daily_limit" };
  if (mine >= caps.perCaller) return { ok: false, code: "daily_limit" };
  try {
    await kv.put(globalKey, String(all + 1), { expirationTtl: TTL });
    await kv.put(callerKey, String(mine + 1), { expirationTtl: TTL });
  } catch {
    return { ok: false, code: "quota_unavailable" };
  }
  return { ok: true };
}

export function parseCap(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
