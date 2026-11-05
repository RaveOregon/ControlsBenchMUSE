// Read-only, loopback-only recording desk. Serves explicitly selected submission artifacts;
// it cannot enumerate the repository, start campaigns, contact a PLC or make model requests.
import {createServer} from 'node:http';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../',import.meta.url));
const {values}=parseArgs({options:{port:{type:'string',default:'5195'},check:{type:'boolean',default:false}}});
const files=new Map();
const add=(url,path,label)=>files.set(url,{path:join(root,path),source:path,label});
const manifest=JSON.parse(readFileSync(join(root,'evidence/manifest.json'),'utf8'));
for(const f of manifest.files)add(`/evidence/${f.file}`,`evidence/${f.file}`,f.role);
const dir='artifacts/projects/p-20261104015133-55daee/v1';
const version=JSON.parse(readFileSync(join(root,dir,'version.json'),'utf8'));
for(const name of ['world.ts','world.manifest.json','world.test.ts','assumptions.md','plan.json','validation.json'])
  add(`/preparation/${name}`,`${dir}/${version.package.directory}/${name}`,`Genuine Muse preparation: ${name}`);
add('/preparation/spec.md',`${dir}/inputs/spec.md`,'Original uploaded specification');
add('/preparation/review.json',`${dir}/review.json`,'Genuine Muse preparation review');
const hmi='artifacts/s2/2026-11-03T23-19-41-497Z-live-retry/host/runs/2026-11-03T23-21-03-238Z-live_plc/portal-host/portal-20261103232137992-1/vision-frames';
for(const [name,file] of [['start','2-2-action.jpg'],['stop','2-3-action.jpg'],['overload','3-current.jpg'],['reset','4-2-action.jpg']])
  add(`/hmi/${name}.jpg`,`${hmi}/${file}`,`S2 received image: ${name}`);
const witness='artifacts/spec-onboarding/witness';
for(const name of readdirSync(join(root,witness)).filter(n=>n.endsWith('.png')))
  add(`/preparation/screens/${name}`,`${witness}/${name}`,'Saved onboarding witness screenshot');
for(const name of ['controlsbench-architecture.png','controlsbench-live-loop.png','controlsbench-plc-integration.png'])
  add(`/diagrams/${name}`,`docs/submission-diagrams/${name}`,'Agnostic architecture; populated demo bindings');

