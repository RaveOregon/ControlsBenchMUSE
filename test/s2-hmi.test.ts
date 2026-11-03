import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WonderResponsesProvider } from "../src/campaign/wonder-responses.ts";
import type { AgentContext } from "../src/campaign/provider.ts";
import { CampaignLedger, replay, report } from "../src/campaign/ledger.ts";
import { CampaignRuntime } from "../src/campaign/runtime.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import { fixtureProvenance } from "../src/campaign/harness.ts";
import { HmiHub } from "../src/host/hmi.ts";
import { HmiService } from "../src/hmi/service.ts";
import { FixturePlc } from "../src/hmi/fixture.ts";
import { PortalSessionBridge } from "../src/hmi/portal-bridge.ts";
import { CdpWebVisuSource, findBrowser } from "../src/host/cdp-webvisu.ts";
import { createHmiServer, listen } from "../src/hmi/http.ts";
import { appendCoordinatorEvent } from "../src/campaign/live-evidence.ts";
import { openOfflineWonderSession } from "../src/live/wonder-process/index.ts";
import { writeS2HeldRecord } from "../src/campaign/s2-evidence.ts";
import { fileURLToPath } from "node:url";

const png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNRsAAAAASUVORK5CYII=","base64");
const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const image=()=>({evidenceId:"screen:1",reference:"hmi-frame:test:1",sessionId:"test",atIso:new Date().toISOString(),sha256:sha(png),contentType:"image/png",bytes:png});
const context:AgentContext={schemaVersion:"controlsbench.campaign.v1",spec:"fixture",signals:[],capabilities:{hmi:"enabled"},state:{status:"running",revision:1,experiments:{}},evidence:[],results:[],diagnosisMode:"known"};

test("Wonder serializes actual image bytes with exact evidence metadata; bad or stale images make no request",async()=>{
  let sent:any;const journal:any[]=[];
  const provider=new WonderResponsesProvider({apiKey:"fixture",explicitlyAuthorized:true,requestAdmissionUsd:5,admissionMode:"context_ceiling",journal:{append:r=>journal.push(r)},
    visualInputs:async()=>[image()],fetch:async(_url,init)=>{sent=JSON.parse(String(init?.body));return Response.json({id:"response-1",status:"completed",output:[{type:"function_call",name:"campaign_decision",call_id:"call-1",arguments:JSON.stringify({summary:"Inspect actual pixels",calls:[]})}]});}});
  await provider.decide(context,new AbortController().signal);
  const content=sent.input.at(-1).content;assert.deepEqual(Buffer.from(content.find((x:any)=>x.type==="input_image").image_url.split(",")[1],"base64"),png);
  assert.equal(JSON.parse(content[1].text).hmiFrame.evidenceId,"screen:1");assert.equal(journal.filter(r=>r.phase==="vision.input").length,1);
  for(const mutation of [{sha256:"wrong"},{atIso:new Date(Date.now()-20_000).toISOString()},{contentType:"image/svg+xml"},{bytes:Buffer.alloc(1_048_577)}]){
    let requests=0;const bad=new WonderResponsesProvider({apiKey:"fixture",explicitlyAuthorized:true,journal:{append(){}},visualInputs:async()=>[{...image(),...mutation}],fetch:async()=>{requests++;throw Error("should not fetch");}});
    await assert.rejects(bad.decide(context,new AbortController().signal),/Invalid.*visual input/);assert.equal(requests,0);
  }
});

test("runtime preserves rejected HMI receipts and refuses invented/wrong-type screen assessments",async()=>{
  const ledger=new CampaignLedger("screen-runtime"),runtime=new CampaignRuntime({ledger,provider:new FakeProvider(()=>({summary:"fixture",calls:[]})),provenance:fixtureProvenance("fixture"),
    evidenceClass:"fake_connector",claimBoundary:"No PLC or model",spec:"fixture",signals:[],categories:["normal"],hmiProofRequirements:["UI-01"],
    hmi:{async perform(){return {reference:"agent:1",atIso:new Date().toISOString(),outcome:"rejected",receipt:{accepted:false,expectedSequence:7}};}}});
  await runtime.start(false);
  const negative=await runtime.executeTool({id:"negative",name:"request_hmi_action",arguments:{action:"cmd.reset"}});
  assert.equal(negative.status,"rejected");assert.equal(negative.evidenceRefs.length,1);assert.equal(ledger.getEvent(negative.evidenceRefs[0])?.type,"hmi.action");
  assert.equal((negative.value as any).accepted,false);
  const frame=ledger.append("hmi.evidence",{actionId:"frame",kind:"frame",reference:"hmi-frame:s:1",atIso:new Date().toISOString()});
  const refs=appendCoordinatorEvent(ledger,{sequence:1,atIso:new Date().toISOString(),atMonotonicMs:1,lane:"connector",data:{action:"commit.acknowledged",cause:"explicit-fake-fixture",workstationEpoch:"1",workstationSequence:"1",slot:0,latencyMs:1,bootIdentity:"fixture",plcCycle:"1",outputCaptureCycle:"1",image:{},outputs:{Motor_RunCmd:false}}});
  const plc=ledger.getEvent(refs[3])!;
  const args={id:"UI-assessment",requirementId:"UI-01",frameEvidenceRefs:[frame.id],actionEvidenceRefs:negative.evidenceRefs,plcEvidenceRefs:[plc.id],observation:"Fixture screen only",verdict:"inconclusive",uncertainty:"Not live"};
  assert.equal((await runtime.executeTool({id:"invented",name:"record_hmi_assessment",arguments:{...args,frameEvidenceRefs:["made-up"]}})).status,"rejected");
  assert.equal((await runtime.executeTool({id:"wrong-kind",name:"record_hmi_assessment",arguments:{...args,frameEvidenceRefs:[plc.id]}})).status,"rejected");
  assert.equal((await runtime.executeTool({id:"real-refs",name:"record_hmi_assessment",arguments:args})).status,"applied");
  assert.equal((await runtime.executeTool({id:"duplicate",name:"record_hmi_assessment",arguments:args})).status,"rejected");
  assert.equal(report(ledger.events).hmiAssessments?.length,1);assert.deepEqual(replay(ledger.events),ledger.state);await runtime.stop();
});

