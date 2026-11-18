import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { appJwt, buildIssuePayload, importAppKey, newSouvenirId, openIssue, InboxNotConfigured, githubConfig } from "../src/souvenir";
import type { Env } from "../src/env";

const sub = { flavor: "ease" as const, lang: "zh" as const, title: "雨停了", cause: "等构建。", course: "下雨了。", result: "都好了。" };

test("souvenir id format", () => expect(newSouvenirId(new Date("2026-11-18T00:00:00Z"), new Uint8Array([1, 2, 255, 16]))).toBe("s-20261118-0102ff10"));

test("issue payload: title has only our id; body is one parseable JSON block", () => {
  const p = buildIssuePayload("s-20261118-00000000", sub, new Date(0));
  expect(p.title).toBe("souvenir s-20261118-00000000");
  expect(p.labels).toEqual(["souvenir", "pending"]);
  const m = p.body.match(/```json\n([\s\S]*?)\n```/)!;
  expect(JSON.parse(m[1]).submission).toEqual(sub);
});

describe("GitHub App", () => {
  for (const format of ["pkcs1", "pkcs8"] as const)
    test(`JWT signs with a ${format} PEM and verifies`, async () => {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const pem = privateKey.export({ type: format, format: "pem" }).toString();
      const jwt = await appJwt("123", await importAppKey(pem), 1_700_000_000);
      const [h, b, s] = jwt.split(".");
      expect(JSON.parse(Buffer.from(b, "base64url").toString())).toEqual({ iat: 1_699_999_940, exp: 1_700_000_540, iss: "123" });
      const ok = createVerify("RSA-SHA256").update(`${h}.${b}`).verify(publicKey, Buffer.from(s, "base64url"));
      expect(ok).toBe(true);
    });

  test("missing config is an explicit error", () => {
    try {
      githubConfig({} as Env);
      throw new Error("should throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InboxNotConfigured);
      expect((e as InboxNotConfigured).missing).toEqual(["GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_INSTALLATION_ID", "SOUVENIR_REPO"]);
    }
  });

  test("openIssue: installation token then issue, against a fake GitHub", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const env = {
      GITHUB_APP_ID: "1",
      GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
      GITHUB_INSTALLATION_ID: "99",
      SOUVENIR_REPO: "example-owner/recess-inbox",
    } as Env;
    const calls: Array<{ url: string; auth: string; body?: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).authorization, body: init.body as string });
      if (url.endsWith("/access_tokens")) return Response.json({ token: "ghs_x" });
      return Response.json({ number: 7 }, { status: 201 });
    }) as unknown as typeof fetch;
    const payload = buildIssuePayload("s-20261118-00000000", sub, new Date(0));
    expect(await openIssue(env, payload, fake)).toEqual({ number: 7 });
    expect(calls[0].url).toBe("https://api.github.com/app/installations/99/access_tokens");
    expect(calls[0].auth).toStartWith("Bearer ey");
    expect(calls[1].url).toBe("https://api.github.com/repos/example-owner/recess-inbox/issues");
    expect(calls[1].auth).toBe("token ghs_x");
    expect(JSON.parse(calls[1].body!)).toEqual(payload);
  });
});
