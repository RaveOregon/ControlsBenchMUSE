import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { CampaignRuntime } from "../src/campaign/runtime.ts";
import { CampaignLedger, readLedger, report, digest } from "../src/campaign/ledger.ts";
import { CampaignBudget } from "../src/campaign/budget.ts";
import { DurableSessionAccount } from "../src/campaign/session-account.ts";
import { WonderResponsesProvider } from "../src/campaign/wonder-responses.ts";
import { ManualClock } from "../src/campaign/clock.ts";
import { openOfflineWonderSession } from "../src/live/wonder-process/index.ts";
import { flushMicrotasks } from "../src/campaign/harness.ts";
import type { AgentContext } from "../src/campaign/provider.ts";

const serviceError={error:{type:"server_error",message:"persistence service error",code:null,param:null}};
const decision=(n:number)=>({summary:`Inspect fixture ${n}`,calls:[{id:`read-${n}`,name:"inspect_recent_evidence",arguments:{limit:n}}]});
const completed=(n:number)=>({id:`response-${n}`,status:"completed",output:[{type:"function_call",name:"campaign_decision",call_id:`call-${n}`,status:"completed",arguments:JSON.stringify(decision(n))}]});
const provenance={spec:"fixture",ioMap:"fixture",plcBuild:"fixture",worldModule:"fixture",model:"muse-wonder-1.0",connector:"offline"};
type StubOptions={maxCalls?:number;maxRetries?:number;inputStatus?:number;headers?:Record<string,string>;onGenerate?:(n:number)=>void|Promise<void>};
function stub(sequence:(n:number)=>{status:number;payload:unknown},options:StubOptions={}) {
  const requests:{endpoint:string;body:any}[]=[],journal:Record<string,any>[]=[];let generations=0;
  const provider=new WonderResponsesProvider({apiKey:"fixture-not-a-key",explicitlyAuthorized:true,maxCalls:options.maxCalls??5,maxTransientRetries:options.maxRetries??1,
    journal:{append:r=>journal.push(structuredClone(r))},fetch:(async(url:any,init:any)=>{
      const endpoint=String(url).endsWith("input_tokens")?"count":"generation",body=JSON.parse(init.body);requests.push({endpoint,body});
      if(endpoint==="count")return Response.json({input_tokens:2000},{status:options.inputStatus??200});
      const n=++generations;await options.onGenerate?.(n);const reply=sequence(n);
      return Response.json(reply.payload,{status:reply.status,headers:options.headers??{"retry-after":"0"}});
    }) as typeof fetch});
  return {provider,requests,journal,get generations(){return generations;}};
}
function runtimeFor(provider:WonderResponsesProvider,options:{turns?:number;retries?:number;clock?:ManualClock;budget?:CampaignBudget;ledger?:CampaignLedger}={}) {
  const ledger=options.ledger??new CampaignLedger("retry-fixture");
  return new CampaignRuntime({ledger,provider,budget:options.budget,clock:options.clock,maxTurns:options.turns??3,maxTransientRetries:options.retries??1,
    paidAuthorized:true,evidenceClass:"fake_connector",claimBoundary:"Offline HTTP/accounting fixture only",spec:"fixture",signals:[],categories:["normal"],provenance});
}
const context=()=>runtimeFor(stub(n=>({status:200,payload:completed(n)})).provider).agentContext();
async function drive(runtime:CampaignRuntime,clock:ManualClock) {
  await runtime.start(false);const running=runtime.runAgent();
  for(let i=0;i<300&&runtime.status==="running";i++){await flushMicrotasks();clock.advance(100);}
  await running;
}

