// HTTP transport for the operator HMI: the browser app (TypeScript served with types stripped),
// a state stream (SSE) and same-origin JSON requests. Loopback only by default. Credentials never
// leave the service process; nothing here exposes a tag write beyond the four operator requests.

import { readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { fileURLToPath } from "node:url";
import type { HmiService } from "./service.ts";
import type { HmiStreamMessage } from "./protocol.ts";

const WEB = fileURLToPath(new URL("./web/", import.meta.url));
const PROTOCOL = fileURLToPath(new URL("./protocol.ts", import.meta.url));
const MAX_BODY = 32 * 1024;
const cache = new Map<string, { mtimeMs: number; body: string }>();

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw Object.assign(new Error("Expected application/json"), { status: 415 });
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 }); chunks.push(chunk as Buffer); }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new Error("Expected a JSON object"), { status: 400 });
  return value as Record<string, unknown>;
}

function asset(path: string): { body: string; type: string } | undefined {
  const file = path === "/protocol.ts" ? PROTOCOL : path === "/" ? `${WEB}index.html` : /^\/app\/[a-z0-9-]+\.(ts|css)$/.test(path) ? `${WEB}${path.slice(5)}` : undefined;
  if (!file) return undefined;
  let mtimeMs: number;
  try { mtimeMs = statSync(file).mtimeMs; } catch { return undefined; }
  const type = file.endsWith(".ts") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return { body: hit.body, type };
  const source = readFileSync(file, "utf8");
  const body = file.endsWith(".ts") ? stripTypeScriptTypes(source, { mode: "strip" }) : source;
  cache.set(file, { mtimeMs, body });
  return { body, type };
}

export function createHmiServer(service: HmiService, options: { heartbeatMs?: number; extraPost?: Record<string, (body: Record<string, unknown>) => unknown> } = {}): Server {
  const sameOrigin = (req: IncomingMessage) => !req.headers.origin || req.headers.origin === `http://${req.headers.host}`;

  const stream = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 1000\n\n");
    const client = url.searchParams.get("client") ?? "";
    const send = (m: HmiStreamMessage) => { res.write(`event: ${m.type}\ndata: ${JSON.stringify(m)}\n\n`); if (client) service.touchClient(client); };
    send({ type: "state", state: service.state() });
    const off = service.subscribe(state => send({ type: "state", state }));
    const offControl = service.subscribeControl(message => { if (!client || message.clientSessionId === client) send(message); });
    const beat = setInterval(() => send({ type: "heartbeat", serverNowIso: new Date().toISOString() }), options.heartbeatMs ?? 5000);
    req.on("close", () => { off(); offControl(); clearInterval(beat); });
  };

  const post: Record<string, (body: Record<string, unknown>) => unknown> = {
    "/api/clients": body => service.registerClient(body),
    "/api/targets": body => service.publishTargets(body),
    "/api/ui-actions": body => ({ reference: service.recordInput(body) }),
    "/api/ui-rendered": body => { service.recordRendered(body); return { ok: true }; },
    "/api/commands": body => service.submitCommand(body),
    "/api/alarms/review": body => service.reviewAlarm(body),
    "/api/agent-actions": body => service.requestAgentAction(body),
    "/api/agent-actions/delivered": body => service.agentActionDelivered(body),
    "/api/agent-actions/observed": body => service.agentActionObserved(body),
    "/api/fixture/control": body => { service.fixtureControl(body); return { ok: true }; },
    ...options.extraPost
  };

  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (req.method === "GET") {
        if (url.pathname === "/api/stream") return stream(req, res, url);
        if (url.pathname === "/api/identity") return json(res, 200, service.identity);
        if (url.pathname === "/api/state") return json(res, 200, service.state());
        if (url.pathname === "/api/alarms") {
          const p = url.searchParams, code = p.get("code");
          return json(res, 200, service.queryAlarms({ state: (p.get("state") ?? "all") as "all", kind: (p.get("kind") ?? "all") as "all", code: code ? Number(code) : undefined,
            text: p.get("text") ?? undefined, sinceIso: p.get("since") ?? undefined, limit: Math.min(500, Number(p.get("limit") ?? 200)) }));
        }
        if (url.pathname === "/api/journal") return json(res, 200, { file: service.journal.file, records: service.journal.tail.slice(-Math.min(500, Number(url.searchParams.get("limit") ?? 100))) });
        if (url.pathname === "/api/targets") { const t = service.targets(url.searchParams.get("client") ?? ""); return t ? json(res, 200, t) : json(res, 404, { error: "No targets published for that client" }); }
        if (url.pathname === "/api/agent-actions") { const a = service.agentAction(url.searchParams.get("reference") ?? ""); return a ? json(res, 200, a) : json(res, 404, { error: "Unknown agent action" }); }
        if (url.pathname === "/api/commands") { const c = service.commands.get(url.searchParams.get("requestId") ?? ""); return c ? json(res, 200, c) : json(res, 404, { error: "Unknown request" }); }
        const file = asset(url.pathname);
        if (!file) return json(res, 404, { error: "Not found" });
        res.writeHead(200, { "content-type": file.type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return void res.end(file.body);
      }
      if (req.method === "POST") {
        const handler = post[url.pathname];
        if (!handler) return json(res, 404, { error: "Not found" });
        if (!sameOrigin(req)) return json(res, 403, { error: "Cross-origin request refused" });
        const body = await readJson(req);
        return json(res, 200, await handler(body));
      }
      json(res, 405, { error: "Method not allowed" });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 400;
      json(res, status, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function listen(server: Server, port: number, hostname = "127.0.0.1"): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => { const a = server.address(); resolve(typeof a === "object" && a ? `http://${hostname}:${a.port}/` : `http://${hostname}:${port}/`); });
  });
}
