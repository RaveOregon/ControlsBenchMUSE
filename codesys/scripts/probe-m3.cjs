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
  float32Bits, browseWanted, readMany, writeMany, imageWrites, compareActive,
} = require('./probe-m1.cjs');

const endpointUrl = process.env.OPC_ENDPOINT || 'opc.tcp://127.0.0.1:4840';
const userName = process.env.OPC_USER;
const password = process.env.OPC_PASSWORD;
const durationSeconds = Number(process.env.M3_DURATION_SECONDS || '600');
const smoke = process.env.M3_SMOKE === '1';
const maxNewRuns = Number(process.env.M3_MAX_RUNS || '0');
const artifactDir = path.resolve(__dirname, '..', 'artifacts');
const resultPath = process.env.M3_OUTPUT || path.join(
  artifactDir, smoke ? 'm3-smoke-result.json' : 'm3-result.json'
);
const traceDir = path.join(artifactDir, smoke ? 'm3-smoke-traces' : 'm3-traces');

const controlNames = [
  'SimRequest', 'SessionResetRequest', 'RequestedSlot', 'RequestedEpoch',
  'RequestedSequence', 'WorkstationHeartbeat',
];
const counterNames = [
  'AppliedCommitCount', 'DuplicateCommitCount', 'StaleCommitCount',
  'SkippedSequenceCount', 'InvalidSlotCount', 'InvalidPayloadCount',
  'SlotMetadataMismatchCount', 'EpochRejectedCount', 'SessionResetCount',
];
const instrumentationNames = [
  'AppliedSequence', 'OutputCaptureCycle', 'OutputCaptureTimeUs',
];
const timingNames = [
  'OutputCaptureCycle', 'OutputCaptureTimeUs', 'PlcHeartbeat', 'PlcTimeUs',
];
const slotNames = [];
for (const slot of [0, 1]) {
  slotNames.push(`Slot${slot}_Valid`, `Slot${slot}_Epoch`, `Slot${slot}_Sequence`);
  for (const field of boolFields) slotNames.push(`Slot${slot}_${field}`);
  for (const field of realFields) slotNames.push(`Slot${slot}_${field}`);
  slotNames.push(`Slot${slot}_Encoder_Count`);
}

const profiles = {
  '1x': { signalCount: 1, names: ['Motor_RunCmd'] },
  '2x': { signalCount: 2, names: ['Motor_RunCmd', 'D1_ExtendCmd'] },
  'full-demo': { signalCount: 25, names: [...activeNames, ...outputFields] },
};
const fullRunOrder = [
  ['full-demo', 10], ['full-demo', 20], ['full-demo', 50], ['full-demo', 5],
  ['1x', 5], ['1x', 10], ['1x', 20], ['1x', 50],
  ['2x', 5], ['2x', 10], ['2x', 20], ['2x', 50],
];
const runOrder = smoke ? [['full-demo', 10]] : fullRunOrder;

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

function expectedOutputs(image) {
  return {
    Motor_RunCmd: image.PE_Entry && !image.Drive_Overload,
    D1_ExtendCmd: image.PE_D1Approach,
    D2_ExtendCmd: image.PE_D2Approach,
    StackLight_Red: image.Drive_Overload,
    StackLight_Green: !image.Drive_Overload,
  };
}

function expectedValue(name, image) {
  if (name.startsWith('Active_')) return image[name.slice('Active_'.length)];
  return expectedOutputs(image)[name];
}

function valuesEqual(name, left, right) {
  if (name.startsWith('Active_') && realFields.includes(name.slice(7))) {
    return float32Bits(left) === float32Bits(right);
  }
  return left === right;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function isoTimestamp(value) {
  return value instanceof Date ? value.toISOString() : null;
}

function serializeDataValue(dataValue, receiptNs) {
  return {
    status: dataValue.statusCode.toString(),
    sourceTimestamp: isoTimestamp(dataValue.sourceTimestamp),
    serverTimestamp: isoTimestamp(dataValue.serverTimestamp),
    workstationReceiptNs: receiptNs.toString(),
  };
}

function readControlCpu() {
  try {
    const script = "$p=Get-Process -Name CODESYSControlService -ErrorAction SilentlyContinue | Select-Object -First 1; if($p){[pscustomobject]@{CpuSeconds=$p.CPU;Pid=$p.Id;LogicalProcessors=[Environment]::ProcessorCount}|ConvertTo-Json -Compress}";
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
      encoding: 'utf8', timeout: 10000, windowsHide: true,
    }).trim();
    return output ? JSON.parse(output) : null;
  } catch {
    return null;
  }
}

