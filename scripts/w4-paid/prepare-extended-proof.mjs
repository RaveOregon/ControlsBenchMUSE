// User authorized the available $150 credit pool for proving the product.
// Use the newly qualified decision-repair provider and explicit proof allowance.
// No real HTTP or PLC contact occurs during preparation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
assert(process.argv[2],'Supply the new proof-qualified launch configuration');
process.env.CONTROLSBENCH_W4_LAUNCH_CONFIG=resolve(root,process.argv[2]);
const s=await import('./support.mjs');
const {configuration,pinned,configurationPath,hash,hashFile,json,fromPin,commonWonderPaths,trialEnvelope,verifyAccountBaseline,configureBoundedRuntime}=s;
assert.equal(json(configuration.proof).status,'pass');
const original=join(root,'artifacts/w4-paid/2026-11-03T00-05-36-042Z');
assert.equal(hashFile(join(original,'packet.json')),'0eb36e875646552b90185e4e6e9922fd801f02af2eada5e7adbca48a6f6aa93f');
assert.equal(json(join(original,'authorization.json')).aggregateConservativeCeilingUsd,12);
const priorDirectory=join(original,'live-host/runs/2026-11-03T00-08-00-121Z-live_plc/portal-host/portal-20261103000832522-1');
const audit=json(join(priorDirectory,'expanded-trial-audit.json')),prior=json(join(priorDirectory,'report.json'));
assert.equal(audit.exactPlcClaimsVerified,7);assert.equal(audit.recovery.final.stoppedBaselineMismatches.length,0);
const accountBytes=readFileSync(commonWonderPaths().session),charges=accountBytes.toString('utf8').trim().split('\n').map(JSON.parse);
const baseline=charges.at(-1).totalUsd;assert.equal(baseline,27);
const directory=join(root,'artifacts/w4-paid',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory,{recursive:true});
const objective={source:'Engineer-selected continuation after proved normal sort',
  goal:'Complete the missing declared-fault experiment on the live PLC, then choose and execute a genuinely new follow-up from the returned current fault evidence. Normal A sorting is already established by the labelled recorded prior proof; do not spend the remaining attempts repeating it. Finish Stopped, fault-free, with no active item or pending completion when possible; otherwise state exactly what remains.',
  discretion:'Choose your own fault, hypotheses, stimuli and follow-up. Up to twenty model decisions are available; finish once you have sufficient evidence. Run a declared fault experiment, inspect its actual PLC response, choose a genuinely new investigation from that evidence, physically execute it, and report grounded findings. A new follow-up must cite actual current evidence and must not be selected in advance. Up to three effect-free validation corrections and five bounded pure-model service/connection retries fit inside the ordinary turns. The engineer authorized the available $150 credit pool for proof work. Do not repeat actions merely to use the allowance.',
  operation:s.objective.operation,boundaries:s.objective.boundaries};
const configRelative=relative(root,configurationPath).replaceAll('\\','/');
const launchFiles=['scripts/w4-paid/support.mjs','scripts/w4-paid/factory.mjs','scripts/w4-paid/export-held.mjs','scripts/w4-paid/launch-resume.ps1',configRelative];
const packet={contract:'controlsbench.w4-paid-approval.v1',preparedAtIso:new Date().toISOString(),ownerCommit:configuration.sourceCommit,
  approvalRevision:{contract:'controlsbench.w4-full-proof-approval.v2',previousAggregateCeilingUsd:15,authorizedCreditPoolUsd:150,status:'User authorized available credits to prove the product',instruction:"we have only spent $7 during all of our development of a 150 set of credits so lets go full send to prove our shit. we don't need to worry abotu spend limits"},
  maximumModelRequests:20,maximumNewConservativeUsd:60,aggregateConservativeCeilingUsd:baseline+60,sessionHardUsd:150,maximumOutputTokens:16000,maxTransientRetries:5,maxRejectedDecisions:3,retryDecisionTransport:true,
  sessionBaseline:{conservativeUsd:baseline,sha256:hash(accountBytes)},model:'muse-wonder-1.0',reasoning:'high',mode:'Standard',perRequestAdmissionUsd:3,requestTimeoutMs:300000,
  categories:['faults','adaptive'],objective,
  recordedPriorProof:{kind:'recorded_prior_trial',evidenceClass:'preserved_live_plc',liveNow:false,campaignId:prior.campaignId,auditSha256:hashFile(join(priorDirectory,'expanded-trial-audit.json')),
    finding:prior.findings[0],boundary:'Historical normal-sort observation only. Prior evidence IDs are not current-campaign IDs. No prior fault or adaptive physical test passed.'},
  repositoryRoot:commonWonderPaths().root,campaignArtifactRoot:join(directory,'live-host'),
  launchConfiguration:{path:configRelative,sha256:hashFile(configurationPath)},launchSourceHashes:Object.fromEntries(launchFiles.map(f=>[f,hashFile(join(root,f))])),
  originalApproval:{packetSha256:hashFile(join(original,'packet.json')),authorizationSha256:hashFile(join(original,'authorization.json')),historicalAggregateCeilingUsd:12,supersededByUserCreditAuthorization:true,alreadySpentConservativeUsd:baseline},
  dataTransfer:json(join(original,'packet.json')).dataTransfer,
  previousHost:{pid:42612,pinDirectoryName:'w4-proof-runtime-pin',packetDirectoryName:'2026-11-03T02-41-21-436Z',expectedCampaignId:'portal-20261103024529383-1'},
  limits:'Up to twenty decisions with separately recorded conservative $3 reservations: at most $60 new/$87 aggregate. Actual billing differs; prior $27 conservative history remains exact, including the possibly billed connection failure. User authorized $150 available credits. Unreturned pure model generation may be requested again from the last valid head, with another charge and fresh hold lease; no uncertain physical effect is retried. Validation correction applies only before any ledger/effect changes.',
  recovery:'Dispose exact child, preserve original report/held-state. Native recovery is read-only until exact saved-state match and explicit recorded reconciliation.',
  proofBoundary:'Current source-bound decision-repair and allowance qualification is linked by the launch configuration. Physical engine unchanged. Fresh zero-model bench commissioning must pass before paid Start.'};
