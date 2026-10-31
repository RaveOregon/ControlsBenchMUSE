#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const relayNodeOpcua = path.resolve(
  __dirname, '..', 'codesys_handoff', 'browser_hmi_handoff', 'opcua_relay',
  'node_modules', 'node-opcua'
);
const { AttributeIds, TimestampsToReturn } = require(relayNodeOpcua);
const {
  OPCUAClient, DataType, MessageSecurityMode, SecurityPolicy, UserTokenType,
  boolFields, realFields, outputFields, activeNames, sleep, u64ToBigInt,
  browseWanted, readMany, writeMany, imageWrites, compareActive,
} = require('./probe-m1.cjs');

const endpointUrl = process.env.OPC_ENDPOINT || 'opc.tcp://127.0.0.1:4840';
const userName = process.env.OPC_USER;
const password = process.env.OPC_PASSWORD || '';
const durationSeconds = Number(process.env.M6_DURATION_SECONDS || '600');
const maxNewRuns = Number(process.env.M6_MAX_RUNS || '1');
const measurementScope = process.env.M6_SCOPE || 'full';
const resultPath = process.env.M6_OUTPUT || path.resolve(__dirname, '..', 'artifacts', 'm6-result.json');
const taskIntervalUs = 20000;
const omittedGapBoundaryUs = 30000;
const progressIntervalMs = 10000;

const controlNames = [
  'SimRequest', 'SimApplied', 'ConnectorStale', 'SessionResetRequest',
  'RequestedSlot', 'RequestedEpoch', 'RequestedSequence', 'WorkstationHeartbeat',
  'ActiveSlot', 'AppliedEpoch', 'AppliedSequence', 'PlcBootIdentity', 'PlcCycle',
  'AppliedCommitCount', 'SkippedSequenceCount', 'SessionResetCount', 'OutputCaptureCycle',
  'OutputCaptureTimeUs', 'PlcHeartbeat', 'PlcTimeUs',
];
const slotNames = [];
for (const slot of [0, 1]) {
  slotNames.push(`Slot${slot}_Valid`, `Slot${slot}_Epoch`, `Slot${slot}_Sequence`);
  for (const field of boolFields) slotNames.push(`Slot${slot}_${field}`);
  for (const field of realFields) slotNames.push(`Slot${slot}_${field}`);
  slotNames.push(`Slot${slot}_Encoder_Count`);
}
const timingNames = ['OutputCaptureCycle', 'OutputCaptureTimeUs', 'PlcHeartbeat', 'PlcTimeUs'];
const scenarios = [
  { id: 'subscribed-only', rateHz: null, description: 'full-demo subscription with a held committed image and no client writes' },
  { id: 'methodical-10hz', rateHz: 10, description: 'complete raw-image streaming at the qualified methodical rate' },
  { id: 'runtime-20hz', rateHz: 20, description: 'complete raw-image streaming at the failed M3 runtime candidate rate' },
  { id: 'maximum-demo-50hz', rateHz: 50, description: 'maximum negotiated full-demo OPC UA load' },
];
const runPlan = scenarios.flatMap((scenario) => [1, 2, 3].map((repeat) => ({ ...scenario, repeat })));
const selectedScenarios = measurementScope === 'hackathon'
  ? scenarios.filter((scenario) => scenario.id === 'methodical-10hz')
  : scenarios;
const selectedRunPlan = selectedScenarios.flatMap(
  (scenario) => [1, 2, 3].map((repeat) => ({ ...scenario, repeat }))
);

function createClient() {
  return OPCUAClient.create({
    applicationName: 'NodeOPCUA-Client',
    endpointMustExist: false,
    securityMode: MessageSecurityMode.SignAndEncrypt,
    securityPolicy: SecurityPolicy.Basic256Sha256,
    automaticallyAcceptUnknownCertificate: true,
    keepSessionAlive: true,
    connectionStrategy: { initialDelay: 250, maxRetry: 0 },
  });
}

async function connectFixture() {
  const client = createClient();
  await client.connect(endpointUrl);
  const session = await client.createSession({ type: UserTokenType.UserName, userName, password });
  const wanted = new Set([...controlNames, ...slotNames, ...activeNames, ...outputFields]);
  const nodes = await browseWanted(session, wanted);
  return { client, session, nodes };
}

