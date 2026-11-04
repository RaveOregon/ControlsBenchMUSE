// HTTP transport for the portal host: Server-Sent Events downstream, JSON POST upstream, the
// built portal, HMI frame bytes, the campaign report (plus its presentation bundle) and the full ledger. Binds to loopback by
// default; state-changing requests must be same-origin JSON.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { buildReportBundle, type CampaignReport } from "../report/bundle.ts";
import type { CampaignHost } from "./campaign-host.ts";
import type { HostStreamMessage } from "./protocol.ts";

export interface PortalServerOptions {
  host: CampaignHost;
  port?: number;
  hostname?: string;
  /** Built portal (ui/dist). Omit to serve only the API (Vite dev proxies /api). */
  staticDir?: string;
  /** Extra origins allowed to POST, e.g. the Vite dev server. */
  allowedOrigins?: string[];
  heartbeatMs?: number;
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const MAX_BODY = 64 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw Object.assign(new Error("Expected application/json"), { status: 415 });
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createPortalServer(options: PortalServerOptions): Server {
  const { host } = options;
  const staticRoot = options.staticDir ? resolve(options.staticDir) : undefined;
  const heartbeatMs = options.heartbeatMs ?? 5000;

  const sameOrigin = (req: IncomingMessage): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true; // non-browser clients (scripts, tests)
    return origin === `http://${req.headers.host}` || (options.allowedOrigins ?? []).includes(origin);
  };

  const stream = (req: IncomingMessage, res: ServerResponse, url: URL) => {
    res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write("retry: 1000\n\n");
    const last = String(req.headers["last-event-id"] ?? "");
    const [lastCampaign, lastSequence] = last.includes("|") ? last.split("|") : [url.searchParams.get("campaignId") ?? undefined, url.searchParams.get("after") ?? undefined];
    const send = (message: HostStreamMessage) => {
      const id = message.type === "events" ? `id: ${message.campaignId}|${message.events.at(-1)?.sequence ?? 0}\n` : "";
      res.write(`${id}event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`);
    };
    const unsubscribe = host.subscribe(send, { campaignId: lastCampaign, after: Number(lastSequence ?? 0) || 0 });
    const beat = setInterval(() => send({ type: "heartbeat", serverNowIso: new Date().toISOString() }), heartbeatMs);
    res.on("close", () => { clearInterval(beat); unsubscribe(); });
  };

  const serveStatic = (res: ServerResponse, pathname: string) => {
    if (!staticRoot) { json(res, 404, { error: "Portal build not served by this host; use the Vite dev server" }); return; }
    const relative = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    let file = resolve(join(staticRoot, relative));
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) { json(res, 403, { error: "Forbidden" }); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticRoot, "index.html");
    if (!existsSync(file)) { json(res, 404, { error: "Portal not built; run npm run build in ui/" }); return; }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "x-content-type-options": "nosniff",
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=3600" });
    createReadStream(file).pipe(res);
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "GET" && url.pathname === "/api/host") return json(res, 200, { ...host.info, campaignId: host.campaignId, hmi: host.hmi.view });
      if (req.method === "GET" && url.pathname === "/api/stream") return stream(req, res, url);
      if (req.method === "POST" && url.pathname === "/api/commands") {
        if (!sameOrigin(req)) return json(res, 403, { error: "Cross-origin command refused" });
        const command = await readJson(req);
        try { return json(res, 202, host.submit(command as Parameters<CampaignHost["submit"]>[0])); }
        catch (error) { return json(res, 400, { error: error instanceof Error ? error.message : String(error) }); }
      }
      if (req.method === "GET" && url.pathname === "/api/campaign/report") {
        const report = host.report();
        return report ? json(res, 200, report) : json(res, 404, { error: "No campaign" });
      }
      if (req.method === "GET" && url.pathname === "/api/campaign/report/bundle") {
        const report = host.report();
        if (!report) return json(res, 404, { error: "No campaign" });
        // Presentation view of the same report; frames resolve only through the host's own retained store.
        return json(res, 200, buildReportBundle({ report: report as CampaignReport, events: host.events, context: { kind: "host_current", factoryLabel: host.factory.label },
          reportIntegrity: { source: "host_memory" },
          resolveMedia: frame => {
            const stored = host.hmi.frame(frame.sessionId, frame.frameSequence);
            if (!stored) return { sha256: frame.sha256!, status: "missing", note: "Frame not retained in host memory; see the HMI session artifacts" };
            if (stored.ref.sha256 !== frame.sha256) return { sha256: frame.sha256!, status: "hash_mismatch", note: "Retained frame does not match the recorded SHA-256; not shown" };
            return { sha256: frame.sha256, status: "url", url: `/api/hmi/frames/${encodeURIComponent(frame.sessionId)}/${frame.frameSequence}`,
              contentType: stored.ref.contentType, byteLength: stored.ref.byteLength, note: "Retained by this host; SHA-256 matches the ledger" };
          } }));
      }
      if (req.method === "GET" && url.pathname === "/api/campaign/ledger") {
        if (!host.campaignId) return json(res, 404, { error: "No campaign" });
        res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "content-disposition": `attachment; filename="${host.campaignId}.jsonl"` });
        return res.end(host.events.map(e => JSON.stringify(e)).join("\n") + "\n");
      }
      const frame = /^\/api\/hmi\/frames\/([^/]+)\/(\d+)$/.exec(url.pathname);
      if (req.method === "GET" && frame) {
        const stored = host.hmi.frame(decodeURIComponent(frame[1]!), Number(frame[2]));
        if (!stored) return json(res, 404, { error: "Frame not retained in memory; see the HMI session artifacts" });
        res.writeHead(200, { "content-type": stored.ref.contentType, "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff",
          "x-controlsbench-sha256": stored.ref.sha256, "x-controlsbench-captured-at": stored.ref.capturedAtIso });
        return res.end(stored.bytes);
      }
      if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Unknown endpoint" });
      if (req.method === "GET" || req.method === "HEAD") return serveStatic(res, url.pathname);
      json(res, 405, { error: "Method not allowed" });
    } catch (error) {
      const status = (error as { status?: number }).status ?? (error instanceof SyntaxError ? 400 : 500);
      if (!res.headersSent) json(res, status, { error: error instanceof Error ? error.message : String(error) });
      else res.end();
    }
  });
}

export function listen(server: Server, port = 0, hostname = "127.0.0.1"): Promise<{ port: number; url: string }> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, () => {
      const address = server.address();
      const actual = typeof address === "object" && address ? address.port : port;
      resolvePromise({ port: actual, url: `http://${hostname}:${actual}` });
    });
  });
}
