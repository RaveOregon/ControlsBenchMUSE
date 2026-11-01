// Minimal headless Chrome/Edge driver over the DevTools protocol. Local files only.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function findChrome() {
  const found = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(p => p && existsSync(p));
  if (!found) throw new Error("No Chrome/Edge found; set CHROME_PATH");
  return found;
}

export async function launch({ width = 1280, height = 640 } = {}) {
  const chrome = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "cb-chrome-"));
  const browser = spawn(chrome, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((ok, fail) => {
    let buffer = "";
    const timer = setTimeout(() => fail(new Error("Chrome did not expose DevTools")), 30_000);
    browser.stderr.on("data", chunk => { buffer += chunk; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer); if (m) { clearTimeout(timer); ok(m[1]); } });
  });
  const port = new URL(wsUrl).port;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.onopen = ok; socket.onerror = fail; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const cdp = (method, params = {}) => new Promise((ok, fail) => { const id = ++nextId; pending.set(id, m => m.error ? fail(new Error(`${method}: ${m.error.message}`)) : ok(m.result)); socket.send(JSON.stringify({ id, method, params })); });
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(`Page evaluation failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  return {
    chrome,
    cdp,
    evaluate,
    async navigate(file) { await cdp("Page.navigate", { url: pathToFileURL(file).href }); },
    /** Polls until `expression` returns a truthy value; returns it (or the last value on timeout). */
    async waitFor(expression, timeoutMs = 30_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        await new Promise(r => setTimeout(r, 100));
        const value = await evaluate(expression).catch(() => null);
        if (value || Date.now() > deadline) return value;
      }
    },
    async screenshot() { return Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"); },
    close() { try { socket.close(); } catch { /* ignore */ } browser.kill(); }
  };
}
