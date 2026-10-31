#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const relayNodeOpcua = path.resolve(
  __dirname, '..', 'codesys_handoff', 'browser_hmi_handoff', 'opcua_relay',
  'node_modules', 'node-opcua'
);
const { AttributeIds, TimestampsToReturn } = require(relayNodeOpcua);
const {
  OPCUAClient, DataType, MessageSecurityMode, SecurityPolicy, UserTokenType,
  boolFields, outputFields, sleep, u64ToBigInt, browseWanted, readMany,
  writeMany, makeImage, imageWrites,
} = require('./probe-m1.cjs');

const endpointUrl = process.env.OPC_ENDPOINT || 'opc.tcp://127.0.0.1:4840';
const userName = process.env.OPC_USER;
const password = process.env.OPC_PASSWORD;
const artifactDir = path.resolve(__dirname, '..', 'artifacts');
const outputPath = process.env.M4_OUTPUT || path.join(artifactDir, 'm4-result.json');
const eventPath = path.join(artifactDir, 'm4-events.jsonl');

const controlNames = [
  'SimRequest', 'SessionResetRequest', 'RequestedSlot', 'RequestedEpoch',
  'RequestedSequence', 'WorkstationHeartbeat',
];
const readNames = [
  'SimApplied', 'ActiveSlot', 'AppliedEpoch', 'AppliedSequence', 'PlcBootIdentity',
  'PlcCycle', 'PlcTimeUs', 'OutputCaptureCycle', 'OutputCaptureTimeUs',
  'SessionResetCount', ...outputFields,
];
const slotNames = [];
for (const slot of [0, 1]) {
  slotNames.push(`Slot${slot}_Valid`, `Slot${slot}_Epoch`, `Slot${slot}_Sequence`);
  for (const field of boolFields) slotNames.push(`Slot${slot}_${field}`);
  for (const field of ['Belt_SpeedActual', 'Drive_Current', 'D1_Position', 'D2_Position']) {
    slotNames.push(`Slot${slot}_${field}`);
  }
  slotNames.push(`Slot${slot}_Encoder_Count`);
}

function createClient() {
  return OPCUAClient.create({
    applicationName: 'NodeOPCUA-Client', endpointMustExist: false,
    securityMode: MessageSecurityMode.SignAndEncrypt,
    securityPolicy: SecurityPolicy.Basic256Sha256,
    automaticallyAcceptUnknownCertificate: true, keepSessionAlive: true,
    connectionStrategy: { initialDelay: 250, maxRetry: 0 },
  });
}

function isoTimestamp(value) {
  return value instanceof Date ? value.toISOString() : null;
}

function serializeDataValue(name, dataValue, receiptNs) {
  return {
    name,
    value: dataValue.value.value,
    status: dataValue.statusCode.toString(),
    sourceTimestamp: isoTimestamp(dataValue.sourceTimestamp),
    serverTimestamp: isoTimestamp(dataValue.serverTimestamp),
    workstationReceiptNs: receiptNs.toString(),
    workstationReceiptTime: new Date().toISOString(),
  };
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

function imageFor(kind, sequence) {
  const image = makeImage(false, [0, 0, 0, 0], sequence);
  if (kind === 'motor') image.PE_Entry = true;
  if (kind === 'd1') image.PE_D1Approach = true;
  if (kind === 'd2') image.PE_D2Approach = true;
  if (kind === 'overload') image.Drive_Overload = true;
  return image;
}

function compactState(values) {
  const result = {
    appliedEpoch: u64ToBigInt(values.AppliedEpoch).toString(),
    appliedSequence: u64ToBigInt(values.AppliedSequence).toString(),
    plcCycle: u64ToBigInt(values.PlcCycle).toString(),
    plcTimeUs: u64ToBigInt(values.PlcTimeUs).toString(),
    outputCaptureCycle: u64ToBigInt(values.OutputCaptureCycle).toString(),
    outputCaptureTimeUs: u64ToBigInt(values.OutputCaptureTimeUs).toString(),
    outputs: {},
  };
  for (const name of outputFields) result.outputs[name] = values[name];
  return result;
}

async function readState(session, nodes) {
  return compactState(await readMany(session, nodes, [
    'AppliedEpoch', 'AppliedSequence', 'PlcCycle', 'PlcTimeUs',
    'OutputCaptureCycle', 'OutputCaptureTimeUs', ...outputFields,
  ]));
}

async function resetSession(session, nodes, state) {
  await writeMany(session, nodes, [{ name: 'SessionResetRequest', dataType: DataType.Boolean, value: false }]);
  const before = await readMany(session, nodes, ['SessionResetCount']);
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'SimRequest', dataType: DataType.Boolean, value: true },
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: true },
  ]);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const current = await readMany(session, nodes, ['SessionResetCount', 'AppliedEpoch', 'AppliedSequence']);
    if (u64ToBigInt(current.SessionResetCount) > u64ToBigInt(before.SessionResetCount)
      && u64ToBigInt(current.AppliedEpoch) === 0n
      && u64ToBigInt(current.AppliedSequence) === 0n) break;
    await sleep(5);
  }
  await writeMany(session, nodes, [
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: false },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: '0' },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: '0' },
  ]);
  await sleep(40);
}

