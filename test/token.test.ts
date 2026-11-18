import { expect, test } from "bun:test";
import { signToken, verifyToken } from "../src/lib/token";

const env = { g: "24", v: "24:1", exp: Math.floor(Date.now() / 1000) + 60, s: { nums: [1, 2, 3, 4] } };

test("round trip", async () => {
  const t = await signToken("k", env);
  expect(await verifyToken("k", t)).toEqual({ ok: true, env });
});
test("wrong key / tampered body / tampered sig", async () => {
  const t = await signToken("k", env);
  expect((await verifyToken("other", t)).ok).toBe(false);
  const [body, sig] = t.split(".");
  const forged = btoa(JSON.stringify({ ...env, s: { nums: [6, 6, 6, 6] } })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  expect(await verifyToken("k", `${forged}.${sig}`)).toEqual({ ok: false, reason: "bad_signature" });
  expect(await verifyToken("k", `${body}.${sig.slice(0, -3)}AAA`)).toEqual({ ok: false, reason: "bad_signature" });
});
test("expired", async () => {
  const t = await signToken("k", { ...env, exp: 1 });
  expect(await verifyToken("k", t)).toEqual({ ok: false, reason: "expired" });
});
test("malformed", async () => {
  for (const t of ["", "abc", "a.b.c", "!!.??", "x".repeat(5000)]) expect((await verifyToken("k", t)).ok).toBe(false);
});
