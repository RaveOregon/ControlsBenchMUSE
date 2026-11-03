// S2 adds the controlled HMI/vision lane around the unchanged, qualified W4 child.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptedBudgetLimits } from "../campaign/budget.ts";
import { createCampaignFactory as wonderFactory } from "./wonder-campaign-factory.ts";
import { WonderResponsesProvider, fileExchangeJournal } from "../campaign/wonder-responses.ts";
import type { WonderVisualInput } from "../campaign/wonder-responses.ts";
import { commonWonderPaths } from "../campaign/wonder-paths.ts";
import { ToolFailure } from "../campaign/driver.ts";
import type { CampaignFactory } from "./campaign-factory.ts";
import { writeS2HeldRecord } from "../campaign/s2-evidence.ts";

const root=fileURLToPath(new URL("../../",import.meta.url));
const sha=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
export function createCampaignFactory(): CampaignFactory {
  const packetPath=process.env.CONTROLSBENCH_S2_PACKET;
  assert(packetPath && process.env.CONTROLSBENCH_S2_PACKET_SHA256,"S2 requires an exact recorded launch packet");
  assert.equal(sha(packetPath),process.env.CONTROLSBENCH_S2_PACKET_SHA256);
  const packet=JSON.parse(readFileSync(packetPath,"utf8"));
  assert.equal(packet.contract,"controlsbench.s2-hmi-proof.v1");assert.equal(packet.authorizedCreditPoolUsd,150);
  assert(Number.isInteger(packet.maximumRequests)&&packet.maximumRequests>=1&&packet.maximumRequests<=8);
  assert.equal(packet.requestAdmissionUsd,5);assert(packet.accountBaseline.totalUsd+packet.maximumRequests*5<=145);
  for(const[p,h]of Object.entries(packet.sourceHashes))assert.equal(sha(join(root,p)),h,`S2 source changed: ${p}`);
  let created=false;
  return { id:"wonder-s2-live-hmi",label:"Muse Wonder · live HMI vision and operation",evidenceClass:"live_plc",connectorId:"isolated-m8-process-v1",
    supportsExitSimulation:true,outputIds:["Motor_RunCmd","D1_ExtendCmd","D2_ExtendCmd","StackLight_Red","StackLight_Green"],
    claimBoundary:"Live Muse HMI operation checkpoint. Pixels, trusted input, PLC acknowledgement and model interpretation remain separate evidence.",
    limits:{...acceptedBudgetLimits,perRequestUsd:5,campaignWarningUsd:packet.maximumRequests*5,campaignHardUsd:(packet.maximumRequests+1)*5,sessionHardUsd:150,requestTimeoutMs:300000},
    scope:{mode:"categories",choices:[{id:"hmi",title:"HMI Start / Stop / Reset and screen verification"}],description:"Muse chooses HMI actions and a simulated fault. Record UI-01–UI-04 assessments; untested behavior remains inconclusive."},
    async create(context){
      assert(!created,"One S2 campaign per launch; preserve accounting and inspect before another run");created=true;
      assert.equal(context.scope.hmi,true,"Select the HMI checkpoint before Start");
      assert(context.artifactDirectory && context.hmi.vision,"Persistent artifacts and actual controlled-session images required");
      assert.equal(sha(commonWonderPaths().session),packet.accountBaseline.sha256,"Account changed since preparation");
      const directory=context.artifactDirectory;mkdirSync(join(directory,"vision-frames"),{recursive:true});
      writeFileSync(join(directory,"w4-approval.json"),readFileSync(packetPath),{flag:"wx"});
      context.ledger.append("world.evidence",{source:{kind:"paid_w4_approval",packetSha256:sha(packetPath),maximumModelRequests:packet.maximumRequests,
        maximumNewConservativeUsd:packet.maximumRequests*5,maximumOutputTokens:16000,aggregateConservativeCeilingUsd:packet.accountBaseline.totalUsd+packet.maximumRequests*5}},"truth");
      let visionTurn=0;
      const base=wonderFactory({proofAllowance:{maximumRequests:packet.maximumRequests,sessionHardUsd:150,maximumRejectedDecisions:2,requestAdmissionUsd:5},
        maxTransientRetries:2,retryDecisionTransport:true,admissionMode:"context_ceiling",
        provider:()=>new WonderResponsesProvider({apiKey:process.env.MODEL_API_KEY!,explicitlyAuthorized:true,journal:fileExchangeJournal(join(directory,"wonder-exchanges.jsonl")),
          maxCalls:packet.maximumRequests,maxOutputTokens:16000,maxTransientRetries:2,retryDecisionTransport:true,requestAdmissionUsd:5,admissionMode:"context_ceiling",
          visualInputs:async(_context,signal)=>{
            const turn=++visionTurn,frames:WonderVisualInput[]=[];
            const keep=async(reference?:string)=>{
              const image=await context.hmi.vision!(signal,reference),{bytes,...metadata}=image;
              assert.equal(createHash("sha256").update(bytes).digest("hex"),image.sha256);
              const file=`${turn}-${reference?`${frames.length}-action`:"current"}.${image.contentType==="image/png"?"png":"jpg"}`;
              writeFileSync(join(directory,"vision-frames",file),bytes,{flag:"wx"});
              const e=context.ledger.append("hmi.evidence",{actionId:`vision-${turn}-${reference?"action":"current"}`,kind:"frame",reference:image.reference,atIso:image.atIso,
                receipt:{sha256:image.sha256,sessionId:image.sessionId,file:`vision-frames/${file}`,recordedActionFrame:!!reference}});
              frames.push({...metadata,bytes,evidenceId:e.id,...(reference?{recorded:true}:{})});
            };
            await keep();
            const recent=context.ledger.events.filter(e=>e.type==="hmi.action"&&String(e.data.action).startsWith("cmd.")).slice(-3);
            for(const action of recent){
              const actionRef=(action.data.receipt as any)?.action?.screen?.frameRef;
              if(actionRef&&!frames.some(f=>f.reference===actionRef))await keep(actionRef);
            }
            return frames;
          }})});
      const hosted=await base.create({...context,scope:{normal:true,faults:true}}),runtime=hosted.runtime;
      const controller=runtime.options.controller!;
      runtime.options.controller={execute(call,...args){if(call.name==="operator_action")return Promise.reject(new ToolFailure("rejected","S2 operator commands must be actual HMI clicks via request_hmi_action"));return controller.execute(call,...args);}};
      runtime.options.hmiProofRequirements=["UI-01","UI-02","UI-03","UI-04"];
      runtime.options.capabilities={...runtime.options.capabilities as object,supervisory:{operator_action:"disabled in S2; use actual HMI clicks",wcs:"not needed for this checkpoint"},
        hmi:{actions:true,vision:true,session:"The same actual controlled browser shown in the portal tile",targets:{"cmd.auto.on":"Auto on","cmd.auto.off":"Auto off","cmd.start":"Start","cmd.stop":"Stop","cmd.reset":"Reset","nav.operation":"Operation page","nav.alarms":"Alarms page","nav.engineering":"Engineering page","link.active-fault":"Active fault"},
          receipt:"request_hmi_action returns requested action, CDP delivery, trusted page input, PLC command acknowledgement/result, and captured rendered frame. Applied tool outcome is not a blanket HMI pass.",
          images:"Every model request contains fresh actual HMI pixels with an hmi.evidence ID, plus the latest action-result frame when available. Recorded action frames are explicitly labelled historical. record_hmi_assessment cites those event IDs, not raw hmi-frame strings. Screen interpretation is your responsibility.",
          assessment:"Record UI-01 controls/acknowledgements; UI-02 command versus feedback; UI-03 mode and active fault text on Operation; UI-04 stale/unknown/WCS-link indication. Inconclusive is correct for behavior you did not test. Do not invent a stale/disconnect test from a healthy screenshot."},
        engineerObjective:packet.objective};
      let disposal:Promise<void>|undefined;
      const dispose=()=>disposal??=Promise.resolve(hosted.dispose?.());
      return {...hosted,dispose,async run(){try{await runtime.runAgent();}finally{
        await runtime.stop("S2 campaign ended; retain original observations");await dispose();
        writeS2HeldRecord(directory);
      }}};
    }};
}