async function createSubscription(session, nodes) {
  const requestedPublishingIntervalMs = 20;
  const requestedSamplingIntervalMs = 20;
  const subscription = await session.createSubscription2({
    requestedPublishingInterval: requestedPublishingIntervalMs,
    requestedLifetimeCount: 10000,
    requestedMaxKeepAliveCount: 20,
    maxNotificationsPerPublish: 0,
    publishingEnabled: true,
    priority: 1,
  });
  const tracker = {
    events: new Map(),
    appliedEvents: new Map(),
    revisedSamplingIntervalsMs: {},
    rawNotifications: 0,
    publishSequenceGaps: 0,
    lastPublishSequence: null,
  };
  const names = [...outputFields, 'AppliedSequence', 'OutputCaptureCycle', 'OutputCaptureTimeUs', 'PlcCycle', 'PlcTimeUs'];
  for (const name of names) tracker.events.set(name, []);
  subscription.on('raw_notification', (notification) => {
    tracker.rawNotifications += 1;
    const seq = Number(notification.sequenceNumber);
    if (tracker.lastPublishSequence !== null && seq > tracker.lastPublishSequence + 1) {
      tracker.publishSequenceGaps += seq - tracker.lastPublishSequence - 1;
    }
    tracker.lastPublishSequence = seq;
  });
  for (const name of names) {
    const item = await subscription.monitor(
      { nodeId: nodes.get(name).nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: requestedSamplingIntervalMs, discardOldest: false, queueSize: 1000 },
      TimestampsToReturn.Both
    );
    tracker.revisedSamplingIntervalsMs[name] = item.monitoringParameters.samplingInterval;
    item.on('changed', (dataValue) => {
      const event = serializeDataValue(name, dataValue, process.hrtime.bigint());
      tracker.events.get(name).push(event);
      if (name === 'AppliedSequence') tracker.appliedEvents.set(u64ToBigInt(event.value).toString(), event);
    });
  }
  await sleep(Math.max(100, subscription.publishingInterval * 3));
  for (const events of tracker.events.values()) events.length = 0;
  tracker.appliedEvents.clear();
  return {
    subscription, tracker,
    requestedPublishingIntervalMs,
    revisedPublishingIntervalMs: subscription.publishingInterval,
    requestedSamplingIntervalMs,
  };
}

async function waitForAppliedEvent(tracker, sequence, timeoutMs = 1500) {
  const key = sequence.toString();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (tracker.appliedEvents.has(key)) return tracker.appliedEvents.get(key);
    await sleep(2);
  }
  throw new Error(`Timed out waiting for AppliedSequence ${sequence}`);
}

async function commitImage(session, nodes, tracker, state, epoch, sequence, image) {
  const before = await readState(session, nodes);
  const active = await readMany(session, nodes, ['ActiveSlot']);
  const slot = Number(active.ActiveSlot) === 0 ? 1 : 0;
  const sendNs = process.hrtime.bigint();
  const sendTime = new Date().toISOString();
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
  const writeCompleteNs = process.hrtime.bigint();
  const appliedEvent = await waitForAppliedEvent(tracker, sequence);
  const after = await readState(session, nodes);
  return {
    sequence: sequence.toString(), slot, sendTime, sendNs: sendNs.toString(),
    writeCompleteNs: writeCompleteNs.toString(),
    writeCompletionMs: Number(writeCompleteNs - sendNs) / 1e6,
    appliedReceiptMs: Number(BigInt(appliedEvent.workstationReceiptNs) - sendNs) / 1e6,
    appliedEvent, before, after,
  };
}

function outputEventsSince(tracker, starts, expected) {
  const found = {};
  for (const [name, value] of Object.entries(expected)) {
    const events = tracker.events.get(name).slice(starts[name]);
    found[name] = events.find((event) => event.value === value) || null;
  }
  return found;
}

async function waitForOutputs(tracker, starts, expected, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = outputEventsSince(tracker, starts, expected);
    if (Object.values(found).every(Boolean)) return found;
    await sleep(5);
  }
  return outputEventsSince(tracker, starts, expected);
}