test("503 retry retains the last valid response head and exact tool results, charges three distinct attempts and executes no duplicate",async()=>{
  const s=stub(n=>n===2?{status:503,payload:serviceError}:{status:200,payload:completed(n)});
  const clock=new ManualClock(),runtime=runtimeFor(s.provider,{clock});await drive(runtime,clock);
  const requests=s.requests.filter(r=>r.endpoint==="generation").map(r=>r.body);
  assert.equal(s.generations,3);assert.equal(runtime.budget.guard.campaignSpentUsd,3);
  assert.equal(requests[1].previous_response_id,"response-1");assert.equal(requests[2].previous_response_id,"response-1");
  assert.equal(requests[1].input[0].call_id,"call-1");assert.deepEqual(requests[2].input[0],requests[1].input[0]);
  assert(runtime.ledger.events.some(e=>e.type==="action.applied"&&e.data.actionId==="read-1"));
  assert(runtime.ledger.events.some(e=>e.type==="action.applied"&&e.data.actionId==="read-3"));
  assert(!runtime.ledger.events.some(e=>e.type.startsWith("action.")&&e.data.actionId==="read-2"));
  assert.equal(runtime.ledger.events.filter(e=>e.type==="budget.accounted"&&e.data.phase==="reserved").length,3);
  assert.equal(runtime.ledger.events.filter(e=>e.type==="agent.activity"&&e.data.phase==="provider_retry_scheduled").length,1);
  assert.equal(s.journal.filter(e=>e.phase==="retryable_service_error").length,1);
  await runtime.stop();
});

test("first-request 503 resends semantic tools and two-attempt allowance preserves ten historical charges",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"retry-account-")),path=join(dir,"account.jsonl");
  const history=Array.from({length:10},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).join("\n")+"\n";writeFileSync(path,history);
  const account=new DurableSessionAccount(path,"retry-two"),ledger=new CampaignLedger("retry-two");
  const s=stub(n=>n===1?{status:503,payload:serviceError}:{status:200,payload:completed(n)},{maxCalls:2});
  try {
    const clock=new ManualClock(),runtime=runtimeFor(s.provider,{clock,ledger,budget:new CampaignBudget(ledger,undefined,5,account),turns:2});
    await drive(runtime,clock);assert.equal(s.generations,2);assert.equal(account.spentUsd,12);
    const req=s.requests.filter(r=>r.endpoint==="generation");
    assert.equal(req[1].body.input[0].role,"developer");assert.equal(req[1].body.previous_response_id,undefined);
    assert(readFileSync(path,"utf8").startsWith(history));
    assert(runtime.ledger.events.some(e=>e.type==="action.applied"&&e.data.actionId==="read-2"));await runtime.stop();
  } finally {account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});

for(const [name,reply,options] of [
  ["retry off by default",{status:503,payload:serviceError},{maxRetries:0}],
  ["rate limit",{status:429,payload:serviceError},{}],
  ["other HTTP error",{status:500,payload:serviceError},{}],
  ["partial response identity",{status:503,payload:{...serviceError,id:"unknown-response"}},{}],
  ["returned output",{status:503,payload:{...serviceError,output:[]}},{}],
  ["incomplete generation",{status:200,payload:{...completed(1),status:"incomplete",incomplete_details:{reason:"max_output_tokens"}}},{}],
  ["malformed error",{status:503,payload:{error:"unstructured"}},{}],
  ["long Retry-After",{status:503,payload:serviceError},{headers:{"retry-after":"60"}}],
  ["invalid Retry-After",{status:503,payload:serviceError},{headers:{"retry-after":"invalid"}}]
] as [string,{status:number;payload:unknown},StubOptions][])test(`does not retry ${name}`,async()=>{
  const s=stub(()=>reply,options);const r=await s.provider.decide(context(),new AbortController().signal);
  assert(r.error);assert.equal(r.retryableServiceError,undefined);
  await assert.rejects(()=>s.provider.decide(context(),new AbortController().signal),/blocked/);assert.equal(s.generations,1);
});

test("one permitted transient retry stops on repeated 503, and runtime opt-out never schedules it",async()=>{
  for(const retries of [0,1]) {
    const s=stub(()=>({status:503,payload:serviceError})),clock=new ManualClock(),runtime=runtimeFor(s.provider,{clock,retries});
    await drive(runtime,clock);assert.equal(s.generations,retries+1);assert.equal(runtime.budget.guard.campaignSpentUsd,retries+1);
    assert.equal(runtime.status,"paused");await runtime.stop();
  }
});

