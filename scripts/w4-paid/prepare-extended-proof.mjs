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
const baseline=charges.at(-1).totalUsd;assert(Number.isInteger(baseline)&&baseline>=45&&baseline<145);
const turns=Math.min(20,Math.floor((145-baseline)/5)),maximumNew=turns*5,aggregate=baseline+maximumNew;assert(turns>=1);
const directory=join(root,'artifacts/w4-paid',new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory,{recursive:true});
const objective={source:'Engineer-selected continuation after proved normal sort',
  goal:'Complete the missing declared-fault experiment on the live PLC, then choose and execute a genuinely new follow-up from the returned current fault evidence. Normal A sorting is already established by the labelled recorded prior proof; do not spend the remaining attempts repeating it. Finish Stopped, fault-free, with no active item or pending completion when possible; otherwise state exactly what remains.',
  discretion:`Choose your own fault, hypotheses, stimuli and follow-up. Up to ${turns} model decisions are available; finish once you have sufficient evidence. Run a declared fault experiment, inspect its actual PLC response, choose a genuinely new investigation from that evidence, physically execute it, and report grounded findings. A new follow-up must cite actual current evidence and must not be selected in advance. Up to three effect-free validation corrections and five bounded pure-model service/connection retries fit inside the ordinary turns. The engineer authorized the available $150 credit pool for proof work. Do not repeat actions merely to use the allowance.`,
  operation:s.objective.operation,boundaries:s.objective.boundaries};
const configRelative=relative(root,configurationPath).replaceAll('\\','/');
const launchFiles=['scripts/w4-paid/support.mjs','scripts/w4-paid/factory.mjs','scripts/w4-paid/export-held.mjs','scripts/w4-paid/launch-resume.ps1','scripts/w4-paid/recover-completed-hold.mjs',configRelative];
const packet={contract:'controlsbench.w4-paid-approval.v1',preparedAtIso:new Date().toISOString(),ownerCommit:configuration.sourceCommit,
  approvalRevision:{contract:'controlsbench.w4-full-proof-approval.v4',previousAggregateCeilingUsd:145,authorizedCreditPoolUsd:150,status:'User authorized available credits to prove the product',instruction:"we have only spent $7 during all of our development of a 150 set of credits so lets go full send to prove our shit. we don't need to worry abotu spend limits"},
  maximumModelRequests:turns,maximumNewConservativeUsd:maximumNew,aggregateConservativeCeilingUsd:aggregate,sessionHardUsd:150,maximumOutputTokens:16000,maxTransientRetries:5,maxRejectedDecisions:3,retryDecisionTransport:true,admissionMode:'context_ceiling',
  sessionBaseline:{conservativeUsd:baseline,sha256:hash(accountBytes)},model:'muse-wonder-1.0',reasoning:'high',mode:'Standard',perRequestAdmissionUsd:5,requestTimeoutMs:300000,
  categories:['faults','adaptive'],objective,
  recordedPriorProof:{kind:'recorded_prior_trial',evidenceClass:'preserved_live_plc',liveNow:false,campaignId:prior.campaignId,auditSha256:hashFile(join(priorDirectory,'expanded-trial-audit.json')),
    finding:prior.findings[0],boundary:'Historical normal-sort observation only. Prior evidence IDs are not current-campaign IDs. No prior fault or adaptive physical test passed.'},
  repositoryRoot:commonWonderPaths().root,campaignArtifactRoot:join(directory,'live-host'),
  launchConfiguration:{path:configRelative,sha256:hashFile(configurationPath)},launchSourceHashes:Object.fromEntries(launchFiles.map(f=>[f,hashFile(join(root,f))])),
  originalApproval:{packetSha256:hashFile(join(original,'packet.json')),authorizationSha256:hashFile(join(original,'authorization.json')),historicalAggregateCeilingUsd:12,supersededByUserCreditAuthorization:true,alreadySpentConservativeUsd:baseline},
  dataTransfer:json(join(original,'packet.json')).dataTransfer,
  previousHost:{pid:21872,pinDirectoryName:'w4-cadence-runtime-pin',packetDirectoryName:'2026-11-03T04-08-28-478Z',expectedCampaignId:'portal-20261103041023645-1'},
  priorRecovery:{path:'active-contradiction',reference:'artifacts/w4-paid/2026-11-03T04-08-28-478Z/live-host/runs/2026-11-03T04-09-01-158Z-live_plc/portal-host/portal-20261103041023645-1',heldStateSha256:hashFile(join(root,'artifacts/w4-paid/2026-11-03T04-08-28-478Z/live-host/runs/2026-11-03T04-09-01-158Z-live_plc/portal-host/portal-20261103041023645-1/held-state.json'))},
  hostObserver:{captureIntervalMs:2000,reason:'Reduce screenshot observer load; PLC I/O target stays 100 ms and 300 ms observation bound stays unchanged'},
  limits:`Up to ${turns} direct generation requests, each with a full-context $5 reservation: at most $${maximumNew} new/$${aggregate} aggregate conservative accounting under the $150 credit authorization. Prior $${baseline} conservative history remains exact. This is not billed spending. No token-count endpoint dependency: 1,048,576 input tokens + 16,000 output tokens at documented rates cost at most $4.514304. Actual usage is reported separately. All attempts remain counted. No uncertain physical effect is retried.`,
  recovery:'Dispose exact child, preserve original report/held-state. Native recovery is read-only until exact saved-state match and explicit recorded reconciliation.',
  proofBoundary:'Current source-bound rejection/admission/retry/cadence qualification is linked by the launch configuration. Confirmed PLC rejections retain original ack/evidence and do not poison the connector. Uncertain writes still quarantine. World physics, PLC logic, raw-signal semantics, 100 ms start cadence and 300 ms bound remain unchanged. Fresh zero-model bench commissioning must pass before paid Start.'};
