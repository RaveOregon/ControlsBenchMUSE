import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const bridgePath =
  process.argv[2] ??
  "C:\\Program Files\\CODESYS 3.5.22.30\\CODESYS\\CODESYS MCP Server\\1.1.0.0\\CodesysMCPBridge\\CodesysMCPBridge.exe";

const bridge = spawn(bridgePath, [], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

const pending = new Map();
const notifications = [];
let nextId = 1;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function send(message) {
  bridge.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params = {}) {
  const id = nextId++;
  send({ jsonrpc: "2.0", id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

const stdout = createInterface({ input: bridge.stdout });
stdout.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.id == null) {
    notifications.push(message);
    return;
  }
  if (!pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
  else waiter.resolve(message.result);
});

let stderr = "";
bridge.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const timeout = setTimeout(() => {
  bridge.kill();
  console.error("CODESYS MCP probe timed out after 20 seconds.");
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
}, 20_000);

try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "controlsbench-mcp-probe", version: "0.1.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });

  let listed = { tools: [] };
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    listed = await request("tools/list");
    if ((listed.tools ?? []).length > 0) break;
    await wait(500);
  }
  const toolNames = (listed.tools ?? []).map((tool) => tool.name).sort();
  let resources = null;
  try {
    resources = await request("resources/list");
  } catch (error) {
    resources = { error: error.message };
  }
  const activePathTool = toolNames.find((name) => name === "get_active_app_as_path");

  let activeProject = null;
  if (activePathTool) {
    activeProject = await request("tools/call", {
      name: activePathTool,
      arguments: {},
    });
  }

  console.log(
    JSON.stringify(
      {
        serverInfo: initialized.serverInfo ?? null,
        protocolVersion: initialized.protocolVersion ?? null,
        toolCount: toolNames.length,
        toolNames,
        resources,
        activeProject,
        notifications,
        stderr: stderr.trim() || null,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`CODESYS MCP probe failed: ${error.message}`);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  bridge.stdin.end();
  bridge.kill();
}
