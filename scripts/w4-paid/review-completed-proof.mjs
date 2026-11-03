// Source-to-wire checks plus an explicit scoped engineering review of this run.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const directory=resolve(process.argv[2]),packetDirectory=resolve(process.argv[3]);
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const lines=p=>readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const audit=json(join(directory,'campaign-audit.json')),events=lines(join(directory,'campaign.jsonl')),byId=new Map(events.map(e=>[e.id,e]));
const held=json(join(directory,'held-state.json')),final=json(join(packetDirectory,'final-observer.json'));
assert.equal(audit.status,'completed_candidate_for_engineering_review');assert.equal(audit.groundedFindings,2);assert.equal(audit.exactPlcClaimsVerified,31);
assert.deepEqual(audit.failures,[]);assert.deepEqual(audit.observedFaultCodes,[12,21]);assert.equal(audit.followups.length,1);
const raw=lines(join(directory,'wonder-process/child-transport.jsonl'));
const receipts=new Map(raw.filter(e=>e.kind==='commit.acknowledged').map(e=>[`${e.receipt.workstationEpoch}/${e.receipt.workstationSequence}`,e.receipt]));
const childSources=new Set(lines(join(directory,'wonder-process/child-stream.jsonl')).filter(e=>e.record.kind==='source').map(e=>JSON.stringify(e.record.event)));
let verified=0;
for(const finding of json(join(directory,'report.json')).findings)for(const claim of finding.claims){
  const output=byId.get(claim.evidenceId),source=byId.get(output.data.sourceId).data.source,d=source.data;
  assert(childSources.has(JSON.stringify(source)),'Cited observation must be an original child source');
  const receipt=receipts.get(`${d.workstationEpoch}/${d.workstationSequence}`);assert(receipt);
  assert.equal(receipt.bootIdentity,held.plc.bootIdentity);assert.equal(receipt.plcCycle,output.data.plcCycle);
  assert.equal(receipt.outputCaptureCycle,receipt.plcCycle);assert.deepEqual(receipt.values[claim.signal],claim.equals);verified++;
}
const firstPlan=events.find(e=>e.type==='plan.created'),followup=events.find(e=>e.type==='followup.added');
assert(firstPlan.sequence<followup.sequence);assert(!firstPlan.data.experiments.some(e=>e.id===followup.data.experiment.id));
assert(followup.data.evidenceRefs.every(id=>byId.get(id)?.type==='plc.output'&&byId.get(id).sequence<followup.sequence));
const physical=audit.followups[0].physicalActions;assert(physical.some(a=>a.name==='inject_fault'&&a.terminal==='action.applied'));
assert(physical.some(a=>a.name==='clear_fault'&&a.terminal==='action.applied'));assert(physical.some(a=>a.name==='operator_action'&&a.arguments.action==='reset'&&a.terminal==='action.applied'));
assert(audit.experiments.every(e=>e.status==='completed'));assert.equal(final.link.state,'connected');assert.equal(final.link.bootIdentity,held.plc.bootIdentity);
for(const[key,value]of Object.entries({ModeText:'Stopped',FaultCode:0,ItemActive:false,CompletionPending:false,OfferPending:false,Motor_RunCmd:false})){
  const sample=final.state.find(s=>s.name===key).sample;assert.equal(sample.good,true);assert.deepEqual(sample.value,value);
}
assert.deepEqual(held.inFlightCommands,[]);assert.equal(held.inFlightCommit,null);assert.deepEqual(held.outstandingWrites.atClose,[]);assert.equal(held.outstandingWrites.childClosed,true);
assert.equal(existsSync(resolve('../../artifacts/m10/live.lock')),false);
const review={status:'pass',scope:'live-m8-fault-and-evidence-dependent-physical-followup',campaignId:audit.campaignId,reviewedAtIso:new Date().toISOString(),
  auditSha256:sha(join(directory,'campaign-audit.json')),finalObserverSha256:sha(join(packetDirectory,'final-observer.json')),
  originalChildAndTransportClaimsVerified:verified,modelRequests:audit.requests,modelServiceRetries:audit.serviceRetriesScheduled,
  priorNormalOperation:'Historical normal-sort proof is labelled separately in the packet; it was not repeated in this campaign.',
  engineeringReview:{novelty:'The initial plan contained only drive-feedback failure. After observing fault12 and clean recovery, Muse proposed a distinct D1-limit contradiction test, explicitly generalizing the observed feedback-inconsistency response. Its cited current observations predate the proposal. This is a modest evidence-dependent extension, not discovery of an unknown fault.',
    execution:'Start, contradictory-limit injection, clear and Reset all executed in the newly active follow-up; native receipts and original child observations support both distinct fault21 and recovery. No human intervention occurred during the campaign.',
    limitations:['The first proposed same-turn follow-up actions were refused before activation; observation waits timed out. Muse corrected this in the next turn. Those attempts remain in the evidence.',
      'No carton was introduced for the D1 follow-up; misrouting and divert timing were not tested.',
      'The first fault was running-feedback loss (12), not the startup-feedback deadline. Detection deadlines are not established.',
      'The world retains one stationary virtual carton while the PLC has no tracked item. No world cleanup is represented as physical travel.',
      'The new confirmed-PLC-rejection handling passed offline tests but was not exercised by a PLC rejection in this successful run.',
      'Muse HMI operation remains a later checkpoint; these were semantic engine/controller tools.']},
  estimatedUncachedTokenCostUsd:audit.estimatedKnownUncachedTokenCostUsd,billingBoundary:audit.billingBoundary,
  claimBoundary:'Scoped fault/adaptive checkpoint passed; not a repeat of normal sorting, HMI-agent proof, exhaustive controller validation or general machine coverage.'};
writeFileSync(join(directory,'engineering-review.json'),JSON.stringify(review,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:review.status,scope:review.scope,verified,requests:audit.requests,estimatedUncachedTokenCostUsd:review.estimatedUncachedTokenCostUsd}));
