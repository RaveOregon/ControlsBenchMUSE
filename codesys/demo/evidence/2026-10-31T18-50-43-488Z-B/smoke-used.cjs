#!/usr/bin/env node
// Methodical live PLC smoke; no generated world, model calls, or PLC playback.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {precheck}=require('./precheck.cjs');
const {
  OPCUAClient, DataType, MessageSecurityMode, SecurityPolicy, UserTokenType,
  boolFields, realFields, activeNames, imageWrites, compareActive, makeImage,
  u64ToBigInt, sleep, browseWanted,
} = require('../../scripts/probe-m1.cjs');
const opc = require('../../codesys_handoff/browser_hmi_handoff/opcua_relay/node_modules/node-opcua');
const map = require('../signal-map-v1.json');
const gate = process.argv[2] || 'All';
assert(['A','B','C','D','All'].includes(gate));
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const dir = path.resolve(__dirname, '../evidence', runId + '-' + gate);
fs.mkdirSync(dir, {recursive:true});
const tracePath = path.join(dir, 'trace.jsonl');
const result = {
  schemaVersion:1, runId, gate, evidenceKind:'live PLC, methodical raw-I/O stimuli',
  mapVersion:map.mapVersion, updateHzLimit:10, checkpoints:[], passed:false,
  limitations:['No continuous generated-world run or physical deceleration model.',
    'No WebVisu test.', 'No new rate/task-impact qualification.'],
};
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
result.projectSha256 = hash(path.resolve(__dirname,'../../conveyordemo.project'));
result.frozenFixtureSha256 = hash(path.resolve(__dirname,'../../gngnf.project'));
result.runnerSha256 = hash(__filename);
result.mapSha256 = hash(path.resolve(__dirname,'../signal-map-v1.json'));
result.precheckSha256 = hash(path.join(__dirname,'precheck.cjs'));
fs.copyFileSync(__filename,path.join(dir,'smoke-used.cjs'));
fs.copyFileSync(path.join(__dirname,'precheck.cjs'),path.join(dir,'precheck-used.cjs'));
fs.copyFileSync(path.resolve(__dirname,'../signal-map-v1.json'),path.join(dir,'signal-map-used.json'));
fs.copyFileSync(path.resolve(__dirname,'../../conveyordemo.project'),path.join(dir,'tested-conveyordemo.project'));
const event = (kind, data) => fs.appendFileSync(tracePath, JSON.stringify({
  wallTime:new Date().toISOString(), monotonicNs:process.hrtime.bigint().toString(), kind, ...data,
}, (_,v)=>typeof v==='bigint'?v.toString():v) + '\n');
let session, client, nodes, boot, seq=0n, heartbeat=0n, lastFrameAt=0;
const epoch=BigInt('0x'+crypto.randomBytes(6).toString('hex')) || 1n;
let image=makeImage(false,[0,0,0,0],0);
const zero=()=>makeImage(false,[0,0,0,0],0);
const normal=()=>({...zero(),D1_HomeFB:true,D2_HomeFB:true,
  ExitA_Ready:true,ExitB_Ready:true,Runout_Ready:true});
const statusNames=['Mode','FaultCode','FaultText','ExceptionCode','ReleaseReady','ItemActive',
  'ActiveItemId','RequestedRoute','EffectiveRoute','ActualExit','Disposition',
  'OfferAckSequence','OfferAckItemId','OfferAccepted','OfferReason','OfferPending',
  'CompletionSequence','CompletionPending','CompletionItemId','CompletionRoute','CompletionExit',
  'CompletionDisposition','CountExitA','CountExitB','CountRunout','CountMisroute','CountFaulted',
  'StartAck','StopAck','ResetAck','StartAccepted','ResetAccepted','EncoderDelta','BeltSpeedMps'];
