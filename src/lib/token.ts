/**
 * Stateless game state: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * The server keeps nothing; it only verifies signatures. Tokens carry an expiry and
 * a data version so a redeploy with a different idiom list can't misread old state.
 * Payload is signed, not encrypted: the agent can read its own game state, which is fine.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
export const MAX_TOKEN_LEN = 4096;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export interface TokenEnvelope<S> {
  g: string; // game id
  v: string; // data version
  exp: number; // unix seconds
  s: S; // game state
}

export async function signToken<S>(secret: string, env: TokenEnvelope<S>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(env)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return body + "." + b64url(sig);
}

export type VerifyResult<S> = { ok: true; env: TokenEnvelope<S> } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export async function verifyToken<S>(secret: string, token: string, now = Date.now()): Promise<VerifyResult<S>> {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LEN) return { ok: false, reason: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const sig = fromB64url(parts[1]);
  if (!sig) return { ok: false, reason: "malformed" };
  const valid = await crypto.subtle.verify("HMAC", await key(secret), sig, enc.encode(parts[0]));
  if (!valid) return { ok: false, reason: "bad_signature" };
  const bytes = fromB64url(parts[0]);
  if (!bytes) return { ok: false, reason: "malformed" };
  let env: TokenEnvelope<S>;
  try {
    env = JSON.parse(dec.decode(bytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof env?.exp !== "number" || env.exp * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, env };
}