async function closeFixture(fixture) {
  if (!fixture) return;
  try { await fixture.session.close(); } finally { await fixture.client.disconnect(); }
}

function readControlCpu() {
  try {
    const script = "$p=Get-Process -Name CODESYSControlService -ErrorAction SilentlyContinue|Select-Object -First 1;if($p){[pscustomobject]@{CpuSeconds=$p.CPU;Pid=$p.Id;LogicalProcessors=[Environment]::ProcessorCount}|ConvertTo-Json -Compress}";
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    }).trim();
    return output ? JSON.parse(output) : null;
  } catch { return null; }
}

function cpuDelta(start, end, elapsedSeconds) {
  if (!start || !end || start.Pid !== end.Pid) return null;
  const seconds = end.CpuSeconds - start.CpuSeconds;
  return {
    pid: end.Pid,
    cpuSecondsDelta: seconds,
    averageSingleCorePercent: (seconds / elapsedSeconds) * 100,
    logicalProcessors: end.LogicalProcessors,
  };
}

function encodedImage(epoch, sequence) {
  const salt = epoch & 0xffffn;
  const image = {};
  boolFields.forEach((field, index) => {
    image[field] = ((sequence + salt + BigInt(index)) & 1n) === 1n;
  });
  image.Belt_SpeedActual = Math.fround(Number((sequence + salt) % 1000n) / 10);
  image.Drive_Current = Math.fround(Number((sequence * 13n + salt) % 10000n) + 0.25);
  image.D1_Position = Math.fround(Number((sequence * 3n + salt) % 1000n) / 10);
  image.D2_Position = Math.fround(Number((sequence * 7n + salt) % 1000n) / 10);
  image.Encoder_Count = Number((sequence * 2654435761n + salt) & 0xffffffffn);
  return image;
}

function zeroImage() {
  const image = {};
  for (const name of boolFields) image[name] = false;
  for (const name of realFields) image[name] = 0;
  image.Encoder_Count = 0;
  return image;
}

async function resetBenchSession(session, nodes, state) {
  await writeMany(session, nodes, [{ name: 'SessionResetRequest', dataType: DataType.Boolean, value: false }]);
  await sleep(30);
  const before = await readMany(session, nodes, ['SessionResetCount']);
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'SimRequest', dataType: DataType.Boolean, value: true },
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: true },
  ]);
  const deadline = Date.now() + 3000;
  let resetObserved = false;
  while (Date.now() < deadline) {
    const values = await readMany(session, nodes, ['SessionResetCount', 'AppliedEpoch', 'AppliedSequence']);
    resetObserved = u64ToBigInt(values.SessionResetCount) > u64ToBigInt(before.SessionResetCount)
      && u64ToBigInt(values.AppliedEpoch) === 0n && u64ToBigInt(values.AppliedSequence) === 0n;
    if (resetObserved) break;
    await sleep(5);
  }
  if (!resetObserved) throw new Error('Session reset/timing start was not observed');
  await writeMany(session, nodes, [
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: false },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: '0' },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: '0' },
  ]);
  state.activeSlot = 255;
}

async function stopTiming(session, nodes) {
  await writeMany(session, nodes, [{ name: 'SimRequest', dataType: DataType.Boolean, value: false }]);
  await sleep(300);
  const values = await readMany(session, nodes, timingNames);
  const p50P95 = u64ToBigInt(values.OutputCaptureCycle);
  const p99Max = u64ToBigInt(values.OutputCaptureTimeUs);
  const jitterSamples = u64ToBigInt(values.PlcHeartbeat);
  const omittedMin = u64ToBigInt(values.PlcTimeUs);
  return {
    source: 'scan-resident FB_BenchTiming histogram; independent of IDE refresh',
    intervalUs: {
      min: Number(omittedMin & 0xffffffffn),
      p50: Number(p50P95 >> 32n),
      p95: Number(p50P95 & 0xffffffffn),
      p99: Number(p99Max >> 32n),
      max: Number(p99Max & 0xffffffffn),
    },
    absoluteJitterUs: { p99: Number(jitterSamples >> 32n) },
    sampleCount: Number(jitterSamples & 0xffffffffn),
    inferredOmittedGapCount: Number(omittedMin >> 32n),
    histogramBinWidthUs: 10,
    taskIntervalUs,
    inferredOmittedGapBoundaryUs: omittedGapBoundaryUs,
    watchdog: { enabled: false, source: 'accepted M0 task configuration' },
  };
}