test("S2 export preserves new HMI assessments with a real isolated child and explicitly fake transport",async()=>{
  const directory=mkdtempSync(join(tmpdir(),"s2-export-")),ledger=new CampaignLedger("s2-export",{file:join(directory,"campaign.jsonl")});
  ledger.append("provenance.recorded",{provenance:fixtureProvenance("fixture"),evidenceClass:"fake_connector",claimBoundary:"Offline export only"});
  const session=await openOfflineWonderSession({ledger,hmi:{async perform(){throw Error("No fixture HMI action");}},scope:{},artifactDirectory:directory},
    {transportModule:fileURLToPath(new URL("./fixtures/wonder-process-transport.ts",import.meta.url)),ownershipPath:join(directory,"live.lock")});
  try{
    await session.driver.initialize();
    const plc=ledger.events.filter(e=>e.type==="plc.output").at(-1)!;
    const frame=ledger.append("hmi.evidence",{actionId:"fixture-frame",kind:"frame",reference:"hmi-frame:fixture:1",atIso:new Date().toISOString()});
    ledger.append("hmi.assessment",{id:"fixture-assessment",requirementId:"UI-04",frameEvidenceRefs:[frame.id],actionEvidenceRefs:[],plcEvidenceRefs:[plc.id],observation:"Fake frame reference only",verdict:"inconclusive",uncertainty:"No actual UI observation"});
    ledger.append("campaign.state",{state:"stopped",reason:"Explicit offline codec/export test"});
    await session.dispose();ledger.close();
    const result=writeS2HeldRecord(directory,{allowOffline:true});assert.equal(result.scope,"offline-fake-transport");
    assert.equal(JSON.parse(readFileSync(join(directory,"report.json"),"utf8")).hmiAssessments.length,1);
    assert.throws(()=>writeS2HeldRecord(directory,{allowOffline:true}),/Never overwrite/);
  }finally{await session.dispose();ledger.close();rmSync(directory,{recursive:true,force:true});}
});

test("real controlled browser fixture: semantic HMI actions retain trusted input, command ack and the same frame bytes",{skip:!findBrowser(),timeout:60_000},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"s2-browser-")),plc=new FixturePlc("m10-stopped-ready");
  // Recorded reads omit some request variables. Align the explicit fake
  // transport's request counters with its recorded echoes before any click.
  for(const name of ["Start","Stop","Reset"])plc.values[`GVL_DemoWrite.${name}Sequence`]=plc.values[`GVL_DemoRead.Status.${name}Ack`];
  const service=new HmiService({source:{kind:"fixture",plc},commandPolicy:"enabled",ownershipRoots:[directory],pollIntervalMs:50});
  let bridge:PortalSessionBridge;
  const hub=new HmiHub({captureIntervalMs:10000,onChange:(v,c)=>bridge?.onHubChange(v,c),agentAction:(c,s)=>bridge.runtimeAction(c,s)});
  bridge=new PortalSessionBridge(service,hub);
  const server=createHmiServer(service);
  try{
    service.url=await listen(server,0);await service.start();
    await hub.connect(bridge.attachSource(new CdpWebVisuSource(`${service.url}?capture=portal`,{headless:true,width:1280,height:800})));
    const until=async(p:()=>boolean)=>{const end=Date.now()+5000;while(!p()){assert(Date.now()<end,"fixture timed out");await new Promise(r=>setTimeout(r,40));}};
    await until(()=>!!bridge.portalClient());await new Promise(r=>setTimeout(r,350));
    const hmi=hub.runtimeAdapter(),signal=new AbortController().signal;
    let counter=0;const click=(target:string)=>hmi.perform({id:`click-${++counter}`,name:"request_hmi_action",arguments:{action:target}},signal);
    for(const target of ["cmd.auto.on","cmd.start","cmd.stop"]){
      const result=await click(target),receipt=result.receipt as any;
      assert.equal(result.outcome,"applied",JSON.stringify(receipt));assert.equal(receipt.action.pageInput.isTrusted,true);assert.equal(receipt.action.pageInput.hitTarget,target);
      assert.equal(receipt.command.outcome,"applied");assert(receipt.action.screen.sha256);
      const actual=await hmi.vision!(signal,receipt.action.screen.frameRef);assert.equal(sha(actual.bytes),receipt.action.screen.sha256);
    }
    await new Promise(r=>setTimeout(r,900));plc.control({fault:{code:10,text:"fixture overload"}});await new Promise(r=>setTimeout(r,200));plc.control({clearCause:true});await new Promise(r=>setTimeout(r,200));
    const reset=await click("cmd.reset");assert.equal(reset.outcome,"applied",JSON.stringify(reset));
    const writes=plc.writes.length;await assert.rejects(click("arbitrary.tag.write"),/Unknown published HMI target/);assert.equal(plc.writes.length,writes);
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(hmi.perform({id:"cancelled",name:"request_hmi_action",arguments:{action:"cmd.start"}},cancelled.signal),/cancelled/i);assert.equal(plc.writes.length,writes);
  }finally{await hub.disconnect("S2 fixture complete");await service.stop();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));rmSync(directory,{recursive:true,force:true});}
});
