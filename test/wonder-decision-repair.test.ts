import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CampaignRuntime} from '../src/campaign/runtime.ts';
import {CampaignLedger} from '../src/campaign/ledger.ts';
import {CampaignBudget,acceptedBudgetLimits} from '../src/campaign/budget.ts';
import {ModelBudgetGuard} from '../src/proof/budget-guard.ts';
import {FakeProvider} from '../src/campaign/provider.ts';
import {WonderResponsesProvider} from '../src/campaign/wonder-responses.ts';
import {DurableSessionAccount} from '../src/campaign/session-account.ts';
import {createCampaignFactory} from '../src/host/wonder-campaign-factory.ts';

const provenance={spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'};
const inspect=(n:number)=>({summary:`Inspect ${n}`,calls:[{id:`inspect-${n}`,name:'inspect_recent_evidence',arguments:{limit:n}}]});
const runtimeFor=(provider:any,extra:any={})=>new CampaignRuntime({ledger:new CampaignLedger('repair-fixture'),provider,paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'Offline only',spec:'fixture',signals:[],categories:['faults','adaptive'],provenance,maxTurns:2,maxRejectedDecisions:1,...extra});

test('effect-free invalid response gets paid fresh-turn feedback with exact response lineage and no replayed effects',async()=>{
  const requests:any[]=[];let generations=0;
  const provider=new WonderResponsesProvider({apiKey:'fixture-only',explicitlyAuthorized:true,maxCalls:2,journal:{append(){}},fetch:async(url,init)=>{
    const body=JSON.parse(String(init!.body));
    if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:100});
    requests.push(body);const n=++generations;
    const decision=n===1?{summary:'Invalid completion',completeExperiment:{id:'missing-experiment',evidenceRefs:['repair-fixture:missing'],conclusion:'observed'},calls:[{id:'never-run',name:'operator_action',arguments:{action:'start'}}]}:inspect(2);
    return Response.json({id:`response-${n}`,status:'completed',output:[{type:'function_call',name:'campaign_decision',call_id:`call-${n}`,arguments:JSON.stringify(decision)}]});
  }});
  const runtime=runtimeFor(provider);await runtime.start(false);await runtime.runAgent();
  assert.equal(generations,2);assert.equal(runtime.budget.guard.campaignSpentUsd,2);
  assert.equal(requests[1].previous_response_id,'response-1');
  const paired=requests[1].input.find((x:any)=>x.type==='function_call_output');
  assert.equal(paired.call_id,'call-1');assert.deepEqual(JSON.parse(paired.output).results,[]);
  const context=JSON.parse(requests[1].input.find((x:any)=>x.role==='user').content[0].text);
  assert.equal(context.capabilities.previousDecisionRefusal.applied,false);
  assert.match(context.capabilities.previousDecisionRefusal.message,/absent or hidden/);
  assert(!runtime.ledger.events.some(e=>e.type==='action.requested'&&e.data.actionId==='never-run'));
  assert(runtime.ledger.events.some(e=>e.type==='action.applied'&&e.data.actionId==='inspect-2'));
  await runtime.stop();runtime.ledger.close();
});

test('immutable-plan rejection occurs before ledger/effect changes and model can correct it on a later turn',async()=>{
  const experiment={id:'fault-1',objective:'Original hypothesis',category:'faults',requirements:[]};
  const provider=new FakeProvider((ctx,n)=>{
    if(n===1)return {summary:'Plan',plan:{objective:'Campaign',experiments:[experiment]},calls:[]};
    if(n===2)return {summary:'Bad rewrite',plan:{objective:'Campaign',experiments:[{...experiment,objective:'Changed hypothesis'}]},calls:[]};
    assert.match((ctx.capabilities as any).previousDecisionRefusal.message,/Cannot rewrite/);return inspect(n) as any;
  });
  const runtime=runtimeFor(provider,{maxTurns:3});await runtime.start(false);await runtime.runAgent();
  assert.equal(provider.contexts.length,3);assert.equal(runtime.ledger.state.experiments['fault-1'].objective,'Original hypothesis');
  assert.equal(runtime.ledger.events.filter(e=>e.type==='agent.activity'&&e.data.phase==='decision_rejected').length,1);
  assert(runtime.ledger.events.some(e=>e.type==='action.applied'&&e.data.actionId==='inspect-3'));
  await runtime.stop();runtime.ledger.close();
});

test('a failure after any decision ledger changes never triggers correction/replay',async()=>{
  const provider=new FakeProvider((_ctx,n)=>inspect(n) as any),runtime=runtimeFor(provider);
  const apply=runtime.applyDecision.bind(runtime);
  runtime.applyDecision=async(...args)=>{await apply(...args);throw Error('Failure after effects');};
  await runtime.start(false);await runtime.runAgent();assert.equal(provider.contexts.length,1);
  assert.equal(runtime.ledger.events.filter(e=>e.type==='action.applied').length,1);
  assert(!runtime.ledger.events.some(e=>e.type==='agent.activity'&&e.data.phase==='decision_rejected'));
  await runtime.stop();runtime.ledger.close();
});

