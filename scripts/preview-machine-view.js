// Builds a local, self-contained preview page for the current generated machine view.
// It plays preserved Gate B world runs (surrogate contract, no PLC) at the recorded 10 Hz
// through the same sandboxed iframe host, with play/pause, scrubbing, a simulated link-loss
// toggle and equipment selection. No model call, network or PLC.
//
//   node scripts/preview-machine-view.js [--open]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveFrame } from "../src/machine-view/frame.ts";
import { buildSrcdoc, randomToken } from "../src/machine-view/host.ts";
import { validatePackage } from "../src/machine-view/package.ts";
import { replaySnapshots } from "../src/machine-view/replay.ts";

const latest = JSON.parse(await readFile(resolve("artifacts/machine-view/latest.json"), "utf8"));
const dir = resolve(latest.relativeDirectory);
const files = {};
for (const name of ["view.manifest.json", "equipment.json", "view-bindings.json", "view.svg"]) files[name] = await readFile(join(dir, name), "utf8");
const contract = JSON.parse(await readFile(resolve("artifacts/machine-view/contract/binding-contract.json"), "utf8"));
const worldDir = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory;
const { report, pkg } = await validatePackage({ files, contract, worldManifestText: await readFile(resolve(worldDir, "world.manifest.json"), "utf8") });
if (!report.viewValid) throw new Error(`Package is not view-valid: ${report.errors.join("; ")}`);

const trace = JSON.parse(await readFile(resolve(worldDir, "gate-b-trace.json"), "utf8"));
const labels = { "cp5-routed-a": "Route A (divert 1 extended)", "cp6-routed-b": "Route B (divert 2 extended)", "cp6-runout": "Unassigned to runout", "cp5-missed-a": "Assigned A, divert 1 not extended (reaches runout)" };
const runs = Object.entries(labels).map(([id, title]) => {
  const snapshots = replaySnapshots(trace.runs.find(r => r.label === id), { packageId: pkg.manifest.packageId, channels: contract.channels, evidenceClass: "surrogate_contract" });
  return {
    id, title,
    fresh: snapshots.map(s => resolveFrame(pkg, s)),
    stale: snapshots.map(s => resolveFrame(pkg, { ...s, link: { state: "stale", ageMs: 2400, reason: "simulated link loss in preview" } })),
    values: snapshots.map(s => Object.fromEntries(Object.entries(s.channels).map(([k, v]) => [k, `${v.value}`]))),
    times: snapshots.map(s => s.frame.sourceTimeMs)
  };
});
const equipment = pkg.equipment.equipment.map(e => ({ id: e.id, label: e.label, channels: e.channels }));
const token = randomToken();
const srcdoc = buildSrcdoc(pkg, token, randomToken());
const safe = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>ControlsBench machine view preview</title>
<style>
body{margin:0;font:14px system-ui,sans-serif;background:#0b0e12;color:#d8dee6}
header{padding:10px 16px;border-bottom:1px solid #222a33}
header b{font-size:15px}header small{color:#8a96a3;display:block;margin-top:2px}
.controls{display:flex;gap:10px;align-items:center;padding:10px 16px;flex-wrap:wrap}
select,button{font:inherit;background:#18202a;color:#d8dee6;border:1px solid #33404d;border-radius:4px;padding:4px 10px}
input[type=range]{width:420px}
main{display:flex;gap:12px;padding:0 16px 16px}
iframe{border:1px solid #222a33;width:1280px;height:620px;background:#11151a;flex:none}
aside{min-width:260px;background:#121820;border:1px solid #222a33;border-radius:6px;padding:10px;font-size:13px}
aside h3{margin:0 0 6px;font-size:14px}code{color:#9fd3ff}
</style></head><body>
<header><b>${pkg.manifest.name}</b><small>Package ${pkg.manifest.packageId} · Muse Wonder ${pkg.manifest.provenance.responseId} · replaying preserved Gate B world traces (surrogate contract, no PLC) at the recorded 10 Hz. The view is sandboxed; this page only sends it snapshots.</small></header>
<div class="controls">
<select id="run"></select><button id="play">Pause</button>
<input id="scrub" type="range" min="0" value="0"><span id="time"></span>
<label><input id="stale" type="checkbox"> simulate link loss (stale)</label>
</div>
<main><iframe id="view" sandbox="allow-scripts" referrerpolicy="no-referrer" title="Generated machine view"></iframe>
<aside><h3>Selection</h3><div id="sel">Click any device in the view.</div></aside></main>
<script>
const runs=${safe(runs)},equipment=${safe(equipment)},token=${safe(token)};
const view=document.getElementById("view"),runSel=document.getElementById("run"),scrub=document.getElementById("scrub"),time=document.getElementById("time"),stale=document.getElementById("stale"),play=document.getElementById("play"),sel=document.getElementById("sel");
let run=runs[0],i=0,playing=true,ready=false,seq=0,timer=null,tween=0;
runs.forEach((r,k)=>runSel.add(new Option(r.title,k)));
function send(){if(!ready)return;const ops=(stale.checked?run.stale:run.fresh)[i];view.contentWindow.postMessage({protocol:"controlsbench.machine-view.protocol.v1",token,type:"frame",sequence:++seq,tweenMs:stale.checked?0:tween,ops},"*");tween=0;scrub.value=i;time.textContent="t = "+(run.times[i]/1000).toFixed(1)+" s · frame "+(i+1)+"/"+run.fresh.length;}
function tick(){if(!playing)return;const next=(i+1)%run.fresh.length;tween=next===i+1?run.times[next]-run.times[i]:0;i=next;send();}
function load(k){run=runs[k];i=0;scrub.max=run.fresh.length-1;send();}
runSel.onchange=()=>load(+runSel.value);scrub.oninput=()=>{i=+scrub.value;send();};stale.onchange=send;
play.onclick=()=>{playing=!playing;play.textContent=playing?"Pause":"Play";};
window.addEventListener("message",e=>{if(e.source!==view.contentWindow)return;const m=e.data;if(!m||m.token!==token)return;
if(m.type==="ready"){ready=true;load(0);timer=setInterval(tick,100);}
else if(m.type==="select"){const eq=equipment.find(q=>q.id===m.equipmentId);
if(m.entityId)sel.innerHTML="Carton <code>"+m.entityId+"</code>";
else if(eq)sel.innerHTML="<b>"+eq.label+"</b> (<code>"+eq.id+"</code>)<br>"+(eq.channels.length?eq.channels.map(c=>"<code>"+c+"</code> = "+(run.values[i][c]??"unknown")).join("<br>"):"no signals");}
else if(m.type==="error")sel.textContent="View error: "+m.message;});
view.srcdoc=${safe(srcdoc)};
</script></body></html>`;

const outDir = join(dir, "preview");
await mkdir(outDir, { recursive: true });
const out = join(outDir, "index.html");
await writeFile(out, html);
console.log(out);
if (process.argv.includes("--open")) {
  const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p => p && existsSync(p));
  if (chrome) spawn(chrome, [pathToFileURL(out).href], { detached: true, stdio: "ignore" }).unref();
}