function eventStarts(tracker) {
  return Object.fromEntries(outputFields.map((name) => [name, tracker.events.get(name).length]));
}

function transitionBounds(commit) {
  return {
    cycle: {
      lowerExclusive: commit.before.outputCaptureCycle,
      upperInclusive: commit.after.outputCaptureCycle,
    },
    plcTimeUs: {
      lowerExclusive: commit.before.outputCaptureTimeUs,
      upperInclusive: commit.after.outputCaptureTimeUs,
    },
    note: 'The client brackets the transition with PLC capture reads; it does not claim the exact scan inside this interval.',
  };
}

function pulseBounds(highCommit, lowCommit) {
  const highLower = BigInt(highCommit.before.outputCaptureCycle);
  const highUpper = BigInt(highCommit.after.outputCaptureCycle);
  const lowLower = BigInt(lowCommit.before.outputCaptureCycle);
  const lowUpper = BigInt(lowCommit.after.outputCaptureCycle);
  const highTimeLower = BigInt(highCommit.before.outputCaptureTimeUs);
  const highTimeUpper = BigInt(highCommit.after.outputCaptureTimeUs);
  const lowTimeLower = BigInt(lowCommit.before.outputCaptureTimeUs);
  const lowTimeUpper = BigInt(lowCommit.after.outputCaptureTimeUs);
  return {
    plcCycles: {
      lowerBound: Number(lowLower > highUpper ? lowLower - highUpper : 0n),
      upperBound: Number(lowUpper > highLower ? lowUpper - highLower : 0n),
    },
    plcTimeUs: {
      lowerBound: Number(lowTimeLower > highTimeUpper ? lowTimeLower - highTimeUpper : 0n),
      upperBound: Number(lowTimeUpper > highTimeLower ? lowTimeUpper - highTimeLower : 0n),
    },
  };
}