async function waitWithProgress(label, seconds, extra = () => '') {
  const start = Date.now();
  const deadline = start + seconds * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.min(progressIntervalMs, deadline - Date.now()));
    const elapsed = (Date.now() - start) / 1000;
    process.stderr.write(`M6 ${label}: ${elapsed.toFixed(0)}/${seconds}s elapsed${extra()}\n`);
  }
}

async function createSubscription(session, nodes, requestedPublishingInterval) {
  const subscription = await session.createSubscription2({
    requestedPublishingInterval,
    requestedLifetimeCount: 300,
    requestedMaxKeepAliveCount: 20,
    maxNotificationsPerPublish: 0,
    publishingEnabled: true,
    priority: 1,
  });
  const tracker = {
    appliedSequence: 0n, appliedEvents: 0, signalEvents: 0,
    rawNotifications: 0, keepalives: 0, publishSequenceGaps: 0,
    lastPublishSequence: null, revisedSamplingIntervalsMs: {},
  };
  subscription.on('keepalive', () => { tracker.keepalives += 1; });
  subscription.on('raw_notification', (notification) => {
    tracker.rawNotifications += 1;
    const sequence = Number(notification.sequenceNumber);
    if (tracker.lastPublishSequence !== null && sequence > tracker.lastPublishSequence + 1) {
      tracker.publishSequenceGaps += sequence - tracker.lastPublishSequence - 1;
    }
    tracker.lastPublishSequence = sequence;
  });
  const monitoredNames = ['AppliedSequence', ...activeNames, ...outputFields];
  const items = [];
  for (const name of monitoredNames) {
    const item = await subscription.monitor(
      { nodeId: nodes.get(name).nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: 20, discardOldest: false, queueSize: 1000 },
      TimestampsToReturn.Both
    );
    tracker.revisedSamplingIntervalsMs[name] = item.monitoringParameters.samplingInterval;
    item.on('changed', (dataValue) => {
      if (name === 'AppliedSequence') {
        tracker.appliedSequence = u64ToBigInt(dataValue.value.value);
        tracker.appliedEvents += 1;
      } else tracker.signalEvents += 1;
    });
    items.push(item);
  }
  await sleep(Math.max(100, subscription.publishingInterval * 2));
  tracker.appliedEvents = 0;
  tracker.signalEvents = 0;
  return {
    subscription, items, tracker,
    requestedPublishingIntervalMs: requestedPublishingInterval,
    revisedPublishingIntervalMs: subscription.publishingInterval,
    requestedSamplingIntervalMs: 20,
  };
}

async function commitImage(session, nodes, state, epoch, sequence, image) {
  const slot = state.activeSlot === 0 ? 1 : 0;
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: false },
    ...imageWrites(slot, image),
    { name: `Slot${slot}_Epoch`, dataType: DataType.UInt64, value: epoch.toString() },
    { name: `Slot${slot}_Sequence`, dataType: DataType.UInt64, value: sequence.toString() },
    { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: true },
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    { name: 'RequestedSlot', dataType: DataType.Byte, value: slot },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: epoch.toString() },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: sequence.toString() },
  ]);
  state.activeSlot = slot;
}

async function bracketedImageCheck(session, nodes, epoch, maxSequence) {
  const before = await readMany(session, nodes, ['AppliedEpoch', 'AppliedSequence']);
  const active = await readMany(session, nodes, activeNames);
  const after = await readMany(session, nodes, ['AppliedEpoch', 'AppliedSequence']);
  const beforeEpoch = u64ToBigInt(before.AppliedEpoch);
  const beforeSequence = u64ToBigInt(before.AppliedSequence);
  const afterSequence = u64ToBigInt(after.AppliedSequence);
  if (beforeEpoch !== epoch || beforeSequence < 1n || afterSequence > maxSequence) {
    return { conclusive: false, ambiguous: true, torn: false };
  }
  if (beforeSequence !== afterSequence) return { conclusive: false, ambiguous: false, torn: false };
  return {
    conclusive: true, ambiguous: false,
    torn: compareActive(encodedImage(epoch, beforeSequence), active).length > 0,
  };
}