test("preflight/unknown transport outcome and late cancellation never become retry candidates",async()=>{
  const pre=stub(()=>({status:200,payload:completed(1)}),{inputStatus:503});
  await assert.rejects(()=>pre.provider.decide(context(),new AbortController().signal),/preflight/);assert.equal(pre.generations,0);
  const broken=stub(()=>({status:503,payload:serviceError}),{onGenerate(){throw Error("socket lost");}});
  await assert.rejects(()=>broken.provider.decide(context(),new AbortController().signal),/socket lost/);
  await assert.rejects(()=>broken.provider.decide(context(),new AbortController().signal),/blocked/);assert.equal(broken.generations,1);
  const abort=new AbortController(),late=stub(()=>({status:503,payload:serviceError}),{onGenerate(){abort.abort();}});
  await assert.rejects(()=>late.provider.decide(context(),abort.signal),/Late response/);assert.equal(late.journal.some(e=>e.phase==="retryable_service_error"),false);
});

test("Stop during backoff aborts the wait and no second generation or action follows",async()=>{
  const s=stub(()=>({status:503,payload:serviceError})),clock=new ManualClock(),runtime=runtimeFor(s.provider,{clock});
  await runtime.start(false);const running=runtime.runAgent();
  for(let i=0;i<100&&!runtime.ledger.events.some(e=>e.type==="agent.activity"&&e.data.phase==="provider_retry_backoff");i++)await flushMicrotasks();
  assert(runtime.ledger.events.some(e=>e.type==="agent.activity"&&e.data.phase==="provider_retry_backoff"));
  await runtime.stop("Engineer stopped during retry wait");clock.advance(30_000);await running;
  assert.equal(s.generations,1);assert.equal(runtime.budget.guard.campaignSpentUsd,2,"Both reservations retained; this does not imply two billed generations");
  assert.equal(Object.keys(runtime.ledger.state.actions).length,0);
});

test("revision change during backoff prevents generation, and final-turn/budget exhaustion never starts a retry",async()=>{
  const s=stub(()=>({status:503,payload:serviceError})),clock=new ManualClock(),runtime=runtimeFor(s.provider,{clock});
  await runtime.start(false);const running=runtime.runAgent();
  for(let i=0;i<100&&!runtime.ledger.events.some(e=>e.type==="agent.activity"&&e.data.phase==="provider_retry_backoff");i++)await flushMicrotasks();
  runtime.ledger.append("plan.created",{objective:"External operator revision changed",experiments:[{id:"operator-plan",objective:"Read fixture",category:"normal",requirements:[]}]});clock.advance(300);await running;
  assert.equal(s.generations,1);assert.equal(Object.keys(runtime.ledger.state.actions).length,0);await runtime.stop();
  for(const budgetLimited of [false,true]) {
    const p=stub(()=>({status:503,payload:serviceError})),c=new ManualClock(),r=runtimeFor(p.provider,{clock:c,turns:budgetLimited?3:1});
    if(budgetLimited)r.budget.guard.limits.campaignHardUsd=1;
    await drive(r,c);assert.equal(p.generations,1);assert.equal(r.budget.guard.leases.size,1);
    assert(!r.ledger.events.some(e=>e.type==="agent.activity"&&e.data.phase==="provider_retry_scheduled"));await r.stop();
  }
});