const snapshotNames=['BuildId','InterfaceVersion','SimApplied','ConnectorStale','ActiveSlot',
  'AppliedEpoch','AppliedSequence','PlcBootIdentity','PlcCycle','OutputCaptureCycle',
  'OutputCaptureTimeUs','Motor_RunCmd','D1_ExtendCmd','D2_ExtendCmd',
  ...activeNames,...statusNames];
const writesNames=['SimRequest','SessionResetRequest','RequestedSlot','RequestedEpoch','RequestedSequence',
  'WorkstationHeartbeat','StartSequence','StopSequence','ResetSequence','AutoRequest',
  'OfferSequence','OfferItemId','OfferRoute','CompletionAck'];
const required=[...new Set([...snapshotNames,...writesNames,...[0,1].flatMap(sl=>[
  'Valid','Epoch','Sequence',...boolFields,...realFields,'Encoder_Count'].map(n=>'Slot'+sl+'_'+n))])];
const writableNames=new Set([...writesNames,...[0,1].flatMap(sl=>[
  'Valid','Epoch','Sequence',...boolFields,...realFields,'Encoder_Count'].map(n=>'Slot'+sl+'_'+n))]);
async function read(names, label='read') {
  const dvs=await session.read(names.map(n=>({nodeId:nodes.get(n).nodeId,attributeId:opc.AttributeIds.Value})),0);
  const values={};
  for(let i=0;i<names.length;i++){
    assert(dvs[i].statusCode.isGood(), names[i]+': '+dvs[i].statusCode);
    values[names[i]]=dvs[i].value.value;
  }
  event(label,{samples:names.map((n,i)=>({name:n,value:values[n],
    status:dvs[i].statusCode.toString(),sourceTimestamp:dvs[i].sourceTimestamp,
    serverTimestamp:dvs[i].serverTimestamp}))});
  return values;
}
async function write(items) {
  for(const [name] of items)assert(writableNames.has(name),'Attempted write outside bench/operator/WCS interface: '+name);
  const codes=await session.write(items.map(([name,type,value])=>({
    nodeId:nodes.get(name).nodeId,attributeId:opc.AttributeIds.Value,
    value:{value:{dataType:DataType[type],value}}
  })));
  event('write',{items:items.map(([name,type,value],i)=>({name,type,value,status:codes[i].toString()}))});
  codes.forEach((c,i)=>assert(c.isGood(),items[i][0]+': '+c));
}
async function snap() {
  for(let attempt=0;attempt<30;attempt++){
    const before=await read(['PlcCycle','OutputCaptureCycle'],'bracket');
    if(u64ToBigInt(before.PlcCycle)!==u64ToBigInt(before.OutputCaptureCycle)) continue;
    const v=await read(snapshotNames,'observation');
    const after=await read(['PlcCycle','OutputCaptureCycle'],'bracket');
    if(u64ToBigInt(before.PlcCycle)!==u64ToBigInt(after.PlcCycle)) continue;
    if(u64ToBigInt(after.PlcCycle)!==u64ToBigInt(after.OutputCaptureCycle)) continue;
    assert.equal(u64ToBigInt(v.OutputCaptureCycle),u64ToBigInt(v.PlcCycle),'output capture cycle');
    if(boot!==undefined) assert.equal(u64ToBigInt(v.PlcBootIdentity),boot,'PLC restarted');
    return v;
  }
  throw Error('Cannot obtain coherent PLC-cycle bracket; stop and investigate');
}
async function wait(predicate,label,ms=2000) {
  const deadline=Date.now()+ms;
  do {
    const v=await snap();
    if(predicate(v)) return v;
    await sleep(40);
  } while(Date.now()<deadline);
  throw Error('Timeout: '+label);
}
async function frame(patch={}, label='frame') {
  const delay=100-(performance.now()-lastFrameAt);
  if(delay>0) await sleep(delay);
  lastFrameAt=performance.now();
  event('frame-start',{label,epoch,sequence:seq+1n});
  image={...image,...patch};
  const v=await read(['ActiveSlot','PlcBootIdentity']);
  assert.equal(u64ToBigInt(v.PlcBootIdentity),boot);
  const sl=Number(v.ActiveSlot)===0?1:0;
  seq++;heartbeat++;
  // Invalidation, complete payload, Valid, metadata, then sequence are separate completed writes.
  await write([['Slot'+sl+'_Valid','Boolean',false]]);
  await write(imageWrites(sl,image).map(w=>[w.name,DataType[w.dataType],w.value]).concat([
    ['Slot'+sl+'_Epoch','UInt64',epoch.toString()],['Slot'+sl+'_Sequence','UInt64',seq.toString()]
  ]));
  await write([['Slot'+sl+'_Valid','Boolean',true]]);
  await write([['WorkstationHeartbeat','UInt64',heartbeat.toString()],
    ['RequestedSlot','Byte',sl],['RequestedEpoch','UInt64',epoch.toString()]]);
  await write([['RequestedSequence','UInt64',seq.toString()]]);
  const applied=await wait(v=>u64ToBigInt(v.AppliedEpoch)===epoch
    &&u64ToBigInt(v.AppliedSequence)===seq,'applied image');
  assert.deepEqual(compareActive(image,applied),[],'complete active image');
  event('frame-applied',{label,epoch,sequence:seq,image,plcCycle:u64ToBigInt(applied.PlcCycle)});
  event('controller-at-frame',{label,epoch,sequence:seq,
    values:Object.fromEntries([...statusNames,'Motor_RunCmd','D1_ExtendCmd','D2_ExtendCmd',
      'SimApplied','ConnectorStale','OutputCaptureCycle']
      .map(n=>[n,applied[n]]))});
  return applied;
}
async function hold(ms, label='hold') {
  const end=performance.now()+ms;
  let v;
  do { v=await frame({},label); } while(performance.now()<end);
  return v;
}
async function command(name,ack) {
  const old=await read([name]);
  const n=(Number(old[name])+1)>>>0;
  await write([[name,'UInt32',n]]);
  return wait(v=>Number(v[ack])===n,ack);
}
async function completionAck(v) {
  await write([['CompletionAck','UInt32',v.CompletionSequence]]);
}
async function establish() {
  await write([['SimRequest','Boolean',true]]);
  await sleep(100);
  await write([['SessionResetRequest','Boolean',false]]);
  await sleep(40);
  await write([['SessionResetRequest','Boolean',true]]);
  await wait(v=>u64ToBigInt(v.AppliedEpoch)===0n&&u64ToBigInt(v.AppliedSequence)===0n,'bench reset');
  await write([['SessionResetRequest','Boolean',false],['RequestedSequence','UInt64','0']]);
  await sleep(40);
  await frame(normal(),'normal no-carton image');
  let v=await snap();
  await completionAck(v);
  await command('StopSequence','StopAck');
  await hold(300,'stationary stop');
  v=await command('ResetSequence','ResetAck');
  assert(v.ResetAccepted,'cleared fault reset');
  assert.equal(v.Mode,0);
}
async function start() {
  await write([['AutoRequest','Boolean',true]]);
  let v=await command('StartSequence','StartAck');
  assert(v.StartAccepted,'start accepted');
  assert.equal(v.Motor_RunCmd,true);
  v=await frame({Drive_RunningFB:true},'external drive running feedback');
  assert.equal(v.Mode,1);
  assert.equal(v.ReleaseReady,true);
  return v;
}
async function stop() {
  const before=await snap();
  let v=await command('StopSequence','StopAck');
  assert.equal(v.Motor_RunCmd,false,'stop removes command while feedback remains external');
  if(before.Active_Drive_RunningFB) assert.equal(v.Mode,2,'Stopping while external feedback remains on');
  const count=image.Encoder_Count;
  v=await frame({Encoder_Count:(count+20)>>>0},'external encoder coast after command removal');
  assert.equal(v.Motor_RunCmd,false);
  v=await frame({Drive_RunningFB:false},'external drive reaches rest');
  v=await hold(300,'external stationary hold');
  assert.equal(v.Mode,0);
  return v;
}
async function offer(item,route) {
  const old=await read(['OfferSequence']);
  const n=(Number(old.OfferSequence)+1)>>>0 || 1;
  await write([['OfferItemId','UInt32',item],['OfferRoute','UInt16',route]]);
  await write([['OfferSequence','UInt32',n]]);
  const v=await wait(v=>v.OfferAckSequence===n,'WCS offer acknowledgement');
  assert(v.OfferAccepted,'WCS offer accepted');
  return n;
}
async function carton(route,actual, id, expect, options={}) {
  let before=await snap();
  if(route!==null) await offer(id,route);
  let v=await frame({PE_Entry:true},'carton at entry');
  assert.equal(v.ItemActive,true);
  assert.equal(v.D1_ExtendCmd,route===1&&!options.blockA);
  assert.equal(v.D2_ExtendCmd,route===2);
  if(route===1&&!options.blockA) await frame({D1_HomeFB:false,D1_ExtendedFB:false},'D1 travel');
  if(route===2) await frame({D2_HomeFB:false,D2_ExtendedFB:false},'D2 travel');
  if(route===1&&!options.blockA) await frame({D1_ExtendedFB:true},'D1 reaches extended limit');
  if(route===2) await frame({D2_ExtendedFB:true},'D2 reaches extended limit');
  await frame({PE_Entry:false,PE_D1Approach:true},'D1 approach');
  if(actual!==1) await frame({PE_D1Approach:false,PE_D2Approach:true},'D2 approach');
  const exit=actual===1?'PE_ExitA':actual===2?'PE_ExitB':'PE_Runout';
  v=await frame({PE_D1Approach:false,PE_D2Approach:false,[exit]:true},'observed physical exit');
  assert.equal(v.CompletionSequence,before.CompletionSequence+1);
  assert.equal(v.CompletionExit,actual);
  assert.equal(v.CompletionDisposition,expect);
  assert.equal(v.CompletionRoute,route||0);
  assert.equal(v.CompletionItemId,route===null?0:id);
  const countName=actual===1?'CountExitA':actual===2?'CountExitB':'CountRunout';
  assert.equal(v[countName],before[countName]+1);
  assert.equal(v.CountMisroute,before.CountMisroute+(expect===3?1:0));
  for(const n of ['CountExitA','CountExitB','CountRunout'])if(n!==countName)assert.equal(v[n],before[n]);
  const done=v.CompletionSequence;
  v=await hold(300,'held exit must not repeat completion');
  assert.equal(v.CompletionSequence,done);
  await frame({[exit]:false,D1_HomeFB:true,D1_ExtendedFB:false,D2_HomeFB:true,D2_ExtendedFB:false},'clear exit and return diverts home');
  await completionAck(v);
  await frame({},'completion acknowledged');
  return v;
}
async function checkpoint(name, fn) {
  event('checkpoint-start',{name});
  assert.equal(hash(path.resolve(__dirname,'../../conveyordemo.project')),result.projectSha256,'project changed during smoke');
  const checked=await precheck();
  event('official-mcp-precheck',{name,...checked});
  await fn();
  result.checkpoints.push({name,passed:true});
  event('checkpoint-pass',{name});
}
async function main(){
  assert(process.env.OPC_USER&&process.env.OPC_PASSWORD,'Run run-smoke.ps1; credentials are never saved.');
  client=OPCUAClient.create({applicationName:'NodeOPCUA-Client',endpointMustExist:false,
    securityMode:MessageSecurityMode.SignAndEncrypt,securityPolicy:SecurityPolicy.Basic256Sha256,
    automaticallyAcceptUnknownCertificate:true,connectionStrategy:{maxRetry:0}});
  await client.connect(process.env.OPC_ENDPOINT||map.endpoint);
  session=await client.createSession({type:UserTokenType.UserName,userName:process.env.OPC_USER,password:process.env.OPC_PASSWORD});
  nodes=await browseWanted(session,new Set(required));
  fs.writeFileSync(path.join(dir,'discovered-symbols.json'),JSON.stringify(Object.fromEntries(nodes),null,2)+'\n');
  const resolved={};
  const accessWarnings=[];
  for(const name of required){
    const candidates=map.signals.filter(s=>s.iecPath.split('.').at(-1)===name&&!s.logical.startsWith('controller.Motor_')&&!s.logical.startsWith('controller.D1_Extend')&&!s.logical.startsWith('controller.D2_Extend'));
    const expected=candidates.find(s=>s.iecPath.startsWith('GVL_BenchRead.'))||candidates[0];
    assert(expected,'map entry '+name);
    const node=nodes.get(name);
    const normalizedBrowsePath=node.browsePath.replace(/(^|\.)\d+:/g,'$1');
    assert(normalizedBrowsePath.endsWith('.'+expected.iecPath),'wrong or ambiguous IEC path for '+name);
    const attrs=await session.read([
      {nodeId:node.nodeId,attributeId:opc.AttributeIds.DataType},
      {nodeId:node.nodeId,attributeId:opc.AttributeIds.UserAccessLevel},
      {nodeId:node.nodeId,attributeId:opc.AttributeIds.AccessLevel}
    ]);
    const id=attrs[0].value.value.value;
    const typeIds={BOOL:1,USINT:3,UINT:5,UDINT:7,ULINT:9,REAL:10,LREAL:11};
    const expectedType=expected.iecType.startsWith('STRING')?12:typeIds[expected.iecType];
    assert.equal(id,expectedType,'UA type '+name);
    const observedAccess=Number(attrs[1].value.value)&Number(attrs[2].value.value)&3;
    assert(observedAccess&1,'Required symbol is not readable: '+name);
    if(expected.access==='readWrite')assert.equal(observedAccess,3,'Required interface is not writable: '+name);
    else if(observedAccess&2)accessWarnings.push({name,iecPath:expected.iecPath,intendedAccess:'read',observedAccess});
    resolved[name]={...node,normalizedBrowsePath,iecPath:expected.iecPath,uaTypeId:id,userAccessLevel:attrs[1].value.value,accessLevel:attrs[2].value.value};
  }
  fs.writeFileSync(path.join(dir,'resolved-symbols.json'),JSON.stringify(resolved,null,2)+'\n');
  result.accessWarnings=accessWarnings;
  result.writePolicy='Only explicit bench inputs/handshake and operator/WCS requests; read-group writes prohibited regardless of server flags.';
  event('access-policy',{warnings:accessWarnings,writePolicy:result.writePolicy,userDirection:'Proceed without writing read-group fields; 2026-10-31'});
  if(accessWarnings.length)result.limitations.push('Server exposes '+accessWarnings.length+' intended read-only symbols as writable; runner enforces read-only use. Server-side read-only enforcement is not proven.');
  let v=await snap();
  assert.equal(v.BuildId,8001,'refuse to drive the M0-M7 fixture');
  assert.equal(v.InterfaceVersion,1);
  boot=u64ToBigInt(v.PlcBootIdentity);
  result.bootIdentity=boot.toString();
  if(gate==='A'||gate==='All'){
    await checkpoint('M8-A',async()=>{
      assert.equal(v.SimApplied,false,'cold-start hardware default; download/reset demo before this gate');
      assert.equal(v.Motor_RunCmd,false);
      await write([['SimRequest','Boolean',true]]);
      v=await wait(v=>v.SimApplied,'simulation entry');
      assert.deepEqual(compareActive(zero(),v),[],'simulation enters with complete zero raw image');
      assert.equal(u64ToBigInt(v.AppliedSequence),0n);
      await establish();
      const applied=await snap();
      await sleep(700); // Deliberate link loss; no frames or heartbeat.
      v=await snap();
      assert.equal(v.ConnectorStale,true);
      assert.equal(v.SimApplied,true);
      assert.deepEqual(compareActive(image,v),[]);
      assert.equal(u64ToBigInt(v.AppliedSequence),u64ToBigInt(applied.AppliedSequence));
      await frame({},'explicit coherent commit recovers freshness');
    });
  }else await establish();
  if(gate==='B'||gate==='All') await checkpoint('M8-B',async()=>{
    await start();await stop();
    await write([['AutoRequest','Boolean',true]]);
    v=await command('StartSequence','StartAck');
    assert(v.StartAccepted);
    v=await hold(1800,'deliberately missing motor feedback');
    assert.equal(v.Mode,3);assert.equal(v.FaultCode,11);assert.equal(v.Motor_RunCmd,false);
    await establish();
    await start();
    const beforeOverload=await snap();
    v=await frame({Drive_Overload:true},'drive overload while running');
    assert.equal(v.Mode,3);assert.equal(v.FaultCode,10);assert.equal(v.Motor_RunCmd,false);
    assert.equal(v.CompletionSequence,beforeOverload.CompletionSequence,'overload without a carton must not invent completion');
    await frame({Drive_Overload:false,Drive_RunningFB:false},'overload cleared and external drive stopped');
    v=await command('ResetSequence','ResetAck');
    assert(v.ResetAccepted);assert.equal(v.Mode,0);assert.equal(v.Motor_RunCmd,false);
  });
  if(gate==='C'||gate==='All') await checkpoint('M8-C',async()=>{
    await start();
    await carton(1,1,101,1);
    await carton(2,2,102,1);
    await carton(null,3,0,2);
    await frame({ExitA_Ready:false},'A blocked with runout available');
    await carton(1,3,103,3,{blockA:true});
    await frame({ExitA_Ready:true});
    await stop();
  });
  if(gate==='D'||gate==='All') await checkpoint('M8-D',async()=>{
    await start();
    const before=await snap();
    await offer(201,1);
    await frame({PE_Entry:true},'failed-divert carton entry');
    await frame({PE_Entry:false,D1_HomeFB:false,D1_ExtendedFB:false},'failed D1 remains between limits');
    v=await hold(1450,'missing D1 extended feedback');
    assert.equal(v.Mode,3);assert.equal(v.FaultCode,23);assert.equal(v.Motor_RunCmd,false);
    assert.equal(v.CompletionSequence,before.CompletionSequence+1);
    assert.equal(v.CompletionDisposition,4);assert.equal(v.CompletionExit,0);
    assert.equal(v.CountExitA,before.CountExitA);assert.equal(v.CountRunout,before.CountRunout);
    const done=v.CompletionSequence;
    v=await frame({PE_Runout:true},'faulted carton later reaches runout');
    v=await hold(200);
    assert.equal(v.CompletionSequence,done,'no second or successful completion after fault');
    assert.equal(v.CountExitA,before.CountExitA);
    assert.equal(v.CountRunout,before.CountRunout);
    await frame(normal(),'clear fault cause and remove carton explicitly');
    await completionAck(v);
    v=await command('ResetSequence','ResetAck');
    assert(v.ResetAccepted);assert.equal(v.Mode,0);assert.equal(v.Motor_RunCmd,false);
  });
  result.passed=true;
}
main().catch(e=>{result.error=e.message;event('failure',{message:e.message});process.exitCode=1;})
.finally(async()=>{
  // A failed run freezes its last image for inspection; no recovery, no next gate.
  if(session)await session.close().catch(()=>{});
  if(client)await client.disconnect().catch(()=>{});
  result.finishedAt=new Date().toISOString();
  result.traceSha256=hash(tracePath);
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({passed:result.passed,checkpoints:result.checkpoints,error:result.error,evidence:dir},null,2));
});

