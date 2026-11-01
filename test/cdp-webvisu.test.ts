// Controlled-browser capture against a local test page (not WebVisu): proves the CDP producer
// returns the page's actual rendered pixels, timestamps and URL, reports delivered input, and
// that the hub holds the last frame as stale when capture is lost. Skipped without Edge/Chrome.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { CdpWebVisuSource, findBrowser } from "../src/host/cdp-webvisu.ts";
import { HmiHub } from "../src/host/hmi.ts";
import type { HmiInputObservation } from "../src/host/hmi.ts";
import { listen } from "../src/host/http.ts";

const browser = findBrowser();
const skip = browser ? false : "No Edge/Chrome executable found";

async function pageServer(html: string) {
  const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(html); });
  const { url } = await listen(server, 0);
  return { url, close: async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}

test("CDP source captures the configured page's rendered pixels and reports engineer input without key values", { skip, timeout: 60_000 }, async () => {
  const page = await pageServer(`<!doctype html><title>capture test</title><body style="margin:0;background:#c00"><button style="width:200px;height:80px">Start</button></body>`);
  const source = new CdpWebVisuSource(`${page.url}/webvisu.htm`, { browserPath: browser, headless: true, width: 640, height: 400 });
  const inputs: HmiInputObservation[] = [];
  let lost: string | undefined;
  try {
    const info = await source.open(i => inputs.push(i), reason => { lost = reason; });
    assert.match(info.browser, /target .* headless/);
    assert.match(info.sessionId, /^hmi-/);
    const frame = await source.capture();
    assert.equal(frame.contentType, "image/jpeg");
    assert.deepEqual([...frame.bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], "JPEG from the browser surface");
    assert.ok(frame.bytes.byteLength > 500);
    assert.ok(Date.parse(frame.capturedAtIso) >= Date.parse(frame.requestedAtIso));
    assert.equal(frame.pageUrl, `${page.url}/webvisu.htm`);
    await source.deliverPointer(50, 30);
    const deadline = Date.now() + 5000;
    while (!inputs.length && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    assert.equal(inputs[0]?.kind, "pointer");
    assert.equal(inputs[0]?.x, 50);
    assert.equal(inputs[0]?.y, 30);
    assert.equal(inputs[0]?.pageUrl, `${page.url}/webvisu.htm`);
  } finally { await source.close(); await page.close(); }
  assert.equal(lost, undefined, "deliberate close is not reported as loss");
});

test("HMI hub over the CDP source: capture loss holds the last frame and goes stale", { skip, timeout: 60_000 }, async () => {
  const page = await pageServer("<body style='background:#036'>HMI</body>");
  const source = new CdpWebVisuSource(`${page.url}/`, { browserPath: browser, headless: true, width: 320, height: 200 });
  const hub = new HmiHub({ captureIntervalMs: 200, staleAfterMs: 600 });
  try {
    const first = await hub.connect(source);
    assert.equal(hub.view.state, "observing");
    assert.equal(hub.frame(first.sessionId, 1)?.ref.sha256, first.sha256);
    await source.close(); // the session disappears underneath the hub
    const deadline = Date.now() + 10_000;
    while (hub.view.state === "observing" && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
    assert.equal(hub.view.state, "stale");
    assert.equal(hub.view.recording, false);
    assert.ok(hub.view.lastFrame && hub.view.lastFrame.frameSequence >= 1, "last frame held");
  } finally { await hub.disconnect("test end"); await page.close(); }
});
