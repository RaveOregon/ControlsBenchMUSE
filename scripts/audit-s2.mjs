// Offline S2 audit. Model screen interpretations remain separately reviewable.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {readLedger,report,digest} from '../src/campaign/ledger.ts';
import {verifyJournal,HmiJournal} from '../src/hmi/journal.ts';
const directory=resolve(process.argv[2]),packetDirectory=resolve(process.argv[3]);
const json=p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')),lines=p=>readFileSync(p,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const held=json(join(directory,'held-state.json')),result=json(join(directory,'result.json')),packet=json(join(packetDirectory,'packet.json'));
assert.equal(sha(join(directory,'held-state.json')),result.heldState.sha256);assert.equal(result.scope,'live-m8-hmi');
for(const[p,h]of Object.entries(held.evidence))assert.equal(sha(join(directory,p)),h);
const events=readLedger(join(directory,'campaign.jsonl')),byId=new Map(events.map(e=>[e.id,e])),saved=json(join(directory,'report.json'));
assert.deepEqual(JSON.parse(JSON.stringify(report(events))),saved);assert.equal(saved.evidenceClass,'live_plc');
const prefix=join(directory,'hmi-journal-prefix.jsonl');verifyJournal(prefix);const hmi=lines(prefix),hmiByRef=new Map(hmi.map(e=>[HmiJournal.ref(e),e]));
const exchanges=lines(join(directory,'wonder-exchanges.jsonl')),seenImages=new Set(),responses=exchanges.filter(e=>e.phase==='response'&&e.endpoint==='responses');
let previous,callId,paired=0;const failures=[];let verifiedImages=0;
for(const request of exchanges.filter(e=>e.phase==='request'&&e.endpoint==='responses')){
  const body=JSON.parse(request.requestText);assert.equal(body.previous_response_id,previous);
  if(callId){const output=body.input.find(x=>x.type==='function_call_output');assert.equal(output.call_id,callId);
    for(const r of JSON.parse(output.output).results){const terminal=events.find(e=>e.data.actionId===r.actionId&&e.type===`action.${r.status}`);assert(terminal);assert.deepEqual(terminal.data,r);paired++;}}
  for(const item of body.input.filter(i=>i.role==='user'))for(let i=0;i<item.content.length;i++)if(item.content[i].type==='input_image'){
    const metadata=JSON.parse(item.content[i-1].text).hmiFrame,bytes=Buffer.from(item.content[i].image_url.split(',')[1],'base64'),hash=createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash,metadata.sha256);const frame=byId.get(metadata.evidenceId);assert.equal(frame?.type,'hmi.evidence');assert.equal(frame.data.reference,metadata.reference);assert.equal(frame.data.receipt.sha256,hash);
    assert.equal(sha(join(directory,frame.data.receipt.file)),hash);assert(hmi.some(e=>e.type==='portal.frame'&&e.data.reference===metadata.reference&&e.data.sha256===hash));seenImages.add(frame.id);verifiedImages++;
  }
  const response=responses.find(e=>e.turn===request.turn);if(!response){failures.push({turn:request.turn,type:'unreturned_generation'});continue;}
  assert.equal(digest(response.responseText),response.responseHash);const r=JSON.parse(response.responseText);
  if(response.httpStatus!==200||r.status!=='completed'){failures.push({turn:request.turn,httpStatus:response.httpStatus,status:r.status,error:r.error});continue;}
  const calls=r.output.filter(x=>x.type==='function_call');assert.equal(calls.length,1);assert.equal(calls[0].name,'campaign_decision');previous=r.id;callId=calls[0].call_id;
}
const actionEvidence=events.filter(e=>e.type==='hmi.action'),verifiedActions=[];
for(const event of actionEvidence){const {action,command}=event.data.receipt;
  assert.equal(event.data.reference,action.reference);assert(hmi.some(e=>e.type==='agent.action.requested'&&e.data.reference===action.reference&&e.data.targetId===event.data.action));
  if(!action.delivered)continue;
  assert(hmi.some(e=>e.type==='agent.action.delivered'&&e.data.reference===action.reference));
  if(!action.pageInput)continue;
  assert.equal(action.pageInput.isTrusted,true);assert.equal(action.pageInput.hitTarget,event.data.action);
  const input=hmiByRef.get(action.pageInput.reference);assert.equal(input?.type,'ui.input');assert.equal(input.data.isTrusted,true);assert.equal(input.data.target,event.data.action);
  assert(hmi.some(e=>e.type==='agent.action.screen'&&e.data.reference===action.reference&&e.data.screen.frameRef===action.screen.frameRef));
  if(command){
    const terminal=hmi.find(e=>e.type===`command.${command.outcome}`&&e.data.requestId===command.requestId);assert(terminal);assert.equal(terminal.data.origin,'agent_seam');
    assert.equal(terminal.data.expectedSequence,command.expectedSequence);assert.equal(terminal.data.accepted,command.accepted);
    if(command.outcome==='applied'&&['start','stop','reset'].includes(command.action)){
      const echo=terminal.data.confirmation[`GVL_DemoRead.Status.${command.action[0].toUpperCase()+command.action.slice(1)}Ack`];assert.equal(echo.good,true);assert.equal(echo.value,command.expectedSequence);
      if(command.action!=='stop')assert.equal(command.accepted,true);
      assert(action.screen.renderedStatus?.startsWith('page rendered:'));
      assert(hmi.some(e=>e.type==='ui.rendered'&&e.data.requestId===command.requestId&&e.data.outcomeShown==='applied'));
      assert(exchanges.some(e=>e.phase==='vision.input'&&e.reference===action.screen.frameRef),'Agent must receive actual action-result pixels');
      verifiedActions.push({eventId:event.id,action:command.action,requestId:command.requestId,frameRef:action.screen.frameRef});
    }
  }
}
const assessments=events.filter(e=>e.type==='hmi.assessment'),unseenAssessmentFrames=[];
for(const assessment of assessments){const a=assessment.data;
  for(const id of a.frameEvidenceRefs){assert.equal(byId.get(id)?.type,'hmi.evidence');if(!seenImages.has(id))unseenAssessmentFrames.push({assessmentId:assessment.id,frameId:id});}
  assert(a.frameEvidenceRefs.some(id=>seenImages.has(id)),'Assessment has no pixels sent to Muse');
  for(const id of a.actionEvidenceRefs)assert.equal(byId.get(id)?.type,'hmi.action');
  for(const id of a.plcEvidenceRefs)assert.equal(byId.get(id)?.type,'plc.output');
}
let exactClaims=0;for(const finding of saved.findings)for(const c of finding.claims){const e=byId.get(c.evidenceId);assert.equal(e.type,'plc.output');assert.deepEqual(e.data.values[c.signal],c.equals);exactClaims++;}
const charges=lines(join(packet.repositoryRoot,'artifacts/wonder/session.jsonl')).filter(c=>c.campaignId===saved.campaignId);assert(charges.length<=packet.maximumRequests);assert(charges.every(c=>c.costUsd===5));
const required=['start','stop','reset'],missingActions=required.filter(a=>!verifiedActions.some(x=>x.action===a)),missingAssessments=['UI-01','UI-02','UI-03','UI-04'].filter(id=>!assessments.some(a=>a.data.requirementId===id));
const state=held.lastObservation.values,clean=state['controller.Mode']===0&&state['controller.FaultCode']===0&&state.Motor_RunCmd===false&&state['controller.ItemActive']===false&&state['controller.CompletionPending']===false;
const direct=events.filter(e=>e.type==='controller.action'&&['start','stop','reset'].includes(e.data.action));assert.equal(direct.length,0,'Operator control must use HMI, not direct semantic PLC commands');
const audit={status:saved.status==='completed'&&!missingActions.length&&!missingAssessments.length&&clean?(unseenAssessmentFrames.length?'reference_review_required':'candidate_for_screen_review'):'partial',campaignId:saved.campaignId,verifiedAtIso:new Date().toISOString(),
  originalEvidenceHashes:Object.keys(held.evidence).length,verifiedImages,verifiedHmiActions:verifiedActions,missingActions,missingAssessments,exactPlcClaims:exactClaims,
  assessments:assessments.map(e=>({eventId:e.id,...e.data})),unseenAssessmentFrames,allAssessmentFrameCitationsViewed:unseenAssessmentFrames.length===0,pairedResults:paired,modelRequests:charges.length,failures,finalRecordedPlcClean:clean,
  inFlightCommands:held.inFlightCommands,inFlightCommit:held.inFlightCommit,outstandingWrites:held.outstandingWrites,
  estimatedUncachedTokenCostUsd:responses.reduce((n,e)=>{const u=JSON.parse(e.responseText).usage;return n+(u?(u.input_tokens*4+u.output_tokens*20)/1e6:0);},0),
  conservativeNewUsd:charges.reduce((n,c)=>n+c.costUsd,0),conservativeAggregateUsd:charges.at(-1)?.totalUsd,
  claimBoundary:'Exact frames were sent to Muse; trusted browser inputs, rendered outcomes and PLC acknowledgements are preserved. Pixel interpretations require separate review; inconclusive UI coverage remains inconclusive.'};
assert(!existsSync(join(directory,'s2-audit.json')));writeFileSync(join(directory,'s2-audit.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(audit,null,2));
