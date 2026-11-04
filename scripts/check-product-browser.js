// Local preview integration witness. Refuses live/paid factories before starting anything.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch } from "./lib/chrome.js";

const url = process.argv[2] ?? "http://127.0.0.1:5190";
assert.equal(new URL(url).hostname, "127.0.0.1");
const outIndex = process.argv.indexOf("--out");
const out = outIndex >= 0 ? process.argv[outIndex + 1] : `artifacts/product-integration/${new Date().toISOString().replace(/[:.]/g, "-")}`;
mkdirSync(out, { recursive: true });
const checks = [];
const check = (name, value) => { assert.ok(value, name); checks.push(name); };
// Recorded import can occupy the server event loop past an idle keep-alive deadline.
// Use independent read connections; do not retry Start or replay any campaign command.
const read = address => fetch(address, { headers: { connection: "close" } });
let browser;
try {
  const host = await (await read(`${url}/api/host`)).json();
  check("explicit zero-cost preview/review factory", ["fixture-adaptive", "wonder-recorded-stub"].includes(host.factory.id));
  const hmi = await (await read(new URL("api/identity", host.hmi.url))).json();
  check("HMI source is visibly a fixture", hmi.source.kind === "fixture");
  browser = await launch({ width: 1440, height: 1100 });
  await browser.cdp("Page.navigate", { url });
  check("production browser attaches to host", await browser.waitFor("window.controlsBenchPortal?.hosted === true"));
  check("Muse-generated machine view mounted", await browser.waitFor("Boolean(document.querySelector('iframe'))"));
  check("portal displays captured HMI pixels", await browser.waitFor("Array.from(document.querySelectorAll('img')).some(i => i.src.includes('/api/hmi/frames/') && i.naturalWidth > 0)"));
  const current = await (await read(`${url}/api/host`)).json();
  const frame = current.hmi.lastFrame;
  const bytes = Buffer.from(await (await read(new URL(frame.mediaUrl, url))).arrayBuffer());
  check("HMI tile frame bytes match capture hash", createHash("sha256").update(bytes).digest("hex") === frame.sha256);
  await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Setup').click();true`);
  check("Setup names the actual configured factory", await browser.waitFor(`document.querySelector('[aria-label="Campaign plan"]')?.textContent.includes(${JSON.stringify(host.factory.label)})`));
  check("Start Campaign is available", await browser.waitFor("Array.from(document.querySelectorAll('button')).some(b => /^Start campaign$/i.test(b.textContent.trim()) && !b.disabled)"));
  await browser.evaluate("Array.from(document.querySelectorAll('button')).find(b => /^Start campaign$/i.test(b.textContent.trim()) && !b.disabled).click(); true");
  const deadline = Date.now() + 60_000;
  let report;
  do {
    await new Promise(r => setTimeout(r, 250));
    const response = await read(`${url}/api/campaign/report`);
    if (response.ok) report = await response.json();
  } while ((!['completed', 'failed', 'stopped'].includes(report?.status) || report?.campaignId === host.campaignId) && Date.now() < deadline);
  check("real portal Start produces a finalized fixture report", report?.status === "completed");
  check("Start created a new campaign", report.campaignId !== host.campaignId);
  check("report includes evidence-grounded findings", Object.keys(report.findings ?? {}).length > 0);
  if (host.factory.id === "fixture-adaptive") {
    await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Campaign').click();true`);
    check("finalized connector observation does not claim current freshness", await browser.waitFor(`document.querySelector('[aria-label="Campaign record"]')?.textContent.includes('current freshness not monitored')`));
  }
  await browser.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Results').click();true`);
  const expectedBadge = host.factory.evidenceClass === "fake_connector" ? "Fixture · fake connector, no PLC" : "Recorded PLC evidence, re-presented";
  check("Results preserves the actual physical evidence class", await browser.waitFor(`document.querySelector('[aria-label="Campaign result source"] .tag')?.textContent===${JSON.stringify(expectedBadge)}`));
  check("hosted export uses the authoritative report endpoint", await browser.waitFor(`document.querySelector('a[download][href="/api/campaign/report"]')?.textContent==='Download JSON report'`));
  const exported = await (await read(`${url}/api/campaign/report`)).json();
  check("exported report retains campaign identity, findings and evidence class", exported.campaignId === report.campaignId && exported.evidenceClass === host.factory.evidenceClass && JSON.stringify(exported.findings) === JSON.stringify(report.findings));
  writeFileSync(`${out}/campaign.jsonl`, await (await read(`${url}/api/campaign/ledger`)).text());
  writeFileSync(`${out}/hmi-frame.jpg`, bytes);
  writeFileSync(`${out}/portal.png`, await browser.screenshot());
  writeFileSync(`${out}/result.json`, JSON.stringify({ status: "pass", checks, factory: host.factory, hmi: hmi.source, frame, report,
    commandOrigin: "synthetic portal button click for offline integration testing", plcContacted: false, paidCalls: 0 }, null, 2) + "\n");
  console.log(JSON.stringify({ status: "pass", checks: checks.length, directory: out }));
} catch (error) {
  writeFileSync(`${out}/result.json`, JSON.stringify({ status: "fail", checks, error: String(error), plcContacted: false, paidCalls: 0 }, null, 2) + "\n");
  throw error;
} finally { browser?.close(); }
