// Recovery of a completed normal sort left held while the model was reasoning.
// No model calls; the original campaign/evidence stays immutable. Inspect by default.
import assert from 'node:assert/strict';
import {appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {configuration, pinned, fromPin, json, hashFile, readLedger, readJsonl, recordedChildExited, commonWonderPaths} from './support.mjs';
const {AT_REST, classifyHeldState, inspectionConnection, summarizeInspection, baselineMismatches} = await fromPin('scripts/lib/w4-commissioning.ts');

export function completedHoldPlan(record, current) {
  const stock=classifyHeldState(record,current);
  assert.deepEqual(stock.refusals.filter(x=>x!=='held state matches a recorded W4 reconciliation path'),[], 'Original identity/image/counter/command checks must all match');
  assert.deepEqual(stock.differences,{},'Unobserved PLC change; no recovery');
  assert.equal(stock.matchedCommit,'last_acknowledged');
  assert.equal(record.inFlightCommit,null); assert.deepEqual(record.inFlightCommands,[]);
  assert.deepEqual(record.outstandingWrites.atClose,[]); assert.equal(record.outstandingWrites.childClosed,true);
  assert.deepEqual(record.world.cartons,[]); assert.deepEqual(record.world.injectedFaults,[]);
  const v=current.observation.values, c=k=>v[`controller.${k}`];
  assert.equal(c('Mode'),1); assert.equal(c('FaultCode'),0); assert.equal(c('ExceptionCode'),0);
  assert.equal(v.Motor_RunCmd,true); assert.equal(c('ItemActive'),false); assert.equal(c('CompletionPending'),true);
  assert.equal(c('CompletionItemId'),c('ActiveItemId')); assert.equal(c('CompletionDisposition'),1);
  assert.equal(c('CompletionExit'),1); assert.equal(c('CompletionRoute'),1); // This recorded A-sort path only.
  assert(Number.isInteger(c('CompletionSequence'))&&c('CompletionSequence')>0);
  assert.equal(c('CountFaulted'),record.lastObservation.values['controller.CountFaulted']);
  for(const [k,value] of Object.entries({...AT_REST,Drive_RunningFB:true,Drive_Overload:false}))assert.equal(current.activeImage[k],value,`Unexpected held input ${k}`);
  return [{op:'stop'},{op:'fresh_world'},{op:'completion_ack',sequence:c('CompletionSequence')},{op:'await_stopped'}];
}

/** Narrow recovery for this campaign's observed, fully settled feedback-loss
 * fault. This is bench cleanup, never evidence of the rejected agent's actions. */
export function feedbackLossPlan(record,current) {
  const stock=classifyHeldState(record,current);
  assert.deepEqual(stock.refusals.filter(x=>x!=='held state matches a recorded W4 reconciliation path'),[]);
  assert.deepEqual(stock.differences,{});assert.equal(stock.matchedCommit,'last_acknowledged');
  assert.equal(record.inFlightCommit,null);assert.deepEqual(record.inFlightCommands,[]);
  assert.deepEqual(record.outstandingWrites.atClose,[]);assert.equal(record.outstandingWrites.childClosed,true);
  assert.equal(record.world.injectedFaults.length,1);
  assert.equal(record.world.injectedFaults[0].controlId,'fault.setDriveFeedbackFailure');
  assert.deepEqual(record.world.injectedFaults[0].parameters,{active:true});assert.deepEqual(record.world.clearedFaults,[]);
  const v=current.observation.values,c=k=>v['controller.'+k];
  assert.equal(c('Mode'),3);assert.equal(c('FaultCode'),12);assert.equal(c('ExceptionCode'),0);
  assert.equal(c('ItemActive'),false);assert.equal(c('CompletionPending'),false);
  assert.equal(v.Motor_RunCmd,false);assert.equal(v.D1_ExtendCmd,false);assert.equal(v.D2_ExtendCmd,false);
  assert.equal(record.world.cartons.length,1);assert.equal(record.world.cartons[0].velocityMps,0);
  for(const[k,value]of Object.entries({...AT_REST,Drive_Overload:false,Belt_SpeedActual:0,Drive_Current:0}))assert.equal(current.activeImage[k],value);
  return [{op:'stop'},{op:'fresh_world'},{op:'reset'},{op:'await_stopped'}];
}

export function clearedContradictionPlan(record,current) {
  const stock=classifyHeldState(record,current);
  assert.deepEqual(stock.refusals.filter(x=>x!=='held state matches a recorded W4 reconciliation path'),[]);
  assert.deepEqual(stock.differences,{});assert.equal(stock.matchedCommit,'last_acknowledged');
  assert.equal(record.inFlightCommit,null);assert.deepEqual(record.inFlightCommands,[]);
  assert.deepEqual(record.outstandingWrites.atClose,[]);assert.equal(record.outstandingWrites.childClosed,true);
  assert.deepEqual(record.world.cartons,[]);assert.equal(record.world.injectedFaults.length,1);
  const fault=record.world.injectedFaults[0];assert.equal(fault.controlId,'fault.setContradictoryLimits');
  assert.deepEqual(fault.parameters,{divert:1,active:true});
  assert.equal(record.world.clearedFaults.length,1);assert.equal(record.world.clearedFaults[0].controlId,fault.controlId);
  const v=current.observation.values,c=k=>v['controller.'+k];
  assert.equal(c('Mode'),3);assert.equal(c('FaultCode'),21);assert.equal(c('ExceptionCode'),0);
  assert.equal(c('ItemActive'),false);assert.equal(c('CompletionPending'),false);assert.equal(c('OfferPending'),false);
  assert.equal(v.Motor_RunCmd,false);assert.equal(v.D1_ExtendCmd,false);assert.equal(v.D2_ExtendCmd,false);
  for(const[k,value]of Object.entries({...AT_REST,Drive_Overload:false,Belt_SpeedActual:0,Drive_Current:0}))assert.equal(current.activeImage[k],value);
  return [{op:'stop'},{op:'fresh_world'},{op:'reset'},{op:'await_stopped'}];
}

/** Commissioning's unassigned carton has completed at runout while its tail is
 * still over that sensor. This is explicit cleanup, not simulated travel. */
export function pendingRunoutPlan(record,current) {
  const stock=classifyHeldState(record,current);
  assert.deepEqual(stock.refusals.filter(x=>x!=='held state matches a recorded W4 reconciliation path'),[]);
  assert.deepEqual(stock.differences,{});assert.equal(stock.matchedCommit,'last_acknowledged');
  assert.equal(record.inFlightCommit,null);assert.deepEqual(record.inFlightCommands,[]);
  assert.deepEqual(record.outstandingWrites.atClose,[]);assert.equal(record.outstandingWrites.childClosed,true);
  assert.deepEqual(record.world.injectedFaults,[]);assert.equal(record.world.cartons.length,1);
  const carton=record.world.cartons[0];assert.equal(carton.itemId,'unassigned');assert.equal(carton.requestedRoute,null);assert.equal(carton.path,'main');assert(carton.positionM>=3.5);
  const v=current.observation.values,c=k=>v['controller.'+k];
  assert.equal(c('Mode'),1);assert.equal(c('FaultCode'),0);assert.equal(c('ItemActive'),false);
  assert.equal(c('CompletionPending'),true);assert.equal(c('CompletionItemId'),0);assert.equal(c('CompletionExit'),3);assert.equal(c('CompletionDisposition'),2);assert.equal(c('CompletionRoute'),0);
  assert.equal(v.Motor_RunCmd,true);assert.equal(c('OfferPending'),false);
  for(const[k,value]of Object.entries({...AT_REST,PE_Runout:true,Drive_RunningFB:true,Drive_Overload:false}))assert.equal(current.activeImage[k],value);
  return [{op:'stop'},{op:'fresh_world'},{op:'completion_ack',sequence:c('CompletionSequence')},{op:'await_stopped'}];
}

export function abortedJamPlan(record,current) {
  const stock=classifyHeldState(record,current);
  assert.deepEqual(stock.refusals.filter(x=>x!=='held state matches a recorded W4 reconciliation path'),[]);
  assert.deepEqual(stock.differences,{});assert.equal(stock.matchedCommit,'last_acknowledged');
  assert.equal(record.inFlightCommit,null);assert.deepEqual(record.inFlightCommands,[]);
  assert.deepEqual(record.outstandingWrites.atClose,[]);assert.equal(record.outstandingWrites.childClosed,true);
  assert.equal(record.world.injectedFaults.length,1);assert.equal(record.world.injectedFaults[0].controlId,'fault.setDivertJam');
  assert.deepEqual(record.world.injectedFaults[0].parameters,{divert:1,active:true});assert.deepEqual(record.world.clearedFaults,[]);
  assert.equal(record.world.cartons.length,1);assert.equal(record.world.cartons[0].velocityMps,0);
  const v=current.observation.values,c=k=>v['controller.'+k];
  assert.equal(c('Mode'),3);assert.equal(c('FaultCode'),23);assert.equal(c('ExceptionCode'),0);assert.equal(c('ItemActive'),false);
  assert.equal(c('CompletionPending'),true);assert.equal(c('CompletionDisposition'),4);assert.equal(c('CompletionExit'),0);
  assert.equal(String(c('CompletionItemId')),record.world.cartons[0].itemId);assert.equal(c('ActiveItemId'),c('CompletionItemId'));assert.equal(c('OfferPending'),false);
  assert.equal(v.Motor_RunCmd,false);assert.equal(v.D1_ExtendCmd,false);assert.equal(v.D2_ExtendCmd,false);
  for(const[k,value]of Object.entries({...AT_REST,Drive_Overload:false,Belt_SpeedActual:0,Drive_Current:0}))assert.equal(current.activeImage[k],value);
  return [{op:'stop'},{op:'fresh_world'},{op:'completion_ack',sequence:c('CompletionSequence')},{op:'reset'},{op:'await_stopped'}];
}

export function startupFeedbackPlan(record,current) {
  const stock=classifyHeldState(record,current);
  assert.deepEqual(stock.refusals.filter(x=>x!=='held state matches a recorded W4 reconciliation path'),[]);
  assert.equal(stock.matchedCommit,'last_acknowledged');assert.equal(record.inFlightCommit,null);assert.deepEqual(record.inFlightCommands,[]);
  assert.deepEqual(record.outstandingWrites.atClose,[]);assert.equal(record.outstandingWrites.childClosed,true);
  assert.deepEqual(record.world.cartons,[]);assert.deepEqual(record.world.injectedFaults,[]);
  const r=record.lastObservation.values,c=current.observation.values;
  assert.equal(r['controller.Mode'],1);assert.equal(r.Motor_RunCmd,true);assert.equal(r['controller.FaultCode'],0);
  assert.equal(r['controller.ItemActive'],false);assert.equal(r['controller.CompletionPending'],false);assert.equal(r['controller.StartAccepted'],true);
  assert.equal(c['controller.Mode'],3);assert.equal(c['controller.FaultCode'],11);assert.equal(c.Motor_RunCmd,false);
  assert.equal(c['controller.ItemActive'],false);assert.equal(c['controller.CompletionPending'],false);assert.equal(c['controller.ExceptionCode'],0);
  const allowed=new Set(['Motor_RunCmd','StackLight_Red','StackLight_Green','controller.Mode','controller.ModeText','controller.FaultCode','controller.FaultText']);
  assert(Object.keys(stock.differences).every(k=>allowed.has(k)),'Only the recorded missing-start-feedback reaction may settle after the run');
  for(const[k,value]of Object.entries({...AT_REST,Drive_Overload:false,Belt_SpeedActual:0,Drive_Current:0}))assert.equal(current.activeImage[k],value);
  return [{op:'stop'},{op:'fresh_world'},{op:'reset'},{op:'await_stopped'}];
}

export async function executeCompletedHold(connection,plan,journal) {
  const {connector}=connection;
  let image;
  for(const step of plan) {
    journal('reconciliation.step',{step});
    if(step.op==='stop')await connector.action('stop',{},'completed-hold-stop');
    else if(step.op==='reset')await connector.action('reset',{},'feedback-loss-recovery-reset');
    else if(step.op==='fresh_world') {
      const {InstrumentedWorldContext}=await fromPin('src/proof/world-context.ts');
      const {worldSeed}=await fromPin('src/live/wonder-process/index.ts');
      const world=(await fromPin('artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts')).default;
      const ctx=new InstrumentedWorldContext(world.manifest,{seed:worldSeed,worldVersion:world.manifest.packageVersion});
      await world.initialize(ctx,{seed:worldSeed,worldVersion:world.manifest.packageVersion});
      image=ctx.plc.currentInputState();
      journal('world.reset',{reason:'Explicit bench recovery to a fresh world at rest; encoder reset is not travel/deceleration evidence',image,worldVersion:world.manifest.packageVersion});
      await connector.resetSession();
      for(let i=0;i<5;i++)await connector.commit(image);
    } else if(step.op==='completion_ack')await connector.action('completion_ack',{sequence:step.sequence},'completed-hold-wcs-ack');
    else if(step.op==='await_stopped') {
      const deadline=performance.now()+3000; let receipt;
      do {await new Promise(r=>setTimeout(r,150));receipt=await connector.commit(image);}while(receipt.values['controller.Mode']!==0&&performance.now()<deadline);
    } else throw Error('Unknown recovery step');
  }
  const final=await connection.inspect();assert.deepEqual(baselineMismatches(final.observation.values),[]);
  return final;
}

async function main() {
  const {positionals,values}=parseArgs({allowPositionals:true,options:{reconcile:{type:'boolean'},authorize:{type:'string'},'feedback-loss':{type:'boolean'},'cleared-contradiction':{type:'boolean'},'pending-runout':{type:'boolean'},'aborted-d1-jam':{type:'boolean'},'startup-feedback':{type:'boolean'}}});
  const planner=values['startup-feedback']?startupFeedbackPlan:values['aborted-d1-jam']?abortedJamPlan:values['pending-runout']?pendingRunoutPlan:values['cleared-contradiction']?clearedContradictionPlan:values['feedback-loss']?feedbackLossPlan:completedHoldPlan;
  const recoveryKind=values['startup-feedback']?'startup-feedback':values['aborted-d1-jam']?'aborted-d1-jam':values['pending-runout']?'pending-runout':values['cleared-contradiction']?'cleared-contradiction':values['feedback-loss']?'feedback-loss':'completed';
  assert.equal(positionals.length,1);
  const reference=resolve(positionals[0]),prior=json(join(reference,'result.json')),record=json(join(reference,'held-state.json'));
  const heldSha=hashFile(join(reference,'held-state.json'));
  assert.equal(prior.status,'held');assert.equal(prior.heldState.sha256,heldSha);
  for(const [file,h]of Object.entries(record.evidence))assert.equal(hashFile(join(reference,file)),h);
  readLedger(join(reference,'campaign.jsonl'));
  assert(recordedChildExited(record,readJsonl(join(reference,'wonder-process/parent-boundary.jsonl'))));
  const last=readJsonl(join(reference,'wonder-process/child-transport.jsonl')).filter(e=>e.kind==='commit.acknowledged').at(-1)?.receipt;
  assert.equal(last.workstationSequence,record.lastAcknowledgedCommit.sequence);assert.equal(last.workstationEpoch,record.lastAcknowledgedCommit.epoch);assert.deepEqual(last.image,record.lastAcknowledgedCommit.image);
  assert.equal(hashFile(join(pinned,'codesys/conveyordemo.project')),record.identities.projectSha256);
  assert.equal(hashFile(join(pinned,'artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts')),record.identities.worldSha256);
  const {m8Preflight}=await fromPin('src/host/m8-campaign-factory.ts');
  const {createM8NativeTransport}=await fromPin('src/live/m8-native-transport.ts');
  const preflight=m8Preflight();assert(preflight.ready,'Native preflight/ownership/credentials must pass');
  const lockPath=commonWonderPaths().ownership;assert.equal(resolve(lockPath),resolve(record.ownership.path));
  const directory=join(reference,recoveryKind+'-recovery-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(directory);
  const journal=(kind,data)=>appendFileSync(join(directory,'transport.jsonl'),JSON.stringify({kind,atIso:new Date().toISOString(),...data})+'\n');
  const result={status:'refused',mode:values.reconcile?'reconcile':'inspect',scope:'live_plc',reference,heldStateSha256:heldSha,modelCalls:0,writesAuthorized:false};
  const fd=openSync(lockPath,'wx');writeFileSync(fd,JSON.stringify({owner:'paid-completion-recovery',pid:process.pid,reference,heldStateSha256:heldSha})+'\n');closeSync(fd);
  let connection,dirty=false;
  try {
    const password=process.env.OPC_PASSWORD;delete process.env.OPC_PASSWORD;
    connection=inspectionConnection(createM8NativeTransport({userName:process.env.OPC_USER,password,event:journal,modulePath:preflight.modulePath}),journal);
    const first=await connection.inspect();const plan=planner(record,first);
    Object.assign(result,{inspection:summarizeInspection(first),plan});
    writeFileSync(join(directory,'inspection.json'),JSON.stringify(first,null,2)+'\n');
    if(!values.reconcile)result.status='inspected';
    else {
      assert.equal(values.authorize,heldSha,'Exact held-state authorization required');
      assert.deepEqual(planner(record,await connection.inspect()),plan);
      connection.gate.authorize(`User-authorized bench cleanup of completed sort; exact held record ${heldSha}; no PLC/model behavior verdict`);
      dirty=true;result.writesAuthorized=true;
      const final=await executeCompletedHold(connection,plan,journal);
      for(const k of ['CountExitA','CountExitB','CountRunout','CountMisroute','CountFaulted'])assert.equal(final.observation.values[`controller.${k}`],record.lastObservation.values[`controller.${k}`]);
      result.final=summarizeInspection(final);result.status='pass';dirty=false;
    }
  } catch(e) {result.error=e.message;}
  finally {
    if(connection)await connection.connector.close().catch(e=>{result.closeError=e.message;dirty ||= result.writesAuthorized;});
    if(!dirty)unlinkSync(lockPath);
    result.ownershipAfter=dirty?'retained':'released';result.transportSha256=hashFile(join(directory,'transport.jsonl'));
    result.finishedAtIso=new Date().toISOString();
    writeFileSync(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
    writeFileSync(join(reference,recoveryKind+'-recovery-latest.json'),JSON.stringify({directory,status:result.status},null,2)+'\n');
  }
  console.log(JSON.stringify({directory,status:result.status,error:result.error,final:result.final}));
  process.exitCode=['inspected','pass'].includes(result.status)?0:1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