async function resetBenchSession(session, nodes, state) {
  await writeMany(session, nodes, [
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: false },
  ]);
  await sleep(30);
  const before = await readMany(session, nodes, ['SessionResetCount']);
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'SimRequest', dataType: DataType.Boolean, value: true },
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: true },
  ]);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const values = await readMany(session, nodes, ['SessionResetCount', 'AppliedEpoch', 'AppliedSequence']);
    if (u64ToBigInt(values.SessionResetCount) > u64ToBigInt(before.SessionResetCount)
      && u64ToBigInt(values.AppliedEpoch) === 0n
      && u64ToBigInt(values.AppliedSequence) === 0n) break;
    await sleep(5);
  }
  await writeMany(session, nodes, [
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: false },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: '0' },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: '0' },
  ]);
  await sleep(40);
  state.activeSlot = 255;
}

async function stopTiming(session, nodes) {
  await writeMany(session, nodes, [
    { name: 'SimRequest', dataType: DataType.Boolean, value: false },
  ]);
  await sleep(250);
  const values = await readMany(session, nodes, timingNames);
  const p50P95 = u64ToBigInt(values.OutputCaptureCycle);
  const p99Max = u64ToBigInt(values.OutputCaptureTimeUs);
  const jitterSamples = u64ToBigInt(values.PlcHeartbeat);
  const omittedMin = u64ToBigInt(values.PlcTimeUs);
  return {
    control: 'started by explicit SessionResetRequest; stopped by explicit SimRequest=false',
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
    inferredOmittedGapThresholdUs: 30000,
  };
}

async function createSubscription(session, nodes, rateHz, profile) {
  const requestedPublishingInterval = 1000 / rateHz;
  const requestedSamplingInterval = 20;
  const subscription = await session.createSubscription2({
    requestedPublishingInterval,
    requestedLifetimeCount: 300,
    requestedMaxKeepAliveCount: 20,
    maxNotificationsPerPublish: 0,
    publishingEnabled: true,
    priority: 1,
  });

  const tracker = {
    latestApplied: 0n,
    latestAppliedData: null,
    latestInstrumentation: new Map(),
    pending: new Map(),
    signalEvents: new Map(profile.names.map((name) => [name, []])),
    initialValues: new Map(),
    revisedSampling: {},
    rawNotifications: 0,
    keepalives: 0,
    publishSequenceGaps: 0,
    lastPublishSequence: null,
  };
  subscription.on('keepalive', () => { tracker.keepalives += 1; });
  subscription.on('raw_notification', (notification) => {
    tracker.rawNotifications += 1;
    const seq = Number(notification.sequenceNumber);
    if (tracker.lastPublishSequence !== null && seq > tracker.lastPublishSequence + 1) {
      tracker.publishSequenceGaps += seq - tracker.lastPublishSequence - 1;
    }
    tracker.lastPublishSequence = seq;
  });

  const monitoredNames = [...new Set([...instrumentationNames, ...profile.names])];
  const items = [];
  for (const name of monitoredNames) {
    const item = await subscription.monitor(
      { nodeId: nodes.get(name).nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: requestedSamplingInterval, discardOldest: false, queueSize: 1000 },
      TimestampsToReturn.Both
    );
    tracker.revisedSampling[name] = item.monitoringParameters.samplingInterval;
    item.on('changed', (dataValue) => {
      const receiptNs = process.hrtime.bigint();
      const value = dataValue.value.value;
      tracker.latestInstrumentation.set(name, { value, dataValue, receiptNs });
      if (!tracker.initialValues.has(name)) tracker.initialValues.set(name, value);
      if (name === 'AppliedSequence') {
        tracker.latestApplied = u64ToBigInt(value);
        tracker.latestAppliedData = { dataValue, receiptNs };
        const pending = tracker.pending.get(tracker.latestApplied.toString());
        if (pending && !pending.appliedNotification) {
          pending.receiptNs = receiptNs.toString();
          pending.sendToAppliedMs = Number(receiptNs - BigInt(pending.sendNs)) / 1e6;
          pending.appliedNotification = serializeDataValue(dataValue, receiptNs);
        }
      }
      if (tracker.signalEvents.has(name)) {
        tracker.signalEvents.get(name).push({ value, dataValue, receiptNs });
      }
    });
    items.push(item);
  }
  await sleep(Math.max(100, subscription.publishingInterval * 2));
  for (const events of tracker.signalEvents.values()) events.length = 0;
  return {
    subscription, tracker, items,
    requestedPublishingInterval,
    revisedPublishingInterval: subscription.publishingInterval,
    requestedSamplingInterval,
  };
}

