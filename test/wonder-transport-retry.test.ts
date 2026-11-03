import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {WonderResponsesProvider} from '../src/campaign/wonder-responses.ts';
import {CampaignRuntime} from '../src/campaign/runtime.ts';
import {CampaignLedger} from '../src/campaign/ledger.ts';
import {CampaignBudget,acceptedBudgetLimits} from '../src/campaign/budget.ts';
import {DurableSessionAccount} from '../src/campaign/session-account.ts';
import {ModelBudgetGuard} from '../src/proof/budget-guard.ts';
import {ManualClock} from '../src/campaign/clock.ts';
import {flushMicrotasks} from '../src/campaign/harness.ts';
const provenance={spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'fixture',connector:'none'};
const complete=(n:number)=>({id:'response-'+n,status:'completed',output:[{type:'function_call',name:'campaign_decision',call_id:'call-'+n,arguments:JSON.stringify({summary:'Inspect '+n,calls:[{id:'inspect-'+n,name:'inspect_recent_evidence',arguments:{limit:n}}]})}]});
const runtimeFor=(provider:any,extra:any={})=>new CampaignRuntime({ledger:new CampaignLedger('transport-fixture'),provider,paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'No network/PLC',spec:'fixture',signals:[],categories:['faults'],provenance,maxTurns:3,maxTransientRetries:2,...extra});
async function drive(runtime:CampaignRuntime,clock:ManualClock){await runtime.start(false);const run=runtime.runAgent();for(let i=0;i<600&&runtime.status==='running';i++){await flushMicrotasks();clock.advance(100);}await run;}

for(const phase of ['input_tokens','responses'])test(`opted-in ${phase} fetch failure preserves last head/results and charges a fresh attempt without duplicate effects`,async()=>{
  const requests:any[]=[],journal:any[]=[];let attempt=0;
  const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:3,maxTransientRetries:2,retryDecisionTransport:true,journal:{append:x=>journal.push(x)},fetch:async(url,init)=>{
    const endpoint=String(url).endsWith('input_tokens')?'input_tokens':'responses',body=JSON.parse(String(init!.body));
    if(endpoint==='input_tokens')attempt++;
    requests.push({attempt,endpoint,body});
    if(attempt===2&&endpoint===phase)throw new TypeError('fetch failed',{cause:{code:'UND_ERR_SOCKET'}});
    return Response.json(endpoint==='input_tokens'?{input_tokens:100}:complete(attempt));
  }});
  const clock=new ManualClock(),runtime=runtimeFor(provider,{clock});await drive(runtime,clock);
  assert.equal(attempt,3);assert.equal(runtime.budget.guard.campaignSpentUsd,3);
  const third=requests.find(x=>x.attempt===3&&x.endpoint==='responses');assert.equal(third.body.previous_response_id,'response-1');
  const secondCount=requests.find(x=>x.attempt===2&&x.endpoint==='input_tokens');
  assert.deepEqual(third.body.input[0],secondCount.body.input[0]);assert.equal(third.body.input[0].call_id,'call-1');
  assert.equal(runtime.ledger.events.filter(e=>e.type==='action.applied').length,2);
  assert(!runtime.ledger.events.some(e=>e.type==='action.requested'&&e.data.actionId==='inspect-2'));
  assert(journal.some(x=>x.phase==='transport_diagnostic'&&x.causeCode==='UND_ERR_SOCKET'));
  assert(journal.some(x=>x.phase==='retryable_decision_transport_error'&&x.billing==='possibly_charged'));
  await runtime.stop();runtime.ledger.close();
});

test('transport retry remains off by default and cancellation never schedules one',async()=>{
  for(const optedIn of [false,true]) {
    const controller=new AbortController(),journal:any[]=[];
    const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:3,maxTransientRetries:2,retryDecisionTransport:optedIn,journal:{append:x=>journal.push(x)},fetch:async()=>{if(optedIn)controller.abort();throw new TypeError('fetch failed');}});
    await assert.rejects(()=>provider.decide(runtimeFor(provider).agentContext(),controller.signal),/fetch failed/);
    assert(!journal.some(x=>x.phase==='retryable_decision_transport_error'));
  }
});

test('HTTP returned incomplete or malformed decisions are never converted to transport retries',async()=>{
  for(const reply of [{...complete(1),status:'incomplete'},{...complete(1),output:[]}]) {
    const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:3,maxTransientRetries:2,retryDecisionTransport:true,journal:{append(){}},fetch:async(url)=>Response.json(String(url).endsWith('input_tokens')?{input_tokens:100}:reply)});
    const result=await provider.decide(runtimeFor(provider).agentContext(),new AbortController().signal);
    assert(result.error);assert.equal(result.retryableDecisionTransportError,undefined);
  }
});

