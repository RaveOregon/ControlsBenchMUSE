// Export using the S2 ledger codec; the older immutable child does not know HMI assessments.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readLedger, report } from "./ledger.ts";
import { deriveHeldState, readJsonl, recordedChildExited } from "../../scripts/lib/w4-commissioning.ts";
import { verifyJournal } from "../hmi/journal.ts";

const sha=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
export function writeS2HeldRecord(directory:string,options:{allowOffline?:boolean}={}) {
  directory=resolve(directory);
  for(const file of ["result.json","report.json","held-state.json"])assert(!existsSync(join(directory,file)),"Never overwrite prior S2 evidence");
  const events=readLedger(join(directory,"campaign.jsonl")),reconstructed=report(events);
  assert(["completed","failed","stopped"].includes(reconstructed.status));
  const lifecycle=readJsonl(join(directory,"wonder-process/child-lifecycle.jsonl")),boundary=readJsonl(join(directory,"wonder-process/parent-boundary.jsonl"));
  const loaded=lifecycle.find(e=>e.kind==="loaded"),acquired=lifecycle.find(e=>e.kind==="ownership.acquired"),exit=boundary.filter(e=>e.kind==="child.exit").at(-1);
  assert(loaded&&acquired&&exit,"Require the loaded, owned and exited isolated child");
  assert.equal(loaded.offline,!!options.allowOffline);assert.equal(reconstructed.evidenceClass,options.allowOffline?"fake_connector":"live_plc");
  const owner=events.find(e=>e.type==="world.evidence"&&(e.data.source as any)?.kind==="owner_adapter_entry")?.data.source as any;
  if(!options.allowOffline)assert.equal(owner?.ownerCommit,"503abd3b895cb2fc03853a9ec2d75166544e2a59");
  const record=deriveHeldState({directory,campaignId:reconstructed.campaignId,reason:"S2 ended; retain original field image and inspect current PLC state before another campaign",ownershipPath:acquired.path,
    ledgerEvents:events,identities:{module:{commit:owner?.ownerCommit??"offline"},worldSha256:loaded.worldSha256,projectSha256:loaded.projectSha256},childExit:{code:exit.code,signal:exit.signal},postStop:null});
  assert(recordedChildExited(record,boundary));assert(record.lastAcknowledgedCommit&&record.lastObservation);
  const approval=join(directory,"w4-approval.json");
  if(!options.allowOffline){
    const source=events.find(e=>e.type==="world.evidence"&&(e.data.source as any)?.kind==="paid_w4_approval")?.data.source as any;
    assert.equal(source?.packetSha256,sha(approval));record.evidence["w4-approval.json"]=sha(approval);
    const journal=join(directory,"../..","journal.jsonl"),bytes=readFileSync(journal),end=bytes.lastIndexOf(10)+1;assert(end>0);
    const prefix=bytes.subarray(0,end);
    writeFileSync(join(directory,"hmi-journal-prefix.jsonl"),prefix,{flag:"wx"});verifyJournal(join(directory,"hmi-journal-prefix.jsonl"));
    record.evidence["hmi-journal-prefix.jsonl"]=sha(join(directory,"hmi-journal-prefix.jsonl"));
    for(const file of readdirSync(join(directory,"vision-frames")))record.evidence[`vision-frames/${file}`]=sha(join(directory,"vision-frames",file));
  }
  for(const[file,h]of Object.entries(record.evidence))assert.equal(sha(join(directory,file)),h);
  const held=JSON.stringify(record,null,2)+"\n";
  writeFileSync(join(directory,"report.json"),JSON.stringify(reconstructed,null,2)+"\n",{flag:"wx"});
  writeFileSync(join(directory,"held-state.json"),held,{flag:"wx"});
  const result={status:"held",contract:"controlsbench.s2-post-run.v1",campaignStatus:reconstructed.status,campaignId:reconstructed.campaignId,
    scope:options.allowOffline?"offline-fake-transport":"live-m8-hmi",heldState:{file:"held-state.json",sha256:createHash("sha256").update(held).digest("hex")},
    claimBoundary:"Retained-image record, not a failure verdict or recovery; final fresh PLC inspection and image/action/ack audit decide S2 proof"};
  writeFileSync(join(directory,"result.json"),JSON.stringify(result,null,2)+"\n",{flag:"wx"});return result;
}