const freshBootArg=process.argv.find(x=>x.startsWith('--fresh-boot='));
if(freshBootArg) {
  const bootIdentity=freshBootArg.slice('--fresh-boot='.length);assert(/^\d{10,20}$/.test(bootIdentity));
  delete packet.priorRecovery;
  packet.freshBaseline={bootIdentity,reason:'User restarted the stopped Control Win service; fresh read-only observer showed Stopped/fault 0/no item/no pending completion/motor off',boundary:'Previous held record is preserved and was not reconciled across the changed boot'};
}
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
  const provider=new WonderResponsesProvider({apiKey:'offline-preview-not-a-key',explicitlyAuthorized:true,maxCalls:turns,maxOutputTokens:16000,maxTransientRetries:5,retryDecisionTransport:true,requestAdmissionUsd:5,admissionMode:'context_ceiling',
    journal:fileExchangeJournal(join(directory,'preview-http.jsonl')),fetch:async(url,init)=>{
      if(String(url).endsWith('input_tokens'))return Response.json({input_tokens:0});
      request=JSON.parse(init.body);throw Error('OFFLINE_PREVIEW_CAPTURE_ONLY');
    }});
  const worldManifest=json(join(pinned,'artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json'));
  const runtime=new CampaignRuntime({ledger,provider,driver:session.driver,controller:session.controller,paidAuthorized:true,maxTransientRetries:5,maxRejectedDecisions:3,requireDecisionLeases:true,
    evidenceClass:'fake_connector',claimBoundary:'Preview with no initialization, no PLC/model contact',categories:packet.categories,provenance:session.provenance,
    spec:readFileSync(join(pinned,'docs/conveyor-machine-spec.md'),'utf8'),signals:[...worldManifest.signals,...session.process.loaded.observedOutputIds.filter(id=>!worldManifest.signals.some(s=>s.id===id)).map(id=>({id,direction:'plc_to_world'}))],
    capabilities:{semantic:session.driver.binding.describe,observations:session.process.loaded.observedOutputIds,decisionLeases:['hold','continue','condition_deadline']}});
  Object.assign(runtime.budget.guard.limits,{perRequestUsd:5,campaignHardUsd:105,sessionHardUsd:150});configureBoundedRuntime(runtime,packet);
  await assert.rejects(()=>provider.decide(runtime.agentContext(),new AbortController().signal),/OFFLINE_PREVIEW_CAPTURE_ONLY/);
  assert.equal(request.max_output_tokens,16000);assert.equal(JSON.parse(request.input.at(-1).content[0].text).providerBudget.maxDecisions,turns);
  writeFileSync(join(directory,'example-request.json'),JSON.stringify(request,null,2)+'\n');
}finally{await session.dispose();ledger.close();}
writeFileSync(join(directory,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
const packetSha256=hashFile(join(directory,'packet.json'));
writeFileSync(join(directory,'authorization.json'),JSON.stringify({status:'approved-full-proof-work',instruction:packet.approvalRevision.instruction,packetSha256,authorizedCreditPoolUsd:150,maximumNewConservativeUsd:maximumNew,aggregateConservativeCeilingUsd:aggregate,previousConservativeUsd:baseline,recordedAtIso:new Date().toISOString()},null,2)+'\n');
writeFileSync(join(root,'artifacts/w4-paid/latest.json'),JSON.stringify({status:'direct-generation-ready-for-bench-check',directory,packetSha256,previousConservativeUsd:baseline,maximumNewConservativeUsd:maximumNew,aggregateConservativeCeilingUsd:aggregate,authorizedCreditPoolUsd:150,maxTransientRetries:5,retryDecisionTransport:true,admissionMode:'context_ceiling'},null,2)+'\n');
console.log(JSON.stringify({directory,packetSha256,maximumNewConservativeUsd:maximumNew,authorizedCreditPoolUsd:150,realApiRequests:0,realPlcConnections:0}));