function timingThresholds(timing, baseline) {
  const p99Limit = baseline.intervalUs.p99 * 1.20;
  const jitterLimit = baseline.absoluteJitterUs.p99 * 1.20;
  const checks = {
    p99Interval: { valueUs: timing.intervalUs.p99, limitUs: p99Limit, pass: timing.intervalUs.p99 <= p99Limit },
    p99AbsoluteJitter: { valueUs: timing.absoluteJitterUs.p99, limitUs: jitterLimit, pass: timing.absoluteJitterUs.p99 <= jitterLimit },
    omittedCycles: { value: timing.inferredOmittedGapCount, limit: 0, pass: timing.inferredOmittedGapCount === 0 },
    maximumInterval: {
      valueUs: timing.intervalUs.max, limitUs: omittedGapBoundaryUs,
      pass: timing.intervalUs.max < omittedGapBoundaryUs,
      note: 'Watchdog is disabled; the fixture inferred-omitted-gap boundary is the recorded stop boundary.',
    },
  };
  return {
    checks,
    pass: Object.values(checks).every((check) => check.pass),
    ratios: {
      p99IntervalToBaseline: baseline.intervalUs.p99 ? timing.intervalUs.p99 / baseline.intervalUs.p99 : null,
      p99AbsoluteJitterToBaseline: baseline.absoluteJitterUs.p99
        ? timing.absoluteJitterUs.p99 / baseline.absoluteJitterUs.p99 : null,
    },
  };
}

async function runBaseline() {
  process.stderr.write(`M6 starting disconnected-baseline (${durationSeconds}s)\n`);
  let fixture = await connectFixture();
  const initial = await readMany(fixture.session, fixture.nodes, ['WorkstationHeartbeat', 'PlcBootIdentity']);
  const state = { heartbeat: u64ToBigInt(initial.WorkstationHeartbeat), activeSlot: 255 };
  const bootIdentity = u64ToBigInt(initial.PlcBootIdentity).toString();
  const cpuStart = readControlCpu();
  await resetBenchSession(fixture.session, fixture.nodes, state);
  const disconnectedAt = new Date().toISOString();
  await closeFixture(fixture);
  fixture = null;
  await waitWithProgress('disconnected-baseline', durationSeconds, () => '; OPC UA client disconnected');
  fixture = await connectFixture();
  try {
    const held = await readMany(fixture.session, fixture.nodes, [
      'SimApplied', 'ConnectorStale', 'AppliedEpoch', 'AppliedSequence',
      'PlcBootIdentity', 'PlcCycle', ...activeNames,
    ]);
    const timing = await stopTiming(fixture.session, fixture.nodes);
    const cpuEnd = readControlCpu();
    const behavior = {
      pass: held.SimApplied === true && held.ConnectorStale === true
        && u64ToBigInt(held.AppliedEpoch) === 0n && u64ToBigInt(held.AppliedSequence) === 0n
        && u64ToBigInt(held.PlcBootIdentity).toString() === bootIdentity
        && compareActive(zeroImage(), held).length === 0,
      simApplied: held.SimApplied,
      connectorStale: held.ConnectorStale,
      appliedEpoch: u64ToBigInt(held.AppliedEpoch).toString(),
      appliedSequence: u64ToBigInt(held.AppliedSequence).toString(),
      bootIdentity: u64ToBigInt(held.PlcBootIdentity).toString(),
      heldImageMismatches: compareActive(zeroImage(), held),
    };
    const pass = behavior.pass && timing.inferredOmittedGapCount === 0
      && timing.intervalUs.max < omittedGapBoundaryUs;
    return {
      id: 'disconnected-baseline', pass, durationSeconds,
      disconnectedAt, reconnectedAt: new Date().toISOString(),
      qualification: durationSeconds === 600 ? 'acceptance-eligible' : 'diagnostic-only',
      timing, behavior,
      cpu: cpuDelta(cpuStart, cpuEnd, durationSeconds),
      completedAt: new Date().toISOString(),
    };
  } finally { await closeFixture(fixture); }
}

