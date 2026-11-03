// External composition around the immutable e3469af runtime; no second executor/ledger.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve, dirname, sep} from 'node:path';
import {configuration, fromPin, hash, hashFile, json, root, verifyAccountBaseline, boundHostedCampaign, trialEnvelope} from './support.mjs';
const {acceptedBudgetLimits} = await fromPin('src/campaign/budget.ts');
const {commissioningQualification}=await fromPin('scripts/lib/w4-commissioning.ts');

export function createCampaignFactory() {
  const packetPath = process.env.CONTROLSBENCH_W4_PACKET;
  assert(packetPath && process.env.CONTROLSBENCH_W4_APPROVAL_SHA256, 'Paid W4 requires the reviewed packet and explicit matching authorization');
  const bytes = readFileSync(resolve(packetPath)), packet = JSON.parse(bytes);
  assert.equal(hash(bytes), process.env.CONTROLSBENCH_W4_APPROVAL_SHA256, 'Authorization packet differs from reviewed bytes');
  assert.equal(packet.ownerCommit, configuration.sourceCommit);
  const turns = trialEnvelope(packet);
  const longProof=packet.approvalRevision?.contract==='controlsbench.w4-full-proof-approval.v2';
  const resume=longProof||['controlsbench.w4-resume-approval.v1','controlsbench.w4-full-proof-approval.v1'].includes(packet.approvalRevision?.contract);
  for (const [path, expected] of Object.entries(packet.launchSourceHashes)) assert.equal(hashFile(join(root, path)), expected, `Launch source changed: ${path}`);
  let delegate;
  return {
    id: 'wonder-w4-qualified-m8', label: 'Muse Wonder 1.0 · bounded live W4', evidenceClass: 'live_plc',
    claimBoundary: 'Live Wonder-directed experiment; W4 verdict requires normal/fault/new evidence-dependent follow-up audit. HMI observation is separate.',
    connectorId: 'isolated-m8-process-v1', supportsExitSimulation: true,
    outputIds: ['Motor_RunCmd', 'D1_ExtendCmd', 'D2_ExtendCmd', 'StackLight_Red', 'StackLight_Green'],
    // Match the standard factory's host contract; the envelope supplements its existing limits.
    limits: {...acceptedBudgetLimits,...(longProof?{perRequestUsd:packet.perRequestAdmissionUsd,campaignHardUsd:(turns+1)*packet.perRequestAdmissionUsd,sessionHardUsd:packet.sessionHardUsd}:{})},
    scope: {mode: 'categories', choices: [...(resume?[]:[{id:'normal',title:'Normal operation'}]),{id: 'faults', title: 'Declared faults'}, {id: 'adaptive', title: 'Evidence-dependent follow-up'}],
      description: `One bounded ${turns}-request trial within ${packet.approvalRevision?'the explicit expanded review':'the remaining original approval'}: normal, declared fault and an observation-dependent follow-up. No HMI operation or PLC/world edits.`},
    async create(context) {
      assert.deepEqual(Object.entries(context.scope).filter(([, enabled]) => enabled).map(([id]) => id).sort(), resume?['adaptive','faults']:['adaptive', 'faults', 'normal'], resume?'Select fault and follow-up categories':'Select all three W4 categories');
      assert(context.artifactDirectory, 'Persistent campaign directory required');
      const bench=resume?verifyResumeBench(packet,resolve(packetPath)):null;
      verifyAccountBaseline(packet); // Checked before the original factory takes its durable lock.
      writeFileSync(join(context.artifactDirectory, 'w4-approval.json'), bytes, {flag: 'wx'});
      context.ledger.append('world.evidence', {source: {kind: 'paid_w4_approval', packetSha256: hash(bytes), maximumModelRequests: turns, maximumNewConservativeUsd: packet.maximumNewConservativeUsd,
        maximumOutputTokens: packet.maximumOutputTokens ?? 4000, aggregateConservativeCeilingUsd: packet.aggregateConservativeCeilingUsd}}, 'truth');
      if(bench)context.ledger.append('world.evidence',{source:{kind:'native_bench_qualification',resultSha256:bench.resultSha256,sourceCommit:configuration.sourceCommit,modelCalls:0}},'truth');
      delegate ??= (await fromPin('src/host/wonder-campaign-factory.ts')).createCampaignFactory({maxTransientRetries:packet.maxTransientRetries??0,retryDecisionTransport:packet.retryDecisionTransport===true,
        ...(longProof?{proofAllowance:{maximumRequests:turns,sessionHardUsd:packet.sessionHardUsd,maximumRejectedDecisions:packet.maxRejectedDecisions,requestAdmissionUsd:packet.perRequestAdmissionUsd}}:{}),provider: () => {
        const provider=new WonderResponsesProvider({apiKey:process.env.MODEL_API_KEY,explicitlyAuthorized:true,maxCalls:turns,maxOutputTokens:packet.maximumOutputTokens??4000,
          maxTransientRetries:packet.maxTransientRetries??0,retryDecisionTransport:packet.retryDecisionTransport===true,requestAdmissionUsd:packet.perRequestAdmissionUsd??1,journal:fileExchangeJournal(join(context.artifactDirectory,'wonder-exchanges.jsonl'))});
        if(packet.maxTransientRetries)assert.equal(provider.maxTransientRetries,packet.maxTransientRetries,'Selected provider pin lacks transient retry support');
        return provider;
      }});
      const hosted = await delegate.create(context);
      return boundHostedCampaign(hosted, context.artifactDirectory, {packet});
    }
  };
}

const {WonderResponsesProvider, fileExchangeJournal} = await fromPin('src/campaign/wonder-responses.ts');

export function verifyResumeBench(packet,packetPath) {
  const directory=dirname(resolve(packetPath)),state=json(join(directory,'launch-status.json'));
  assert.equal(state.phase,'bench-pass-ready-for-paid-start','Fresh bench qualification required before paid Start');
  assert.equal(state.packetSha256,hashFile(packetPath));assert.equal(state.sourceCommit,configuration.sourceCommit);
  const benchDirectory=resolve(state.benchDirectory);
  assert(benchDirectory.toLowerCase().startsWith(resolve(directory,'bench-check').toLowerCase()+sep),'Bench record outside this packet');
  const result=json(join(benchDirectory,'result.json'));
  assert.equal(result.status,'pass');assert.equal(result.scope,'live-m8');assert.equal(result.modelCalls,0);assert.equal(result.paidCalls,0);
  assert.equal(result.qualification.passed,true);assert.equal(result.identities.module.commit,configuration.sourceCommit);
  assert.deepEqual(commissioningQualification(result.measurements),{passed:true,failures:[]},'Native timing/lease measurements must qualify');
  assert(Object.keys(result.evidenceHashes).length>=9,'Native qualification evidence is incomplete');
  assert.equal(result.finalState.postStopMatchesApplied,true);
  assert.equal(result.finalState.ownership,'released');assert.deepEqual(result.finalState.postStopBaselineMismatches,[]);
  for(const[f,h]of Object.entries(result.evidenceHashes))assert.equal(hashFile(join(benchDirectory,f)),h);
  return {resultSha256:hashFile(join(benchDirectory,'result.json'))};
}
