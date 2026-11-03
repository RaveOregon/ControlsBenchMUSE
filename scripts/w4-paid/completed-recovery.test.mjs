import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {completedHoldPlan,executeCompletedHold,feedbackLossPlan} from './recover-completed-hold.mjs';
import {fromPin,json,root} from './support.mjs';
const sample=json(join(root,'artifacts/w4-paid/2026-11-02T21-16-08-803Z/live-host/runs/2026-11-02T23-43-04-875Z-live_plc/portal-host/portal-20261102234344698-1/held-state.json'));
const fixture=()=>({observation:{...sample.plc,values:structuredClone(sample.lastObservation.values)},activeImage:structuredClone(sample.appliedImage)});

test('feedback-loss cleanup requires exact settled fault-12 run, stopped carton and unchanged identity/image/counters',()=>{
  const record=json(join(root,'artifacts/w4-paid/2026-11-03T02-03-15-190Z/live-host/runs/2026-11-03T02-03-47-941Z-live_plc/portal-host/portal-20261103020555687-1/held-state.json'));
  const state=()=>({observation:{...record.plc,values:structuredClone(record.lastObservation.values)},activeImage:structuredClone(record.appliedImage)});
  assert.deepEqual(feedbackLossPlan(record,state()).map(x=>x.op),['stop','fresh_world','reset','await_stopped']);
  for(const mutate of [s=>s.observation.bootIdentity+='x',s=>s.observation.appliedSequence='0',s=>s.activeImage.Encoder_Count++,s=>s.observation.values['controller.CountFaulted']++,s=>s.observation.values['controller.FaultCode']=11,s=>s.observation.values['controller.CompletionPending']=true]) {
    const changed=state();mutate(changed);assert.throws(()=>feedbackLossPlan(record,changed));
  }
  for(const mutate of [r=>r.world.injectedFaults=[],r=>r.world.cartons[0].velocityMps=1,r=>r.inFlightCommands.push({action:'reset'}),r=>r.outstandingWrites.atClose.push({paths:['unknown']})]) {
    const changed=structuredClone(record);mutate(changed);assert.throws(()=>feedbackLossPlan(changed,state()));
  }
});

test('completed-sort classification requires exact original identity, image, counters and completion with no uncertainty',()=>{
  const plan=completedHoldPlan(sample,fixture());assert.deepEqual(plan.map(s=>s.op),['stop','fresh_world','completion_ack','await_stopped']);
  assert.equal(plan[2].sequence,1);
  const changes=[s=>s.observation.bootIdentity+='x',s=>s.observation.appliedEpoch+='1',s=>s.observation.appliedSequence='0',s=>s.activeImage.PE_Entry=true,
    s=>s.observation.values['controller.CountExitA']++,s=>s.observation.values['controller.CountFaulted']++,s=>s.observation.values['controller.CompletionSequence']++,
    s=>s.observation.values['controller.CompletionPending']=false,s=>s.observation.values['controller.FaultCode']=33,s=>s.observation.values['controller.ItemActive']=true];
  for(const mutate of changes){const state=fixture();mutate(state);assert.throws(()=>completedHoldPlan(sample,state));}
  for(const mutate of [r=>r.inFlightCommit={},r=>r.inFlightCommands.push({action:'stop'}),r=>r.outstandingWrites.atClose.push({paths:['unknown']}),r=>r.world.cartons.push({id:'unknown'}),r=>r.world.injectedFaults.push({controlId:'fault.setOverload'})]){
    const record=structuredClone(sample);mutate(record);assert.throws(()=>completedHoldPlan(record,fixture()));
  }
});

test('completed-sort recovery executes through the real connector and write gate against explicitly fake transport',async()=>{
  const {createTransport,editBenchState}=await fromPin('test/fixtures/w4-bench-transport.ts');
  const {inspectionConnection}=await fromPin('scripts/lib/w4-commissioning.ts');
  const dir=mkdtempSync(join(tmpdir(),'completed-hold-fixture-')),stateFile=join(dir,'state.json'),events=[];
  const transport=createTransport({stateFile},{event:(k,d)=>events.push({kind:k,...d})});
  await transport.open();await transport.close();
  editBenchState(stateFile,{values:{Mode:1,ModeText:'Auto',FaultCode:0,Motor_RunCmd:true,ItemActive:false,CompletionPending:true,CompletionSequence:1,CompletionItemId:101,CompletionExit:1,CompletionDisposition:1,CountExitA:1}});
  const openConnection=()=>inspectionConnection(createTransport({stateFile},{event:(k,d)=>events.push({kind:k,...d})}),(k,d)=>events.push({kind:k,...d}));
  let connection=openConnection();
  try {
    await connection.inspect();
    await assert.rejects(()=>connection.connector.action('completion_ack',{sequence:1},'unapproved'),/read.only|write/i);
    await connection.connector.close(); // A refused write quarantines that connector; never reuse it.
    connection=openConnection();await connection.inspect();
    connection.gate.authorize('Explicitly fake recovery test');
    const final=await executeCompletedHold(connection,completedHoldPlan(sample,fixture()),(kind,data)=>events.push({kind,...data}));
    assert.equal(final.observation.values['controller.Mode'],0);assert.equal(final.observation.values.Motor_RunCmd,false);
    assert.equal(final.observation.values['controller.CompletionPending'],false);assert.equal(final.observation.values['controller.CountExitA'],1);
    assert.equal(final.observation.values['controller.FaultCode'],0);
    assert(events.some(e=>e.kind==='command.applied'&&e.action==='completion_ack'));
    assert(!events.some(e=>e.kind==='command.requested'&&['reset','start'].includes(e.action)));
  } finally {await connection.connector.close();rmSync(dir,{recursive:true,force:true});}
});

test('feedback-loss cleanup uses Stop, fresh image and Reset through the real connector with fake transport',async()=>{
  const {createTransport,editBenchState}=await fromPin('test/fixtures/w4-bench-transport.ts');
  const {inspectionConnection}=await fromPin('scripts/lib/w4-commissioning.ts');
  const dir=mkdtempSync(join(tmpdir(),'feedback-loss-fixture-')),stateFile=join(dir,'state.json'),events=[];
  const transport=createTransport({stateFile},{event:(k,d)=>events.push({kind:k,...d})});
  await transport.open();await transport.close();
  editBenchState(stateFile,{values:{Mode:3,ModeText:'Faulted',FaultCode:12,Motor_RunCmd:false,ItemActive:false,CompletionPending:false,OfferPending:true}});
  const connection=inspectionConnection(createTransport({stateFile},{event:(k,d)=>events.push({kind:k,...d})}),(k,d)=>events.push({kind:k,...d}));
  try {
    await connection.inspect();connection.gate.authorize('Explicitly fake feedback-loss cleanup test');
    const final=await executeCompletedHold(connection,[{op:'stop'},{op:'fresh_world'},{op:'reset'},{op:'await_stopped'}],(kind,data)=>events.push({kind,...data}));
    assert.equal(final.observation.values['controller.Mode'],0);assert.equal(final.observation.values['controller.FaultCode'],0);
    assert(events.some(e=>e.kind==='command.applied'&&e.action==='reset'));
    assert(!events.some(e=>e.kind==='command.requested'&&e.action==='start'));
  } finally {await connection.connector.close();rmSync(dir,{recursive:true,force:true});}
});
