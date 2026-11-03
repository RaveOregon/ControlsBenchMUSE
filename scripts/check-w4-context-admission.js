// Delta qualification against the preserved 215/215 parent build. No browser/UI,
// physical world or PLC changes; rerun affected campaign/provider/process tests.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const basePath=resolve('artifacts/w4-transport-retry/2026-11-03T02-56-42-016Z/result.json'),base=JSON.parse(readFileSync(basePath,'utf8'));
assert.equal(base.status,'pass');assert(base.results.some(r=>r.name==='affected-campaign-provider-process-tests'&&r.tests===88&&r.passed));
const directory=resolve('artifacts/w4-context-admission',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory,{recursive:true});
const paths=['src/campaign/provider.ts','src/campaign/runtime.ts','src/campaign/wonder-responses.ts','src/host/wonder-campaign-factory.ts','test/wonder-transport-retry.test.ts','package.json','scripts/check-w4-context-admission.js'];
const sources=Object.fromEntries(paths.map(p=>[p,sha(p)])),account=resolve('../../artifacts/wonder/session.jsonl'),accountBefore=sha(account);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^OPC_|^MODEL_API_KEY$|^CONTROLSBENCH_WONDER/.test(k)));
const tests=['test/campaign.test.ts','test/wonder-campaign.test.ts','test/wonder-factory.test.ts','test/wonder-process.test.ts','test/wonder-retry.test.ts','test/wonder-decision-repair.test.ts','test/wonder-transport-retry.test.ts','test/w4-integration.test.ts'];
const checks=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
  ['affected-campaign-provider-process-tests',['--import','./scripts/lib/network-disabled.js','--test','--test-reporter=tap','--test-concurrency=1',...tests]],
  ['historical-paid-wrapper-tests',['--import','./scripts/lib/network-disabled.js','--test','--test-reporter=tap','--test-concurrency=1','scripts/w4-paid/paid.test.mjs','scripts/w4-paid/expanded.test.mjs','scripts/w4-paid/completed-recovery.test.mjs']]];
const result={status:'running',scope:'offline-transport-retry-delta',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),
  sources,baseQualification:{file:basePath,sha256:sha(basePath),fullSuiteTests:215,parentAffectedTests:88,passed:true,claimBoundary:'Prior full build and transport delta; current context-admission delta separately qualified below'},
  startedAtIso:new Date().toISOString(),realModelCalls:0,livePlcExecuted:false,results:[]};
const save=()=>writeFileSync(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');save();console.log('Evidence: '+directory);
for(const[name,args]of checks){console.log('Checking '+name+'...');const run=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true,timeout:480000,maxBuffer:64*1024*1024});
  const output=(run.stdout??'')+(run.stderr??'');writeFileSync(join(directory,name+'.txt'),output);
  result.results.push({name,passed:run.status===0,exitCode:run.status,error:run.error?.message,tests:Number(output.match(/# tests (\d+)/)?.[1]??0),failed:Number(output.match(/# fail (\d+)/)?.[1]??0),skipped:Number(output.match(/# skipped (\d+)/)?.[1]??0)});save();if(run.status!==0)break;}
try{for(const[p,h]of Object.entries(sources))assert.equal(sha(p),h);assert.equal(sha(account),accountBefore);
  const old=JSON.parse(readFileSync('artifacts/w4-readiness/e3469af/launch.json','utf8')),proof=JSON.parse(readFileSync(old.proof,'utf8'));let count=0;
  for(const group of[proof.sourceHashes,proof.frozenHashes])for(const[p,h]of Object.entries(group)){assert.equal(sha(join(old.pinnedCheckout,p)),h);count++;}
  result.livePin={commit:old.sourceCommit,verifiedUnchangedHashes:count};result.accountSha256=accountBefore;
  result.status=result.results.length===checks.length&&result.results.every(r=>r.passed)?'pass':'fail';
}catch(e){result.status='fail';result.error=e.message;}
result.finishedAtIso=new Date().toISOString();save();writeFileSync('artifacts/w4-context-admission/latest.json',JSON.stringify({status:result.status,directory},null,2)+'\n');
console.log(JSON.stringify({status:result.status,directory,results:result.results}));process.exitCode=result.status==='pass'?0:1;
