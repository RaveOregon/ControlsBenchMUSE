import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
assert(process.env.CONTROLSBENCH_W4_LAUNCH_CONFIG,'Select the promoted proof configuration explicitly');
const s=await import('./support.mjs');
const packet={approvalRevision:{contract:'controlsbench.w4-full-proof-approval.v2',authorizedCreditPoolUsd:150},sessionBaseline:{conservativeUsd:12},
  maximumModelRequests:20,maximumNewConservativeUsd:60,perRequestAdmissionUsd:3,sessionHardUsd:150,aggregateConservativeCeilingUsd:72,
  maximumOutputTokens:16000,maxTransientRetries:2,maxRejectedDecisions:3,objective:{goal:'Fault then a new evidence-dependent physical follow-up'}};

test('expanded proof envelope matches explicit credit authorization and rejects silent changes',()=>{
  assert.equal(s.trialEnvelope(packet),20);
  assert.equal(s.trialEnvelope({...packet,maxTransientRetries:5,retryDecisionTransport:true}),20);
  for(const change of [{perRequestAdmissionUsd:4},{maximumModelRequests:21},{maxRejectedDecisions:4},{maximumOutputTokens:32000},{aggregateConservativeCeilingUsd:100}])assert.throws(()=>s.trialEnvelope({...packet,...change}));
});

