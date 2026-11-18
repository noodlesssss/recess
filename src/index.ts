import { createMcpHandler } from "agents/mcp/server";
import type { Env } from "./env";
import { createServer, STATS } from "./server";
import { aboutText, plainGetOnMcp } from "./about";
import { callerId, deriveKey, KEY_LABEL_CALLER, KEY_LABEL_GAME } from "./lib/keys";


const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET")
      return new Response(aboutText(url.origin, STATS), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (url.pathname !== "/mcp") return new Response("not found", { status: 404 });
    // A plain GET (someone pasted the link): point at the install guide. MCP clients opening an
    // SSE stream send Accept: text/event-stream and still get the handler's own answer.
    if (request.method === "GET" && !(request.headers.get("accept") ?? "").includes("text/event-stream"))
      return plainGetOnMcp(url.origin);

    // No silent fallback: without the root secret, caller ids and game tokens would be forgeable.
    if (!env.GAME_SECRET) return json(503, { error: "not_configured" });
    const [callerKey, gameKey] = await Promise.all([
      deriveKey(env.GAME_SECRET, KEY_LABEL_CALLER),
      deriveKey(env.GAME_SECRET, KEY_LABEL_GAME),
    ]);
    const key = await callerId(callerKey, request.headers.get("cf-connecting-ip") ?? "local");
    const { success } = await env.RL_READ.limit({ key });
    if (!success) return json(429, { error: "rate_limited" }, { "retry-after": "60" });

    return createMcpHandler(() => createServer(env, { key, gameKey, defer: (p) => ctx.waitUntil(p) }))(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
