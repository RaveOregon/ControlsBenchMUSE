// Paid W4 preparation around the unchanged, live-qualified engine. No transport is opened here.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const configuration = JSON.parse(readFileSync(join(root, 'artifacts/w4-readiness/e3469af/launch.json'), 'utf8'));
export const pinned = configuration.pinnedCheckout;
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const hashFile = path => hash(readFileSync(path));
export const json = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
export const fromPin = path => import(pathToFileURL(join(pinned, path)).href);
export const {readLedger, report} = await fromPin('src/campaign/ledger.ts');
export const {deriveHeldState, readJsonl, recordedChildExited} = await fromPin('scripts/lib/w4-commissioning.ts');
export const {commonWonderPaths} = await fromPin('src/campaign/wonder-paths.ts');
export const terminal = new Set(['completed', 'stopped', 'failed']);
export const objective = {
  source: 'engineer-selected W4 proof objective',
  goal: 'Use the accepted specification to plan and perform a normal-operation experiment and a declared fault experiment on the live PLC. From returned PLC evidence, choose and execute a genuinely new follow-up investigation; cite its motivating observations. Produce grounded findings and finish with the controller Stopped, fault-free, no tracked item or pending completion.',
  discretion: 'Choose your own hypotheses, fault, stimuli, observations and follow-up. No scripted sequence or predetermined verdict is supplied. Four model decisions are available; group compatible semantic actions thoughtfully. If the budget or evidence is insufficient, report the missing proof honestly.',
  operation: 'WCS assign_route is separate from carton requestedRoute metadata. Observe the actual completion sequence before acknowledging it. Stop and Reset are distinct sequenced operator commands. Default hold freezes world advancement while PLC scans and timers continue; do not assume a held active carton stops its PLC transit timer. Engine streaming continues independently of reasoning.',
  boundaries: 'Preserved generated world 0.5.0; actual PLC build 8001/interface 1. No world/PLC edits, HMI operation, higher-rate qualification or automatic recovery. HMI pixels are separate engineer evidence.'
};

export function trialEnvelope(packet) {
  const turns = packet.maximumModelRequests;
  const wiggle=packet.approvalRevision?.contract==='controlsbench.w4-expanded-approval.v2';
  assert(Number.isInteger(turns) && turns >= 1 && turns <= (wiggle?5:4), 'Invalid request allowance');
  assert.equal(packet.maximumNewConservativeUsd, turns, 'Each attempt needs a conservative dollar');
  const ceiling = wiggle ? 12 : packet.approvalRevision ? 11 : 8;
  if (packet.approvalRevision) {
    assert.equal(packet.approvalRevision.contract,wiggle?'controlsbench.w4-expanded-approval.v2':'controlsbench.w4-expanded-approval.v1');
    assert.equal(packet.approvalRevision.previousAggregateCeilingUsd,8);
    assert.equal(packet.sessionBaseline?.conservativeUsd,7,'Expanded review is tied to the existing seven-dollar account');
    assert.equal(turns,wiggle?5:4); assert.equal(packet.maximumOutputTokens,8000);
  }
  assert.equal(packet.aggregateConservativeCeilingUsd, ceiling, packet.approvalRevision ? `Expanded aggregate review is $${ceiling}` : 'Original aggregate approval is $8');
  assert(Number.isInteger(packet.sessionBaseline?.conservativeUsd) && packet.sessionBaseline.conservativeUsd >= 4);
  assert(packet.sessionBaseline.conservativeUsd + turns <= ceiling, 'Remaining original approval would be exceeded');
  assert(Number.isInteger(packet.maximumOutputTokens ?? 4000) && (packet.maximumOutputTokens ?? 4000)>=16 && (packet.maximumOutputTokens ?? 4000)<=8000,'Invalid provider output allowance');
  assert(Number.isInteger(packet.maxTransientRetries ?? 0) && (packet.maxTransientRetries ?? 0)>=0 && (packet.maxTransientRetries ?? 0)<=1
    && (packet.maxTransientRetries ?? 0)<turns,'Invalid trial transient retry allowance');
  return turns;
}

export function trialObjective(turns) {
  return {...objective, discretion: objective.discretion.replace('Four model decisions', `${turns} model decisions`)};
}