test('actual promoted provider serializes twenty turns, 16K/high and three-dollar admission',async()=>{
  const {WonderResponsesProvider}=await s.fromPin('src/campaign/wonder-responses.ts');
  const {CampaignLedger}=await s.fromPin('src/campaign/ledger.ts');
  const {CampaignRuntime}=await s.fromPin('src/campaign/runtime.ts');
  const {createCampaignFactory}=await s.fromPin('src/host/wonder-campaign-factory.ts');
  const factory=createCampaignFactory({proofAllowance:{maximumRequests:20,sessionHardUsd:150,maximumRejectedDecisions:3,requestAdmissionUsd:3}});
  assert.equal(factory.limits.perRequestUsd,3);assert.equal(factory.limits.campaignHardUsd,63);
  let generation;
  const provider=new WonderResponsesProvider({apiKey:'offline-fixture',explicitlyAuthorized:true,maxCalls:20,maxOutputTokens:16000,maxTransientRetries:5,retryDecisionTransport:true,requestAdmissionUsd:3,journal:{append(){}},fetch:async(url,init)=>{
    if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:300000});
    generation=JSON.parse(init.body);throw Error('CAPTURE_ONLY_NO_NETWORK');
  }});
  const ledger=new CampaignLedger('extended-preview');
  const runtime=new CampaignRuntime({ledger,provider,paidAuthorized:true,maxRejectedDecisions:3,evidenceClass:'fake_connector',claimBoundary:'Offline',spec:'fixture',signals:[],categories:['faults'],provenance:{spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'}});
  s.configureBoundedRuntime(runtime,{...packet,maxTransientRetries:5,retryDecisionTransport:true});
  await assert.rejects(()=>provider.decide(runtime.agentContext(),new AbortController().signal),/CAPTURE_ONLY/);
  assert.equal(generation.max_output_tokens,16000);assert.equal(generation.reasoning.effort,'high');
  assert.equal(JSON.parse(generation.input.at(-1).content[0].text).providerBudget.maxDecisions,20);
  assert.equal(runtime.options.maxTransientRetries,5);assert.equal(runtime.options.provider.retryDecisionTransport,true);assert.equal(runtime.options.maxRejectedDecisions,3);ledger.close();
});

test('twenty actual runtime decisions preserve twelve dollars and stop at seventy-two with no twenty-first charge',async()=>{
  const {CampaignLedger}=await s.fromPin('src/campaign/ledger.ts');
  const {CampaignRuntime}=await s.fromPin('src/campaign/runtime.ts');
  const {CampaignBudget,acceptedBudgetLimits}=await s.fromPin('src/campaign/budget.ts');
  const {ModelBudgetGuard}=await s.fromPin('src/proof/budget-guard.ts');
  const {DurableSessionAccount}=await s.fromPin('src/campaign/session-account.ts');
  const dir=mkdtempSync(join(tmpdir(),'extended-proof-')),file=join(dir,'session.jsonl');
  const history=Array.from({length:12},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).join('\n')+'\n';writeFileSync(file,history);
  const approval={...packet,sessionBaseline:{conservativeUsd:12,sha256:s.hash(history)}};
  assert.equal(s.verifyAccountBaseline(approval,file),12);
  const ledger=new CampaignLedger('twenty-fixture'),account=new DurableSessionAccount(file,'twenty-fixture',150);let calls=0;
  try {
    const provider={id:'offline-twenty',paid:true,estimatedRequestUsd:3,maxTransientRetries:2,async decide(){const n=++calls;return {decision:{summary:'Inspect '+n,calls:[{id:'read-'+n,name:'inspect_recent_evidence',arguments:{limit:n}}]},costUsd:3};}};
    const budget=new CampaignBudget(ledger,new ModelBudgetGuard({...acceptedBudgetLimits,perRequestUsd:3,campaignHardUsd:63,sessionHardUsd:150}),60,account);
    const runtime=new CampaignRuntime({ledger,provider,budget,maxRejectedDecisions:3,paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'Offline',spec:'fixture',signals:[],categories:['faults'],provenance:{spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'}});
    s.configureBoundedRuntime(runtime,approval);await runtime.start(false);await runtime.runAgent();await runtime.stop();
    assert.equal(calls,20);assert.equal(account.spentUsd,72);assert.equal(budget.guard.leases.size,20);
    assert(readFileSync(file,'utf8').startsWith(history));assert(ledger.events.some(e=>e.type==='action.applied'&&e.data.actionId==='read-20'));
    assert.throws(()=>s.verifyAccountBaseline(approval,file),/changed since/);
  }finally{account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test('direct generation profile preserves forty-five historical dollars and executes twenty five-dollar decisions below the authorized pool',async()=>{
  const direct={...packet,approvalRevision:{contract:'controlsbench.w4-full-proof-approval.v3',authorizedCreditPoolUsd:150},sessionBaseline:{conservativeUsd:45},
    perRequestAdmissionUsd:5,maximumNewConservativeUsd:100,aggregateConservativeCeilingUsd:145,admissionMode:'context_ceiling',retryDecisionTransport:true,maxTransientRetries:5};
  assert.equal(s.trialEnvelope(direct),20);assert.throws(()=>s.trialEnvelope({...direct,perRequestAdmissionUsd:3}));
  const {CampaignLedger}=await s.fromPin('src/campaign/ledger.ts'),{CampaignRuntime}=await s.fromPin('src/campaign/runtime.ts');
  const {CampaignBudget,acceptedBudgetLimits}=await s.fromPin('src/campaign/budget.ts'),{ModelBudgetGuard}=await s.fromPin('src/proof/budget-guard.ts');
  const {DurableSessionAccount}=await s.fromPin('src/campaign/session-account.ts');
  const dir=mkdtempSync(join(tmpdir(),'direct-generation-')),file=join(dir,'session.jsonl');
  const history=Array.from({length:12},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).concat(Array.from({length:11},(_,i)=>JSON.stringify({costUsd:3,totalUsd:15+i*3}))).join('\n')+'\n';writeFileSync(file,history);
  const approval={...direct,sessionBaseline:{conservativeUsd:45,sha256:s.hash(history)}};assert.equal(s.verifyAccountBaseline(approval,file),45);
  const ledger=new CampaignLedger('direct-generation'),account=new DurableSessionAccount(file,'direct-generation',150);let calls=0;
  try {
    const provider={id:'offline-direct',paid:true,estimatedRequestUsd:5,maxTransientRetries:5,retryDecisionTransport:true,async decide(){const n=++calls;return{decision:{summary:'Inspect '+n,calls:[{id:'read-'+n,name:'inspect_recent_evidence',arguments:{limit:n}}]},costUsd:5};}};
    const budget=new CampaignBudget(ledger,new ModelBudgetGuard({...acceptedBudgetLimits,perRequestUsd:5,campaignHardUsd:105,sessionHardUsd:150}),100,account);
    const runtime=new CampaignRuntime({ledger,provider,budget,maxRejectedDecisions:3,paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'Offline accounting only',spec:'fixture',signals:[],categories:['faults'],provenance:{spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'}});
    s.configureBoundedRuntime(runtime,approval);await runtime.start(false);await runtime.runAgent();await runtime.stop();
    assert.equal(calls,20);assert.equal(account.spentUsd,145);assert(readFileSync(file,'utf8').startsWith(history));
    assert(ledger.events.some(e=>e.type==='action.applied'&&e.data.actionId==='read-20'));assert.equal(budget.guard.leases.size,20);
  }finally{account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
