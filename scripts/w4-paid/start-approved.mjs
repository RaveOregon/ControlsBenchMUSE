// One explicitly authorized portal Start after native bench qualification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
const {values}=parseArgs({options:{packet:{type:'string'}}});
assert(values.packet,'--packet required');
const path=resolve(values.packet),directory=dirname(path),packet=JSON.parse(readFileSync(path,'utf8'));
process.env.CONTROLSBENCH_W4_LAUNCH_CONFIG=resolve(fileURLToPath(new URL('../../',import.meta.url)),packet.launchConfiguration.path);
const s=await import('./support.mjs');
const {verifyResumeBench}=await import('./factory.mjs');
const bench=verifyResumeBench(packet,path);s.verifyAccountBaseline(packet);
assert(!existsSync(join(directory,'start-request.json')),'Start already attempted; inspect before another action');
const host=await fetch('http://127.0.0.1:5190/api/host').then(r=>{assert(r.ok);return r.json();});
assert.equal(host.campaignId,null);assert.equal(host.hmi.state,'observing');
const hmi=await fetch('http://127.0.0.1:5191/api/state').then(r=>{assert(r.ok);return r.json();});
assert.equal(hmi.link.state,'connected');
for(const[key,value]of Object.entries({ModeText:'Stopped',FaultCode:0,ItemActive:false,CompletionPending:false,Motor_RunCmd:false})) {
  const signal=hmi.snapshot.values['GVL_DemoRead.Status.'+key];assert.equal(signal.good,true);assert.equal(signal.value,value);
}
const request={contractVersion:1,requestId:'approved-fault-followup-'+Date.now(),type:'start',payload:{scope:{faults:true,adaptive:true}}};
writeFileSync(join(directory,'pre-start.json'),JSON.stringify({atIso:new Date().toISOString(),packetSha256:s.hashFile(path),bench,host,hmi},null,2)+'\n',{flag:'wx'});
writeFileSync(join(directory,'start-request.json'),JSON.stringify(request,null,2)+'\n',{flag:'wx'});
const response=await fetch('http://127.0.0.1:5190/api/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)});
const body=await response.text();
writeFileSync(join(directory,'start-response.json'),JSON.stringify({httpStatus:response.status,body},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({httpStatus:response.status,body}));assert(response.ok,'Inspect saved acknowledgement before doing anything else');
