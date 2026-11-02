import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {trialEnvelope,configureBoundedRuntime,verifyAccountBaseline,fromPin,json,root,hash} from './support.mjs';
const expanded={maximumModelRequests:4,maximumNewConservativeUsd:4,maximumOutputTokens:8000,aggregateConservativeCeilingUsd:11,
  sessionBaseline:{conservativeUsd:7},approvalRevision:{contract:'controlsbench.w4-expanded-approval.v1',previousAggregateCeilingUsd:8}};

test('expanded envelope requires the exact new revision and cannot silently raise old approval',()=>{
  assert.equal(trialEnvelope(expanded),4);
  for(const change of [p=>delete p.approvalRevision,p=>p.aggregateConservativeCeilingUsd=12,p=>p.sessionBaseline.conservativeUsd=6,p=>p.maximumOutputTokens=16000,p=>p.maximumModelRequests=5,p=>p.maximumNewConservativeUsd=5]) {
    const packet=structuredClone(expanded);change(packet);assert.throws(()=>trialEnvelope(packet));
  }
});

test('expanded runtime preserves seven prior charges and stops after four new reservations without a fifth',async()=>{
  const {CampaignLedger}=await fromPin('src/campaign/ledger.ts');
  const {CampaignRuntime}=await fromPin('src/campaign/runtime.ts');
  const {CampaignBudget}=await fromPin('src/campaign/budget.ts');
  const {DurableSessionAccount}=await fromPin('src/campaign/session-account.ts');
  const dir=mkdtempSync(join(tmpdir(),'expanded-w4-')),file=join(dir,'account.jsonl');
  const before=Array.from({length:7},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).join('\n')+'\n';writeFileSync(file,before);
  const packet={...expanded,sessionBaseline:{conservativeUsd:7,sha256:hash(before)}};
  assert.equal(verifyAccountBaseline(packet,file),7);
  const ledger=new CampaignLedger('expanded-fixture'),account=new DurableSessionAccount(file,'expanded-fixture');let calls=0;
  try {
    const runtime=new CampaignRuntime({ledger,provider:{id:'expanded-fake-provider',paid:true,estimatedRequestUsd:1,async decide(){const n=++calls;return {decision:{summary:`Observe fixture ${n}`,calls:[{id:`inspect-${n}`,name:'inspect_evidence_window',arguments:{ids:[],afterSequence:0,throughSequence:ledger.state.sequence,limit:n}}]},costUsd:1};}},
      budget:new CampaignBudget(ledger,undefined,5,account),paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'Offline accounting only',categories:['normal'],spec:'fixture',signals:[],provenance:{spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'}});
    configureBoundedRuntime(runtime,packet);await runtime.start(false);await runtime.runAgent();await runtime.stop('fixture ended');
    assert.equal(calls,4);assert.equal(account.spentUsd,11);assert.equal(runtime.budget.guard.leases.size,4);
    assert.equal(runtime.options.capabilities.approvedRequestEnvelope.maximumOutputTokens,8000);
    assert.throws(()=>verifyAccountBaseline(packet,file),/changed since/);
  } finally {account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test('unchanged provider serializes 8000 output tokens at high reasoning and still performs dollar admission before generation',async()=>{
  const {WonderResponsesProvider}=await fromPin('src/campaign/wonder-responses.ts');
  const example=json(join(root,'artifacts/w4-paid/2026-11-02T21-16-08-803Z/example-request.json'));
  const context=JSON.parse(example.input.find(x=>x.role==='user').content[0].text);
  const journal=[];let request;
  const provider=new WonderResponsesProvider({apiKey:'offline-fixture-not-a-key',explicitlyAuthorized:true,maxCalls:4,maxOutputTokens:8000,journal:{append:r=>journal.push(r)},fetch:async(url,init)=>{
    if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:33764});
    request=JSON.parse(init.body);throw Error('OFFLINE_CAPTURE_ONLY');
  }});
  await assert.rejects(()=>provider.decide(context,new AbortController().signal),/OFFLINE_CAPTURE_ONLY/);
  assert.equal(request.max_output_tokens,8000);assert.equal(request.reasoning.effort,'high');
  const admission=journal.find(x=>x.phase==='admission');assert.equal(admission.maxOutputTokens,8000);assert(admission.maximumUsd<1);
  const previous=journal.length;await assert.rejects(()=>provider.decide(context,new AbortController().signal),/blocked/);assert.equal(journal.length,previous);
});
