// Offline audit of the original paid retry and its recorded cleanup; never opens a PLC/API.
import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fromPin,json,hashFile,readLedger,readJsonl,report,commonWonderPaths} from './support.mjs';
const {digest}=await fromPin('src/campaign/ledger.ts');
const directory=resolve(process.argv[2]);
const record=json(join(directory,'held-state.json')),saved=json(join(directory,'result.json'));
assert.equal(saved.heldState.sha256,hashFile(join(directory,'held-state.json')));
for(const [f,h]of Object.entries(record.evidence))assert.equal(hashFile(join(directory,f)),h);
const events=readLedger(join(directory,'campaign.jsonl'));
assert.deepEqual(report(events),json(join(directory,'report.json')));
const exchanges=readJsonl(join(directory,'wonder-exchanges.jsonl'));
for(const x of exchanges.filter(x=>x.phase==='response'))assert.equal(digest(x.responseText),x.responseHash);
const responses=exchanges.filter(x=>x.phase==='response'&&x.endpoint==='responses').map(x=>({httpStatus:x.httpStatus,...JSON.parse(x.responseText)}));
assert.equal(responses.length,2);assert.equal(responses[0].status,'completed');assert.equal(responses[1].status,'incomplete');
assert.equal(responses[1].incomplete_details.reason,'max_output_tokens');
assert(!responses[1].output.some(x=>x.type==='function_call'),'No incomplete decision was executed');
const firstCall=responses[0].output.find(x=>x.type==='function_call');
const next=JSON.parse(exchanges.find(x=>x.phase==='request'&&x.endpoint==='responses'&&x.turn===2).requestText);
assert.equal(next.previous_response_id,responses[0].id);
const paired=next.input.find(x=>x.type==='function_call_output');assert.equal(paired.call_id,firstCall.call_id);
const tools=JSON.parse(paired.output).results;
for(const r of tools) {
  const original=events.find(x=>x.type==='action.'+r.status&&x.data.actionId===r.actionId);
  assert(original,'Missing original terminal action '+r.actionId);
  for(const k of ['actionId','status','message','evidenceRefs','value'])assert.deepEqual(r[k],original.data[k]);
}
const normal=events.find(x=>x.type==='plc.output'&&x.data.values?.['controller.CountExitA']===1&&x.data.values?.['controller.CompletionPending']===true&&x.data.values?.['controller.CompletionItemId']===101&&x.data.values?.['controller.CompletionExit']===1&&x.data.values?.['controller.CompletionDisposition']===1);
assert(normal,'No real normal-A completion proof');
assert.equal(events.filter(x=>x.type==='budget.accounted'&&x.data.phase==='reserved').length,2);
const recoveryStatus=json(join(directory,'completion-recovery-status.json'));assert.equal(recoveryStatus.status,'pass');
const recovery=json(join(recoveryStatus.recoveryDirectory,'result.json'));assert.equal(recovery.status,'pass');
assert.equal(hashFile(join(recoveryStatus.recoveryDirectory,'transport.jsonl')),recovery.transportSha256);
assert.deepEqual(recovery.final.stoppedBaselineMismatches,[]);assert.equal(recovery.ownershipAfter,'released');
assert(!existsSync(commonWonderPaths().ownership),'A writer still owns the PLC');
const account=readJsonl(commonWonderPaths().session);assert.equal(account.at(-1).totalUsd,7);
const usage=responses.map(r=>({responseId:r.id,status:r.status,inputTokens:r.usage.input_tokens,outputTokens:r.usage.output_tokens,reasoningTokens:r.usage.output_tokens_details.reasoning_tokens}));
const audit={verifiedAtIso:new Date().toISOString(),status:'partial',claimBoundary:'Real Wonder normal A sort proved; fault, adaptive follow-up, HMI operation and full W4 pass remain unproved',
  campaignId:record.campaignId,ledgerEvents:events.length,originalEvidenceHashesVerified:Object.keys(record.evidence).length,exactReportReconstruction:true,
  responseHashesVerified:exchanges.filter(x=>x.phase==='response').length,responseToolLineageVerified:true,terminalToolResultsVerified:tools.length,normalCompletionEvidence:normal.id,
  normalPlcValues:normal.data.values,modelRequests:2,usage,estimatedUncachedTokenCostUsd:usage.reduce((sum,u)=>sum+(u.inputTokens*4+u.outputTokens*20)/1e6,0),
  priceBoundary:'Uncached Standard estimate, not an invoice; no cache discount assumed',conservativeNewUsd:2,conservativeSessionUsd:7,remainingOriginalConservativeUsd:1,
  failure:{kind:'provider_output_limit',reason:responses[1].incomplete_details.reason,maximumOutputTokens:next.max_output_tokens,incompleteDecisionExecuted:false},
  recovery:{directory:recoveryStatus.recoveryDirectory,resultSha256:hashFile(join(recoveryStatus.recoveryDirectory,'result.json')),transportSha256:recovery.transportSha256,plan:recovery.plan,final:recovery.final,ownershipAfter:recovery.ownershipAfter},
  next:'Reduce/structure reasoning and result context; allow sufficient output for high reasoning plus decision. A new trial must derive its remaining allowance from the original ceiling, not reuse this packet.'};
writeFileSync(join(directory,'paid-retry-audit.json'),JSON.stringify(audit,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:audit.status,modelRequests:2,terminalResults:tools.length,normalCompletionEvidence:normal.id,estimatedUncachedTokenCostUsd:audit.estimatedUncachedTokenCostUsd,recovered:true,remainingOriginalConservativeUsd:1}));
