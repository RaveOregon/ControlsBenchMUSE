// Offline evidence verification. A completed campaign remains a candidate for
// engineering review; exact claims alone do not prove its inferences/coverage.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const directory=resolve(process.argv[2]),configuration=resolve(process.argv[3]);
process.env.CONTROLSBENCH_W4_LAUNCH_CONFIG=configuration;
const s=await import('./support.mjs'),{digest}=await s.fromPin('src/campaign/ledger.ts');
const held=s.json(join(directory,'held-state.json')),result=s.json(join(directory,'result.json')),approval=s.json(join(directory,'w4-approval.json'));
assert.equal(s.hashFile(join(directory,'held-state.json')),result.heldState.sha256);
for(const[f,h]of Object.entries(held.evidence))assert.equal(s.hashFile(join(directory,f)),h);
const events=s.readLedger(join(directory,'campaign.jsonl')),report=s.report(events);assert.deepEqual(report,s.json(join(directory,'report.json')));
const exchanges=s.readJsonl(join(directory,'wonder-exchanges.jsonl'));
for(const e of exchanges.filter(e=>e.phase==='response'))assert.equal(digest(e.responseText),e.responseHash);
const requests=exchanges.filter(e=>e.phase==='request'&&e.endpoint==='responses');let head,callId,pairedResults=0;
const responses=[],failures=[];
for(const turn of [...new Set(exchanges.map(x=>x.turn))]) {
  if(requests.some(x=>x.turn===turn))continue;
  const failed=exchanges.findLast(x=>x.turn===turn&&['failed','retryable_decision_transport_error','retryable_service_error'].includes(x.phase));
  if(failed)failures.push({turn,type:'preflight_failed_no_generation_sent',phase:failed.phase,billing:'No generation request recorded; conservative reservation retained'});
}
for(const request of requests) {
  const body=JSON.parse(request.requestText);assert.equal(body.previous_response_id,head);
  assert.equal(body.max_output_tokens,approval.maximumOutputTokens);assert.equal(body.reasoning.effort,'high');
  if(callId) {
    const paired=body.input.find(x=>x.type==='function_call_output');assert.equal(paired.call_id,callId);
    for(const r of JSON.parse(paired.output).results) {
      const e=events.find(e=>e.type==='action.'+r.status&&e.data.actionId===r.actionId);assert(e);
      for(const k of ['actionId','status','message','evidenceRefs'])assert.deepEqual(r[k],e.data[k]);
      if(r.value?.omitted==='Result exceeds compact context; retrieve an exact evidence window')assert(JSON.stringify(e.data).length>48000);
      else assert.deepEqual(r.value,e.data.value);pairedResults++;
    }
  }
  const response=exchanges.find(e=>e.turn===request.turn&&e.phase==='response'&&e.endpoint==='responses');
  if(!response){failures.push({turn:request.turn,type:'generation_response_not_returned',billing:'unknown, retained conservatively'});continue;}
  const payload=JSON.parse(response.responseText);responses.push({turn:request.turn,httpStatus:response.httpStatus,...payload});
  if(response.httpStatus===200&&payload.status==='completed') {
    const calls=payload.output.filter(x=>x.type==='function_call');assert.equal(calls.length,1);head=payload.id;callId=calls[0].call_id;
  }else failures.push({turn:request.turn,httpStatus:response.httpStatus,error:payload.error,status:payload.status});
}
let claims=0;
for(const finding of report.findings)for(const claim of finding.claims) {
  const e=events.find(e=>e.id===claim.evidenceId);assert.equal(e?.type,'plc.output');assert.deepEqual(e.data.values[claim.signal],claim.equals);claims++;
}
const followups=events.filter(e=>e.type==='followup.added').map(e=>{
  const refs=e.data.evidenceRefs.map(id=>events.find(x=>x.id===id));assert(refs.every(x=>x&&x.visibility==='public'&&x.sequence<e.sequence));
  const physical=events.filter(x=>x.type==='action.requested'&&x.sequence>e.sequence&&x.data.experimentId===e.data.experiment.id
    &&['introduce_carton','assign_route','operator_action','inject_fault','clear_fault','set_downstream_readiness'].includes(x.data.name));
  return{eventId:e.id,...e.data,citedTypes:refs.map(x=>({id:x.id,type:x.type})),physicalActions:physical.map(x=>({id:x.data.actionId,name:x.data.name,arguments:x.data.arguments,
    terminal:events.find(y=>y.data.actionId===x.data.actionId&&y.type!=='action.requested'&&y.type.startsWith('action.'))?.type})),
    completion:events.find(x=>x.type==='experiment.completed'&&x.data.id===e.data.experiment.id)?.data};
});
const reservations=events.filter(e=>e.type==='budget.accounted'&&e.data.phase==='reserved');
const charges=s.readJsonl(s.commonWonderPaths().session).filter(e=>e.campaignId===held.campaignId);
assert.equal(charges.length,reservations.length);assert(charges.length<=approval.maximumModelRequests);
assert(charges.every(c=>c.costUsd===approval.perRequestAdmissionUsd));
const newUsd=charges.reduce((n,c)=>n+c.costUsd,0);assert(newUsd<=approval.maximumNewConservativeUsd);
const usage=responses.filter(r=>r.usage).map(r=>({turn:r.turn,responseId:r.id,...r.usage}));
const faultCodes=[...new Set(events.filter(e=>e.type==='plc.output').map(e=>e.data.values['controller.FaultCode']).filter(n=>n!==0))];
const faultActions=events.filter(e=>e.type==='action.requested'&&e.data.name==='inject_fault').map(e=>({eventId:e.id,...e.data,
  applied:events.some(x=>x.type==='action.applied'&&x.data.actionId===e.data.actionId)}));
