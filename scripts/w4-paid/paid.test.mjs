import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';
import {boundHostedCampaign, configuration, configureBoundedRuntime, fromPin, hash, json, pinned, readLedger, root, verifyAccountBaseline, writeHeldRecord} from './support.mjs';
import {createCampaignFactory as paidFactory} from './factory.mjs';

test('paid factory refuses absent authorization, changed source and partial scope before any live session; host metadata stays complete', async () => {
  const before={packet:process.env.CONTROLSBENCH_W4_PACKET,sha:process.env.CONTROLSBENCH_W4_APPROVAL_SHA256};
  const dir=mkdtempSync(join(tmpdir(),'w4-packet-refusal-'));
  try {
    delete process.env.CONTROLSBENCH_W4_PACKET;delete process.env.CONTROLSBENCH_W4_APPROVAL_SHA256;
    assert.throws(()=>paidFactory(),/requires the reviewed packet/);
    const packet={ownerCommit:configuration.sourceCommit,maximumNewConservativeUsd:4,maximumModelRequests:4,launchSourceHashes:{'scripts/w4-paid/support.mjs':'wrong'}};
    const text=JSON.stringify(packet),path=join(dir,'packet.json');writeFileSync(path,text);
    process.env.CONTROLSBENCH_W4_PACKET=path;process.env.CONTROLSBENCH_W4_APPROVAL_SHA256=hash(text);
    assert.throws(()=>paidFactory(),/Launch source changed/);
    process.env.CONTROLSBENCH_W4_APPROVAL_SHA256='0'.repeat(64);
    assert.throws(()=>paidFactory(),/reviewed bytes/);
    packet.launchSourceHashes={'scripts/w4-paid/support.mjs':hash(readFileSync(join(root,'scripts/w4-paid/support.mjs')))};
    const valid=JSON.stringify(packet);writeFileSync(path,valid);process.env.CONTROLSBENCH_W4_APPROVAL_SHA256=hash(valid);
    const factory=paidFactory();
    assert.equal(factory.outputIds.length,5);assert.equal(Object.keys(factory.limits).length,9);
    const {CampaignHost}=await fromPin('src/host/campaign-host.ts');
    const host=new CampaignHost({factory});
    assert.equal(host.info.outputIds.length,5);assert.deepEqual(host.info.factory.scope.choices.map(c=>c.id),['normal','faults','adaptive']);
    await assert.rejects(()=>factory.create({scope:{normal:true},artifactDirectory:dir}),/Select all three/);
    await host.close();
  } finally {
    if(before.packet===undefined) delete process.env.CONTROLSBENCH_W4_PACKET;else process.env.CONTROLSBENCH_W4_PACKET=before.packet;
    if(before.sha===undefined) delete process.env.CONTROLSBENCH_W4_APPROVAL_SHA256;else process.env.CONTROLSBENCH_W4_APPROVAL_SHA256=before.sha;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('approval account baseline is aggregate, immutable and refuses reuse or incomplete accounting', () => {
  const dir = mkdtempSync(join(tmpdir(), 'w4-grant-'));
  try {
    const path=join(dir,'account.jsonl');
    const text=Array.from({length:4},(_,i)=>JSON.stringify({costUsd:1,totalUsd:i+1})).join('\n')+'\n';
    writeFileSync(path,text);
    const packet={sessionBaseline:{sha256:hash(text),conservativeUsd:4},maximumNewConservativeUsd:4};
    assert.equal(verifyAccountBaseline(packet,path),4);
    writeFileSync(path,text+JSON.stringify({costUsd:1,totalUsd:5})+'\n');
    assert.throws(()=>verifyAccountBaseline(packet,path),/changed since/);
    writeFileSync(path,text.trim());
    assert.throws(()=>verifyAccountBaseline({...packet,sessionBaseline:{...packet.sessionBaseline,sha256:hash(text.trim())}},path),/Incomplete/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('four simulated paid reservations stop before any fifth charge; no network or PLC', async () => {
  const {CampaignLedger}=await fromPin('src/campaign/ledger.ts');
  const {CampaignRuntime}=await fromPin('src/campaign/runtime.ts');
  const {CampaignBudget}=await fromPin('src/campaign/budget.ts');
  const {DurableSessionAccount}=await fromPin('src/campaign/session-account.ts');
  const dir=mkdtempSync(join(tmpdir(),'w4-turn-cap-'));
  const ledger=new CampaignLedger('paid-reservation-fixture');
  const account=new DurableSessionAccount(join(dir,'isolated-account.jsonl'),'paid-reservation-fixture');
  let calls=0;
  try {
    const runtime=new CampaignRuntime({ledger, provider:{id:'simulated-paid-envelope',paid:true,estimatedRequestUsd:1,async decide(){
      const turn=++calls;
      return {decision:{summary:`Read-only fixture turn ${turn}`,calls:[{id:`read-${turn}`,name:'inspect_evidence_window',arguments:{ids:[],afterSequence:0,throughSequence:ledger.state.sequence,limit:turn}}]},costUsd:1};
    }},budget:new CampaignBudget(ledger,undefined,5,account),paidAuthorized:true,evidenceClass:'fake_connector',claimBoundary:'Simulated accounting only; no model or PLC',
      categories:['normal'],spec:'Offline accounting fixture',signals:[],provenance:{spec:'fixture',ioMap:'fixture',plcBuild:'fixture',worldModule:'fixture',model:'simulated-paid-envelope',connector:'none'}});
    configureBoundedRuntime(runtime);
    await runtime.start(false);await runtime.runAgent();await runtime.stop('Offline fixture ended');
    assert.equal(calls,4,JSON.stringify(ledger.events.filter(e=>e.type==='campaign.state')));assert.equal(account.spentUsd,4);assert.equal(runtime.budget.guard.leases.size,4);
    assert.equal(ledger.events.filter(e=>e.type==='budget.accounted'&&e.data.phase==='reserved').length,4);
    assert(ledger.events.some(e=>e.type==='campaign.state'&&/turn limit/.test(e.data.reason)));
  } finally {account.close();ledger.close();rmSync(dir,{recursive:true,force:true});}
});

test('actual native live commissioning cannot masquerade as a paid campaign export', () => {
  const source=join(root,'artifacts/w4-readiness/e3469af/live-2026-11-02T13-10-27-030Z');
  const dir=mkdtempSync(join(tmpdir(),'w4-export-native-'));
  try {
    cpSync(source,dir,{recursive:true});rmSync(join(dir,'result.json'));
    assert.throws(()=>writeHeldRecord(dir),/owner-entry/);
    assert.equal(existsSync(join(dir,'held-state.json')),false);
    assert.throws(()=>writeHeldRecord(dir,{allowOffline:true}),/explicitly recorded fixture/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('real child/provider-loop wrapper writes exact recoverable state on turn-limit exit; refuses relabel, missing exit and overwrite', async () => {
  const {CampaignLedger}=await fromPin('src/campaign/ledger.ts');
  const {createCampaignFactory}=await fromPin('src/host/wonder-campaign-factory.ts');
  const {openOfflineWonderSession}=await fromPin('src/live/wonder-process/index.ts');
  const dir=mkdtempSync(join(tmpdir(),'w4-paid-wrapper-')), run=join(dir,'portal-fixture');
  const {mkdirSync}=await import('node:fs');mkdirSync(run);
  const ledger=new CampaignLedger('paid-wrapper-fixture',{file:join(run,'campaign.jsonl')});
  const lock=join(dir,'fake.lock'), stateFile=join(dir,'bench.json');
  let calls=0, session, wrapped;
  try {
    const factory=createCampaignFactory({provider:()=>({id:'four-turn-zero-cost-fixture',paid:false,estimatedRequestUsd:0,async decide(){
      const turn=++calls;
      return {decision:{summary:`Fixture observation ${turn}`,...(turn===1?{plan:{objective:'Source/cleanup only',experiments:[{id:'baseline',objective:'Observe the protocol fixture',category:'normal',requirements:[]}]}}:{}),calls:[{id:`observe-${turn}`,name:'observe_for_duration',arguments:{durationMs:100+turn}}]},costUsd:0};
    }}),openSession:async context=>session=await openOfflineWonderSession(context,{transportModule:join(pinned,'test/fixtures/w4-bench-transport.ts'),transportOptions:{stateFile},ownershipPath:lock})});
    const hosted=await factory.create({ledger,hmi:{async perform(){throw new Error('No HMI in fixture');}},scope:{normal:true},artifactDirectory:run});
    wrapped=boundHostedCampaign(hosted,run,{allowOffline:true});
    await wrapped.runtime.start(true);await wrapped.run();
    assert.equal(calls,4);assert.equal(session.process.channel.exit.code,0);assert.equal(existsSync(lock),false);
    const record=json(join(run,'held-state.json')), result=json(join(run,'result.json'));
    assert.equal(result.status,'held');assert.equal(result.scope,'offline-fake-transport');assert.equal(result.campaignStatus,'stopped');
    assert.equal(record.lastAcknowledgedCommit.sequence,record.plc.appliedSequence);
    for(const [file,want] of Object.entries(record.evidence)) assert.equal(hash(readFileSync(join(run,file))),want);
    readLedger(join(run,'campaign.jsonl'));
    // Existing recovery reads this new format without any adapter/runtime change.
    const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^OPC_|KEY|TOKEN|SECRET|PASSWORD|^CONTROLSBENCH_WONDER/i.test(k)));
    const args=[join(pinned,'scripts/recover-w4-held.js'),run,'--offline','--artifacts',dir,'--ownership',lock,'--transport-module',join(pinned,'test/fixtures/w4-bench-transport.ts'),'--transport-options',JSON.stringify({stateFile})];
    const inspection=spawnSync(process.execPath,args,{encoding:'utf8',env,windowsHide:true,timeout:30000});
    assert.equal(inspection.status,0,inspection.stdout+inspection.stderr);
    assert.match(inspection.stdout,/no_reconciliation_required/);
    assert.throws(()=>writeHeldRecord(run,{allowOffline:true}),/already exists/);
    const saved=readFileSync(join(run,'wonder-process/parent-boundary.jsonl'),'utf8');
    rmSync(join(run,'result.json'));rmSync(join(run,'held-state.json'));
    writeFileSync(join(run,'wonder-process/parent-boundary.jsonl'),saved.split('\n').filter(l=>!l.includes('"kind":"child.exit"')).join('\n'));
    assert.throws(()=>writeHeldRecord(run,{allowOffline:true}),/terminal child-exit evidence/);
    assert.equal(existsSync(join(run,'held-state.json')),false);
  } finally {await wrapped?.dispose();await session?.dispose();ledger.close();rmSync(dir,{recursive:true,force:true});}
});
