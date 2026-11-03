// Full offline regression for known PLC rejections versus uncertain writes.
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const basePath=resolve('artifacts/w4-cadence/2026-11-03T03-47-18-212Z/result.json');
assert.equal(JSON.parse(readFileSync(basePath,'utf8')).status,'pass');
const directory=resolve('artifacts/w4-command-rejection',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory,{recursive:true});
const physical=['src/live/wonder-process/engine.ts','src/live/wonder-process/protocol.ts','src/live/wonder-process/driver.ts','src/live/m8-opcua.ts','src/campaign/driver.ts','src/campaign/m8-bindings.ts'];
const paths=[...physical,'src/campaign/contracts.ts','src/campaign/runtime.ts','scripts/lib/w4-commissioning.ts','test/fixtures/m8-protocol-transport.ts','test/fixtures/wonder-process-transport.ts','test/m8-connector.test.ts','test/wonder-process.test.ts','scripts/check-w4-command-rejection.js'];
const sources=Object.fromEntries(paths.map(p=>[p,sha(p)])),account=resolve('../../artifacts/wonder/session.jsonl'),accountBefore=sha(account);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^OPC_|^MODEL_API_KEY$|^CONTROLSBENCH_WONDER/.test(k)));
const tests=JSON.parse(readFileSync('package.json','utf8')).scripts.test.split(' ').filter(x=>x.startsWith('test/'));
const priorPath=resolve('artifacts/w4-command-rejection/2026-11-03T13-04-25-355Z/result.json');
const prior=JSON.parse(readFileSync(priorPath,'utf8')),priorOutput=readFileSync(join(resolve(priorPath,'..'),'full-offline-suite.txt'),'utf8');
assert.equal(prior.results[1].tests,229);assert.equal(prior.results[1].failed,10);
for(const block of priorOutput.split(/(?=not ok \d+ - )/).slice(1))assert(/Networking disabled for recorded Wonder replay|could not write config file/.test(block.split('# Subtest:')[0]));
for(const[p,h]of Object.entries(prior.sources))if(p!=='scripts/check-w4-command-rejection.js')assert.equal(sha(p),h);
const environmentReruns=['test/cdp-webvisu.test.ts','test/hmi-freshness.test.ts','test/portal-host.test.ts','test/product-integration.test.ts','test/wonder-factory.test.ts'];
const checks=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
  ['environment-blocked-tests-rerun',['--test','--test-reporter=tap','--test-concurrency=1',...environmentReruns]],
  ['historical-paid-wrapper-tests',['--import','./scripts/lib/network-disabled.js','--test','--test-reporter=tap','--test-concurrency=1','scripts/w4-paid/paid.test.mjs','scripts/w4-paid/expanded.test.mjs','scripts/w4-paid/completed-recovery.test.mjs']]];
const result={status:'running',scope:'offline-command-rejection-delta',sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),sources,qualifiedPhysicalDelta:physical,
  baseQualification:{file:basePath,sha256:sha(basePath),implementationCommit:'dcb7867f1ef270166bbf365b1ad6a13f33ec1dac',passed:true},
  fullSuiteCoverage:{file:priorPath,sha256:sha(priorPath),tests:229,passed:219,environmentFailures:10,rerunFiles:environmentReruns,claimBoundary:'Only network-disabled loopback tests and sandbox-denied temporary git init failed; all unchanged source hashes verified. Rerun those five files with loopback and temporary git access, retaining original results.'},
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
result.finishedAtIso=new Date().toISOString();save();writeFileSync('artifacts/w4-command-rejection/latest.json',JSON.stringify({status:result.status,directory},null,2)+'\n');
console.log(JSON.stringify({status:result.status,directory,results:result.results}));process.exitCode=result.status==='pass'?0:1;