async function dispatchCommit(session, nodes, state, tracker, profile, epoch, sequence, image) {
  const slot = state.activeSlot === 0 ? 1 : 0;
  const expected = Object.fromEntries(profile.names.map((name) => [name, expectedValue(name, image)]));
  const sendNs = process.hrtime.bigint();
  const sendWall = new Date().toISOString();
  const record = {
    sequence: sequence.toString(), slot, sendWall, sendNs: sendNs.toString(),
    writeCompleteNs: null, receiptNs: null, writeCompletionMs: null,
    sendToAppliedMs: null, notificationMissing: true,
    appliedNotification: null, expected, image,
  };
  tracker.pending.set(sequence.toString(), record);
  state.heartbeat += 1n;
  try {
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
  } catch (error) {
    tracker.pending.delete(sequence.toString());
    throw error;
  }
  const writeCompleteNs = process.hrtime.bigint();
  state.activeSlot = slot;
  record.writeCompleteNs = writeCompleteNs.toString();
  record.writeCompletionMs = Number(writeCompleteNs - sendNs) / 1e6;
  if (record.appliedNotification) record.notificationMissing = false;
  return record;
}

async function runOne(session, nodes, state, profileId, rateHz) {
  const profile = profiles[profileId];
  const runId = `${profileId}-${rateHz}hz-${durationSeconds}s`;
  const tracePath = path.join(traceDir, `${runId}.jsonl`);
  fs.writeFileSync(tracePath, '', 'utf8');
  await resetBenchSession(session, nodes, state);
  const epoch = (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
  const sub = await createSubscription(session, nodes, rateHz, profile);
  const counterBaseline = await readMany(session, nodes, ['AppliedCommitCount', 'SkippedSequenceCount']);
  const cpuStart = readControlCpu();
  const nodeCpuStart = process.cpuUsage();
  const startNs = process.hrtime.bigint();
  const periodNs = BigInt(Math.round(1e9 / rateHz));
  const targetCount = Math.floor(durationSeconds * rateHz);
  const timeoutMs = Math.max(1000, sub.revisedPublishingInterval * 5);
  const records = [];
  const latencies = [];
  const writeLatencies = [];
  const outputLatencies = [];
  let notificationMissing = 0;
  let expectedChanges = 0;
  let observedChanges = 0;
  let signalValueMismatches = 0;
  let tornSamples = 0;
  let inconclusiveTransitionSamples = 0;
  let sequenceAmbiguity = 0;
  let lastProgress = performance.now();
  const lastExpected = Object.fromEntries(profile.names.map((name) => [name, sub.tracker.initialValues.get(name)]));
  const expectedEvents = new Map(profile.names.map((name) => [name, []]));
  let finalState = null;
  let dispatchEndNs = startNs;
  let appliedCount = 0;
  let skippedSequenceDelta = null;
  let runError = null;

  try {
    for (let index = 1; index <= targetCount; index += 1) {
      const dueNs = startNs + (BigInt(index - 1) * periodNs);
      const nowNs = process.hrtime.bigint();
      if (dueNs > nowNs) await sleep(Number(dueNs - nowNs) / 1e6);
      const sequence = BigInt(index);
      const image = encodedImage(epoch, sequence);
      const record = await dispatchCommit(
        session, nodes, state, sub.tracker, profile, epoch, sequence, image
      );
      records.push(record);
      for (const name of profile.names) {
        const expected = record.expected[name];
        const changed = !valuesEqual(name, expected, lastExpected[name]);
        if (changed) {
          expectedChanges += 1;
          expectedEvents.get(name).push({ value: expected, sendNs: BigInt(record.sendNs) });
        }
        lastExpected[name] = expected;
      }
      if (index % 100 === 0) {
        const before = await readMany(session, nodes, ['AppliedEpoch', 'AppliedSequence']);
        const sample = await readMany(session, nodes, activeNames);
        const after = await readMany(session, nodes, ['AppliedEpoch', 'AppliedSequence']);
        const beforeEpoch = u64ToBigInt(before.AppliedEpoch);
        const beforeSequence = u64ToBigInt(before.AppliedSequence);
        const afterEpoch = u64ToBigInt(after.AppliedEpoch);
        const afterSequence = u64ToBigInt(after.AppliedSequence);
        if (beforeEpoch !== epoch || afterEpoch !== epoch
          || beforeSequence < 1n || afterSequence > sequence) {
          sequenceAmbiguity += 1;
        } else if (beforeSequence !== afterSequence) {
          inconclusiveTransitionSamples += 1;
        } else if (compareActive(encodedImage(epoch, beforeSequence), sample).length) {
          tornSamples += 1;
        }
      }
      const now = performance.now();
      if (now - lastProgress >= 10000) {
        const elapsedSec = Number(process.hrtime.bigint() - startNs) / 1e9;
        const acknowledged = records.filter((row) => row.appliedNotification).length;
        const currentLatencies = records.filter((row) => row.sendToAppliedMs !== null).map((row) => row.sendToAppliedMs);
        const p99 = percentile(currentLatencies, 0.99);
        process.stderr.write(
          `M3 ${runId}: ${index}/${targetCount} dispatched, ${acknowledged} acknowledged; ` +
          `${elapsedSec.toFixed(0)}s elapsed; ${(index / elapsedSec).toFixed(2)} Hz dispatch; ` +
          `p99 ${p99?.toFixed(2) ?? 'n/a'} ms\n`
        );
        lastProgress = now;
      }
    }
    dispatchEndNs = process.hrtime.bigint();

    const acknowledgementDeadline = Date.now() + timeoutMs;
    while (records.some((record) => !record.appliedNotification) && Date.now() < acknowledgementDeadline) {
      await sleep(5);
    }
    finalState = await readMany(session, nodes, [
      'AppliedEpoch', 'AppliedSequence', 'AppliedCommitCount', 'SkippedSequenceCount', ...activeNames,
    ]);
    const appliedDelta = u64ToBigInt(finalState.AppliedCommitCount)
      - u64ToBigInt(counterBaseline.AppliedCommitCount);
    appliedCount = Number(appliedDelta >= 0n ? appliedDelta : 0n);
    const skippedDelta = u64ToBigInt(finalState.SkippedSequenceCount)
      - u64ToBigInt(counterBaseline.SkippedSequenceCount);
    skippedSequenceDelta = skippedDelta.toString();
    if (u64ToBigInt(finalState.AppliedEpoch) !== epoch
      || u64ToBigInt(finalState.AppliedSequence) !== BigInt(targetCount)
      || appliedCount !== targetCount
      || skippedDelta !== 0n) sequenceAmbiguity += 1;
    if (compareActive(encodedImage(epoch, BigInt(targetCount)), finalState).length) tornSamples += 1;

    for (const record of records) {
      record.notificationMissing = !record.appliedNotification;
      if (record.notificationMissing) notificationMissing += 1;
      if (record.sendToAppliedMs !== null) latencies.push(record.sendToAppliedMs);
      if (record.writeCompletionMs !== null) writeLatencies.push(record.writeCompletionMs);
    }
    for (const name of profile.names) {
      const expectedForName = expectedEvents.get(name);
      const observedForName = sub.tracker.signalEvents.get(name);
      const paired = Math.min(expectedForName.length, observedForName.length);
      observedChanges += paired;
      for (let index = 0; index < paired; index += 1) {
        const expectedEvent = expectedForName[index];
        const observedEvent = observedForName[index];
        const valueMatches = valuesEqual(name, expectedEvent.value, observedEvent.value);
        if (!valueMatches) signalValueMismatches += 1;
        if (valueMatches && outputFields.includes(name)) {
          outputLatencies.push(Number(observedEvent.receiptNs - expectedEvent.sendNs) / 1e6);
        }
      }
    }
    if (signalValueMismatches > 0) sequenceAmbiguity += 1;
  } catch (error) {
    runError = error;
  } finally {
    const cleanupErrors = [];
    try {
      for (let offset = 0; offset < records.length; offset += 250) {
        const chunk = records.slice(offset, offset + 250);
        fs.appendFileSync(tracePath, `${chunk.map((row) => JSON.stringify(row)).join('\n')}\n`);
      }
    } catch (error) {
      cleanupErrors.push(new Error(`trace flush failed: ${error.message}`));
    }
    let timing = null;
    try {
      timing = await stopTiming(session, nodes);
    } catch (error) {
      cleanupErrors.push(new Error(`timing stop/read failed: ${error.message}`));
    }
    const endNs = process.hrtime.bigint();
    const cpuEnd = readControlCpu();
    const nodeCpu = process.cpuUsage(nodeCpuStart);
    try {
      await sub.subscription.terminate();
    } catch (error) {
      cleanupErrors.push(new Error(`subscription terminate failed: ${error.message}`));
    }
    const elapsedSeconds = Number(endNs - startNs) / 1e9;
    const dispatchElapsedSeconds = Number(dispatchEndNs - startNs) / 1e9;
    const firstSendNs = records.length ? BigInt(records[0].sendNs) : null;
    const lastSendNs = records.length ? BigInt(records[records.length - 1].sendNs) : null;
    const acknowledgedRecords = records.filter((record) => record.receiptNs !== null);
    const firstReceiptNs = acknowledgedRecords.length ? BigInt(acknowledgedRecords[0].receiptNs) : null;
    const lastReceiptNs = acknowledgedRecords.length ? BigInt(acknowledgedRecords[acknowledgedRecords.length - 1].receiptNs) : null;
    const achievedDispatchRateHz = records.length > 1 && lastSendNs > firstSendNs
      ? (records.length - 1) / (Number(lastSendNs - firstSendNs) / 1e9) : 0;
    const achievedAppliedRateHz = acknowledgedRecords.length > 1 && lastReceiptNs > firstReceiptNs
      ? (acknowledgedRecords.length - 1) / (Number(lastReceiptNs - firstReceiptNs) / 1e9) : 0;
    const within150 = latencies.filter((value) => value <= 150).length;
    const within60 = latencies.filter((value) => value <= 60).length;
    const result = {
      runId, profile: profileId, signalCount: profile.signalCount, rateHz,
      durationRequestedSeconds: durationSeconds, elapsedSeconds, dispatchElapsedSeconds,
      targetCount, dispatchedCount: records.length, appliedCount,
      acknowledgedCount: acknowledgedRecords.length,
      achievedDispatchRateHz, achievedAppliedRateHz,
      appliedLossCount: Math.max(0, targetCount - appliedCount),
      notificationMissing, sequenceAmbiguity, tornSamples, inconclusiveTransitionSamples,
      commitEvidence: {
        finalAppliedEpoch: finalState ? u64ToBigInt(finalState.AppliedEpoch).toString() : null,
        finalAppliedSequence: finalState ? u64ToBigInt(finalState.AppliedSequence).toString() : null,
        appliedCommitDelta: appliedCount,
        skippedSequenceDelta,
      },
      signalNotifications: {
        expectedChanges, observedChanges,
        missingOrCoalesced: expectedChanges - observedChanges,
        valueMismatches: signalValueMismatches,
        valueMismatchNote: 'Order-paired mismatch count can cascade after a missing/coalesced notification; any nonzero value invalidates aligned latency, but is not an independent loss count.',
      },
      subscription: {
        requestedPublishingIntervalMs: sub.requestedPublishingInterval,
        revisedPublishingIntervalMs: sub.revisedPublishingInterval,
        requestedSamplingIntervalMs: sub.requestedSamplingInterval,
        revisedSamplingIntervalsMs: sub.tracker.revisedSampling,
        rawNotifications: sub.tracker.rawNotifications,
        keepalives: sub.tracker.keepalives,
        publishSequenceGaps: sub.tracker.publishSequenceGaps,
      },
      latencyMs: {
        min: latencies.length ? Math.min(...latencies) : null,
        p50: percentile(latencies, 0.50), p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99), max: latencies.length ? Math.max(...latencies) : null,
        within150Percent: targetCount ? (within150 / targetCount) * 100 : 0,
        within60Percent: targetCount ? (within60 / targetCount) * 100 : 0,
      },
      writeCompletionMs: {
        p50: percentile(writeLatencies, 0.50), p99: percentile(writeLatencies, 0.99),
      },
      outputObservationMs: {
        valid: expectedChanges === observedChanges && signalValueMismatches === 0,
        invalidReason: expectedChanges === observedChanges && signalValueMismatches === 0
          ? null : 'Signal notification alignment was lost; output latency values are not acceptance evidence.',
        samples: outputLatencies.length,
        p50: percentile(outputLatencies, 0.50), p99: percentile(outputLatencies, 0.99),
        max: outputLatencies.length ? Math.max(...outputLatencies) : null,
      },
      plcTiming: timing,
      cpu: {
        controlProcess: cpuStart && cpuEnd && cpuStart.Pid === cpuEnd.Pid ? {
          pid: cpuEnd.Pid,
          cpuSecondsDelta: cpuEnd.CpuSeconds - cpuStart.CpuSeconds,
          averageSingleCorePercent: ((cpuEnd.CpuSeconds - cpuStart.CpuSeconds) / elapsedSeconds) * 100,
          logicalProcessors: cpuEnd.LogicalProcessors,
        } : null,
        nodeClient: {
          userSeconds: nodeCpu.user / 1e6, systemSeconds: nodeCpu.system / 1e6,
          averageSingleCorePercent: ((nodeCpu.user + nodeCpu.system) / 1e6 / elapsedSeconds) * 100,
        },
      },
      tracePath,
      completedAt: new Date().toISOString(),
    };
    if (runError || cleanupErrors.length) {
      const primaryError = runError || cleanupErrors[0];
      primaryError.partialResult = {
        ...result,
        completed: false,
        failure: {
          primary: runError ? (runError.stack || runError.message) : null,
          cleanup: cleanupErrors.map((error) => error.stack || error.message),
        },
      };
      throw primaryError;
    }
    return result;
  }
}