async function main() {
  if (!userName) throw new Error('OPC_USER is required');
  const wanted = new Set([...controlNames, ...readNames, ...slotNames]);
  const client = createClient();
  await client.connect(endpointUrl);
  let session;
  let sub;
  try {
    session = await client.createSession({ type: UserTokenType.UserName, userName, password: password || '' });
    const nodes = await browseWanted(session, wanted);
    const initial = await readMany(session, nodes, ['WorkstationHeartbeat', 'PlcBootIdentity']);
    const state = { heartbeat: u64ToBigInt(initial.WorkstationHeartbeat) };
    await resetSession(session, nodes, state);
    sub = await createSubscription(session, nodes);
    const epoch = (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
    let sequence = 0n;
    const steadyTransitions = [];
    const pulses = [];

    async function steady(label, kind) {
      sequence += 1n;
      const image = imageFor(kind, Number(sequence));
      const expected = expectedOutputs(image);
      const starts = eventStarts(sub.tracker);
      const commit = await commitImage(session, nodes, sub.tracker, state, epoch, sequence, image);
      const changedExpected = Object.fromEntries(
        outputFields.filter((name) => commit.before.outputs[name] !== expected[name])
          .map((name) => [name, expected[name]])
      );
      const events = await waitForOutputs(sub.tracker, starts, changedExpected);
      const readMatches = outputFields.every((name) => commit.after.outputs[name] === expected[name]);
      const notificationsVisible = Object.values(events).every(Boolean);
      steadyTransitions.push({
        label, expected, changedExpected, readMatches, notificationsVisible,
        statusGood: Object.values(events).filter(Boolean).every((event) => event.status.startsWith('Good')),
        transitionBounds: transitionBounds(commit), commit, outputEvents: events,
      });
    }

    async function pulse(kind, requestedHoldMs) {
      const expectedHigh = expectedOutputs(imageFor(kind, Number(sequence + 1n)));
      const expectedLow = expectedOutputs(imageFor('baseline', Number(sequence + 2n)));
      const starts = eventStarts(sub.tracker);
      sequence += 1n;
      const highCommit = await commitImage(
        session, nodes, sub.tracker, state, epoch, sequence, imageFor(kind, Number(sequence))
      );
      if (requestedHoldMs > 0) await sleep(requestedHoldMs);
      sequence += 1n;
      const lowCommit = await commitImage(
        session, nodes, sub.tracker, state, epoch, sequence, imageFor('baseline', Number(sequence))
      );
      await sleep(Math.max(100, sub.revisedPublishingIntervalMs * 3));
      const visibility = {};
      for (const name of outputFields) {
        if (expectedHigh[name] === expectedLow[name]) continue;
        const events = sub.tracker.events.get(name).slice(starts[name]);
        const highIndex = events.findIndex((event) => event.value === expectedHigh[name]);
        const lowIndex = highIndex < 0
          ? -1 : events.findIndex((event, index) => index > highIndex && event.value === expectedLow[name]);
        visibility[name] = {
          highVisible: highIndex >= 0,
          lowVisibleAfterHigh: lowIndex >= 0,
          highEvent: highIndex >= 0 ? events[highIndex] : null,
          lowEvent: lowIndex >= 0 ? events[lowIndex] : null,
        };
      }
      pulses.push({
        kind, requestedHoldAfterHighAckMs: requestedHoldMs,
        bounds: pulseBounds(highCommit, lowCommit),
        highCommit, lowCommit, visibility,
      });
    }

    await steady('baseline', 'baseline');
    await steady('motor-on', 'motor');
    await steady('motor-off', 'baseline');
    await steady('d1-on', 'd1');
    await steady('d1-off', 'baseline');
    await steady('d2-on', 'd2');
    await steady('d2-off', 'baseline');
    await steady('overload-on-red-on-green-off', 'overload');
    await steady('overload-off-red-off-green-on', 'baseline');

    for (const kind of ['motor', 'd1', 'd2', 'overload']) {
      for (const holdMs of [0, 20, 40, 80, 160]) await pulse(kind, holdMs);
    }

    const limits = {};
    for (const name of outputFields) {
      const candidates = pulses.filter((pulseResult) => pulseResult.visibility[name]);
      const visible = candidates.filter((pulseResult) => {
        const item = pulseResult.visibility[name];
        return item.highVisible && item.lowVisibleAfterHigh;
      });
      limits[name] = {
        attempted: candidates.length,
        visible: visible.length,
        missing: candidates.length - visible.length,
        narrowestVisible: visible.length ? visible.reduce((best, current) => (
          current.bounds.plcTimeUs.upperBound < best.bounds.plcTimeUs.upperBound ? current : best
        )) : null,
      };
    }

    const allEvents = [...sub.tracker.events.values()].flat();
    allEvents.sort((a, b) => (BigInt(a.workstationReceiptNs) < BigInt(b.workstationReceiptNs) ? -1 : 1));
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(eventPath, `${allEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    const exercisedOutputs = [...new Set(steadyTransitions.flatMap((item) => Object.keys(item.changedExpected)))];
    const steadyPass = outputFields.every((name) => exercisedOutputs.includes(name))
      && steadyTransitions.every((item) => item.readMatches
        && item.notificationsVisible && item.statusGood);
    const payload = {
      schemaVersion: 1,
      milestone: 'M4', measuredAt: new Date().toISOString(),
      endpointUrl, securityMode: 'SignAndEncrypt', securityPolicy: 'Basic256Sha256',
      pass: steadyPass,
      verdict: steadyPass
        ? 'All five steady-state outputs were current and visible. Pulse visibility is bounded below without claiming exact scan observation.'
        : 'At least one steady-state output was stale, missing, or reported non-Good status.',
      bootIdentity: u64ToBigInt(initial.PlcBootIdentity).toString(),
      epoch: epoch.toString(), finalSequence: sequence.toString(),
      subscription: {
        requestedPublishingIntervalMs: sub.requestedPublishingIntervalMs,
        revisedPublishingIntervalMs: sub.revisedPublishingIntervalMs,
        requestedSamplingIntervalMs: sub.requestedSamplingIntervalMs,
        revisedSamplingIntervalsMs: sub.tracker.revisedSamplingIntervalsMs,
        rawNotifications: sub.tracker.rawNotifications,
        publishSequenceGaps: sub.tracker.publishSequenceGaps,
      },
      steadyTransitions, exercisedOutputs, pulses, pulseVisibilityLimits: limits,
      timestampEvidence: {
        fieldsRetained: ['status', 'sourceTimestamp', 'serverTimestamp', 'workstationReceiptNs', 'workstationReceiptTime'],
        eventCount: allEvents.length,
        nullSourceTimestamps: allEvents.filter((event) => event.sourceTimestamp === null).length,
        nullServerTimestamps: allEvents.filter((event) => event.serverTimestamp === null).length,
      },
      limitations: [
        'OPC UA observation is not scan-synchronous.',
        'Transition scans are represented as PLC cycle/time bounds from reads around each accepted commit.',
        'A missing narrow pulse notification establishes a visibility limit; it does not imply that the PLC output failed to pulse.',
      ],
      eventPath,
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } finally {
    if (sub) {
      try { await sub.subscription.terminate(); } catch { /* preserve primary result */ }
    }
    if (session) {
      try { await session.close(); } catch { /* preserve primary result */ }
    }
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`M4 probe failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
