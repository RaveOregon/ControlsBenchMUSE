// A fresh read-only boot attestation replaces only the stale preparation boot.
// Original packet, source hashes, credit accounting and single-Start guard stay intact.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const path=resolve(process.argv[2]),boot=process.argv[3],directory=dirname(path);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(sha(path),'c37e23d72f3e2af6bada9d46b1cfbed9bc4b8d871d01e9ba10300abd00183283');
assert.equal(boot,'1787886077538','Only the freshly inspected boot is authorized by this attestation');
const packet=JSON.parse(readFileSync(path,'utf8'));
assert.equal(packet.contract,'controlsbench.s2-hmi-proof.v1');
assert.equal(JSON.parse(readFileSync(join(directory,'launch-status.json'),'utf8').replace(/^\uFEFF/,'')).phase,'ready-for-authorized-start');
assert(!existsSync(join(directory,'start-request.json')),'Start already attempted; inspect before another request');
assert.equal(sha(join(packet.repositoryRoot,'artifacts/wonder/session.jsonl')),packet.accountBaseline.sha256);
assert(!existsSync(join(packet.repositoryRoot,'artifacts/m10/live.lock')));
for(const[p,h]of Object.entries(packet.sourceHashes))assert.equal(sha(join(packet.sourceRoot,p)),h);
const host=await fetch('http://127.0.0.1:5190/api/host').then(r=>{assert(r.ok);return r.json();});
assert.equal(host.factory.id,'wonder-s2-live-hmi');assert.equal(host.campaignId,null);assert.equal(host.hmi.state,'observing');
const hmi=await fetch('http://127.0.0.1:5191/api/state').then(r=>{assert(r.ok);return r.json();});
assert.equal(hmi.link.state,'connected');assert.equal(hmi.link.bootIdentity,boot);assert.equal(hmi.link.plcScanning,true);assert.equal(hmi.ownership.commandsEnabled,true);
assert(Date.now()-Date.parse(hmi.link.lastPollOkAtIso)<5000);
for(const[path,value]of Object.entries({'GVL_DemoRead.BuildId':8001,'GVL_DemoRead.InterfaceVersion':1,
  'GVL_DemoRead.Status.ModeText':'Stopped','GVL_DemoRead.Status.FaultCode':0,'GVL_DemoRead.Status.ItemActive':false,
  'GVL_DemoRead.Status.CompletionPending':false,'GVL_DemoRead.Status.OfferPending':false,'GVL_DemoRead.Status.Motor_RunCmd':false})){
  const sample=hmi.snapshot.values[path];assert.equal(sample.good,true);assert.deepEqual(sample.value,value);
}
const review={atIso:new Date().toISOString(),packetSha256:sha(path),preparedBoot:packet.bootIdentity,inspectedBoot:boot,
  reason:'PLC restarted between preparation and the user reporting local password entry. Fresh observer is scanning on the expected M8 build with clean stopped state. No previous held state is recovered across this boot.',
  sourceAndAccountUnchanged:true,host,hmi};
writeFileSync(join(directory,'fresh-boot-attestation.json'),JSON.stringify(review,null,2)+'\n',{flag:'wx'});
writeFileSync(join(directory,'pre-start.json'),JSON.stringify(review,null,2)+'\n',{flag:'wx'});
const request={contractVersion:1,requestId:'s2-authorized-fresh-boot-'+Date.now(),type:'start',payload:{scope:{hmi:true}}};
writeFileSync(join(directory,'start-request.json'),JSON.stringify(request,null,2)+'\n',{flag:'wx'});
const response=await fetch('http://127.0.0.1:5190/api/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)}),body=await response.text();
writeFileSync(join(directory,'start-response.json'),JSON.stringify({httpStatus:response.status,body},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({httpStatus:response.status,body}));assert(response.ok,'Inspect saved request/response before any other action');
