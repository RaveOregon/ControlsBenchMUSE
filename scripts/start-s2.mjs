import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
const path=resolve(process.argv[2]),directory=dirname(path),packet=JSON.parse(readFileSync(path,'utf8'));
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(packet.contract,'controlsbench.s2-hmi-proof.v1');
assert.equal(JSON.parse(readFileSync(join(directory,'launch-status.json'),'utf8').replace(/^\uFEFF/,'')).phase,'ready-for-authorized-start');
assert(!existsSync(join(directory,'start-request.json')),'Start was already attempted; inspect before another request');
assert.equal(sha(join(packet.repositoryRoot,'artifacts/wonder/session.jsonl')),packet.accountBaseline.sha256);
for(const[p,h]of Object.entries(packet.sourceHashes))assert.equal(sha(join(packet.sourceRoot,p)),h);
const host=await fetch('http://127.0.0.1:5190/api/host').then(r=>{assert(r.ok);return r.json();});
assert.equal(host.factory.id,'wonder-s2-live-hmi');assert.equal(host.campaignId,null);assert.equal(host.hmi.state,'observing');
const hmi=await fetch('http://127.0.0.1:5191/api/state').then(r=>{assert(r.ok);return r.json();});
assert.equal(hmi.link.state,'connected');assert.equal(hmi.link.bootIdentity,packet.bootIdentity);assert.equal(hmi.ownership.commandsEnabled,true);
for(const[key,value]of Object.entries({ModeText:'Stopped',FaultCode:0,ItemActive:false,CompletionPending:false,OfferPending:false,Motor_RunCmd:false})){
  const sample=hmi.snapshot.values['GVL_DemoRead.Status.'+key];assert.equal(sample.good,true);assert.deepEqual(sample.value,value);
}
writeFileSync(join(directory,'pre-start.json'),JSON.stringify({atIso:new Date().toISOString(),packetSha256:sha(path),host,hmi},null,2)+'\n',{flag:'wx'});
const request={contractVersion:1,requestId:'s2-authorized-'+Date.now(),type:'start',payload:{scope:{hmi:true}}};
writeFileSync(join(directory,'start-request.json'),JSON.stringify(request,null,2)+'\n',{flag:'wx'});
const response=await fetch('http://127.0.0.1:5190/api/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)}),body=await response.text();
writeFileSync(join(directory,'start-response.json'),JSON.stringify({httpStatus:response.status,body},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({httpStatus:response.status,body}));assert(response.ok,'Inspect saved request/response before doing anything else');