function evaluateTiers(runs) {
  const full = Object.fromEntries(runs.filter((run) => run.profile === 'full-demo').map((run) => [run.rateHz, run]));
  const healthy = (run) => run && run.appliedLossCount === 0 && run.notificationMissing === 0
    && run.sequenceAmbiguity === 0 && run.tornSamples === 0
    && run.signalNotifications.missingOrCoalesced === 0
    && run.signalNotifications.valueMismatches === 0
    && run.achievedAppliedRateHz >= run.rateHz * 0.99;
  const methodicalRun = full[10];
  const runtimeRun = full[20];
  const preferredRun = full[50];
  return {
    methodical: {
      pass: healthy(methodicalRun) && methodicalRun.latencyMs.p99 <= 250,
      threshold: '10 Hz sustained; no unexplained loss; p99 <= 250 ms',
    },
    runtime: {
      pass: healthy(runtimeRun) && runtimeRun.latencyMs.within150Percent >= 99.9,
      threshold: '20 Hz sustained; >=99.9% applied within 150 ms; no tearing or sequence ambiguity',
    },
    preferred: {
      pass: healthy(preferredRun) && preferredRun.latencyMs.within60Percent >= 99.9,
      threshold: '50 Hz sustained; >=99.9% applied within 60 ms',
    },
    operationalSustainedRateRule: 'achieved applied rate >= 99% of requested rate',
    tierProfile: 'full-demo (20 active input members + 5 PLC outputs; instrumentation excluded)',
  };
}

