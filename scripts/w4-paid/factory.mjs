// External composition around the immutable e3469af runtime; no second executor/ledger.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {configuration, fromPin, hash, hashFile, json, root, verifyAccountBaseline, boundHostedCampaign} from './support.mjs';
const {acceptedBudgetLimits} = await fromPin('src/campaign/budget.ts');

export function createCampaignFactory() {
  const packetPath = process.env.CONTROLSBENCH_W4_PACKET;
  assert(packetPath && process.env.CONTROLSBENCH_W4_APPROVAL_SHA256, 'Paid W4 requires the reviewed packet and explicit matching authorization');
  const bytes = readFileSync(resolve(packetPath)), packet = JSON.parse(bytes);
  assert.equal(hash(bytes), process.env.CONTROLSBENCH_W4_APPROVAL_SHA256, 'Authorization packet differs from reviewed bytes');
  assert.equal(packet.ownerCommit, configuration.sourceCommit);
  assert.equal(packet.maximumNewConservativeUsd, 4); assert.equal(packet.maximumModelRequests, 4);
  for (const [path, expected] of Object.entries(packet.launchSourceHashes)) assert.equal(hashFile(join(root, path)), expected, `Launch source changed: ${path}`);
  let delegate;
  return {
    id: 'wonder-w4-qualified-m8', label: 'Muse Wonder 1.0 · bounded live W4', evidenceClass: 'live_plc',
    claimBoundary: 'Live Wonder-directed experiment; W4 verdict requires normal/fault/new evidence-dependent follow-up audit. HMI observation is separate.',
    connectorId: 'isolated-m8-process-v1', supportsExitSimulation: true,
    outputIds: ['Motor_RunCmd', 'D1_ExtendCmd', 'D2_ExtendCmd', 'StackLight_Red', 'StackLight_Green'],
    // Match the standard factory's host contract; the envelope supplements its existing limits.
    limits: {...acceptedBudgetLimits},
    scope: {mode: 'categories', choices: [{id: 'normal', title: 'Normal operation'}, {id: 'faults', title: 'Declared faults'}, {id: 'adaptive', title: 'Evidence-dependent follow-up'}],
      description: 'One bounded four-request trial: normal, declared fault and an observation-dependent follow-up. No HMI operation or PLC/world edits.'},
    async create(context) {
      assert.deepEqual(Object.entries(context.scope).filter(([, enabled]) => enabled).map(([id]) => id).sort(), ['adaptive', 'faults', 'normal'], 'Select all three W4 categories');
      assert(context.artifactDirectory, 'Persistent campaign directory required');
      verifyAccountBaseline(packet); // Checked before the original factory takes its durable lock.
      writeFileSync(join(context.artifactDirectory, 'w4-approval.json'), bytes, {flag: 'wx'});
      context.ledger.append('world.evidence', {source: {kind: 'paid_w4_approval', packetSha256: hash(bytes), maximumModelRequests: 4, maximumNewConservativeUsd: 4}}, 'truth');
      delegate ??= (await fromPin('src/host/wonder-campaign-factory.ts')).createCampaignFactory();
      const hosted = await delegate.create(context);
      return boundHostedCampaign(hosted, context.artifactDirectory);
    }
  };
}