test("real isolated child establishes a fresh hold lease and keeps the image committed through 503 retry backoff",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"retry-child-")),ledger=new CampaignLedger("retry-real-child",{file:join(dir,"campaign.jsonl")});
  const session=await openOfflineWonderSession({ledger,hmi:{async perform(){throw Error("No HMI");}},scope:{},artifactDirectory:dir},{
    transportModule:fileURLToPath(new URL("./fixtures/wonder-process-transport.ts",import.meta.url)),ownershipPath:join(dir,"fake.lock")});
  const s=stub(n=>n===1?{status:503,payload:serviceError}:{status:200,payload:completed(n)},{maxCalls:2,headers:{"retry-after":"1"}});
  const runtime=new CampaignRuntime({ledger,provider:s.provider,budget:new CampaignBudget(ledger),driver:session.driver,controller:session.controller,requireDecisionLeases:true,
    maxTransientRetries:1,maxTurns:2,paidAuthorized:true,evidenceClass:"fake_connector",claimBoundary:"Real child, fake transport only",spec:"fixture",signals:[],categories:["normal"],provenance:session.provenance});
  try {
    await runtime.start(true);await runtime.runAgent();await runtime.stop();await session.dispose();
    assert.equal(s.generations,2);
    const starts=ledger.events.filter(e=>e.type==="agent.response"&&(e.data.response as any).phase==="decision_lease_started").map(e=>(e.data.response as any));
    assert.equal(starts.length,2);assert.notEqual(starts[0].receipt.id,starts[1].receipt.id);assert.equal(starts[1].policy.mode,"hold");
    // Authoritative transport acknowledgements prove streaming, not merely two lease labels.
    const acks=readFileSync(join(dir,"wonder-process/child-transport.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line)).filter(e=>e.kind==="commit.acknowledged");
    const backoff=ledger.events.find(e=>e.type==="agent.activity"&&e.data.phase==="provider_retry_backoff")!;
    const sent=s.journal.find(e=>e.turn===2&&e.phase==="request"&&e.endpoint==="responses")!;
    const heldAcks=acks.filter(e=>e.atIso>=backoff.atIso&&e.atIso<=sent.atIso);
    assert(heldAcks.length>=3,JSON.stringify({acks:heldAcks.length,backoff:backoff.atIso,sent:sent.atIso}));
    assert.equal(new Set(heldAcks.map(e=>digest(e.receipt.image))).size,1);
    assert(BigInt(heldAcks.at(-1).receipt.plcCycle)>BigInt(heldAcks[0].receipt.plcCycle));
    assert.equal(starts[1].receipt.boundary.worldHeld,true);
    assert(!existsSync(join(dir,"fake.lock")));
    const replay=readLedger(join(dir,"campaign.jsonl"));assert.deepEqual(report(replay),runtime.getReport());
    if(process.env.WONDER_RETRY_EVIDENCE){mkdirSync(process.env.WONDER_RETRY_EVIDENCE,{recursive:true});cpSync(dir,join(process.env.WONDER_RETRY_EVIDENCE,"real-child"),{recursive:true});}
  } finally {await session.dispose();ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test("real child lease invalidation after a 503 refuses retry and retains the failed charge",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"retry-invalid-lease-")),ledger=new CampaignLedger("retry-invalid-lease");
  const session=await openOfflineWonderSession({ledger,hmi:{async perform(){throw Error("No HMI");}},scope:{},artifactDirectory:dir},{
    transportModule:fileURLToPath(new URL("./fixtures/wonder-process-transport.ts",import.meta.url)),ownershipPath:join(dir,"fake.lock")});
  const s=stub(()=>({status:503,payload:serviceError}));
  const finish=session.driver.decisionLeases!.finish;
  session.driver.decisionLeases!.finish=async(r,signal)=>({...await finish(r,signal),valid:false,reason:"Fixture invalidated the completed lease"});
  const runtime=new CampaignRuntime({ledger,provider:s.provider,driver:session.driver,controller:session.controller,requireDecisionLeases:true,maxTransientRetries:1,maxTurns:3,
    paidAuthorized:true,evidenceClass:"fake_connector",claimBoundary:"Real child, fake transport only",spec:"fixture",signals:[],categories:["normal"],provenance:session.provenance});
  try {
    await runtime.start(true);await runtime.runAgent();assert.equal(s.generations,1);assert.equal(runtime.budget.guard.campaignSpentUsd,1);
    assert(!ledger.events.some(e=>e.type==="agent.activity"&&e.data.phase==="provider_retry_scheduled"));await runtime.stop();
  } finally {await session.dispose();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
