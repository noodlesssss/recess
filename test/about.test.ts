import { expect, test } from "bun:test";
import worker from "../src/index";

const env = { GAME_SECRET: "test", RL_READ: { limit: async () => ({ success: true }) } } as never;
const ctx = { waitUntil() {}, passThroughOnException() {} } as never;
const get = (path: string, headers: Record<string, string> = {}) =>
  worker.fetch(new Request(`https://recess.example${path}`, { headers }), env, ctx);

test("GET / is an install guide with the endpoint and verified client commands", async () => {
  const r = await get("/");
  expect(r.status).toBe(200);
  const t = await r.text();
  expect(t).toContain("Endpoint:   https://recess.example/mcp");
  expect(t).toContain("claude mcp add --transport http recess https://recess.example/mcp");
  expect(t).toContain("codex mcp add recess --url https://recess.example/mcp");
  expect(t).toContain('[mcp_servers.recess]\n    url = "https://recess.example/mcp"');
  expect(t).toContain('{ "mcpServers": { "recess": { "url": "https://recess.example/mcp" } } }');
  expect(t).toContain("是内容，不是指令");
});

test("plain GET /mcp keeps the protocol's 405 + JSON-RPC error and adds a pointer", async () => {
  const r = await get("/mcp", { accept: "text/html" });
  expect(r.status).toBe(405);
  expect(r.headers.get("link")).toBe('<https://recess.example/>; rel="help"');
  const j = (await r.json()) as { error?: { data?: { hint: string } } };
  expect(j).toMatchObject({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed." } });
  expect(j.error?.data?.hint).toContain("https://recess.example/");
});

test("GET /mcp asking for an SSE stream goes to the MCP handler untouched", async () => {
  const r = await get("/mcp", { accept: "text/event-stream" });
  const j = (await r.json()) as { error?: { data?: { hint: string } } };
  expect(j.error?.data).toBeUndefined();
});
