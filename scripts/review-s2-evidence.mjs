// Reproduce the original-transport checks backing the separately reviewed screens.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {byLogical} from '../src/live/m8-map.ts';
const directory=resolve(process.argv[2]),packetDirectory=resolve(process.argv[3]);
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,''));
const lines=p=>readFileSync(join(directory,p),'utf8').trim().split('\n').map(JSON.parse);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const events=lines('campaign.jsonl'),byId=new Map(events.map(e=>[e.id,e]));
const audit=json(join(directory,'s2-audit.json')),held=json(join(directory,'held-state.json'));
const transport=lines('wonder-process/child-transport.jsonl'),child=lines('wonder-process/child-stream.jsonl');
const lifecycle=lines('wonder-process/child-lifecycle.jsonl'),closed=lifecycle.at(-1);
assert.equal(closed.kind,'closed');assert.equal(closed.ownership,'released');assert.equal(closed.drained,true);assert.deepEqual(closed.uncertainWrites,[]);
assert.equal(existsSync(join(json(join(packetDirectory,'packet.json')).repositoryRoot,'artifacts/m10/live.lock')),false);
const nativeClaims=[];
for(const finding of json(join(directory,'report.json')).findings)for(const claim of finding.claims){
  const output=byId.get(claim.evidenceId),source=byId.get(output.data.sourceId).data.source;
  assert(child.some(e=>e.record.kind==='source'&&JSON.stringify(e.record.event)===JSON.stringify(source)));
  const observation=transport.find(e=>e.kind==='observation'&&e.observation.plcCycle===output.data.plcCycle&&e.observation.values[claim.signal]===claim.equals);
  assert(observation,'Missing original native observation');
  const path=byLogical.get(claim.signal).iecPath;
  const read=transport.find(e=>e.kind==='opc.read'&&e.samples['GVL_BenchRead.PlcCycle']?.value===output.data.plcCycle&&e.samples[path]?.value===claim.equals&&e.samples[path].status==='Good (0x00000000)');
  assert(read,'Missing same-cycle native OPC sample');
  nativeClaims.push({evidenceId:claim.evidenceId,signal:claim.signal,equals:claim.equals,plcCycle:output.data.plcCycle,nativeObservedAtIso:observation.atIso,nativeReadAtIso:read.atIso,path});
}
const observerPath=join(packetDirectory,'final-observer.json'),observer=json(observerPath),values=observer.snapshot.values;
assert.equal(observer.link.state,'connected');assert.equal(observer.link.bootIdentity,held.plc.bootIdentity);
for(const [name,expected]of Object.entries({Mode:0,FaultCode:0,Motor_RunCmd:false,ItemActive:false,CompletionPending:false,OfferPending:false})){
  const v=values['GVL_DemoRead.Status.'+name];assert.equal(v.good,true);assert.equal(v.value,expected);
}
assert(Date.parse(observer.snapshot.receivedAtIso)>Date.parse(held.stoppedAtIso));
assert.equal(values['GVL_BenchRead.AppliedSequence'].value,held.plc.appliedSequence);
assert.equal(values['GVL_BenchRead.AppliedEpoch'].value,held.plc.appliedEpoch);
const reviewedFrames=['2-2-action.jpg','2-3-action.jpg','3-current.jpg','4-2-action.jpg'].map(file=>({file:'vision-frames/'+file,sha256:sha(join(directory,'vision-frames',file))}));
const review={status:'pass_with_limitations',scope:'Muse browser HMI operation and UI-01/UI-02/UI-03 screen checks against live M8',
  reviewedAtIso:new Date().toISOString(),campaignId:audit.campaignId,auditSha256:sha(join(directory,'s2-audit.json')),finalObserverSha256:sha(observerPath),
  originalChildAndTransportClaimsVerified:nativeClaims.length,nativeClaims,reviewedFrames,
  screenReview:{'UI-01':'Supported: visible stable controls, applied Start/Stop/Reset and explicit Auto readback limitation.',
    'UI-02':'Supported for the captured transitions: RUN command/STOPPED feedback after Start, OFF command/RUNNING feedback during coast after Stop.',
    'UI-03':'Supported by received frame :2798 (3-current.jpg): Faulted, F10 Drive overload, red fault banner and motor off. Extra :2783 was captured but its pixels were not sent to Muse; that citation is excluded from this engineering conclusion.',
    'UI-04':'Inconclusive: no stale/unknown/WCS-disconnect stimulus. No coverage pass claimed.'},
  citationDefects:audit.unseenAssessmentFrames,allModelCitationsValid:false,
  firstAttempt:'The preceding one-request attempt stopped on a real PLC heartbeat lapse before any HMI action. It remains partial. Retry reduced observer load only; physical engine, world, PLC and timing bounds were unchanged.',
  finalPlc:'Fresh same-boot read confirms Stopped, fault0, motor off, no item/offer/completion; retained simulation image at rest. ConnectorStale after child exit is expected bench diagnostic.',
  ownership:{childClosed:true,drained:true,lockReleased:true,inFlightCommands:held.inFlightCommands,inFlightCommit:held.inFlightCommit,outstandingWrites:held.outstandingWrites},
  modelRequests:audit.modelRequests,estimatedUncachedTokenCostUsd:audit.estimatedUncachedTokenCostUsd,
  claimBoundary:'Scoped HMI operation proof passed with a report citation defect. Not all HMI requirements passed; not arbitrary-HMI navigation, native CODESYS WebVisu, exhaustive alarms or physical hardware validation.'};
writeFileSync(join(directory,'engineering-review.json'),JSON.stringify(review,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:review.status,nativeClaims:nativeClaims.length,reviewedFrames:reviewedFrames.length,citationDefects:review.citationDefects.length}));