trialEnvelope(packet);verifyAccountBaseline(packet);
const {CampaignLedger}=await fromPin('src/campaign/ledger.ts');
const {CampaignRuntime}=await fromPin('src/campaign/runtime.ts');
const {WonderResponsesProvider,fileExchangeJournal}=await fromPin('src/campaign/wonder-responses.ts');
const {openOfflineWonderSession}=await fromPin('src/live/wonder-process/index.ts');
const ledger=new CampaignLedger('resumed-payload-preview');
const session=await openOfflineWonderSession({ledger,hmi:{async perform(){throw Error('No HMI');}},scope:{faults:true,adaptive:true},artifactDirectory:join(directory,'preview')},
  {transportModule:join(pinned,'test/fixtures/w4-bench-transport.ts'),ownershipPath:join(directory,'unused-preview.lock')});
let request;
try {
  const provider=new WonderResponsesProvider({apiKey:'offline-preview-not-a-key',explicitlyAuthorized:true,maxCalls:20,maxOutputTokens:16000,maxTransientRetries:5,retryDecisionTransport:true,requestAdmissionUsd:3,
    journal:fileExchangeJournal(join(directory,'preview-http.jsonl')),fetch:async(url,init)=>{
      if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:0});
      request=JSON.parse(init.body);throw Error('OFFLINE_PREVIEW_CAPTURE_ONLY');
    }});
  const worldManifest=json(join(pinned,'artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json'));
  const runtime=new CampaignRuntime({ledger,provider,driver:session.driver,controller:session.controller,paidAuthorized:true,maxTransientRetries:5,maxRejectedDecisions:3,requireDecisionLeases:true,
    evidenceClass:'fake_connector',claimBoundary:'Preview with no initialization, no PLC/model contact',categories:packet.categories,provenance:session.provenance,
    spec:readFileSync(join(pinned,'docs/conveyor-machine-spec.md'),'utf8'),signals:[...worldManifest.signals,...session.process.loaded.observedOutputIds.filter(id=>!worldManifest.signals.some(s=>s.id===id)).map(id=>({id,direction:'plc_to_world'}))],
    capabilities:{semantic:session.driver.binding.describe,observations:session.process.loaded.observedOutputIds,decisionLeases:['hold','continue','condition_deadline']}});
  Object.assign(runtime.budget.guard.limits,{perRequestUsd:3,campaignHardUsd:63,sessionHardUsd:150});configureBoundedRuntime(runtime,packet);
  await assert.rejects(()=>provider.decide(runtime.agentContext(),new AbortController().signal),/OFFLINE_PREVIEW_CAPTURE_ONLY/);
  assert.equal(request.max_output_tokens,16000);assert.equal(JSON.parse(request.input.at(-1).content[0].text).providerBudget.maxDecisions,20);
  writeFileSync(join(directory,'example-request.json'),JSON.stringify(request,null,2)+'\n');
}finally{await session.dispose();ledger.close();}
writeFileSync(join(directory,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
const packetSha256=hashFile(join(directory,'packet.json'));
writeFileSync(join(directory,'authorization.json'),JSON.stringify({status:'approved-full-proof-work',instruction:packet.approvalRevision.instruction,packetSha256,authorizedCreditPoolUsd:150,maximumNewConservativeUsd:60,aggregateConservativeCeilingUsd:baseline+60,previousConservativeUsd:baseline,recordedAtIso:new Date().toISOString()},null,2)+'\n');
writeFileSync(join(root,'artifacts/w4-paid/latest.json'),JSON.stringify({status:'transport-proof-ready-for-bench-check',directory,packetSha256,previousConservativeUsd:baseline,maximumNewConservativeUsd:60,aggregateConservativeCeilingUsd:baseline+60,authorizedCreditPoolUsd:150,maxTransientRetries:5,retryDecisionTransport:true},null,2)+'\n');
console.log(JSON.stringify({directory,packetSha256,maximumNewConservativeUsd:60,authorizedCreditPoolUsd:150,realApiRequests:0,realPlcConnections:0}));
