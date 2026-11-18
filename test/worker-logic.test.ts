import { describe, expect, test } from "bun:test";
import { normalizeIp, callerId, deriveKey, KEY_LABEL_CALLER, KEY_LABEL_GAME } from "../src/lib/keys";
import { reserveSouvenirQuota } from "../src/quota";
import { recordStamp } from "../src/stamps";
import { buildReviewFlagPayload, openIssue } from "../src/souvenir";

/** Minimal in-memory KV; `failPuts`/`failGets` simulate quota exhaustion / outages. */
function fakeKV(opts: { failPuts?: boolean; failGets?: boolean } = {}) {
  const m = new Map<string, string>();
  return {
    m,
    async get(k: string, type?: string) {
      if (opts.failGets) throw new Error("kv get failed");
      const v = m.get(k);
      return v === undefined ? null : type === "json" ? JSON.parse(v) : v;
    },
    async put(k: string, v: string) {
      if (opts.failPuts) throw new Error("KV put() limit exceeded for the day");
      m.set(k, v);
    },
  } as unknown as KVNamespace & { m: Map<string, string> };
}

describe("caller identity", () => {
  test("IPv6 groups by /64, IPv4 as-is, mapped v4 unwrapped", () => {
    expect(normalizeIp("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:DB8:0001:0002::")).toBe("2001:db8:1:2::/64");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(normalizeIp("203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });
  test("rotating within a /64 keeps the same caller id", async () => {
    const k = await deriveKey("s", KEY_LABEL_CALLER);
    expect(await callerId(k, "2001:db8:1:2::1")).toBe(await callerId(k, "2001:db8:1:2:dead:beef:0:9"));
    expect(await callerId(k, "2001:db8:1:3::1")).not.toBe(await callerId(k, "2001:db8:1:2::1"));
  });
  test("caller and game keys are independent derivations", async () => {
    const a = await deriveKey("root", KEY_LABEL_CALLER);
    const b = await deriveKey("root", KEY_LABEL_GAME);
    expect(a).not.toBe(b);
    expect(a).not.toContain("root");
  });
});

describe("souvenir quota", () => {
  const caps = { perCaller: 2, global: 3 };
  test("per caller then global, reserved before use", async () => {
    const kv = fakeKV();
    expect(await reserveSouvenirQuota(kv, "a", "d", caps)).toEqual({ ok: true });
    expect(await reserveSouvenirQuota(kv, "a", "d", caps)).toEqual({ ok: true });
    expect(await reserveSouvenirQuota(kv, "a", "d", caps)).toEqual({ ok: false, code: "daily_limit" });
    expect(await reserveSouvenirQuota(kv, "b", "d", caps)).toEqual({ ok: true });
    expect(await reserveSouvenirQuota(kv, "c", "d", caps)).toEqual({ ok: false, code: "global_daily_limit" });
    expect(await reserveSouvenirQuota(kv, "c", "next-day", caps)).toEqual({ ok: true });
  });
  test("fails closed when KV can't write or read", async () => {
    expect(await reserveSouvenirQuota(fakeKV({ failPuts: true }), "a", "d", caps)).toEqual({ ok: false, code: "quota_unavailable" });
    expect(await reserveSouvenirQuota(fakeKV({ failGets: true }), "a", "d", caps)).toEqual({ ok: false, code: "quota_unavailable" });
  });
});

describe("stamps", () => {
  test("one mark per caller per entry, ever", async () => {
    const kv = fakeKV();
    expect(await recordStamp(kv, "x", "gallery", "a", "odd")).toMatchObject({ recorded: true, counts: { good: 0, odd: 1 } });
    expect(await recordStamp(kv, "x", "gallery", "a", "odd")).toEqual({ recorded: false, reason: "already_stamped" });
    expect(await recordStamp(kv, "x", "gallery", "a", "good")).toEqual({ recorded: false, reason: "already_stamped" });
  });
  test("one caller repeating for days can't move the needle", async () => {
    const kv = fakeKV();
    for (let day = 0; day < 10; day++) await recordStamp(kv, "x", "moments", "a", "odd");
    expect(JSON.parse(kv.m.get("stamp:x")!)).toEqual({ good: 0, odd: 1 });
  });
  test("flags for review exactly once when crossing the line", async () => {
    const kv = fakeKV();
    const flags = [];
    for (const c of ["a", "b", "c", "d", "e"]) flags.push((await recordStamp(kv, "x", "gallery", c, "odd")) as { flagForReview: boolean });
    expect(flags.map((f) => f.flagForReview)).toEqual([false, false, true, false, false]);
  });
  test("store failure is reported, not swallowed as success", async () => {
    expect(await recordStamp(fakeKV({ failPuts: true }), "x", "gallery", "a", "good")).toEqual({ recorded: false, reason: "store_unavailable" });
  });
  test("review flag issue carries only our ids and numbers", () => {
    const p = buildReviewFlagPayload("some-id", "gallery", { good: 1, odd: 3 });
    expect(p.title).toBe("odd-flag some-id");
    expect(p.labels).toEqual(["odd-flag", "needs-human"]);
    expect(p.labels).not.toContain("souvenir"); // must never enter the souvenir review workflow
  });
});

test("installation token is narrowed to the inbox repo and issues:write", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const bodies: unknown[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    bodies.push(init.body ? JSON.parse(init.body as string) : undefined);
    return url.endsWith("/access_tokens") ? Response.json({ token: "t" }) : Response.json({ number: 1 });
  }) as unknown as typeof fetch;
  await openIssue(
    { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(), GITHUB_INSTALLATION_ID: "2", SOUVENIR_REPO: "example-owner/recess-inbox" } as never,
    { title: "t", body: "b", labels: [] },
    fake,
  );
  expect(bodies[0]).toEqual({ repositories: ["recess-inbox"], permissions: { issues: "write" } });
});