test('five mixed service/transport failures share one retry bound and preserve all possible charges before success',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'transport-account-')),path=join(dir,'session.jsonl');
  const history=Array.from({length:12},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).concat(Array.from({length:5},(_,i)=>JSON.stringify({costUsd:3,totalUsd:15+i*3}))).join('\n')+'\n';writeFileSync(path,history);
  const account=new DurableSessionAccount(path,'transport-fixture',150),ledger=new CampaignLedger('transport-fixture');let attempts=0;
  const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:6,maxTransientRetries:5,retryDecisionTransport:true,requestAdmissionUsd:3,journal:{append(){}},fetch:async(url)=>{
    if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:100});
    const n=++attempts;if(n===1)return Response.json({error:{type:'server_error',message:'persistence service error'}},{status:503});
    if(n<6)throw new TypeError('fetch failed');return Response.json(complete(n));
  }});
  try {
    const clock=new ManualClock(),budget=new CampaignBudget(ledger,new ModelBudgetGuard({...acceptedBudgetLimits,perRequestUsd:3,campaignHardUsd:21,sessionHardUsd:150}),18,account);
    const runtime=runtimeFor(provider,{ledger,clock,budget,maxTurns:6,maxTransientRetries:5});await drive(runtime,clock);
    assert.equal(attempts,6);assert.equal(account.spentUsd,45);assert(readFileSync(path,'utf8').startsWith(history));
    assert.equal(ledger.events.filter(e=>e.type==='action.applied').length,1);
    assert.equal(ledger.events.filter(e=>e.type==='agent.activity'&&e.data.phase==='provider_retry_scheduled').length,5);
    await runtime.stop();
  } finally {account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test('invalid lease after unreturned generation stops without another paid request',async()=>{
  let calls=0;
  const provider={id:'fixture',paid:true,estimatedRequestUsd:1,retryDecisionTransport:true,async decide(){calls++;return{decision:null,error:'fetch failed',retryableDecisionTransportError:{phase:'responses',decisionReturned:false,billing:'possibly_charged',retryAfterMs:1000}};}};
  const driver:any={binding:{describe:{fixture:true}},observedOutputIds:[],quarantined:false,async initialize(){},start(){},async hold(){},async drain(){},decisionLeases:{async begin(_p:any,revision:number){return{id:'lease',basedOnRevision:revision,valid:true,reason:'fixture',evidenceRefs:[]};},async finish(r:any){return{...r,valid:false,reason:'expired'};}}};
  const runtime=runtimeFor(provider,{driver});await runtime.start(false);await runtime.runAgent();assert.equal(calls,1);assert.equal(runtime.status,'paused');
  await runtime.stop();runtime.ledger.close();
});

test('full-context admission makes only generation requests and reserves more than the maximum context/output token cost',async()=>{
  const requests:string[]=[],journal:any[]=[];
  const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:20,maxOutputTokens:16000,requestAdmissionUsd:5,admissionMode:'context_ceiling',journal:{append:x=>journal.push(x)},fetch:async(url)=>{requests.push(String(url));assert(!String(url).endsWith('input_tokens'));return Response.json(complete(1));}});
  const result=await provider.decide(runtimeFor(provider).agentContext(),new AbortController().signal);assert(!result.error);
  assert.equal(requests.length,1);const admission=journal.find(x=>x.phase==='admission');
  assert.equal(admission.inputTokens,1048576);assert.equal(admission.tokenBasis,'context_ceiling');assert.equal(admission.maximumUsd,4.514304);assert(admission.maximumUsd<provider.estimatedRequestUsd);
  assert.throws(()=>new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,requestAdmissionUsd:3,admissionMode:'context_ceiling',journal:{append(){}}}),/five-dollar/);
});

for(const phase of ['input_tokens','responses'])test(`structured HTTP 500 during ${phase} retries only with extended policy`,async()=>{
  let count=0;
  const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:2,maxTransientRetries:1,retryDecisionTransport:true,journal:{append(){}},fetch:async(url)=>{
    const endpoint=String(url).endsWith('input_tokens')?'input_tokens':'responses';if(endpoint==='input_tokens')count++;
    if(count===1&&endpoint===phase)return Response.json({error:{type:'server_error',message:'internal server error'}},{status:500});
    return Response.json(endpoint==='input_tokens'?{input_tokens:100}:complete(count));
  }});
  const clock=new ManualClock(),runtime=runtimeFor(provider,{clock,maxTurns:2,maxTransientRetries:1});await drive(runtime,clock);
  assert.equal(count,2);assert.equal(runtime.ledger.events.filter(e=>e.type==='action.applied').length,1);await runtime.stop();runtime.ledger.close();
});

test('successful decisions reset consecutive service retry counters while every request stays counted',async()=>{
  let count=0;
  const provider=new WonderResponsesProvider({apiKey:'fixture',explicitlyAuthorized:true,maxCalls:4,maxTransientRetries:1,retryDecisionTransport:true,journal:{append(){}},fetch:async(url)=>{
    if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:100});const n=++count;
    return n%2?Response.json({error:{type:'server_error',message:'internal server error'}},{status:500}):Response.json(complete(n));
  }});
  const clock=new ManualClock(),runtime=runtimeFor(provider,{clock,maxTurns:4,maxTransientRetries:1});await drive(runtime,clock);
  assert.equal(count,4);assert.equal(runtime.budget.guard.campaignSpentUsd,4);
  assert.equal(runtime.ledger.events.filter(e=>e.type==='agent.activity'&&e.data.phase==='provider_retry_scheduled').length,2);
  assert.equal(runtime.ledger.events.filter(e=>e.type==='action.applied').length,2);await runtime.stop();runtime.ledger.close();
});
