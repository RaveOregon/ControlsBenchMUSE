// Self-contained, zero-model/zero-PLC acceptance witness for repeat use of the real portal.
// Starts its own fixture services on ephemeral ports. Never attaches to an existing user's host.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {CampaignHost} from '../src/host/campaign-host.ts';
import {fixtureCampaignFactory} from '../src/host/campaign-factory.ts';
import {FakeProvider} from '../src/campaign/provider.ts';
import {adaptivePolicy} from '../src/campaign/harness.ts';
import {readLedger} from '../src/campaign/ledger.ts';
import {HmiService} from '../src/hmi/service.ts';
import {FixturePlc} from '../src/hmi/fixture.ts';
import {createHmiServer,listen as listenHmi} from '../src/hmi/http.ts';
import {PortalSessionBridge} from '../src/hmi/portal-bridge.ts';
import {HmiHub} from '../src/host/hmi.ts';
import {CdpWebVisuSource} from '../src/host/cdp-webvisu.ts';
import {createPortalServer,listen as listenPortal} from '../src/host/http.ts';
import {launch} from './lib/chrome.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(root,process.argv[2]??`artifacts/workflow-acceptance/${new Date().toISOString().replace(/[:.]/g,'-')}`);
mkdirSync(out,{recursive:true});
const checks=[],acks=[],startedAtIso=new Date().toISOString();
let browser,host,service,portal,hmiServer,firstId,secondId,error;
const check=(name,value)=>{assert(value,name);checks.push(name);};
const save=(file,value)=>writeFileSync(join(out,file),JSON.stringify(value,null,2)+'\n');
const wait=async(condition,label,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await condition())return;await new Promise(r=>setTimeout(r,50));}throw Error(`Timed out: ${label}`);};
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');

