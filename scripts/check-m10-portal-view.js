// Offline browser witness of the actual portal component using preserved M10 evidence.
// Serves only built files/API metadata; never starts a campaign or constructs native OPC.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { fixtureCampaignFactory } from "../src/host/campaign-factory.ts";
import { createPortalServer, listen } from "../src/host/http.ts";
import { launch } from "./lib/chrome.js";

const index = process.argv.indexOf("--out");
const out = resolve(index >= 0 ? process.argv[index + 1] : `artifacts/m10-convergence/${new Date().toISOString().replace(/[:.]/g, "-")}/view`);
mkdirSync(out, { recursive: true });
const latest = JSON.parse(readFileSync("artifacts/machine-view/latest.json", "utf8"));
const host = new CampaignHost({ factory: fixtureCampaignFactory() });
const server = createPortalServer({ host, staticDir: "ui/dist" });
const { url } = await listen(server, 0);
let browser;
const checks = [];
const check = (name, actual) => { assert(actual, name); checks.push({ name, passed: true }); };
try {
  browser = await launch({ width: 1360, height: 1000 });
  await browser.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.viewMessages=[];window.addEventListener('message',e=>{if(e.source===document.querySelector('.generated-view-mount iframe')?.contentWindow)window.viewMessages.push(e.data);});` });
  await browser.cdp("Page.navigate", { url: `${url}/m10-replay.html` });
  const ready = () => browser.waitFor(`document.querySelector('.generated-machine')?.dataset.viewStatus === 'ready' && window.viewMessages.some(m=>m.type==='applied')`, 60_000);
  check("promoted package mounts and acknowledges a preserved M10 frame", await ready());
  const identity = await browser.evaluate(`({id:document.querySelector('.generated-machine').dataset.packageId,sandbox:document.querySelector('iframe').getAttribute('sandbox'),sequence:window.m10Replay.state().eventCount})`);
  check("latest.json selects promoted package", identity.id === latest.packageId);
  check("renderer has scripts-only sandbox, no same-origin authority", identity.sandbox === "allow-scripts");
  const snapshots = [];
  for (const path of ["exitA", "exitB"]) {
    await browser.evaluate(`window.m10Replay.seek(window.m10Replay.events.findIndex(e=>e.type==='world.evidence'&&e.data.source?.data?.snapshot?.state?.path===${JSON.stringify(path)})+1).then(()=>true)`);
    check(`${path} recorded carton reaches mounted view`, await ready());
    const state = await browser.evaluate(`({campaignId:window.m10Replay.state().hosted.campaignId,entities:window.m10Replay.state().entities,time:window.m10Replay.state().world.sourceTimeMs})`);
    check(`${path} carton is supplied from coordinator evidence`, Object.values(state.entities).some(e => e.state.path === path && e.eventId));
    snapshots.push({ path, ...state });
    await new Promise(r => setTimeout(r, 200));
    writeFileSync(resolve(out, `${path}.png`), await browser.screenshot());
  }
  const probe = `(()=>{const f=document.querySelector('iframe'),src=f.srcdoc;return {f,token:/,T=("[^"]+")/.exec(src)?.[1]};})()`;
  await browser.evaluate(`(()=>{const {f,token}=${probe};window.dispatchEvent(new MessageEvent('message',{source:f.contentWindow,data:{protocol:'controlsbench.machine-view.protocol.v1',token:JSON.parse(token),type:'select',equipmentId:'peEntry',entityId:null}}));return true;})()`);
  check("equipment selection preserves evidence links", await browser.waitFor(`document.querySelector('.view-selection button')?.textContent.includes('m10-live:')`));
  await browser.evaluate(`document.querySelector('.view-selection button').click();true`);
  check("equipment evidence opens in the ledger inspector", await browser.waitFor(`document.querySelector('.drawer .json')?.textContent.includes('m10-live:') || document.querySelector('.drawer .kv')?.textContent.includes('m10-live:')`));
  await browser.evaluate(`document.querySelector('[aria-label="Close inspector"]').click();window.m10Replay.setLink('stale');true`);
  check("stale probe is visibly labeled separately from recorded evidence", await browser.waitFor(`document.body.textContent.includes('Presentation probe: stale')`));
  await browser.evaluate(`(()=>{const {f,token}=${probe};window.dispatchEvent(new MessageEvent('message',{source:f.contentWindow,data:{protocol:'controlsbench.machine-view.protocol.v1',token:JSON.parse(token),type:'error',message:'offline audit fallback probe'}}));return true;})()`);
  check("view runtime failure removes iframe and shows contract fallback", await browser.waitFor(`!document.querySelector('iframe') && document.querySelector('.generated-fallback')?.textContent.includes('offline audit fallback probe')`));
  writeFileSync(resolve(out, "fallback.png"), await browser.screenshot());
  check("all renderer acknowledgements have no missing elements", await browser.evaluate(`window.viewMessages.filter(m=>m.type==='applied').every(m=>m.missing.length===0)`));
  check("no campaign or PLC connector was started", host.events.length === 0 && !host.runtime);
  writeFileSync(resolve(out, "result.json"), JSON.stringify({ status: "pass", package: latest, evidence: "artifacts/m10/2026-11-01T00-58-43-185Z/campaign.jsonl", checks, snapshots, browser: browser.chrome, livePlcExecuted: false, paidCalls: 0,
    limitation: "Selection and fallback are explicit protocol probes. No real HMI or combined live rehearsal was performed." }, null, 2) + "\n");
  console.log(`M10 portal view: ${checks.length}/${checks.length} checks passed; ${out}`);
} catch (error) { writeFileSync(resolve(out, "failure.json"), JSON.stringify({ message: String(error), checks }, null, 2)); throw error; }
finally { browser?.close(); await host.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