/** Refuses a second/new campaign after this approval's baseline account has changed. */
export function verifyAccountBaseline(packet, path = commonWonderPaths().session) {
  const bytes = existsSync(path) ? readFileSync(path) : Buffer.alloc(0);
  assert.equal(hash(bytes), packet.sessionBaseline.sha256, 'Durable account changed since this one-campaign approval; review before another run');
  let total = 0;
  const text = bytes.toString('utf8');
  assert(!text || text.endsWith('\n'), 'Incomplete account');
  for (const line of text.trim() ? text.trim().split('\n') : []) {
    const record = JSON.parse(line);
    assert.equal(record.costUsd, 1); assert.equal(record.totalUsd, ++total);
  }
  assert.equal(total, packet.sessionBaseline.conservativeUsd);
  if (packet.aggregateConservativeCeilingUsd !== undefined) trialEnvelope(packet);
  assert(total + packet.maximumNewConservativeUsd <= 15, 'Durable session cap would be exceeded');
  return total;
}

/** Derive the existing recovery format from this actual campaign's original journals.
 * No field value, acknowledgement or source record is synthesized; no PLC read/write occurs.
 * 'held' describes the retained image, not a verdict about campaign success. */
export function writeHeldRecord(directory, {allowOffline = false} = {}) {
  directory = resolve(directory);
  assert(!existsSync(join(directory, 'result.json')) && !existsSync(join(directory, 'held-state.json')), 'Post-run record already exists; never overwrite it');
  const events = readLedger(join(directory, 'campaign.jsonl')), reconstructed = report(events);
  assert(terminal.has(reconstructed.status), 'Stop/finalize the campaign before exporting its state');
  const lifecycle = readJsonl(join(directory, 'wonder-process/child-lifecycle.jsonl'));
  const boundary = readJsonl(join(directory, 'wonder-process/parent-boundary.jsonl'));
  const loaded = lifecycle.find(e => e.kind === 'loaded');
  const acquired = lifecycle.find(e => e.kind === 'ownership.acquired');
  const exit = boundary.filter(e => e.kind === 'child.exit').at(-1);
  assert(loaded && acquired && exit, 'Loaded world, ownership and terminal child-exit evidence are required');
  if (!allowOffline) {
    assert.equal(loaded.offline, false, 'Fixture transport cannot become live recovery evidence');
    assert.equal(reconstructed.evidenceClass, 'live_plc');
    const entry = json(join(directory, 'owner-entry.json'));
    const approvalBytes = readFileSync(join(directory, 'w4-approval.json'));
    const approved = events.find(e => e.type === 'world.evidence' && e.data.source?.kind === 'paid_w4_approval')?.data.source;
    assert.equal(approved?.packetSha256, hash(approvalBytes), 'Approval record differs from original campaign evidence');
    const recordedEntry = events.find(e => e.type === 'world.evidence' && e.data.source?.kind === 'owner_adapter_entry')?.data.source;
    assert.equal(recordedEntry?.ownerCommit, configuration.sourceCommit);
    assert.equal(recordedEntry?.entrySha256, entry.entrySha256);
    assert.equal(hashFile(join(pinned, 'src/live/wonder-process/index.ts')), entry.entrySha256);
  } else assert.equal(loaded.offline, true, 'Offline seam accepts only an explicitly recorded fixture');
  assert.equal(hashFile(join(pinned, 'codesys/conveyordemo.project')), loaded.projectSha256);
  assert.equal(hashFile(join(pinned, 'artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts')), loaded.worldSha256);
  const state = deriveHeldState({directory, campaignId: reconstructed.campaignId, reason: 'Bounded Wonder campaign ended; retained input image needs current-state inspection before another run',
    ownershipPath: acquired.path, ledgerEvents: events, identities: {module: {commit: configuration.sourceCommit}, worldSha256: loaded.worldSha256, projectSha256: loaded.projectSha256},
    childExit: {code: exit.code, signal: exit.signal}, postStop: null});
  assert(recordedChildExited(state, boundary), 'Exit must identify the exact acquired fork, not a reused PID or IPC disconnect');
  assert(state.lastAcknowledgedCommit && state.lastObservation, 'No acknowledged state/observation available; manual inspection is required');
  for (const file of ['owner-entry.json', 'w4-approval.json']) if (existsSync(join(directory, file))) state.evidence[file] = hashFile(join(directory, file));
  // Capture the journals after the exact fork exited; then check they did not change while deriving.
  for (const [file, expected] of Object.entries(state.evidence)) assert.equal(hashFile(join(directory, file)), expected);
  const heldBytes = JSON.stringify(state, null, 2) + '\n';
  if (existsSync(join(directory, 'report.json'))) assert.deepEqual(json(join(directory, 'report.json')), reconstructed, 'Existing report differs from the authoritative ledger');
  else writeFileSync(join(directory, 'report.json'), JSON.stringify(reconstructed, null, 2) + '\n', {flag: 'wx'});
  writeFileSync(join(directory, 'held-state.json'), heldBytes, {flag: 'wx'});
  const result = {schemaVersion: 1, contract: 'controlsbench.w4-paid-post-run.v1', status: 'held', campaignStatus: reconstructed.status,
    scope: allowOffline ? 'offline-fake-transport' : 'live-m8', sourceCommit: configuration.sourceCommit, directory,
    claimBoundary: 'Post-run retained-image record only; not a live recovery, W4 pass or PLC-state inspection',
    heldState: {file: 'held-state.json', sha256: hash(heldBytes)}, evidenceHashes: state.evidence,
    currentInspectionRequired: true, recovery: `Run the pinned recover-w4-held.js with this directory and --artifacts "${dirname(directory)}"; inspect-only by default. Stop the owner host before recovery.`,
    reportSha256: hash(JSON.stringify(reconstructed)), liveRecoveryQualified: false};
  writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  return result;
}

