import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationEngine } from "./core/simulation-engine.js";
import { cloneDemoModel, demoSpecification } from "./core/demo-model.js";
import { SimulatedPlcConnector } from "./connectors/simulated-plc.js";
import { compileModel } from "./providers/meta-model-api.js";

const root = fileURLToPath(new URL("../public", import.meta.url));
const port = Number(process.env.PORT || 4310);
const engine = new SimulationEngine(cloneDemoModel(), new SimulatedPlcConnector());
const clients = new Set();

engine.on("tick", (snapshot) => {
  const message = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of clients) client.write(message);
});
engine.start();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") return json(res, 200, engine.snapshot());
  if (req.method === "GET" && url.pathname === "/api/specification") return json(res, 200, { specification: demoSpecification.trim() });
  if (req.method === "GET" && url.pathname === "/api/report") return json(res, 200, engine.report());

  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    res.write(`data: ${JSON.stringify(engine.snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/investigation/start") {
    engine.startInvestigation();
    return json(res, 202, engine.snapshot());
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    engine.reset();
    return json(res, 200, engine.snapshot());
  }

  if (req.method === "POST" && url.pathname === "/api/control") {
    const request = await body(req);
    if (!["start", "stop", "reset"].includes(request.signal)) return json(res, 400, { error: "Unknown control signal." });
    engine.pulse(request.signal, 300);
    return json(res, 202, { accepted: request.signal });
  }

  if (req.method === "POST" && url.pathname === "/api/fault") {
    const request = await body(req);
    if (!["none", "chatter", "stuck-entry"].includes(request.fault)) return json(res, 400, { error: "Unknown fault." });
    engine.setFault(request.fault);
    return json(res, 202, { accepted: request.fault });
  }

  if (req.method === "POST" && url.pathname === "/api/model/compile") {
    try {
      const request = await body(req);
      if (!request.specification?.trim()) return json(res, 400, { error: "A functional specification is required." });
      const result = await compileModel(request.specification);
      engine.replaceModel(result.model, result.source);
      return json(res, 200, { ...result, state: engine.snapshot() });
    } catch (error) {
      return json(res, 502, { error: error.message });
    }
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    const handled = await api(req, res, url);
    if (handled === false) json(res, 404, { error: "Not found" });
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(root, safePath);
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mime[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(port, () => {
  console.log(`ControlsBench Muse is running at http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    engine.stop();
    server.close(() => process.exit(0));
  });
}