async function main() {
  if (!userName) throw new Error('OPC_USER is required');
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid duration');
  fs.mkdirSync(traceDir, { recursive: true });
  let payload = !smoke && fs.existsSync(resultPath)
    ? JSON.parse(fs.readFileSync(resultPath, 'utf8'))
    : {
      schemaVersion: 1, milestone: smoke ? 'M3-smoke' : 'M3',
      startedAt: new Date().toISOString(), endpointUrl,
      securityMode: 'SignAndEncrypt', securityPolicy: 'Basic256Sha256',
      durationSeconds, acceptanceEligible: !smoke && durationSeconds === 600,
      profileDefinition: {
        '1x': 'one representative monitored application signal',
        '2x': 'two representative monitored application signals',
        'full-demo': 'all 20 active raw inputs plus all five PLC outputs',
        note: 'Every write always carries the complete 20-field M2 raw image; profile scaling changes monitored signal count only.',
      },
      runs: [], tiers: null,
    };
  for (const run of payload.runs) {
    if (run.outputObservationMs && run.outputObservationMs.valid === undefined) {
      const valid = run.signalNotifications.missingOrCoalesced === 0
        && run.signalNotifications.valueMismatches === 0;
      run.outputObservationMs.valid = valid;
      run.outputObservationMs.invalidReason = valid
        ? null : 'Signal notification alignment was lost; output latency values are not acceptance evidence.';
    }
  }

  const client = createClient();
  await client.connect(endpointUrl);
  try {
    const session = await client.createSession({
      type: UserTokenType.UserName, userName, password: password || '',
    });
    try {
      const profileNames = Object.values(profiles).flatMap((profile) => profile.names);
      const wanted = new Set([
        ...controlNames, ...counterNames, ...slotNames, ...activeNames,
        ...instrumentationNames, ...timingNames, ...profileNames,
        'AppliedEpoch', 'PlcBootIdentity',
      ]);
      const nodes = await browseWanted(session, wanted);
      const controls = await readMany(session, nodes, ['WorkstationHeartbeat']);
      const state = { heartbeat: u64ToBigInt(controls.WorkstationHeartbeat), activeSlot: 255 };
      let newRuns = 0;
      for (const [profileId, rateHz] of runOrder) {
        const runId = `${profileId}-${rateHz}hz-${durationSeconds}s`;
        if (payload.runs.some((run) => run.runId === runId)) continue;
        process.stderr.write(`M3 starting ${runId}\n`);
        let run;
        try {
          run = await runOne(session, nodes, state, profileId, rateHz);
        } catch (error) {
          payload.failedRun = error.partialResult || {
            runId,
            completed: false,
            failure: { primary: error.stack || error.message, cleanup: [] },
          };
          payload.updatedAt = new Date().toISOString();
          fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
          throw error;
        }
        payload.runs.push(run);
        delete payload.failedRun;
        newRuns += 1;
        payload.tiers = evaluateTiers(payload.runs);
        payload.updatedAt = new Date().toISOString();
        fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
        process.stderr.write(`M3 completed ${runId}: ${run.achievedAppliedRateHz.toFixed(2)} Hz, p99 ${run.latencyMs.p99.toFixed(2)} ms\n`);
        if (!smoke && profileId === 'full-demo' && rateHz === 10 && !payload.tiers.methodical.pass) {
          payload.stopCondition = 'Direct streaming missed the mandatory methodical tier.';
          fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
          throw new Error(payload.stopCondition);
        }
        if (maxNewRuns > 0 && newRuns >= maxNewRuns) {
          process.stderr.write(`M3 chunk limit reached after ${newRuns} new run(s); result is resumable.\n`);
          break;
        }
        await sleep(3000);
      }
      payload.tiers = evaluateTiers(payload.runs);
      payload.complete = payload.runs.length === runOrder.length;
      payload.completedAt = new Date().toISOString();
      fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`);
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`M3 probe failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
