// Controlled-browser WebVisu capture over the Chrome DevTools Protocol (Edge or Chrome).
//
// The host launches a dedicated browser profile, opens the configured WebVisu URL and captures
// the page's actual rendered pixels. In headed mode the engineer operates that same window;
// pointer/key events are reported (without key values) so they can be correlated with frames
// and PLC evidence. No dependency beyond Node's built-in fetch and WebSocket.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HmiCaptureSource, HmiFrameCapture, HmiInputObservation, HmiSessionInfo } from "./hmi.ts";
import { newHmiSessionId, validateHmiUrl } from "./hmi.ts";

const BROWSER_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
];

export function findBrowser(explicit = process.env.CONTROLSBENCH_HMI_BROWSER): string | undefined {
  if (explicit) return existsSync(explicit) ? explicit : undefined;
  return BROWSER_CANDIDATES.find(path => existsSync(path));
}

export interface CdpWebVisuOptions {
  browserPath?: string;
  headless?: boolean;
  width?: number;
  height?: number;
  format?: "jpeg" | "png";
  quality?: number;
  openTimeoutMs?: number;
  operationTimeoutMs?: number;
}

const BINDING = "__controlsBenchHmiInput";
// Reports that an input reached the page. Coordinates only; key identities are never sent.
const INPUT_SCRIPT = `(() => {
  if (window.__controlsBenchHmiInstalled) return; window.__controlsBenchHmiInstalled = true;
  const send = (kind, e) => { try { window.${BINDING}(JSON.stringify({ kind, atIso: new Date().toISOString(),
    x: kind === 'pointer' ? Math.round(e.clientX) : undefined, y: kind === 'pointer' ? Math.round(e.clientY) : undefined,
    viewportWidth: innerWidth, viewportHeight: innerHeight, pageUrl: location.href })); } catch {} };
  addEventListener('pointerdown', e => send('pointer', e), true);
  addEventListener('keydown', e => send('key', e), true);
})();`;

export class CdpWebVisuSource implements HmiCaptureSource {
  readonly id: string;
  readonly kind = "webvisu" as const;
  readonly url: string;
  readonly options: Required<Omit<CdpWebVisuOptions, "browserPath">> & { browserPath?: string };
  #process?: ChildProcess;
  #profile?: string;
  #socket?: WebSocket;
  #nextId = 0;
  #pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  #listeners = new Map<string, Array<(params: Record<string, unknown>) => void>>();
  #closing = false;

  constructor(url: string, options: CdpWebVisuOptions = {}) {
    this.url = validateHmiUrl(url);
    this.id = `webvisu:${new URL(this.url).host}`;
    this.options = { headless: true, width: 1280, height: 800, format: "jpeg", quality: 80, openTimeoutMs: 20_000, operationTimeoutMs: 10_000, ...options };
  }

