import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
process.env.CONTROLSBENCH_W4_LAUNCH_CONFIG=fileURLToPath(new URL('../../artifacts/w4-readiness/retry-62a1d8c/launch.json',import.meta.url));
const s=await import('./support.mjs');
const {verifyResumeBench}=await import('./factory.mjs');
const packet={maximumModelRequests:2,maximumNewConservativeUsd:2,maximumOutputTokens:8000,maxTransientRetries:1,aggregateConservativeCeilingUsd:12,sessionBaseline:{conservativeUsd:10},
  approvalRevision:{contract:'controlsbench.w4-resume-approval.v1',previousAggregateCeilingUsd:12},objective:{goal:'Fault then follow-up only'},recordedPriorProof:{kind:'recorded_prior_trial',liveNow:false}};

test('promoted coordinator matches exact tested source and old physical engine, and accepts remaining-two policy',async()=>{
  const proof=s.json(s.configuration.proof),parent=s.json(proof.retryProof.file);
  for(const[f,h]of Object.entries(parent.sources))assert.equal(s.hashFile(join(s.pinned,f)),h);
  for(const group of[proof.sourceHashes,proof.frozenHashes])for(const[f,h]of Object.entries(group))assert.equal(s.hashFile(join(s.pinned,f)),h);
  const {verifyOwnerEntry,verifyOwnerHandoff}=await s.fromPin('src/campaign/owner-handoff.ts');
  verifyOwnerEntry(join(s.pinned,'src/live/wonder-process/index.ts'),s.configuration.sourceCommit);
  verifyOwnerHandoff(s.configuration.manifest,s.configuration.manifestSha256,s.configuration.sourceCommit);
  assert.equal(s.trialEnvelope(packet),2);
  assert.throws(()=>s.trialEnvelope({...packet,maximumModelRequests:3,maximumNewConservativeUsd:3}),/strictEqual|Expected|2/);
  const {CampaignLedger}=await s.fromPin('src/campaign/ledger.ts');const {CampaignRuntime}=await s.fromPin('src/campaign/runtime.ts');
  const {WonderResponsesProvider}=await s.fromPin('src/campaign/wonder-responses.ts');
  const ledger=new CampaignLedger('promoted-policy');
  const provider=new WonderResponsesProvider({apiKey:'offline-fixture',explicitlyAuthorized:true,maxCalls:2,maxOutputTokens:8000,maxTransientRetries:1,journal:{append(){}},fetch:async()=>{throw Error('No request');}});
  const runtime=new CampaignRuntime({ledger,provider,paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'No network/PLC',spec:'fixture',signals:[],categories:['faults','adaptive'],
    provenance:{spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'}});
  s.configureBoundedRuntime(runtime,packet);assert.equal(runtime.options.maxTransientRetries,1);assert.equal(runtime.options.maxTurns,2);
  assert.equal(runtime.agentContext().capabilities.recordedPriorProof.liveNow,false);ledger.close();
});

test('paid Start refuses missing, mismatched, fixture or altered bench qualification without effects',()=>{
  const dir=mkdtempSync(join(tmpdir(),'resume-bench-gate-')),packetPath=join(dir,'packet.json');writeFileSync(packetPath,JSON.stringify(packet));
  try {
    assert.throws(()=>verifyResumeBench(packet,packetPath));
    const benchDirectory=join(dir,'bench-check','fixture-only');mkdirSync(benchDirectory,{recursive:true});
    const state={phase:'bench-pass-ready-for-paid-start',packetSha256:s.hashFile(packetPath),sourceCommit:s.configuration.sourceCommit,benchDirectory};
    writeFileSync(join(dir,'launch-status.json'),JSON.stringify(state));
    cpSync(join(s.root,'artifacts/w4-paid/timing-2026-11-02T18-29-41-137Z/native-commissioning'),benchDirectory,{recursive:true});
    const result=s.json(join(benchDirectory,'result.json'));result.scope='offline-fake-transport';result.identities.module.commit=s.configuration.sourceCommit;
    writeFileSync(join(benchDirectory,'result.json'),JSON.stringify(result));assert.throws(()=>verifyResumeBench(packet,packetPath),/live-m8/);
    // Synthetic records are used only to exercise the gate's predicate; never live qualification.
    result.scope='live-m8';writeFileSync(join(benchDirectory,'result.json'),JSON.stringify(result));assert(verifyResumeBench(packet,packetPath).resultSha256);
    writeFileSync(join(benchDirectory,'result.json'),JSON.stringify({...result,measurements:{}}));assert.throws(()=>verifyResumeBench(packet,packetPath),/measurements must/);
    writeFileSync(join(benchDirectory,'result.json'),JSON.stringify(result));
    writeFileSync(join(dir,'launch-status.json'),JSON.stringify({...state,packetSha256:'changed'}));assert.throws(()=>verifyResumeBench(packet,packetPath));
    writeFileSync(join(dir,'launch-status.json'),JSON.stringify({...state,phase:'zero-model-bench-check'}));assert.throws(()=>verifyResumeBench(packet,packetPath),/Fresh bench/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('full-proof authorization preserves ten charges and executes all five decisions including the fifteenth charge',async()=>{
  const full={...packet,maximumModelRequests:5,maximumNewConservativeUsd:5,aggregateConservativeCeilingUsd:15,
    approvalRevision:{contract:'controlsbench.w4-full-proof-approval.v1',authorizedCreditPoolUsd:150}};
  assert.equal(s.trialEnvelope(full),5);
  assert.throws(()=>s.trialEnvelope({...full,maximumModelRequests:6}));
  assert.throws(()=>s.trialEnvelope({...full,approvalRevision:{...full.approvalRevision,authorizedCreditPoolUsd:12}}));
  const {CampaignLedger}=await s.fromPin('src/campaign/ledger.ts');
  const {CampaignRuntime}=await s.fromPin('src/campaign/runtime.ts');
  const {CampaignBudget}=await s.fromPin('src/campaign/budget.ts');
  const {DurableSessionAccount}=await s.fromPin('src/campaign/session-account.ts');
  const dir=mkdtempSync(join(tmpdir(),'full-proof-account-')),file=join(dir,'account.jsonl');
  const original=Array.from({length:10},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).join('\n')+'\n';writeFileSync(file,original);
  const ledger=new CampaignLedger('full-proof-fixture'),account=new DurableSessionAccount(file,'full-proof-fixture');let calls=0;
  try {
    const runtime=new CampaignRuntime({ledger,provider:{id:'fixture-only',paid:true,estimatedRequestUsd:1,maxTransientRetries:1,async decide(){const n=++calls;return {decision:{summary:`Inspect fixture ${n}`,calls:[{id:`read-${n}`,name:'inspect_evidence_window',arguments:{ids:[],afterSequence:0,throughSequence:ledger.state.sequence,limit:n}}]},costUsd:1};}},
      budget:new CampaignBudget(ledger,undefined,5,account),paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'Offline accounting only',categories:['normal'],spec:'fixture',signals:[],provenance:{spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'}});
    s.configureBoundedRuntime(runtime,full);await runtime.start(false);await runtime.runAgent();await runtime.stop('fixture ended');
    assert.equal(calls,5);assert.equal(account.spentUsd,15);
    assert(readFileSync(file,'utf8').startsWith(original),'Prior charges remain byte-identical');
    assert(ledger.events.some(e=>e.type==='action.applied'&&e.data.actionId==='read-5'));
    assert.equal(runtime.budget.guard.leases.size,5);
  } finally {account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