let recovery;
for(const name of ['aborted-d1-jam','pending-runout','cleared-contradiction','feedback-loss','completed']) {
  let path=join(directory,name+'-recovery-status.json');if(!existsSync(path))path=join(directory,name+'-recovery-latest.json');if(!existsSync(path))continue;
  const status=s.json(path);if(status.status==='pass') {
    const recovered=status.recoveryDirectory??status.directory;
    const r=s.json(join(recovered,'result.json'));assert.equal(r.status,'pass');assert.equal(s.hashFile(join(recovered,'transport.jsonl')),r.transportSha256);
    assert.deepEqual(r.final.stoppedBaselineMismatches,[]);recovery={resultSha256:s.hashFile(join(recovered,'result.json')),directory:recovered,final:r.final};
  }
}
const audit={status:report.status==='completed'?'completed_candidate_for_engineering_review':'partial',verifiedAtIso:new Date().toISOString(),campaignId:held.campaignId,
  ledgerEvents:events.length,originalEvidenceHashesVerified:Object.keys(held.evidence).length,reportReconstructedExactly:true,responseHashesVerified:exchanges.filter(e=>e.phase==='response').length,
  responseToolLineageVerified:true,exactPairedTerminalResults:pairedResults,requests:reservations.length,generationRequests:requests.length,completedResponses:responses.filter(r=>r.status==='completed').length,
  failures,serviceRetriesScheduled:events.filter(e=>e.type==='agent.activity'&&e.data.phase==='provider_retry_scheduled').length,
  effectFreeDecisionCorrections:events.filter(e=>e.type==='agent.activity'&&e.data.phase==='decision_rejected').length,
  faultActions,observedFaultCodes:faultCodes,followups,groundedFindings:report.findings.length,exactPlcClaimsVerified:claims,experiments:report.experiments,
  assumptions:report.findings.flatMap(f=>f.assumptions),usage,estimatedKnownUncachedTokenCostUsd:usage.reduce((n,r)=>n+(r.input_tokens*4+r.output_tokens*20)/1e6,0),
  billingBoundary:'Known reported token usage only at documented uncached rates; actual invoices/caching differ. Failed and unreturned generations are not assumed free.',
  conservativeNewUsd:newUsd,conservativeAggregateUsd:charges.at(-1)?.totalUsd??approval.sessionBaseline.conservativeUsd,authorizedCreditPoolUsd:150,
  recovery,finalHeldObservation:held.lastObservation.values,claimBoundary:'Audit proves preserved evidence and exact claims. Review follow-up novelty, actual interventions and inferences before calling W4 passed. No agent HMI-operation or certified coverage claim.'};
writeFileSync(join(directory,'campaign-audit.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:audit.status,events:events.length,requests:reservations.length,faultCodes,followups:followups.length,claims,failures,conservativeAggregateUsd:audit.conservativeAggregateUsd}));
