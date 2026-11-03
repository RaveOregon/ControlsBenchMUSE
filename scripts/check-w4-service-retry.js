// Offline qualification of retry changes. Full suite uses loopback browser fixtures;
// retry-specific proof additionally disables every Node network transport.
import {spawnSync,execFileSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
const directory=resolve('artifacts/w4-service-retry',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory,{recursive:true});
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const paths=['src/campaign/provider.ts','src/campaign/runtime.ts','src/campaign/wonder-responses.ts','src/host/wonder-campaign-factory.ts','test/wonder-retry.test.ts','package.json','scripts/check-w4-service-retry.js',
  'scripts/w4-paid/support.mjs','scripts/w4-paid/factory.mjs','scripts/w4-paid/paid.test.mjs'];
const sources=Object.fromEntries(paths.map(p=>[p,sha(p)]));
const account=resolve('../../artifacts/wonder/session.jsonl');
const accountBefore=sha(account);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^OPC_|^MODEL_API_KEY$|^CONTROLSBENCH_WONDER|^WONDER_RETRY_EVIDENCE$/.test(k)));
env.CONTROLSBENCH_HMI_BROWSER??='C:/Program Files/Google/Chrome/Application/chrome.exe';
const testFiles=JSON.parse(readFileSync('package.json','utf8')).scripts.test.match(/test\/\S+\.ts/g);
const checks=[['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],
  ['runtime-tests',['--test','--test-reporter=tap','--test-concurrency=1',...testFiles]],
  ['retry-network-disabled',['--import','./scripts/lib/network-disabled.js','--test','--test-reporter=tap','--test-concurrency=1','test/wonder-retry.test.ts']],
  ['paid-wrapper-network-disabled',['--import','./scripts/lib/network-disabled.js','--test','--test-reporter=tap','--test-concurrency=1','scripts/w4-paid/paid.test.mjs','scripts/w4-paid/expanded.test.mjs','scripts/w4-paid/completed-recovery.test.mjs']]];
const result={status:'running',scope:'offline-fake-transport',directory,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),sources,
  startedAtIso:new Date().toISOString(),realModelCalls:0,livePlcExecuted:false,results:[]};
const save=()=>writeFileSync(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');save();
console.log(`Evidence: ${directory}`);
for(const[name,args]of checks) {
  console.log(`Checking ${name}...`);
  const run=spawnSync(process.execPath,args,{env:{...env,...(name==='retry-network-disabled'?{WONDER_RETRY_EVIDENCE:join(directory,'samples')}:{})},encoding:'utf8',windowsHide:true,timeout:480_000,maxBuffer:64*1024*1024});
  const output=(run.stdout??'')+(run.stderr??'');writeFileSync(join(directory,name+'.txt'),output);
  result.results.push({name,passed:run.status===0,exitCode:run.status,signal:run.signal,error:run.error?.message,
    tests:Number(output.match(/# tests (\d+)/)?.[1]??0),failed:Number(output.match(/# fail (\d+)/)?.[1]??0),skipped:Number(output.match(/# skipped (\d+)/)?.[1]??0)});save();
  if(run.status!==0)break;
}
try {
  for(const[p,h]of Object.entries(sources))if(sha(p)!==h)throw Error(`Source changed during verification: ${p}`);
  if(sha(account)!==accountBefore)throw Error('Shared paid account changed during offline verification');
  const config=JSON.parse(readFileSync('artifacts/w4-readiness/e3469af/launch.json','utf8'));
  const proof=JSON.parse(readFileSync(config.proof,'utf8'));let count=0;
  for(const group of[proof.sourceHashes,proof.frozenHashes])for(const[p,h]of Object.entries(group)){if(sha(join(config.pinnedCheckout,p))!==h)throw Error('Original live pin changed: '+p);count++;}
  result.livePin={commit:config.sourceCommit,verifiedUnchangedHashes:count};result.accountSha256=accountBefore;
  result.status=result.results.length===checks.length&&result.results.every(r=>r.passed)?'pass':'fail';
}catch(e){result.status='fail';result.error=e.message;}
result.finishedAtIso=new Date().toISOString();save();
writeFileSync('artifacts/w4-service-retry/latest.json',JSON.stringify({status:result.status,directory},null,2)+'\n');
console.log(JSON.stringify({status:result.status,directory,results:result.results}));process.exitCode=result.status==='pass'?0:1;
