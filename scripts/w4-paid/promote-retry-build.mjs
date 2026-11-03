// Freeze the already-tested coordinator while retaining the original runtime pin.
// No transport, credentials or model client is opened.
import assert from 'node:assert/strict';
import {copyFileSync,cpSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve,relative,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const git=(...args)=>execFileSync('git',['-c','core.longpaths=true','-C',root,...args],{encoding:'utf8',windowsHide:true}).trim();
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const old=json(join(root,'artifacts/w4-readiness/e3469af/launch.json'));
assert.equal(hash(old.proof),old.proofSha256);
const previous=json(old.proof),retryPath=join(root,'artifacts/w4-service-retry/2026-11-03T00-35-06-586Z/result.json'),retry=json(retryPath);
assert.equal(retry.status,'pass');
const commit=git('rev-parse','62a1d8c'),pin=resolve(root,'../w4-retry-runtime-pin');
assert.equal(execFileSync('git',['-C',pin,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),commit);
const directory=join(root,'artifacts/w4-readiness/retry-62a1d8c');mkdirSync(directory,{recursive:true});
for(const[f,h]of Object.entries(retry.sources))assert.equal(hash(join(root,f)),h,'Tested retry source changed: '+f);
const sourceHashes={},frozenHashes={};
for(const f of new Set([...Object.keys(previous.sourceHashes),...Object.keys(retry.sources)])) {
  const target=join(pin,f);assert(target.startsWith(pin+'\\')||target.startsWith(pin+'/'));
  mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,f),target);sourceHashes[f]=hash(target);
}
for(const[f,h]of Object.entries(previous.frozenHashes)) {
  assert.equal(hash(join(old.pinnedCheckout,f)),h);const target=join(pin,f);mkdirSync(dirname(target),{recursive:true});
  copyFileSync(join(old.pinnedCheckout,f),target);frozenHashes[f]=hash(target);assert.equal(frozenHashes[f],h);
}
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
for(const file of walk(join(old.pinnedCheckout,'ui/dist'))) {
  const f=relative(old.pinnedCheckout,file),target=join(pin,f);mkdirSync(dirname(target),{recursive:true});copyFileSync(file,target);frozenHashes[f.replaceAll('\\','/')]=hash(target);
}
const physical=['src/live','src/proof','src/campaign/driver.ts','src/campaign/m8-bindings.ts','src/campaign/ledger.ts','scripts/wonder-process-child.js','codesys/conveyordemo.project',
  'artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0'];
assert.equal(git('diff','--name-only',old.sourceCommit,commit,'--',...physical),'','Physical engine/world/PLC bytes must stay unchanged');
execFileSync('git',['-c','core.longpaths=true','-C',pin,'diff','--quiet','--','src','scripts','package.json'],{windowsHide:true});
const oldManifest=json(old.manifest),checks={};
for(const[name,ref]of Object.entries(oldManifest.checks)) {
  const src=resolve(dirname(old.manifest),ref.file);assert.equal(hash(src),ref.sha256);copyFileSync(src,join(directory,name+'.json'));
  checks[name]={file:name+'.json',sha256:hash(join(directory,name+'.json'))};
}
const proof={status:'pass',scope:'offline-retry-coordinator-with-unchanged-live-engine',sourceCommit:commit,sourceHashes,frozenHashes,
  retryProof:{file:retryPath,sha256:hash(retryPath),testedCommit:retry.sourceCommit,tests:retry.results},
  existingNativeEngine:{commit:old.sourceCommit,unchangedPaths:physical},
  liveTimingQualified:false,liveRetryQualified:false,claimBoundary:'Parent retry coordinator offline-qualified; old physical engine unchanged; fresh zero-model bench check required before paid Start.'};
writeFileSync(join(directory,'promotion-proof.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
const manifest={...oldManifest,ownerCommit:commit,checks,integrationProof:{file:'promotion-proof.json',sha256:hash(join(directory,'promotion-proof.json'))},
  parentRetryProof:proof.retryProof,claimBoundary:proof.claimBoundary};
writeFileSync(join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const config={sourceCommit:commit,pinnedCheckout:pin,manifest:join(directory,'manifest.json'),manifestSha256:hash(join(directory,'manifest.json')),
  proof:join(directory,'promotion-proof.json'),proofSha256:hash(join(directory,'promotion-proof.json'))};
writeFileSync(join(directory,'launch.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({directory,...config,sourceFiles:Object.keys(sourceHashes).length,frozenFiles:Object.keys(frozenHashes).length}));