/** Reuse the provider/runtime unchanged. Limit before reservation so a fifth failed provider
 * call cannot consume another conservative dollar after four legitimate requests. */
export function configureBoundedRuntime(runtime, packet) {
  const turns = packet ? trialEnvelope(packet) : 4;
  const retries=packet?.maxTransientRetries??0;
  if(retries) {
    assert.equal(runtime.transientRetryPolicy,'meta-503-v1','Selected runtime pin lacks verified transient retry support');
    assert.equal(runtime.options.provider.maxTransientRetries,retries,'Provider and runtime retry policies must match');
  }
  runtime.options.maxTransientRetries=retries;
  if(turns===5) {
    assert.equal(runtime.budget.guard.campaignSpentUsd,0,'Configure before any reservation');
    assert.equal(runtime.budget.guard.leases.size,0,'Configure before any reservation');
    // The generic guard hard-stops during settlement at its threshold, before
    // executing that decision. Keep one unit of internal headroom, as the original
    // four-turn/$5 composition does. Five-turn and provider caps bound charges to $5.
    runtime.budget.guard.limits.campaignHardUsd=6;
    runtime.ledger.append('world.evidence',{source:{kind:'paid_w4_budget_configuration',maximumPaidReservations:5,maximumConservativeUsd:5,
      genericSettlementStopUsd:6,reason:'Allow the fifth approved response to execute; no sixth runtime/provider request permitted'}},'truth');
  }
  runtime.options.maxTurns = turns;
  runtime.options.capabilities = {...runtime.options.capabilities, engineerObjective: trialObjective(turns),
    approvedRequestEnvelope: {maximumModelRequests: turns, maximumNewConservativeUsd: turns, maximumOutputTokens: packet?.maximumOutputTokens ?? 4000, maxTransientRetries:retries,
      aggregateConservativeCeilingUsd: packet?.aggregateConservativeCeilingUsd ?? 8, source: packet?.approvalRevision ? 'explicit expanded packet approval required; existing account preserved' : 'remaining original approval; no accounting reset'}};
}

export function boundHostedCampaign(hosted, directory, {allowOffline = false, packet} = {}) {
  configureBoundedRuntime(hosted.runtime, packet);
  let finished;
  const dispose = () => finished ??= Promise.resolve(hosted.dispose?.());
  return {...hosted, dispose, async run() {
    try { await hosted.runtime.runAgent(); }
    finally {
      await hosted.runtime.stop('Bounded W4 run ended; preserve observations and inspect retained inputs');
      await dispose();
      writeHeldRecord(directory, {allowOffline});
    }
  }};
}