const catalog=[...files].map(([url,f])=>{
  if(!existsSync(f.path))throw Error(`Missing recording artifact: ${f.source}`);
  const bytes=readFileSync(f.path);
  return{url,source:f.source,label:f.label,byteLength:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
});
if(values.check){console.log(JSON.stringify({status:'pass',files:catalog.length,modelCalls:0,plcContacted:false}));process.exit(0);}
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ControlsBench Muse — video desk</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f5f7;color:#142536;font:16px/1.55 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:42px 28px 64px}h1{font-size:36px;line-height:1.15;margin:8px 0 12px}h2{font-size:21px;margin:0 0 10px}h3{font-size:17px}p{margin:8px 0 16px}.muted{color:#536578}.eyebrow{font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#536578}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;margin-top:28px}.card{background:white;border:1px solid #d6dfe8;border-radius:12px;padding:24px}.full{grid-column:1/-1}a{color:#075ca8}a.button{display:inline-block;text-decoration:none;background:#075ca8;color:white;border-radius:6px;padding:10px 16px;margin:4px 6px 4px 0}a.secondary{background:#edf3fa;color:#075ca8}.badge{display:inline-block;font-size:12px;font-weight:650;background:#edf3fa;color:#315272;padding:3px 9px;border-radius:5px;margin-bottom:10px}.frames{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.frames img{width:100%;border:1px solid #d6dfe8;border-radius:5px}.frames p{font-size:13px;margin:4px 0}.diagram{width:100%;display:block;border:1px solid #d6dfe8;border-radius:6px}ul{padding-left:20px}.timeline{font-variant-numeric:tabular-nums}code{font-size:13px}@media(max-width:760px){.grid{grid-template-columns:1fr}.frames{grid-template-columns:repeat(2,1fr)}h1{font-size:30px}}</style></head><body><main>
<div class="eyebrow">ControlsBench Muse · submission recording</div><h1>Video desk</h1><p class="muted">Open each screen you need, then record short segments. The tester and saved live evidence are labelled separately.</p>
<div class="grid">
<section class="card"><span class="badge">Tester · Muse preparation / offline campaigns</span><h2>1. Specification → world and plan</h2><p>Open Setup. Use <b>Create project from specification</b>, or select <b>Slow-belt conveyor variant → v1</b> to show the genuine saved Muse preparation and its 28-check plan.</p><a class="button" href="http://127.0.0.1:5194/" target="_blank" rel="noopener">Open tester app</a><a class="button secondary" href="/preparation/spec.md" target="_blank">Open example spec</a><p class="muted">Prepare with Muse makes paid model calls. This tester's campaign transport/provider are offline fixtures; it does not run a new PLC trial.</p></section>
<section class="card"><span class="badge">Recorded live PLC / Muse investigation</span><h2>2. Show the adaptive result</h2><p>Muse observed missing drive feedback and fault 12, then chose a new D1 feedback-consistency investigation, observed fault 21, and recovered. Two findings, 31 exact PLC claims.</p><a class="button" href="/evidence/reports/adaptive-plc-investigation.html" target="_blank">Open adaptive report</a><a class="button secondary" href="/evidence/reports/adaptive-plc-investigation.pdf" target="_blank">PDF</a><p><a href="/evidence/records/w4-engineering-review.json" target="_blank">Engineering review</a> · <a href="/evidence/records/w4-audit.json" target="_blank">Audit</a></p></section>
<section class="card"><span class="badge">Separate recorded live HMI trial</span><h2>3. Muse operates the HMI</h2><p>Actual browser clicks, PLC acknowledgements and 17 received screenshot inputs. Start, Stop/coast, overload and Reset were supported in the exercised cases; stale/disconnect remained inconclusive.</p><a class="button" href="/evidence/reports/muse-hmi-operation.html" target="_blank">Open HMI report</a><a class="button secondary" href="http://127.0.0.1:5190/" target="_blank" rel="noopener">Completed-trial app</a><p><a href="/evidence/reports/muse-hmi-operation.pdf" target="_blank">PDF</a> · <a href="/evidence/records/s2-engineering-review.json" target="_blank">Engineering review and limitations</a></p></section>
<section class="card"><span class="badge">Genuine saved model generation</span><h2>4. Inspect what Muse built</h2><p>The changed specification generated a 0.30 m/s conveyor world. One repair passed all 13 validation checks. These are the saved source files and measurements.</p><a class="button" href="/preparation/world.ts" target="_blank">World source</a><a class="button secondary" href="/preparation/validation.json" target="_blank">Validation</a><p><a href="/preparation/assumptions.md" target="_blank">Assumptions</a> · <a href="/preparation/plan.json" target="_blank">Prepared plan</a> · <a href="/preparation/screens/20-genuine-muse-preparation.png" target="_blank">Saved preparation screen</a></p></section>
<section class="card full"><span class="badge">Exact images received by Muse in S2</span><h2>HMI frames for the video</h2><div class="frames">${[['start','Start'],['stop','Stop / coast'],['overload','Drive overload'],['reset','Reset / stopped']].map(([id,title])=>`<div><a href="/hmi/${id}.jpg" target="_blank"><img src="/hmi/${id}.jpg" alt="Saved S2 ${title} screen"></a><p>${title}</p></div>`).join('')}</div></section>
<section class="card full"><span class="badge">Agnostic interfaces · populated demo choices</span><h2>Architecture</h2><p>Model, connection and controller-platform adapters are separate. The exercised bindings are Muse Wonder, OPC UA and CODESYS Control Win.</p><a href="/diagrams/controlsbench-architecture.png" target="_blank"><img class="diagram" src="/diagrams/controlsbench-architecture.png" alt="ControlsBench agnostic product architecture with populated demonstration bindings"></a><p><a href="/diagrams/controlsbench-live-loop.png" target="_blank">Live loop</a> · <a href="/diagrams/controlsbench-plc-integration.png" target="_blank">PLC integration</a></p></section>
<section class="card full"><h2>Recording order · target 2:50</h2><p class="timeline"><b>0:00–0:20</b> problem and purpose · <b>0:20–0:55</b> preparation and brief architecture · <b>0:55–1:15</b> normal-operation evidence · <b>1:15–1:55</b> adaptive investigation · <b>1:55–2:15</b> HMI · <b>2:15–2:50</b> report and closing.</p><p>Keep separate trials labelled; mark removed model waiting time. CODESYS Control Win executes the PLC application. The saved reports are evidence review, not new live footage.</p><p><a href="/evidence/records/normal-operation-result.json" target="_blank">Normal-operation result</a> · <a href="/evidence/records/normal-operation-audit.json" target="_blank">Normal-operation audit</a> · <a href="/evidence/reports/partial-hmi-attempt.pdf" target="_blank">Preserved partial attempt</a> · <a href="/api/catalog" target="_blank">Artifact hashes</a></p></section>
</div></main></body></html>`;
const mime={'.html':'text/html; charset=utf-8','.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8','.ts':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
const server=createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{allow:'GET, HEAD'});res.end();return;}
  const url=new URL(req.url,'http://127.0.0.1');
  let bytes,type;
  if(url.pathname==='/'||url.pathname==='/index.html'){bytes=Buffer.from(html);type='text/html; charset=utf-8';}
  else if(url.pathname==='/api/catalog'){bytes=Buffer.from(JSON.stringify({scope:'saved-submission-evidence',files:catalog},null,2));type='application/json; charset=utf-8';}
  else{const entry=files.get(url.pathname);if(!entry){res.writeHead(404);res.end('Artifact not listed');return;}bytes=readFileSync(entry.path);type=mime[extname(entry.path)]??'application/octet-stream';}
  res.writeHead(200,{'content-type':type,'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:bytes);
});
server.listen(Number(values.port),'127.0.0.1',()=>console.log(`ControlsBench video desk: http://127.0.0.1:${values.port}/ (${catalog.length} saved artifacts)`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.closeAllConnections();server.close(()=>process.exit(0));});