async function runConnected(plan, baselineTiming) {
  const runId = `${plan.id}-repeat-${plan.repeat}`;
  process.stderr.write(`M6 starting ${runId} (${durationSeconds}s)\n`);
  const fixture = await connectFixture();
  let subscription = null;
  try {
    const initial = await readMany(fixture.session, fixture.nodes, [
      'WorkstationHeartbeat', 'PlcBootIdentity', 'AppliedCommitCount', 'SkippedSequenceCount',
    ]);
    const state = { heartbeat: u64ToBigInt(initial.WorkstationHeartbeat), activeSlot: 255 };
    const bootIdentity = u64ToBigInt(initial.PlcBootIdentity).toString();
    const epoch = (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
    const publishingInterval = plan.rateHz ? 1000 / plan.rateHz : 20;
    subscription = await createSubscription(fixture.session, fixture.nodes, publishingInterval);
    await resetBenchSession(fixture.session, fixture.nodes, state);
    const cpuStart = readControlCpu();
    const nodeCpuStart = process.cpuUsage();
    const startNs = process.hrtime.bigint();
    const deadlineNs = startNs + BigInt(Math.round(durationSeconds * 1e9));
    let dispatched = 0;
    let lastImage = null;
    let tornSamples = 0;
    let ambiguousSamples = 0;
    let conclusiveSamples = 0;

    if (plan.rateHz === null) {
      dispatched = 1;
      lastImage = encodedImage(epoch, 1n);
      await commitImage(fixture.session, fixture.nodes, state, epoch, 1n, lastImage);
      while (process.hrtime.bigint() < deadlineNs) {
        const remainingMs = Number(deadlineNs - process.hrtime.bigint()) / 1e6;
        await sleep(Math.min(progressIntervalMs, Math.max(1, remainingMs)));
        const elapsed = Number(process.hrtime.bigint() - startNs) / 1e9;
        process.stderr.write(`M6 ${runId}: ${Math.min(elapsed, durationSeconds).toFixed(0)}/${durationSeconds}s elapsed; held sequence 1\n`);
      }
    } else {
      const periodNs = BigInt(Math.round(1e9 / plan.rateHz));
      let nextDueNs = startNs;
      let lastProgress = Date.now();
      while (process.hrtime.bigint() < deadlineNs) {
        const nowNs = process.hrtime.bigint();
        if (nextDueNs > nowNs) await sleep(Number(nextDueNs - nowNs) / 1e6);
        if (process.hrtime.bigint() >= deadlineNs) break;
        dispatched += 1;
        const sequence = BigInt(dispatched);
        lastImage = encodedImage(epoch, sequence);
        await commitImage(fixture.session, fixture.nodes, state, epoch, sequence, lastImage);
        nextDueNs += periodNs;
        if (dispatched % 100 === 0) {
          const check = await bracketedImageCheck(fixture.session, fixture.nodes, epoch, sequence);
          if (check.conclusive) conclusiveSamples += 1;
          if (check.ambiguous) ambiguousSamples += 1;
          if (check.torn) tornSamples += 1;
        }
        if (Date.now() - lastProgress >= progressIntervalMs) {
          const elapsed = Number(process.hrtime.bigint() - startNs) / 1e9;
          process.stderr.write(
            `M6 ${runId}: ${Math.min(elapsed, durationSeconds).toFixed(0)}/${durationSeconds}s elapsed; `
            + `${dispatched} dispatched; ${(dispatched / elapsed).toFixed(2)} Hz\n`
          );
          lastProgress = Date.now();
        }
      }
    }

    await sleep(Math.max(200, subscription.revisedPublishingIntervalMs * 3));
    const final = await readMany(fixture.session, fixture.nodes, [
      'SimApplied', 'ConnectorStale', 'AppliedEpoch', 'AppliedSequence', 'PlcBootIdentity',
      'AppliedCommitCount', 'SkippedSequenceCount', 'PlcCycle', ...activeNames,
    ]);
    const timing = await stopTiming(fixture.session, fixture.nodes);
    const endNs = process.hrtime.bigint();
    const elapsedSeconds = Number(endNs - startNs) / 1e9;
    const cpuEnd = readControlCpu();
    const nodeCpu = process.cpuUsage(nodeCpuStart);
    const appliedCount = Number(
      u64ToBigInt(final.AppliedCommitCount) - u64ToBigInt(initial.AppliedCommitCount)
    );
    const skippedDelta = u64ToBigInt(final.SkippedSequenceCount)
      - u64ToBigInt(initial.SkippedSequenceCount);
    const finalSequence = u64ToBigInt(final.AppliedSequence);
    const finalMatches = lastImage ? compareActive(lastImage, final).length === 0 : false;
    const coherentBehavior = u64ToBigInt(final.AppliedEpoch) === epoch
      && finalSequence === BigInt(dispatched) && finalMatches
      && tornSamples === 0 && ambiguousSamples === 0
      && u64ToBigInt(final.PlcBootIdentity).toString() === bootIdentity;
    const deliveryComplete = appliedCount === dispatched && skippedDelta === 0n;
    const behavior = {
      pass: coherentBehavior && deliveryComplete,
      coherentBehavior,
      deliveryComplete,
      dispatchedCount: dispatched,
      appliedCommitCount: appliedCount,
      unappliedOrCoalescedCount: Math.max(0, dispatched - appliedCount),
      achievedDispatchRateHz: dispatched / elapsedSeconds,
      finalAppliedEpoch: u64ToBigInt(final.AppliedEpoch).toString(),
      finalAppliedSequence: finalSequence.toString(),
      finalImageMatches: finalMatches,
      tornSamples, ambiguousSamples, conclusiveSamples,
      skippedSequenceDelta: skippedDelta.toString(),
      bootIdentity: u64ToBigInt(final.PlcBootIdentity).toString(),
      simAppliedBeforeStop: final.SimApplied,
      connectorStaleBeforeStop: final.ConnectorStale,
    };
    const thresholds = timingThresholds(timing, baselineTiming);
    return {
      runId, scenario: plan.id, description: plan.description, repeat: plan.repeat,
      requestedRateHz: plan.rateHz, durationSeconds, elapsedSeconds,
      qualification: durationSeconds === 600 ? 'acceptance-eligible' : 'diagnostic-only',
      pass: thresholds.pass && behavior.pass,
      taskHealthPass: thresholds.pass,
      applicationBehaviorPass: behavior.pass,
      timing, thresholds, behavior,
      subscription: {
        requestedPublishingIntervalMs: subscription.requestedPublishingIntervalMs,
        revisedPublishingIntervalMs: subscription.revisedPublishingIntervalMs,
        requestedSamplingIntervalMs: subscription.requestedSamplingIntervalMs,
        revisedSamplingIntervalsMs: subscription.tracker.revisedSamplingIntervalsMs,
        rawNotifications: subscription.tracker.rawNotifications,
        keepalives: subscription.tracker.keepalives,
        publishSequenceGaps: subscription.tracker.publishSequenceGaps,
        appliedSequenceEvents: subscription.tracker.appliedEvents,
        signalEvents: subscription.tracker.signalEvents,
      },
      cpu: {
        controlProcess: cpuDelta(cpuStart, cpuEnd, elapsedSeconds),
        nodeClient: {
          ...process.cpuUsage(nodeCpuStart),
          averageSingleCorePercent: ((nodeCpu.user + nodeCpu.system) / 1e6 / elapsedSeconds) * 100,
        },
      },
      completedAt: new Date().toISOString(),
    };
  } finally {
    if (subscription) {
      try { await subscription.subscription.terminate(); } catch { /* preserve primary result */ }
    }
    await closeFixture(fixture);
  }
}

function summarize(payload) {
  const groups = {};
  for (const scenario of selectedScenarios) {
    const runs = payload.runs.filter((run) => run.scenario === scenario.id);
    groups[scenario.id] = {
      completedRepeats: runs.length,
      taskHealthPassCount: runs.filter((run) => run.taskHealthPass).length,
      applicationBehaviorPassCount: runs.filter((run) => run.applicationBehaviorPass).length,
      pass: runs.length === 3 && runs.filter((run) => run.taskHealthPass).length >= 2
        && runs.every((run) => run.applicationBehaviorPass),
      note: runs.some((run) => !run.taskHealthPass)
        ? 'A threshold breach requires a recorded cause/configuration change before clearance; it is not averaged away.'
        : null,
    };
  }
  const complete = payload.baseline && payload.runs.length === selectedRunPlan.length;
  return {
    scope: measurementScope,
    complete,
    frozenPlanComplete: measurementScope === 'full' && complete,
    taskImpactPass: complete && payload.baseline.pass
      && Object.values(groups).every((group) => group.completedRepeats === 3 && group.taskHealthPassCount >= 2),
    overallPass: complete && payload.baseline.pass && Object.values(groups).every((group) => group.pass),
    scenarioVerdicts: groups,
  };
}

async function main() {
  if (!userName) throw new Error('OPC_USER is required');
  if (!Number.isFinite(durationSeconds) || durationSeconds < 60) throw new Error('Invalid M6 duration');
  const payload = fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    : {
      schemaVersion: 1, milestone: 'M6', startedAt: new Date().toISOString(),
      scope: measurementScope,
      scopeStatement: measurementScope === 'hackathon'
        ? 'Reduced by operator priority to the disconnected baseline plus three qualified 10 Hz full-demo runs. This is not a complete frozen-plan M6 matrix.'
        : 'Complete frozen-plan M6 matrix.',
      endpointUrl, securityMode: 'SignAndEncrypt', securityPolicy: 'Basic256Sha256',
      durationSeconds, acceptanceEligible: durationSeconds === 600,
      taskConfiguration: {
        task: 'MainTask', type: 'cyclic', intervalMs: 20, priority: 1,
        watchdogEnabled: false, source: 'accepted M0 operator-observed configuration',
      },
      thresholdPolicy: {
        p99IntervalRatioMaximum: 1.20,
        p99AbsoluteJitterRatioMaximum: 1.20,
        omittedCycleMaximum: 0,
        maximumIntervalBoundaryUs: omittedGapBoundaryUs,
        firstThresholdBreach: 'stop-and-investigate; no automatic continuation or averaging',
      },
      baseline: null, runs: [], summary: null,
    };
  if (payload.durationSeconds !== durationSeconds) {
    throw new Error(`Existing M6 result uses ${payload.durationSeconds}s runs; requested ${durationSeconds}s`);
  }
  if ((payload.scope || 'full') !== measurementScope) {
    throw new Error(`Existing M6 result uses scope ${payload.scope || 'full'}; requested ${measurementScope}`);
  }

  let newRuns = 0;
  if (!payload.baseline) {
    payload.baseline = await runBaseline();
    newRuns += 1;
    payload.updatedAt = new Date().toISOString();
    payload.summary = summarize(payload);
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
    if (!payload.baseline.pass) {
      payload.stopCondition = 'Disconnected baseline failed task-health or held-state checks.';
      fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
      throw new Error(payload.stopCondition);
    }
  }

  for (const plan of selectedRunPlan) {
    const runId = `${plan.id}-repeat-${plan.repeat}`;
    if (payload.runs.some((run) => run.runId === runId)) continue;
    if (newRuns >= maxNewRuns) break;
    const run = await runConnected(plan, payload.baseline.timing);
    payload.runs.push(run);
    newRuns += 1;
    payload.updatedAt = new Date().toISOString();
    payload.summary = summarize(payload);
    fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
    process.stderr.write(
      `M6 completed ${runId}: task health ${run.taskHealthPass ? 'PASS' : 'FAIL'}, `
      + `application behavior ${run.applicationBehaviorPass ? 'PASS' : 'FAIL'}\n`
    );
    if (!run.taskHealthPass) {
      payload.stopCondition = `${runId} crossed a frozen 1.20x/omitted-cycle task-health threshold.`;
      payload.summary = summarize(payload);
      fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
      throw new Error(payload.stopCondition);
    }
  }

  payload.summary = summarize(payload);
  payload.complete = payload.summary.complete;
  if (payload.complete) payload.completedAt = new Date().toISOString();
  fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  if (!payload.complete) {
    process.stderr.write(
      `M6 checkpoint saved: baseline ${payload.baseline ? 'complete' : 'pending'}, `
      + `${payload.runs.length}/${selectedRunPlan.length} connected runs complete. Re-run the same command to resume.\n`
    );
  }
}

main().catch((error) => {
  console.error(`M6 probe failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
