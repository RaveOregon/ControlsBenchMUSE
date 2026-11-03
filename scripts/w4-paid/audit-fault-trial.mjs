// Offline audit of the first fault trial, including its rejected second decision.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
process.env.CONTROLSBENCH_W4_LAUNCH_CONFIG=fileURLToPath(new URL('../../artifacts/w4-readiness/retry-62a1d8c/launch.json',import.meta.url));
const s=await import('./support.mjs');
const {digest}=await s.fromPin('src/campaign/ledger.ts');
const directory=resolve(process.argv[2]),record=s.json(join(directory,'held-state.json')),saved=s.json(join(directory,'result.json'));
assert.equal(s.hashFile(join(directory,'held-state.json')),saved.heldState.sha256);
for(const[f,h]of Object.entries(record.evidence))assert.equal(s.hashFile(join(directory,f)),h);
const events=s.readLedger(join(directory,'campaign.jsonl')),report=s.report(events);
assert.deepEqual(report,s.json(join(directory,'report.json')));
const exchanges=s.readJsonl(join(directory,'wonder-exchanges.jsonl'));
for(const x of exchanges.filter(x=>x.phase==='response'))assert.equal(digest(x.responseText),x.responseHash);
const requests=exchanges.filter(x=>x.phase==='request'&&x.endpoint==='responses').map(x=>JSON.parse(x.requestText));
const responses=exchanges.filter(x=>x.phase==='response'&&x.endpoint==='responses').map(x=>JSON.parse(x.responseText));
assert.equal(requests.length,2);assert.equal(responses.length,2);responses.forEach(r=>assert.equal(r.status,'completed'));
assert.equal(requests[1].previous_response_id,responses[0].id);
assert.equal(requests[1].input.find(x=>x.type==='function_call_output').call_id,responses[0].output.find(x=>x.type==='function_call').call_id);
const paired=JSON.parse(requests[1].input.find(x=>x.type==='function_call_output').output).results;
for(const r of paired) {
  const e=events.find(e=>e.type==='action.'+r.status&&e.data.actionId===r.actionId);assert(e);
  for(const k of ['actionId','status','message','evidenceRefs','value'])assert.deepEqual(r[k],e.data[k]);
}
const decision=JSON.parse(responses[1].output.find(x=>x.type==='function_call').arguments);
const finding=decision.calls.find(x=>x.name==='record_finding').arguments;
for(const claim of finding.claims) {
  const e=events.find(e=>e.id===claim.evidenceId);assert.equal(e?.type,'plc.output');assert.deepEqual(e.data.values[claim.signal],claim.equals);
}
const rejectedRefs=decision.completeExperiment.evidenceRefs.filter(id=>events.find(e=>e.id===id)?.visibility!=='public');
assert.deepEqual(rejectedRefs,[record.campaignId+':932']);assert.equal(events.find(e=>e.id===rejectedRefs[0]).type,'fault.truth');
const refusal=events.find(e=>e.type==='campaign.state'&&String(e.data.reason).startsWith('Invalid agent decision: Evidence is absent'));
assert(refusal);const secondResponse=events.findLast(e=>e.type==='agent.request'&&e.data.phase==='completed');
assert(!events.some(e=>e.sequence>secondResponse.sequence&&e.type==='action.requested'),'Rejected decision must apply no cleanup/follow-up effects');
assert(events.some(e=>e.type==='action.applied'&&e.data.actionId==='c-inject-drivefb-501'));
assert(events.some(e=>e.type==='plc.output'&&e.data.values['controller.FaultCode']===12&&e.data.values.Motor_RunCmd===false));
const status=s.json(join(directory,'feedback-loss-recovery-status.json'));assert.equal(status.status,'pass');
const recovery=s.json(join(status.recoveryDirectory,'result.json'));assert.equal(recovery.status,'pass');assert.equal(recovery.ownershipAfter,'released');
assert.equal(s.hashFile(join(status.recoveryDirectory,'transport.jsonl')),recovery.transportSha256);
assert.deepEqual(recovery.final.stoppedBaselineMismatches,[]);
const usage=responses.map(r=>({responseId:r.id,...r.usage}));
const audit={status:'partial',verifiedAtIso:new Date().toISOString(),campaignId:record.campaignId,ledgerEvents:events.length,
  originalEvidenceHashesVerified:Object.keys(record.evidence).length,responseHashesVerified:exchanges.filter(x=>x.phase==='response').length,
  reportReconstructedExactly:true,responseToolLineageVerified:true,exactTerminalResultsVerified:paired.length,
  realFaultInjected:'fault.setDriveFeedbackFailure',observedFault:{code:12,text:'Motor running feedback lost',motorCommand:false},
  rejectedDecision:{reason:refusal.data.reason,wrongVisibilityRefs:rejectedRefs,physicalEffectsApplied:false,proposedFindingExactPlcClaimsVerified:finding.claims.length,
    findingAccepted:false,followupChosen:decision.calls.find(x=>x.name==='create_followup_experiment').arguments,followupExecuted:false},
  modelGenerationAttempts:2,usage,estimatedUncachedTokenCostUsd:usage.reduce((n,r)=>n+(r.input_tokens*4+r.output_tokens*20)/1e6,0),
  billingBoundary:'Token estimate at documented Standard rates, no cache discount; not actual invoiced balance',conservativeNewUsd:2,conservativeAggregateUsd:12,
  authorization:'Engineer authorized available $150 credit pool; historical ten conservative charges preserved',
  recovery:{directory:status.recoveryDirectory,resultSha256:s.hashFile(join(status.recoveryDirectory,'result.json')),transportSha256:recovery.transportSha256,final:recovery.final},
  claimBoundary:'Declared physical fault and real PLC response proved; model selected but did not execute its follow-up. No full W4 pass or agent HMI-operation claim.'};
writeFileSync(join(directory,'fault-trial-audit.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:audit.status,events:events.length,exactClaims:finding.claims.length,fault:12,followupExecuted:false,recovered:true}));
