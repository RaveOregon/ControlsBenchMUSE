import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const directory=resolve('artifacts/s2',new Date().toISOString().replace(/[:.]/g,'-')+'-offline');mkdirSync(directory,{recursive:true});
const files=execFileSync('git',['ls-files','--','src','scripts','docs/contracts','package.json','test'],{encoding:'utf8',windowsHide:true}).trim().split('\n');
for(const p of ['src/host/wonder-hmi-factory.ts','scripts/check-s2-offline.js','test/s2-hmi.test.ts'])if(!files.includes(p))files.push(p);
const sources=Object.fromEntries(files.map(p=>[p,hash(p)]));
const account=resolve('../../artifacts/wonder/session.jsonl'),accountHash=hash(account);
const pin=resolve('../w4-rejection-runtime-pin');
for(const p of files.filter(p=>p.startsWith('src/live/')||p.startsWith('src/proof/')||p==='scripts/wonder-process-child.js'))assert.equal(hash(p),hash(join(pin,p)),`Physical engine changed: ${p}`);
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^OPC_|^MODEL_API_KEY$|^CONTROLSBENCH_(WONDER|S2|W4)/.test(k)));
const tests=['test/campaign.test.ts','test/wonder-campaign.test.ts','test/wonder-retry.test.ts','test/wonder-decision-repair.test.ts','test/wonder-transport-retry.test.ts','test/s2-hmi.test.ts',
  'test/hmi-confirmation.test.ts','test/hmi-commands.test.ts','test/portal-host.test.ts','test/cdp-webvisu.test.ts','test/hmi-audit.test.ts','test/hmi-freshness.test.ts','test/wonder-process.test.ts','test/product-integration.test.ts'];
const result={status:'running',scope:'offline-fixture-browser-and-campaign',directory,sources,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),enginePin:'503abd3b895cb2fc03853a9ec2d75166544e2a59',realModelCalls:0,livePlcContact:false,accountSha256:accountHash,results:[]};
const save=()=>writeFileSync(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');save();console.log(directory);
for(const[name,args]of [['typecheck',['node_modules/typescript/bin/tsc','--noEmit']],['affected-regression-tests',['--test','--test-reporter=tap','--test-concurrency=1',...tests]]]){
  console.log('Checking '+name);const r=spawnSync(process.execPath,args,{env,encoding:'utf8',windowsHide:true,timeout:360000,maxBuffer:64*1024*1024});
  const output=(r.stdout??'')+(r.stderr??'');writeFileSync(join(directory,name+'.txt'),output);result.results.push({name,passed:r.status===0,exitCode:r.status,error:r.error?.message,tests:Number(output.match(/# tests (\d+)/)?.[1]??0),fail:Number(output.match(/# fail (\d+)/)?.[1]??0),skipped:Number(output.match(/# skipped (\d+)/)?.[1]??0)});save();if(r.status!==0)break;
}
for(const[p,h]of Object.entries(sources))assert.equal(hash(p),h);assert.equal(hash(account),accountHash);
result.status=result.results.length===2&&result.results.every(r=>r.passed&&r.skipped===0)?'pass':'fail';result.finishedAtIso=new Date().toISOString();save();
writeFileSync('artifacts/s2/latest-offline.json',JSON.stringify({directory,status:result.status},null,2)+'\n');console.log(JSON.stringify({status:result.status,results:result.results}));process.exitCode=result.status==='pass'?0:1;
