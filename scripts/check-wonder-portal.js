// Production App/Start/render witness. Local recorded review only; no model or PLC adapter.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { createCampaignFactory } from "../src/host/wonder-recorded-factory.ts";
import { createPortalServer, listen } from "../src/host/http.ts";
import { launch } from "./lib/chrome.js";

const outIndex = process.argv.indexOf("--out");
const out = resolve(outIndex >= 0 ? process.argv[outIndex + 1] : `artifacts/wonder-review-fixes/browser-${new Date().toISOString().replace(/[:.]/g, "-")}`);
mkdirSync(out, { recursive: true });
const host = new CampaignHost({ factory: createCampaignFactory() });
const server = createPortalServer({ host, staticDir: "ui/dist" });
const { url } = await listen(server, 0); let browser;
const checks = [];
const check = (name, value) => { assert(value, name); checks.push({ name, status: "pass" }); };
try {
  browser = await launch({ width: 1450, height: 1100 });
  await browser.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.reviewCommands=[];const originalFetch=window.fetch.bind(window);window.fetch=(input,init)=>{if(String(input).endsWith('/api/commands')&&init?.body)window.reviewCommands.push(JSON.parse(init.body));return originalFetch(input,init);};` });
  await browser.cdp("Page.navigate", { url });
  check("production App displays the host's explicit recorded-review categories", await browser.waitFor(`document.querySelector('[aria-label="Include Recorded M10 evidence review"]') && document.body.textContent.includes('HOSTED REVIEW')`, 60_000));
  await browser.evaluate(`document.querySelector('[aria-label="Include Recorded M10 evidence review"]').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Start Campaign').click();true`);
  check("partial recorded scope is rejected without overriding a deselection", await browser.waitFor(`document.querySelector('.command-status')?.textContent.includes('rejected')`));
  check("partial selection creates no campaign or model", host.events.length === 0);
  await browser.evaluate(`document.querySelector('[aria-label="Include Recorded M10 evidence review"]').click();[...document.querySelectorAll('button')].find(b=>b.textContent==='Start Campaign').click();true`);
  check("normal production Start completes the authoritative recorded review", await browser.waitFor(`document.body.textContent.includes('Recorded M10 review completed') || document.body.textContent.includes('Campaign complete')`, 90_000));
  await host.runtime?.runAgent(); await host.runtime?.stop();
  check("review is completed in the authoritative ledger", host.projection?.status === "completed");
  const commands = await browser.evaluate("window.reviewCommands");
  check("actual browser Start forwards category IDs and exact deselections", commands.length === 2 && commands[0].payload.scope.evidence === false && commands[1].payload.scope.evidence === true && Object.keys(commands[1].payload.scope).sort().join(",") === "adaptive,evidence");
  check("Start acknowledgement is applied rather than timed out", await browser.waitFor(`document.querySelector('.command-status')?.textContent.includes('start · applied')`));
  check("PLC and world per-event labels never say live", await browser.evaluate(`[...document.querySelectorAll('.event-row .tag')].every(t=>!['PLC · live','world · live'].includes(t.textContent))`));
  check("campaign header labels the current session as a recorded-evidence review", await browser.evaluate(`document.querySelector('.page-heading .eyebrow')?.textContent.includes('HOSTED REVIEW')`));
  check("actual PLC event badge and tooltip describe a recorded source observation", await browser.waitFor(`[...document.querySelectorAll('.event-row .tag')].some(t=>t.textContent==='PLC · recorded'&&t.title.includes('not a current PLC observation'))`));
  check("raw values remain recorded rather than aging as current PLC frames", await browser.evaluate(`document.querySelector('[aria-label="Raw I/O"]')?.textContent.includes('recorded')`));
  check("current review and recorded component liveness are separate", await browser.evaluate(`document.body.textContent.includes('recorded · not monitored') && document.body.textContent.includes('recorded · no live evolution')`));
  await browser.evaluate(`[...document.querySelectorAll('.event-row')].find(r=>r.querySelector('.tag')?.textContent==='PLC · recorded').click();true`);
  check("event inspector identifies a hosted review with a recorded clock", await browser.waitFor(`document.querySelector('.drawer')?.textContent.includes('hosted review — recorded evidence') && document.querySelector('.drawer')?.textContent.includes('recorded wall-clock duration')`));
  writeFileSync(resolve(out, "recorded-review.png"), await browser.screenshot());
  writeFileSync(resolve(out, "result.json"), JSON.stringify({ status: "pass", checks, commands, campaignId: host.campaignId, source: "production App.tsx/bootstrap and hosted recorded-M10 factory", actualModelCalls: 0, spendUsd: 0, plcContacted: false, liveHmiOperated: false }, null, 2) + "\n");
  console.log(`Wonder production portal: ${checks.length} checks pass; ${out}`);
} catch (error) { writeFileSync(resolve(out, "failure.json"), JSON.stringify({ message: String(error), checks }, null, 2)); throw error; }
finally { browser?.close(); await host.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