test('validation repair is off by default and bounded when enabled; no hidden automatic actions',async()=>{
  for(const repairs of [0,2]) {
    const provider=new FakeProvider((_ctx,n)=>({summary:'Invalid',completeExperiment:{id:'x',evidenceRefs:[`missing-${n}`],conclusion:'observed'},calls:[]}));
    const runtime=runtimeFor(provider,{maxTurns:5,maxRejectedDecisions:repairs});await runtime.start(false);await runtime.runAgent();
    assert.equal(provider.contexts.length,repairs+1);assert(!runtime.ledger.events.some(e=>e.type==='action.requested'));
    await runtime.stop();runtime.ledger.close();
  }
});

test('expanded durable allowance preserves every historical charge, crosses fifteen and refuses its exact configured ceiling',()=>{
  const dir=mkdtempSync(join(tmpdir(),'expanded-account-')),path=join(dir,'session.jsonl');
  const history=Array.from({length:12},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).join('\n')+'\n';writeFileSync(path,history);
  const account=new DurableSessionAccount(path,'expanded-fixture',32);
  try {
    for(let i=0;i<20;i++)account.charge('fixture-'+i);
    assert.equal(account.spentUsd,32);assert(readFileSync(path,'utf8').startsWith(history));
    assert.throws(()=>account.charge('overflow'),/32/);
  } finally {account.close();rmSync(dir,{recursive:true,force:true});}
  for(const cap of [0,151,NaN,1.5])assert.throws(()=>new DurableSessionAccount(path,'invalid',cap),/Invalid/);
});

test('larger output/call configuration still refuses generation above one-dollar token admission',async()=>{
  let generated=0;
  const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:20,maxOutputTokens:16000,journal:{append(){}},fetch:async(url)=>{
    if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:210000});generated++;throw Error('Generation must not run');
  }});
  const context=runtimeFor(new FakeProvider(()=>inspect(1) as any)).agentContext();
  await assert.rejects(()=>provider.decide(context,new AbortController().signal),/exceeds \$1/);assert.equal(generated,0);
});

test('explicit three-dollar reservations execute beyond old fifteen limit and remain durable across reopen',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'larger-paid-proof-')),path=join(dir,'session.jsonl');
  const history=Array.from({length:12},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).join('\n')+'\n';writeFileSync(path,history);
  const ledger=new CampaignLedger('larger-proof'),account=new DurableSessionAccount(path,'larger-proof',100);let calls=0;
  try {
    const budget=new CampaignBudget(ledger,new ModelBudgetGuard({...acceptedBudgetLimits,perRequestUsd:3,campaignHardUsd:21,sessionHardUsd:100}),18,account);
    const runtime=runtimeFor({id:'paid-fixture',paid:true,estimatedRequestUsd:3,async decide(){return {decision:inspect(++calls),costUsd:3};}},{ledger,budget,maxTurns:6,maxRejectedDecisions:0});
    await runtime.start(false);await runtime.runAgent();await runtime.stop();
    assert.equal(calls,6);assert.equal(account.spentUsd,30);assert.equal(budget.guard.sessionSpentUsd,30);
    assert(readFileSync(path,'utf8').startsWith(history));
    assert(ledger.events.some(e=>e.type==='action.applied'&&e.data.actionId==='inspect-6'));
    account.close();const reopened=new DurableSessionAccount(path,'next-proof',100);assert.equal(reopened.spentUsd,30);reopened.close();
  } finally {account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test('larger provider request admission serializes the configured output capacity and counts identical instructions',async()=>{
  const bodies:any[]=[];
  const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:20,maxOutputTokens:16000,requestAdmissionUsd:3,journal:{append(){}},fetch:async(url,init)=>{
    const body=JSON.parse(String(init!.body));bodies.push(body);
    if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:210000});
    return Response.json({id:'larger-response',status:'completed',output:[{type:'function_call',name:'campaign_decision',call_id:'larger-call',arguments:JSON.stringify(inspect(1))}]});
  }});
  const reply=await provider.decide(runtimeFor(new FakeProvider(()=>inspect(1) as any)).agentContext(),new AbortController().signal);
  assert(!reply.error);assert.equal(provider.estimatedRequestUsd,3);assert.equal(bodies[1].max_output_tokens,16000);
  assert.equal(bodies[0].instructions,bodies[1].instructions);
});

test('explicit factory allowance is validated before transport and defaults remain unchanged',()=>{
  assert.equal(createCampaignFactory().limits!.sessionHardUsd,15);
  const factory=createCampaignFactory({proofAllowance:{maximumRequests:20,sessionHardUsd:100,maximumRejectedDecisions:3}});
  assert.equal(factory.limits!.sessionHardUsd,100);assert.equal(factory.limits!.campaignHardUsd,21);
  for(const maximumRequests of [0,41,NaN])assert.throws(()=>createCampaignFactory({proofAllowance:{maximumRequests,sessionHardUsd:100,maximumRejectedDecisions:3}}),/allowance/);
});
