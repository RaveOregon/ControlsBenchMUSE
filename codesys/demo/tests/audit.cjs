#!/usr/bin/env node
'use strict';
// Independent checks over retained live evidence; never executes model/controller code.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const dir=path.resolve(process.argv[2]||'');
assert(process.argv[2],'Usage: node audit.cjs <evidence run directory>');
const result=JSON.parse(fs.readFileSync(path.join(dir,'result.json'),'utf8'));
const bytes=fs.readFileSync(path.join(dir,'trace.jsonl'));
const rows=bytes.toString('utf8').trim().split(/\r?\n/).map(l=>JSON.parse(l));
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const checks=[];
function check(name,fn){fn();checks.push({name,passed:true});}
check('Passed live result and frozen fixture identity',()=>{
  assert(result.passed);
  assert.equal(result.evidenceKind,'live PLC, methodical raw-I/O stimuli');
  assert.equal(result.frozenFixtureSha256.toLowerCase(),'2e9774d1782e82fff0a9383779be517ee94afc1a48cdfcdce6ee6c5fa31a73b7');
  assert.equal(digest(bytes),result.traceSha256);
  assert.equal(digest(fs.readFileSync(path.join(dir,'tested-conveyordemo.project'))),result.projectSha256);
  assert.equal(digest(fs.readFileSync(path.join(dir,'smoke-used.cjs'))),result.runnerSha256);
  assert.equal(digest(fs.readFileSync(path.join(dir,'precheck-used.cjs'))),result.precheckSha256);
  assert.equal(digest(fs.readFileSync(path.join(dir,'signal-map-used.json'))),result.mapSha256);
});
const expected=result.gate==='All'?['A','B','C','D']:[result.gate];
check('Required checkpoints and official compiler precheck at each breakpoint',()=>{
  assert.deepEqual(result.checkpoints.map(c=>c.name),expected.map(g=>'M8-'+g));
  assert(result.checkpoints.every(c=>c.passed));
  for(const g of expected){
    const p=rows.find(r=>r.kind==='official-mcp-precheck'&&r.name==='M8-'+g);
    assert(p);assert.equal(p.tool,'check_for_errors');assert.equal(p.response.isError,false);
    assert(p.response.content.every(c=>c.type!=='text'||!c.text.trim()));
  }
  assert(!rows.some(r=>r.kind==='failure'));
});
const starts=rows.filter(r=>r.kind==='frame-start');
const frames=rows.filter(r=>r.kind==='frame-applied');
check('Complete frames, epoch continuity, sequence acknowledgement, and 10 Hz limit',()=>{
  assert(frames.length>0);assert.equal(starts.length,frames.length);
  const epoch=frames[0].epoch;
  const bool=['PE_Entry','PE_D1Approach','PE_D2Approach','PE_ExitA','PE_ExitB','PE_Runout',
    'D1_HomeFB','D1_ExtendedFB','D2_HomeFB','D2_ExtendedFB','Drive_RunningFB','Drive_Overload',
    'ExitA_Ready','ExitB_Ready','Runout_Ready'];
  const real=['Belt_SpeedActual','Drive_Current','D1_Position','D2_Position'];
  frames.forEach((r,i)=>{
    assert.equal(r.epoch,epoch);assert.equal(BigInt(r.sequence),BigInt(i+1));
    assert.equal(Object.keys(r.image).length,20);
    for(const f of bool)assert.equal(typeof r.image[f],'boolean');
    for(const f of real)assert(Number.isFinite(r.image[f]));
    assert(Number.isInteger(r.image.Encoder_Count)&&r.image.Encoder_Count>=0&&r.image.Encoder_Count<=0xffffffff);
    if(i)assert(Number(BigInt(starts[i].monotonicNs)-BigInt(starts[i-1].monotonicNs))/1e6>=99,'frame cadence above 10 Hz');
  });
});
check('Good quality with non-null source/server and workstation timestamps',()=>{
  const samples=rows.flatMap(r=>r.samples||[]);
  assert(samples.length>0);
  for(const s of samples){
    assert(s.status.startsWith('Good'));
    assert(s.sourceTimestamp);assert(s.serverTimestamp);
  }
  assert(rows.every(r=>r.wallTime&&r.monotonicNs));
});
check('Resolved OPC UA symbols have exact IEC mapping and access/type evidence',()=>{
  const symbols=JSON.parse(fs.readFileSync(path.join(dir,'resolved-symbols.json'),'utf8'));
  for(const name of ['BuildId','InterfaceVersion','Mode','StartSequence','CompletionSequence','RequestedSequence']){
    const s=symbols[name];assert(s&&s.nodeId&&s.iecPath);
    assert(Number.isInteger(s.uaTypeId));assert([1,3].includes(s.userAccessLevel&3));
  }
});
check('No writes to PLC outputs or read-group state, regardless of server access flags',()=>{
  const symbols=JSON.parse(fs.readFileSync(path.join(dir,'resolved-symbols.json'),'utf8'));
  const writes=rows.filter(r=>r.kind==='write').flatMap(r=>r.items);
  assert(writes.length>0);
  for(const w of writes){
    const s=symbols[w.name];assert(s);
    assert(s.iecPath.startsWith('GVL_BenchWrite.')||s.iecPath.startsWith('GVL_DemoWrite.'));
  }
  assert(rows.some(r=>r.kind==='access-policy'));
});
const states=rows.filter(r=>r.kind==='controller-at-frame');
if(expected.includes('C'))check('A, B, unassigned runout, and assigned misroute observed once',()=>{
  const exits=states.filter(r=>r.label==='observed physical exit').map(r=>r.values);
  assert.equal(exits.length,4);
  assert.deepEqual(exits.map(v=>[v.CompletionRoute,v.CompletionExit,v.CompletionDisposition]),[
    [1,1,1],[2,2,1],[0,3,2],[1,3,3]
  ]);
  for(let i=1;i<exits.length;i++)assert.equal(exits[i].CompletionSequence,exits[i-1].CompletionSequence+1);
  assert.equal(exits[3].CountExitA-exits[0].CountExitA,0);
  assert.equal(exits[3].CountExitB-exits[0].CountExitB,1);
  assert.equal(exits[3].CountRunout-exits[0].CountRunout,2);
  assert.equal(exits[3].CountMisroute-exits[0].CountMisroute,1);
});
if(expected.includes('B'))check('Stop removes command during external encoder coast',()=>{
  const coast=states.find(r=>r.label==='external encoder coast after command removal');
  assert(coast);assert.equal(coast.values.Motor_RunCmd,false);assert.equal(coast.values.Mode,2);
  assert(coast.values.EncoderDelta>=0);
  assert(states.some(r=>r.values.FaultCode===11&&r.values.Motor_RunCmd===false));
});
if(expected.includes('D'))check('Failed-divert abort cannot become a second/successful completion',()=>{
  const at=states.findIndex(r=>r.values.FaultCode===23);
  assert(at>=0);
  const fault=states[at].values;
  assert.equal(fault.Mode,3);assert.equal(fault.CompletionDisposition,4);assert.equal(fault.CompletionExit,0);
  const later=states.find(r=>r.label==='faulted carton later reaches runout');
  assert(later);assert.equal(later.values.CompletionSequence,fault.CompletionSequence);
  assert.equal(later.values.CompletionDisposition,4);assert.equal(later.values.Motor_RunCmd,false);
  assert.equal(later.values.CountExitA,fault.CountExitA);assert.equal(later.values.CountRunout,fault.CountRunout);
});
const audit={schemaVersion:1,auditedAt:new Date().toISOString(),passed:true,checks,limitations:result.limitations};
fs.writeFileSync(path.join(dir,'audit.json'),JSON.stringify(audit,null,2)+'\n');
console.log(JSON.stringify(audit,null,2));
