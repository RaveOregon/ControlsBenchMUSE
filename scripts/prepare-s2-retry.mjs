// Repeat only the still-unexecuted HMI checkpoint, preserving its first attempt.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),json=p=>JSON.parse(readFileSync(p,'utf8'));
const first=join(root,'artifacts/s2/2026-11-03T13-58-03-806Z-live'),old=json(join(first,'packet.json'));
assert.equal(sha(join(first,'packet.json')),'c37e23d72f3e2af6bada9d46b1cfbed9bc4b8d871d01e9ba10300abd00183283');
const failed='host/runs/2026-11-03T23-10-57-424Z-live_plc/portal-host/portal-20261103231427237-1',audit=json(join(first,failed,'s2-audit.json')),held=json(join(first,failed,'held-state.json'));
assert.equal(audit.status,'partial');assert.equal(audit.modelRequests,1);assert.equal(audit.verifiedHmiActions.length,0);
assert.equal(held.lastObservation.values['controller.Mode'],0);assert.equal(held.lastObservation.values['controller.FaultCode'],0);assert.equal(held.inFlightCommit,null);assert.deepEqual(held.inFlightCommands,[]);assert.deepEqual(held.outstandingWrites.atClose,[]);assert.equal(held.outstandingWrites.childClosed,true);
for(const[p,h]of Object.entries(old.sourceHashes))assert.equal(sha(join(root,p)),h,'Core S2 source must remain unchanged');
const account=join(old.repositoryRoot,'artifacts/wonder/session.jsonl'),charges=readFileSync(account,'utf8').trim().split('\n').map(JSON.parse);assert.equal(charges.at(-1).totalUsd,110);
const original=readFileSync(join(root,'scripts/launch-s2.ps1'),'utf8');
assert(original.includes("if($s2Report.status -ne 'completed')"));assert(original.includes("'--capture-ms','2000'"));
const launcher=original.replace("if($s2Report.status -ne 'completed')","if($s2Report.status -notin @('completed','stopped','failed'))")
  .replace("'--capture-ms','2000'","'--capture-ms','3000','--shared-poll-ms','2000'");
writeFileSync(join(root,'scripts/launch-s2-retry.ps1'),launcher,{flag:'wx'});
const directory=join(root,'artifacts/s2',new Date().toISOString().replace(/[:.]/g,'-')+'-live-retry');mkdirSync(directory);
const packet={...old,preparedAtIso:new Date().toISOString(),maximumRequests:7,maximumNewConservativeUsd:35,accountBaseline:{totalUsd:110,sha256:sha(account)},
  previousHost:{pid:27784,pinDirectoryName:'s2-hmi',campaignId:'portal-20261103231427237-1'},bootIdentity:'1787886077538',artifactRoot:join(directory,'host'),
  objective:{...old.objective,discretion:old.objective.discretion.replace('At most 8','At most 7')},
  retryReview:{firstPacketSha256:sha(join(first,'packet.json')),firstAuditSha256:sha(join(first,failed,'s2-audit.json')),heldStateSha256:sha(join(first,failed,'held-state.json')),
    reason:'The first decision returned but was cancelled before any action when a coherent link metadata read stalled and PLC ConnectorStale asserted. PLC stayed clean. The original attempt remains immutable. Reduce only background observer load: periodic capture3000ms, shared HMI polling2000ms; on-demand action frames remain. Engine/PLC thresholds and core code unchanged. Seven remaining requests plus the first request fit the original eight-attempt envelope.'},
  sourceHashes:{...old.sourceHashes,'scripts/prepare-s2-retry.mjs':sha(join(root,'scripts/prepare-s2-retry.mjs')),'scripts/launch-s2-retry.ps1':sha(join(root,'scripts/launch-s2-retry.ps1'))}};
writeFileSync(join(directory,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
writeFileSync(join(root,'artifacts/s2/latest-live.json'),JSON.stringify({directory,packetSha256:sha(join(directory,'packet.json'))},null,2)+'\n');
console.log(JSON.stringify({directory,packetSha256:sha(join(directory,'packet.json')),maximumRequests:7,aggregateConservativeCeiling:145,realModelCalls:0,plcConnections:0}));
