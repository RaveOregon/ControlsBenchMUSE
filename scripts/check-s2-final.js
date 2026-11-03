// Only export/vision batching changed after the 163-test qualification.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync,execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const basePath=resolve('artifacts/s2/2026-11-03T13-46-57-221Z-offline/result.json'),base=JSON.parse(readFileSync(basePath,'utf8'));
assert.equal(base.status,'pass');assert.equal(base.results[1].tests,163);
const changes=['src/campaign/wonder-responses.ts','src/host/wonder-hmi-factory.ts','test/s2-hmi.test.ts'];
for(const[p,h]of Object.entries(base.sources))if(!changes.includes(p))assert.equal(sha(p),h,'Unqualified change: '+p);
const paths=[...Object.keys(base.sources),'src/campaign/s2-evidence.ts','scripts/prepare-s2.mjs','scripts/launch-s2.ps1','scripts/check-s2-final.js'];
const sources=Object.fromEntries(paths.map(p=>[p,sha(p)])),account=resolve('../../artifacts/wonder/session.jsonl'),accountBefore=sha(account);
const directory=resolve('artifacts/s2',new Date().toISOString().replace(/[:.]/g,'-')+'-final-offline');mkdirSync(directory,{recursive:true});
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^OPC_|^MODEL_API_KEY$|^CONTROLSBENCH_(S2|W4|WONDER)/.test(k)));
const result={status:'running',scope:'offline-fixture-browser-export-and-vision-delta',base:{file:basePath,sha256:sha(basePath),tests:163},sources,realModelCalls:0,livePlcContact:false,results:[]};
const save=()=>writeFileSync(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');save();console.log(directory);
for(const[name,args]of [['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['changed-path-tests',['--test','--test-reporter=tap','--test-concurrency=1','test/s2-hmi.test.ts','test/campaign.test.ts','test/wonder-campaign.test.ts']]]){
  const r=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:32*1024*1024}),output=(r.stdout??'')+(r.stderr??'');writeFileSync(join(directory,name+'.txt'),output);
  result.results.push({name,passed:r.status===0,exitCode:r.status,tests:Number(output.match(/# tests (\d+)/)?.[1]??0),fail:Number(output.match(/# fail (\d+)/)?.[1]??0),skipped:Number(output.match(/# skipped (\d+)/)?.[1]??0)});save();if(r.status!==0)break;
}
for(const[p,h]of Object.entries(sources))assert.equal(sha(p),h);assert.equal(sha(account),accountBefore);
result.status=result.results.length===2&&result.results.every(r=>r.passed&&!r.skipped)?'pass':'fail';result.finishedAtIso=new Date().toISOString();save();
writeFileSync('artifacts/s2/latest-offline.json',JSON.stringify({directory,status:result.status},null,2)+'\n');console.log(JSON.stringify({status:result.status,results:result.results}));process.exitCode=result.status==='pass'?0:1;