  async open(onInput: (input: HmiInputObservation) => void, onClosed: (reason: string) => void): Promise<HmiSessionInfo> {
    const browser = this.options.browserPath ?? findBrowser();
    if (!browser) throw new Error("No Edge/Chrome executable found; set CONTROLSBENCH_HMI_BROWSER");
    this.#profile = mkdtempSync(join(tmpdir(), "controlsbench-hmi-"));
    const args = [`--remote-debugging-port=0`, `--user-data-dir=${this.#profile}`, "--no-first-run", "--no-default-browser-check",
      "--disable-extensions", "--disable-sync", "--disable-background-networking", `--window-size=${this.options.width},${this.options.height}`,
      ...(this.options.headless ? ["--headless=new", "--hide-scrollbars", "--mute-audio"] : []), "about:blank"];
    const child = spawn(browser, args, { stdio: "ignore", windowsHide: this.options.headless });
    this.#process = child;
    child.once("exit", code => { if (!this.#closing) onClosed(`browser exited (${code ?? "signal"})`); });
    const port = await this.#devtoolsPort(this.options.openTimeoutMs);
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { Browser?: string };
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{ id: string; type: string; webSocketDebuggerUrl: string }>;
    const page = targets.find(t => t.type === "page");
    if (!page) throw new Error("Controlled browser exposed no page target");
    await this.#connect(page.webSocketDebuggerUrl, onClosed);
    this.#on("Runtime.bindingCalled", params => {
      if (params.name !== BINDING) return;
      try {
        const raw = JSON.parse(String(params.payload)) as Record<string, unknown>;
        const kind = raw.kind === "key" ? "key" : "pointer";
        const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
        onInput({ kind, atIso: typeof raw.atIso === "string" && Number.isFinite(Date.parse(raw.atIso)) ? raw.atIso : new Date().toISOString(),
          x: kind === "pointer" ? num(raw.x) : undefined, y: kind === "pointer" ? num(raw.y) : undefined,
          viewportWidth: num(raw.viewportWidth), viewportHeight: num(raw.viewportHeight), pageUrl: String(raw.pageUrl ?? "").slice(0, 2048) });
      } catch { /* malformed page payload is ignored, never trusted */ }
    });
    await this.#send("Page.enable");
    await this.#send("Runtime.enable");
    await this.#send("Runtime.addBinding", { name: BINDING });
    await this.#send("Page.addScriptToEvaluateOnNewDocument", { source: INPUT_SCRIPT });
    await this.#send("Emulation.setDeviceMetricsOverride", { width: this.options.width, height: this.options.height, deviceScaleFactor: 1, mobile: false });
    const loaded = this.#once("Page.loadEventFired", this.options.openTimeoutMs);
    const navigation = await this.#send("Page.navigate", { url: this.url });
    if (typeof navigation.errorText === "string" && navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
    await loaded;
    await this.#send("Runtime.evaluate", { expression: INPUT_SCRIPT });
    return { sessionId: newHmiSessionId(), browser: `${version.Browser ?? "unknown browser"} · target ${page.id}${this.options.headless ? " · headless" : " · headed"}` };
  }

  async capture(): Promise<HmiFrameCapture> {
    const requestedAtIso = new Date().toISOString();
    const shot = await this.#send("Page.captureScreenshot", { format: this.options.format, ...(this.options.format === "jpeg" ? { quality: this.options.quality } : {}), fromSurface: true });
    const capturedAtIso = new Date().toISOString();
    const history = await this.#send("Page.getNavigationHistory");
    const entries = history.entries as Array<{ url: string }> | undefined;
    const current = entries?.[Number(history.currentIndex)]?.url ?? "unknown";
    if (typeof shot.data !== "string") throw new Error("Screenshot returned no data");
    return { bytes: Buffer.from(shot.data, "base64"), contentType: this.options.format === "png" ? "image/png" : "image/jpeg", requestedAtIso, capturedAtIso, pageUrl: current };
  }

  /**
   * Delivers a trusted left click at viewport coordinates. Not wired to any portal or Muse tool;
   * it is the seam for the S2 HMI-operation stretch and for tests.
   */
  async deliverPointer(x: number, y: number): Promise<void> {
    for (const type of ["mousePressed", "mouseReleased"]) await this.#send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }

  async close(): Promise<void> {
    this.#closing = true;
    try { if (this.#socket?.readyState === WebSocket.OPEN) await this.#send("Browser.close").catch(() => {}); } finally {
      this.#socket?.close();
      const child = this.#process;
      if (child && child.exitCode === null) {
        await new Promise<void>(resolve => { const t = setTimeout(() => { child.kill(); resolve(); }, 3000); child.once("exit", () => { clearTimeout(t); resolve(); }); });
      }
      if (this.#profile) {
        const profile = this.#profile; this.#profile = undefined;
        // Only the temporary profile this instance created.
        for (let i = 0; i < 5; i++) { try { rmSync(profile, { recursive: true, force: true }); break; } catch { await new Promise(r => setTimeout(r, 300)); } }
      }
    }
  }

  async #devtoolsPort(timeoutMs: number): Promise<number> {
    const file = join(this.#profile!, "DevToolsActivePort"), deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.#process?.exitCode !== null && this.#process?.exitCode !== undefined) throw new Error("Browser exited before exposing DevTools");
      try { const port = Number(readFileSync(file, "utf8").split(/\r?\n/)[0]); if (port > 0) return port; } catch { /* not yet written */ }
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("Timed out waiting for the browser DevTools port");
  }

  #connect(url: string, onClosed: (reason: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.#socket = socket;
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("DevTools WebSocket error"));
      socket.onclose = () => {
        for (const p of this.#pending.values()) p.reject(new Error("DevTools connection closed"));
        this.#pending.clear();
        if (!this.#closing) onClosed("DevTools connection closed");
      };
      socket.onmessage = message => {
        const data = JSON.parse(String(message.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown> };
        if (data.id !== undefined) {
          const p = this.#pending.get(data.id); this.#pending.delete(data.id);
          if (data.error) p?.reject(new Error(data.error.message)); else p?.resolve(data.result ?? {});
        } else if (data.method) for (const listener of this.#listeners.get(data.method) ?? []) listener(data.params ?? {});
      };
    });
  }

  #send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("DevTools session is not open"));
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`${method} timed out`)); }, this.options.operationTimeoutMs);
      this.#pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  #on(method: string, listener: (params: Record<string, unknown>) => void): () => void {
    const list = this.#listeners.get(method) ?? [];
    list.push(listener); this.#listeners.set(method, list);
    return () => this.#listeners.set(method, (this.#listeners.get(method) ?? []).filter(l => l !== listener));
  }

  #once(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error(`${method} not received within ${timeoutMs} ms`)); }, timeoutMs);
      const off = this.#on(method, () => { clearTimeout(timer); off(); resolve(); });
    });
  }
}
