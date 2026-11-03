// Offline reconstruction of the five-request trial that stopped on Meta HTTP 503.
import assert from 'node:assert/strict';
import {existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fromPin,json,hashFile,readLedger,readJsonl,report,commonWonderPaths} from './support.mjs';
const {digest}=await fromPin('src/campaign/ledger.ts');
const directory=resolve(process.argv[2]),record=json(join(directory,'held-state.json')),saved=json(join(directory,'result.json'));
assert.equal(hashFile(join(directory,'held-state.json')),saved.heldState.sha256);
for(const[f,h]of Object.entries(record.evidence))assert.equal(hashFile(join(directory,f)),h);
const events=readLedger(join(directory,'campaign.jsonl')),reconstructed=report(events);
assert.deepEqual(reconstructed,json(join(directory,'report.json')));
const exchanges=readJsonl(join(directory,'wonder-exchanges.jsonl'));
for(const x of exchanges.filter(x=>x.phase==='response'))assert.equal(digest(x.responseText),x.responseHash);
const requests=exchanges.filter(x=>x.phase==='request'&&x.endpoint==='responses').map(x=>JSON.parse(x.requestText));
const responses=exchanges.filter(x=>x.phase==='response'&&x.endpoint==='responses').map(x=>({httpStatus:x.httpStatus,...JSON.parse(x.responseText)}));
assert.equal(requests.length,3);assert.equal(responses.length,3);
assert.equal(responses[0].status,'completed');assert.equal(responses[1].status,'completed');
assert.equal(responses[2].httpStatus,503);assert.equal(responses[2].error.type,'server_error');assert.equal(responses[2].error.message,'persistence service error');
let terminalResults=0;
for(let i=0;i<requests.length;i++) {
  assert.equal(requests[i].max_output_tokens,8000);assert.equal(requests[i].reasoning.effort,'high');
  if(!i)continue;
  assert.equal(requests[i].previous_response_id,responses[i-1].id);
  const call=responses[i-1].output.find(x=>x.type==='function_call'),paired=requests[i].input.find(x=>x.type==='function_call_output');
  assert.equal(paired.call_id,call.call_id);
  for(const r of JSON.parse(paired.output).results) {
    const e=events.find(e=>e.type==='action.'+r.status&&e.data.actionId===r.actionId);assert(e);
    for(const k of ['actionId','status','message','evidenceRefs','value'])assert.deepEqual(r[k],e.data[k]);terminalResults++;
  }
}
let claims=0;
for(const finding of reconstructed.findings)for(const claim of finding.claims) {
  const e=events.find(e=>e.id===claim.evidenceId);assert.equal(e?.type,'plc.output');assert.deepEqual(e.data.values[claim.signal],claim.equals);claims++;
}
assert.equal(reconstructed.findings.length,1);assert.equal(claims,7);
const normal=reconstructed.experiments.find(e=>e.id==='EXP-NORMAL-A');assert.equal(normal.status,'completed');
assert.equal(record.world.injectedFaults.length,0,'No declared fault was physically injected');
const reservations=events.filter(e=>e.type==='budget.accounted'&&e.data.phase==='reserved');assert.equal(reservations.length,3);
const failed=events.find(e=>e.type==='agent.request'&&e.data.phase==='failed');assert(failed);
assert(!events.some(e=>e.sequence>failed.sequence&&e.type.startsWith('action.')),'No late failed decision effects');
const status=json(join(directory,'native-recovery-status.json'));assert.equal(status.status,'pass');
const recovery=json(join(status.recoveryDirectory,'result.json'));assert.equal(recovery.status,'pass');assert.equal(recovery.classification.path,'held-running');
assert.equal(hashFile(join(status.recoveryDirectory,'transport.jsonl')),recovery.transportSha256);assert.equal(recovery.ownershipAfter,'released');
assert.deepEqual(recovery.finalObservation.stoppedBaselineMismatches,[]);assert(!existsSync(commonWonderPaths().ownership));
const account=readJsonl(commonWonderPaths().session);assert.equal(account.at(-1).totalUsd,10);
const usage=responses.filter(r=>r.usage).map(r=>({responseId:r.id,inputTokens:r.usage.input_tokens,outputTokens:r.usage.output_tokens,reasoningTokens:r.usage.output_tokens_details.reasoning_tokens}));
const audit={status:'partial',verifiedAtIso:new Date().toISOString(),campaignId:record.campaignId,ledgerEvents:events.length,originalEvidenceHashesVerified:Object.keys(record.evidence).length,
  reportReconstructedExactly:true,responseHashesVerified:exchanges.filter(e=>e.phase==='response').length,responseToolLineageVerified:true,exactTerminalResultsVerified:terminalResults,
  groundedFindings:reconstructed.findings.length,exactPlcClaimsVerified:claims,normalExperiment:normal,assumptions:reconstructed.findings.flatMap(f=>f.assumptions),
  modelGenerationAttempts:3,successfulDecisions:2,maximumOutputTokens:8000,usage,
  estimatedKnownUncachedTokenCostUsd:usage.reduce((n,r)=>n+(r.inputTokens*4+r.outputTokens*20)/1e6,0),billingBoundary:'Estimate for the two reported usages only, no cache discount; 503 billing unknown, not assumed free',
  conservativeNewUsd:3,conservativeAggregateUsd:10,approvedAggregateCeilingUsd:12,remainingApprovedUsd:2,
  failure:{httpStatus:503,type:responses[2].error.type,message:responses[2].error.message,partialDecisionExecuted:false},
  recovery:{directory:status.recoveryDirectory,resultSha256:hashFile(join(status.recoveryDirectory,'result.json')),transportSha256:recovery.transportSha256,plan:recovery.classification.plan,final:recovery.finalObservation,ownershipAfter:recovery.ownershipAfter},
  claimBoundary:'Real normal sort, acknowledgement, evidence review and one grounded finding; no fault injection, adaptive physical follow-up, agent HMI operation or full W4 pass',
  next:'Handle retryable Meta service errors with exact lineage, lease validity and each attempt accounted before another paid trial. Preserve current $10 and remaining $2; do not reset or reuse the old packet.'};
writeFileSync(join(directory,'expanded-trial-audit.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:audit.status,events:events.length,claims,terminalResults,serverError:audit.failure,remainingApprovedUsd:2,recovered:true}));
