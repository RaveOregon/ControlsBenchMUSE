// Reviewable static payload and an explicitly recorded-evidence example. Zero real API/PLC calls.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {configuration, configureBoundedRuntime, fromPin, hash, hashFile, json, trialObjective, trialEnvelope, pinned, readLedger, root, commonWonderPaths, verifyAccountBaseline} from './support.mjs';

const directory=join(root,'artifacts/w4-paid',new Date().toISOString().replace(/[:.]/g,'-'));
mkdirSync(directory,{recursive:true});
const paths=commonWonderPaths(), accountBytes=existsSync(paths.session)?readFileSync(paths.session):Buffer.alloc(0);
const charges=accountBytes.toString('utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const baseline=charges.at(-1)?.totalUsd??0;
const retry=process.argv.includes('--remaining-approved');
const originalDirectory=join(root,'artifacts/w4-paid/2026-11-02T13-42-05-152Z');
const originalSha='2b7363876810fe6df81ce0a7fcd06d97bbc5edae67b3f8815ba2d9af17be7bf9';
assert.equal(hashFile(join(originalDirectory,'packet.json')),originalSha);
const originalAuthorization=json(join(originalDirectory,'authorization.json'));
assert.equal(originalAuthorization.packetSha256,originalSha);
assert.equal(originalAuthorization.aggregateConservativeCeilingUsd,8);
assert.equal(originalAuthorization.status,'approved-by-user');
const turns=retry?8-baseline:4;
assert(retry?baseline===5:baseline===4,'This preparation is for the reviewed first retry only; no automatic retries/reset');
const objective=trialObjective(turns);
const files=['scripts/w4-paid/support.mjs','scripts/w4-paid/factory.mjs','scripts/w4-paid/export-held.mjs','scripts/w4-paid/launch.ps1','scripts/w4-paid/start-approved-retry.ps1','artifacts/w4-readiness/e3469af/launch.json'];
const packet={contract:'controlsbench.w4-paid-approval.v1',preparedAtIso:new Date().toISOString(),authorization:'pending user review; no calls authorized by this file alone',
  ownerCommit:configuration.sourceCommit,launchLayerCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',windowsHide:true}).trim(),model:'muse-wonder-1.0',reasoning:'high',mode:'Standard',maximumModelRequests:turns,maximumNewConservativeUsd:turns,
  sessionBaseline:{sha256:hash(accountBytes),conservativeUsd:baseline},aggregateConservativeCeilingUsd:8,
  pricingReviewedOn:'2026-11-02',pricingSource:'https://dev.meta.ai/docs/pricing-rate-limits',inputUsdPerMillion:4,outputUsdPerMillion:20,
  perRequestAdmissionUsd:1,maximumOutputTokens:4000,requestTimeoutMs:300000,categories:['normal','faults','adaptive'],objective,
  repositoryRoot:paths.root,campaignArtifactRoot:join(directory,'live-host'),
  launchSourceHashes:Object.fromEntries(files.map(path=>[path,hashFile(join(root,path))])),
  dataTransfer:{destination:'https://api.meta.ai/v1',sends:['accepted conveyor specification','logical signal and semantic tool definitions','engineer objective','fresh live PLC raw-input/output observations and diagnostic values','action results, faults, experiment state and evidence identifiers','grounded findings and subsequent investigation results'],
    excludes:['PLC source/binaries','model/PLC credentials','opaque connection addresses/node IDs','generated world source','HMI pixels/video'],
    dynamics:'Live observations, times, revisions, IDs, decisions and paired tool outcomes are generated at run time; these dynamic fields are approved by class, not identical to the recorded example.'},
  limits:`One explicitly authorized retry only. ${turns} runtime turns and provider calls; failed/preflight/uncertain attempts retain charges. The durable baseline blocks reuse. Original $8 aggregate ceiling; no new allowance, reset or automatic retry.`,
  recovery:'The bounded wrapper disposes the exact child and writes report.json, held-state.json and result.json beside the original ledger/journals. Recovery uses the pinned inspect-only procedure with --artifacts set to the campaign parent. Unknown/changed states refuse writes.',
  proofBoundary:'First paid trial partial due to 336 ms transport gap. Exact native recovery and corrected-host zero-model commissioning passed. Wonder normal/fault/adaptive proof is still outstanding.',
  originalApproval:{packet:join(originalDirectory,'packet.json'),packetSha256:originalSha,authorization:join(originalDirectory,'authorization.json'),retryInstruction:retry?'Go for it':'original approval',alreadySpentNewConservativeUsd:baseline-4,maximumTotalNewConservativeUsd:4}};
trialEnvelope(packet);
verifyAccountBaseline(packet);
const {CampaignLedger}=await fromPin('src/campaign/ledger.ts');
const {createCampaignFactory}=await fromPin('src/host/wonder-campaign-factory.ts');
const {openOfflineWonderSession}=await fromPin('src/live/wonder-process/index.ts');
const {WonderResponsesProvider,fileExchangeJournal}=await fromPin('src/campaign/wonder-responses.ts');
const {evidenceQuality,assertLogicalContext}=await fromPin('src/campaign/model-context.ts');
const ledger=new CampaignLedger('w4-payload-preview');let hosted,session;
try {
  const factory=createCampaignFactory({provider:()=>({id:'preview-only',paid:false,estimatedRequestUsd:0,async decide(){throw new Error('No fixture decisions requested');}}),
    openSession:async context=>session=await openOfflineWonderSession(context,{transportModule:join(pinned,'test/fixtures/w4-bench-transport.ts'),ownershipPath:join(directory,'unused-fixture.lock')})});
  hosted=await factory.create({ledger,hmi:{async perform(){throw new Error('No HMI export');}},scope:{normal:true,faults:true,adaptive:true},artifactDirectory:join(directory,'preview-construction')});
  configureBoundedRuntime(hosted.runtime,packet);
  const context=hosted.runtime.agentContext();
  const recorded=readLedger(join(root,'artifacts/w4-readiness/e3469af/live-2026-11-02T13-10-27-030Z/campaign.jsonl'));
  context.evidence=recorded.filter(e=>e.type==='plc.output').slice(-6);
  context.boundary={evidenceClass:'preserved_live_plc',recorded:true,categories:packet.categories,claimBoundary:'REVIEW PREVIEW ONLY: sample observations from the completed zero-model commissioning run. Future live W4 starts fresh and sends new live observations/IDs.'};
  context.evidenceWindow={throughSequence:recorded.at(-1).sequence,selectedIds:context.evidence.map(e=>e.id),retrieval:context.evidenceWindow.retrieval,
    quality:evidenceQuality({getEvent:id=>recorded.find(e=>e.id===id)},context.evidence,true,Date.now())};
  context.budget={campaignUsd:0,sessionUsd:baseline,perRequestUsd:1,campaignHardUsd:5};
  assertLogicalContext(context);
  let request;
  const provider=new WonderResponsesProvider({apiKey:'offline-preview-not-a-key',explicitlyAuthorized:true,maxCalls:turns,
    journal:fileExchangeJournal(join(directory,'preview-local-exchanges.jsonl')),fetch:async(url,init)=>{
      if(String(url).endsWith('input_tokens')) return Response.json({input_tokens:0}); // shape capture only, not a real token count
      request=JSON.parse(init.body);throw new Error('OFFLINE_PREVIEW_CAPTURE_ONLY');
    }});
  await assert.rejects(()=>provider.decide(context,new AbortController().signal),/OFFLINE_PREVIEW_CAPTURE_ONLY/);
  assert(request);writeFileSync(join(directory,'example-request.json'),JSON.stringify(request,null,2)+'\n');
  writeFileSync(join(directory,'static-payload.json'),JSON.stringify({spec:context.spec,signals:context.signals,capabilities:context.capabilities,semanticTools:JSON.parse(request.input[0].content[0].text).semanticTools},null,2)+'\n');
  packet.staticPayloadSha256=hashFile(join(directory,'static-payload.json'));packet.exampleRequestSha256=hashFile(join(directory,'example-request.json'));
  packet.preview={realApiRequests:0,realPlcConnections:0,realModelResponses:0,tokenCountMeasured:false,meaning:'Actual provider HTTP shape with a local fetch stub and clearly recorded sample observations; not an exact future live request or a model result.'};
  writeFileSync(join(directory,'packet.json'),JSON.stringify(packet,null,2)+'\n');
  const packetSha256=hashFile(join(directory,'packet.json'));
  if(retry)writeFileSync(join(directory,'authorization.json'),JSON.stringify({status:'approved-retry-within-original-allowance',recordedAtIso:new Date().toISOString(),answer:'Go for it',packetSha256,originalApproval:packet.originalApproval,maximumModelRequests:turns,maximumNewConservativeUsd:turns,aggregateConservativeCeilingUsd:8,dataScope:packet.dataTransfer},null,2)+'\n');
  writeFileSync(join(root,'artifacts/w4-paid/latest.json'),JSON.stringify({directory,packetSha256,status:retry?'approved-retry-ready-to-launch':'awaiting-new-approval',realApiRequests:0,realPlcConnections:0,previousConservativeUsd:baseline,maximumNewConservativeUsd:turns,aggregateConservativeCeilingUsd:8},null,2)+'\n');
  console.log(JSON.stringify({directory,packetSha256,maximumNewConservativeUsd:turns,previousConservativeUsd:baseline,realApiRequests:0,realPlcConnections:0}));
} finally {await hosted?.dispose();await session?.dispose();ledger.close();}
