/** Key derivation and caller identity. */

const enc = new TextEncoder();

/** Derive an independent sub-key from the one deployed secret: HMAC-SHA256(secret, label), hex. */
export async function deriveKey(secret: string, label: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(label)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const KEY_LABEL_CALLER = "recess/caller-id/v1";
export const KEY_LABEL_GAME = "recess/game-token/v1";

/**
 * Group addresses the way a single client can rotate them:
 * IPv4 as-is, IPv6 by its /64 (an end site usually controls a whole /64).
 */
export function normalizeIp(ip: string): string {
  ip = ip.trim().toLowerCase();
  if (!ip.includes(":")) return ip;
  const v4tail = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/); // ::ffff:1.2.3.4
  if (v4tail && /^(::ffff:|::)$/.test(v4tail[1])) return v4tail[2];
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => (parseInt(x || "0", 16) || 0).toString(16)).join(":") + "::/64";
}

/** Stable, non-reversible caller id: HMAC(caller-key, normalised ip), 96 bits hex. */
export async function callerId(callerKey: string, ip: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(callerKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(normalizeIp(ip))));
  return Array.from(sig.slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
}