try{
  check('Production UI build exists',existsSync(join(root,'ui/dist/index.html')));
  service=new HmiService({source:{kind:'fixture',plc:new FixturePlc('m10-final-held',{emulate:true})},artifactRoot:join(out,'hmi'),pollIntervalMs:250,commandPolicy:'disabled'});
  let bridge;
  const hub=new HmiHub({captureIntervalMs:1000,onChange:(view,change)=>bridge?.onHubChange(view,change)});
  bridge=new PortalSessionBridge(service,hub);
  hmiServer=createHmiServer(service);service.url=await listenHmi(hmiServer,0);await service.start();
  let campaigns=0;
  const holding=(context,turn)=>({summary:'Observe fixture while the engineer tests lifecycle commands',...(turn===1?{plan:{objective:'Fixture lifecycle acceptance',experiments:[{id:'lifecycle-observation',objective:'Exercise pause, resume and stop during observation',category:'normal',requirements:[]}]}}:{}),
    calls:[{id:`observe-${turn}`,name:'observe_for_duration',arguments:{durationMs:5000}}]});
  const factory=fixtureCampaignFactory({adaptive:true,provider:()=>new FakeProvider(++campaigns===1?holding:adaptivePolicy)});
  factory.id='fixture-workflow-acceptance';factory.label='Fixture workflow acceptance · no PLC or model';
  host=new CampaignHost({factory,artifactDir:join(out,'campaigns'),hmi:hub,hmiSourceFactory:url=>bridge.attachSource(new CdpWebVisuSource(url,{headless:true,width:1280,height:800}))});
  host.subscribe(m=>{if(m.type==='ack')acks.push(m.ack);});
  portal=createPortalServer({host,staticDir:join(root,'ui/dist')});
  const {url}=await listenPortal(portal,0,'127.0.0.1');
  host.submit({contractVersion:1,requestId:'acceptance-hmi',type:'configure_hmi',payload:{url:service.url+'?capture=portal'}});
  await host.idle();check('Controlled fixture HMI is captured',hub.view.state==='observing');
  browser=await launch({width:1440,height:1000});
  await browser.cdp('Page.navigate',{url});
  check('Real production browser attached',await browser.waitFor('window.controlsBenchPortal?.hosted===true'));
  check('Unsupported live steering is disabled with an explanation',await browser.waitFor(`document.querySelector('textarea[aria-label="Direction for Muse"]')?.disabled===true&&document.querySelector('[aria-label="Steer Muse"]')?.textContent.includes('unavailable in this host')`));
  check('Unsupported physical-sink overrides are disabled without hiding PLC outputs',await browser.waitFor(`(()=>{const buttons=Array.from(document.querySelectorAll('[data-control="sink-suppression"]'));return buttons.length>0&&buttons.every(b=>b.disabled)&&document.querySelector('[aria-label="Raw I/O"]').textContent.includes('PLC commands remain visible');})()`));
  const buttonReady=label=>browser.waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled)`);
  const click=async label=>{
    check(`${label} is available`,await buttonReady(label));
    const rect=await browser.evaluate(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled);b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await browser.cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...rect});
    await browser.cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...rect});
  };
  await click('Start campaign');
  await wait(()=>host.runtime?.status==='running'&&host.events.some(e=>e.type==='action.requested'&&e.data.name==='observe_for_duration'),'first observation');
  firstId=host.campaignId;
  await click('Pause');await wait(()=>host.runtime.status==='paused','pause acknowledged');
  check('Pause has an applied host acknowledgement',acks.some(a=>a.outcome==='applied'&&a.campaignId===firstId&&a.detail.startsWith('Paused:')));
  const held=JSON.stringify(host.report().provenance)+'|'+JSON.stringify(host.projection.rawImage);
  await new Promise(r=>setTimeout(r,250));
  check('Paused fixture image is retained',held===JSON.stringify(host.report().provenance)+'|'+JSON.stringify(host.projection.rawImage));
  await click('Resume');await wait(()=>host.runtime.status==='running','resume acknowledged');
  await click('Stop');await wait(()=>host.runtime.status==='stopped','stop acknowledged');await host.idle();
  const first=await(await fetch(`${url}/api/campaign/report`)).json();
  save('first-stopped-report.json',first);
  check('Stopped run has its own final report',first.campaignId===firstId&&first.status==='stopped'&&Boolean(first.finalization));
  check('Stopped run has no outstanding requested actions',Object.values(host.projection.actions).every(a=>a.status!=='requested'));
  await click('Start campaign');await wait(()=>host.campaignId!==firstId&&host.runtime?.status==='completed','second campaign completed');await host.idle();
  secondId=host.campaignId;
  const second=await(await fetch(`${url}/api/campaign/report`)).json();save('second-completed-report.json',second);
  check('Second Start creates a distinct completed campaign',second.campaignId===secondId&&secondId!==firstId&&second.status==='completed');
  check('Second run has its own evidence-grounded findings',second.findings.length>0&&second.findings.every(f=>f.claims.every(c=>c.evidenceId.startsWith(secondId+':'))));
  const firstFile=join(out,'campaigns',firstId,'campaign.jsonl');const firstEvents=readLedger(firstFile);
  check('First stopped ledger remains independently readable',firstEvents.at(-1).campaignId===firstId&&firstEvents.some(e=>e.type==='report.finalized'));
  const firstHash=sha(firstFile);
  await browser.cdp('Page.reload');check('Browser reconnects to the existing campaign',await browser.waitFor('window.controlsBenchPortal?.hosted===true'));
  await click('Results');
  check('Results displays the current run after browser reload',await browser.waitFor(`document.querySelector('.bench-report')?.textContent.includes(${JSON.stringify(secondId)})`));
  check('Results does not mix the first run into the second report',await browser.evaluate(`!document.querySelector('.bench-report').textContent.includes(${JSON.stringify(firstId)})`));
  check('First run was not modified by reload or the second run',sha(firstFile)===firstHash);
  const bundle=await(await fetch(`${url}/api/campaign/report/bundle`)).json();
  check('Presentation bundle carries the exact current report',JSON.stringify(bundle.report)===JSON.stringify(second));
  await browser.evaluate(`window.__acceptanceDownloads=[];window.__acceptanceCreateObjectURL=URL.createObjectURL;URL.createObjectURL=function(blob){window.__acceptanceDownloads.push(blob);return window.__acceptanceCreateObjectURL.call(this,blob)};true`);
  await click('Download HTML report');
  check('HTML report download completes',await browser.waitFor('window.__acceptanceDownloads.some(b=>b.type==="text/html")'));
  const html=await browser.evaluate('window.__acceptanceDownloads.find(b=>b.type==="text/html").text()');
  check('Portable report belongs to the second campaign',html.includes(secondId)&&!html.includes(firstId)&&html.startsWith('<!doctype html>'));
  writeFileSync(join(out,'second-report.html'),html);writeFileSync(join(out,'second-results.png'),await browser.screenshot());
  check('Fixture reports never claim a live PLC run',first.evidenceClass==='fake_connector'&&second.evidenceClass==='fake_connector');
  save('acknowledgements.json',acks);
}catch(caught){error=caught;}
finally{
  browser?.close();
  try{await host?.close();}catch(caught){error??=caught;}
  try{await service?.stop();}catch(caught){error??=caught;}
  for(const server of [portal,hmiServer])if(server?.listening){server.closeAllConnections?.();await new Promise(ok=>server.close(ok));}
  const result={status:error?'fail':'pass',scope:'offline-production-portal-lifecycle',startedAtIso,completedAtIso:new Date().toISOString(),sourceCommit:execFileSync('git',['-c','core.longpaths=true','-C',root,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),
    harnessSha256:sha(fileURLToPath(import.meta.url)),productionEntrySha256:sha(join(root,'ui/dist/index.html')),
    checks,firstId,secondId,error:error?String(error.stack??error):undefined,plcContacted:false,modelCalls:0,
    qualification:'Fixture lifecycle and report continuity only. Does not qualify uploaded-project generation, live PLC recovery, service-restart history, HMI/PLC behavior, or model-selected plans.'};
  save('result.json',result);console.log(JSON.stringify({status:result.status,checks:checks.length,directory:out,error:error?String(error):undefined}));
}
if(error)process.exitCode=1;
