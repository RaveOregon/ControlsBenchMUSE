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
  boolFields, realFields, outputFields, activeNames, sleep, u64ToBigInt,
  browseWanted, readMany, writeMany, makeImage, imageWrites, compareActive,
} = require('./probe-m1.cjs');

const endpointUrl = process.env.OPC_ENDPOINT || 'opc.tcp://127.0.0.1:4840';
const userName = process.env.OPC_USER;
const password = process.env.OPC_PASSWORD;
const outputPath = process.env.M5_OUTPUT
  || path.resolve(__dirname, '..', 'artifacts', 'm5-result.json');

const controlNames = [
  'SimRequest', 'SessionResetRequest', 'RequestedSlot', 'RequestedEpoch',
  'RequestedSequence', 'WorkstationHeartbeat',
];
const readNames = [
  'SimApplied', 'ConnectorStale', 'ActiveSlot', 'AppliedEpoch', 'AppliedSequence',
  'PlcBootIdentity', 'PlcCycle', 'PlcTimeUs', 'SessionResetCount', ...outputFields,
];
const slotNames = [];
for (const slot of [0, 1]) {
  slotNames.push(`Slot${slot}_Valid`, `Slot${slot}_Epoch`, `Slot${slot}_Sequence`);
  for (const field of boolFields) slotNames.push(`Slot${slot}_${field}`);
  for (const field of realFields) slotNames.push(`Slot${slot}_${field}`);
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

async function createSession(client) {
  return client.createSession({ type: UserTokenType.UserName, userName, password: password || '' });
}

function testImage(id) {
  const image = makeImage(
    (index) => ((index + id) % 3) === 0,
    [id + 0.25, id + 1.5, id + 10, id + 20],
    (0x10000000 + id) >>> 0
  );
  return image;
}

function compactSnapshot(values) {
  const active = Object.fromEntries(activeNames.map((name) => [name, values[name]]));
  const outputs = Object.fromEntries(outputFields.map((name) => [name, values[name]]));
  return {
    simApplied: values.SimApplied,
    connectorStale: values.ConnectorStale,
    activeSlot: Number(values.ActiveSlot),
    appliedEpoch: u64ToBigInt(values.AppliedEpoch).toString(),
    appliedSequence: u64ToBigInt(values.AppliedSequence).toString(),
    bootIdentity: u64ToBigInt(values.PlcBootIdentity).toString(),
    plcCycle: u64ToBigInt(values.PlcCycle).toString(),
    plcTimeUs: u64ToBigInt(values.PlcTimeUs).toString(),
    active, outputs,
  };
}

async function snapshot(session, nodes) {
  return compactSnapshot(await readMany(session, nodes, [
    'SimApplied', 'ConnectorStale', 'ActiveSlot', 'AppliedEpoch', 'AppliedSequence',
    'PlcBootIdentity', 'PlcCycle', 'PlcTimeUs', ...activeNames, ...outputFields,
  ]));
}

function imageHeld(image, state) {
  return compareActive(image, state.active).length === 0;
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

async function waitApplied(session, nodes, epoch, sequence, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = await readMany(session, nodes, ['AppliedEpoch', 'AppliedSequence']);
    if (u64ToBigInt(values.AppliedEpoch) === epoch
      && u64ToBigInt(values.AppliedSequence) === sequence) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for (${epoch}, ${sequence})`);
}

async function commitImage(session, nodes, state, epoch, sequence, image) {
  const active = await readMany(session, nodes, ['ActiveSlot']);
  const slot = Number(active.ActiveSlot) === 0 ? 1 : 0;
  state.heartbeat += 1n;
  const heartbeatWriteNs = process.hrtime.bigint();
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
  await waitApplied(session, nodes, epoch, sequence);
  return { slot, heartbeat: state.heartbeat.toString(), heartbeatWriteNs };
}

async function writeStagingOnly(session, nodes, epoch, sequence, image) {
  const active = await readMany(session, nodes, ['ActiveSlot']);
  const slot = Number(active.ActiveSlot) === 0 ? 1 : 0;
  await writeMany(session, nodes, [
    { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: false },
    ...imageWrites(slot, image),
    { name: `Slot${slot}_Epoch`, dataType: DataType.UInt64, value: epoch.toString() },
    { name: `Slot${slot}_Sequence`, dataType: DataType.UInt64, value: sequence.toString() },
    { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: true },
  ]);
  return slot;
}

async function heartbeatOnly(session, nodes, state) {
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
  ]);
  await sleep(60);
}

async function observeStaleAndHold(observerSession, nodes, image, heartbeatWriteNs) {
  const samples = [];
  let staleState = null;
  const deadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    const current = await snapshot(observerSession, nodes);
    const elapsedMs = Number(process.hrtime.bigint() - heartbeatWriteNs) / 1e6;
    const held = imageHeld(image, current);
    samples.push({ elapsedMs, held, connectorStale: current.connectorStale, plcCycle: current.plcCycle });
    if (!held || !current.simApplied) break;
    if (current.connectorStale) {
      staleState = current;
      break;
    }
    await sleep(10);
  }
  const first = samples[0];
  const last = samples.at(-1);
  return {
    pass: Boolean(staleState)
      && samples.every((sample) => sample.held)
      && staleState.simApplied
      && last.elapsedMs >= 500,
    staleObserved: Boolean(staleState),
    staleObservedAfterMs: staleState ? last.elapsedMs : null,
    plcCyclesElapsed: staleState ? Number(BigInt(last.plcCycle) - BigInt(first.plcCycle)) : null,
    holdSamples: samples.length,
    allSamplesHeld: samples.every((sample) => sample.held),
    finalState: staleState || await snapshot(observerSession, nodes),
  };
}

async function verifyNoImplicitApply(observerSession, nodes, heldImage, heldEpoch, heldSequence) {
  await sleep(150);
  const current = await snapshot(observerSession, nodes);
  return {
    pass: imageHeld(heldImage, current)
      && current.appliedEpoch === heldEpoch.toString()
      && current.appliedSequence === heldSequence.toString()
      && current.simApplied,
    state: current,
  };
}

async function createAndTerminateSubscription(session, nodes) {
  const subscription = await session.createSubscription2({
    requestedPublishingInterval: 20,
    requestedLifetimeCount: 1000,
    requestedMaxKeepAliveCount: 20,
    maxNotificationsPerPublish: 0,
    publishingEnabled: true,
    priority: 1,
  });
  const item = await subscription.monitor(
    { nodeId: nodes.get('AppliedSequence').nodeId, attributeId: AttributeIds.Value },
    { samplingInterval: 20, discardOldest: true, queueSize: 10 },
    TimestampsToReturn.Both
  );
  await sleep(100);
  const evidence = {
    requestedPublishingIntervalMs: 20,
    revisedPublishingIntervalMs: subscription.publishingInterval,
    requestedSamplingIntervalMs: 20,
    revisedSamplingIntervalMs: item.monitoringParameters.samplingInterval,
  };
  await subscription.terminate();
  return evidence;
}

async function main() {
  if (!userName) throw new Error('OPC_USER is required');
  const wanted = new Set([...controlNames, ...readNames, ...slotNames, ...activeNames]);
  const observerClient = createClient();
  let controllerClient = createClient();
  await observerClient.connect(endpointUrl);
  await controllerClient.connect(endpointUrl);
  let observerSession;
  let controllerSession;
  try {
    observerSession = await createSession(observerClient);
    controllerSession = await createSession(controllerClient);
    const nodes = await browseWanted(observerSession, wanted);
    const initial = await readMany(controllerSession, nodes, ['WorkstationHeartbeat', 'PlcBootIdentity']);
    const state = { heartbeat: u64ToBigInt(initial.WorkstationHeartbeat) };
    const bootIdentity = u64ToBigInt(initial.PlcBootIdentity);
    await resetSession(controllerSession, nodes, state);
    const epoch1 = (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
    const cases = [];

    process.stderr.write('M5 subscription-loss case\n');
    const imageA = testImage(1);
    const commitA = await commitImage(controllerSession, nodes, state, epoch1, 1n, imageA);
    const subscriptionEvidence = await createAndTerminateSubscription(controllerSession, nodes);
    const subscriptionHold = await observeStaleAndHold(
      observerSession, nodes, imageA, commitA.heartbeatWriteNs
    );
    const imageB = testImage(2);
    const stagedSlotB = await writeStagingOnly(controllerSession, nodes, epoch1, 2n, imageB);
    const stagedNoApplyB = await verifyNoImplicitApply(observerSession, nodes, imageA, epoch1, 1n);
    await heartbeatOnly(controllerSession, nodes, state);
    const heartbeatNoApplyB = await verifyNoImplicitApply(observerSession, nodes, imageA, epoch1, 1n);
    const commitB = await commitImage(controllerSession, nodes, state, epoch1, 2n, imageB);
    const recoveredB = await snapshot(observerSession, nodes);
    cases.push({
      name: 'subscription-loss',
      pass: subscriptionHold.pass && stagedNoApplyB.pass && heartbeatNoApplyB.pass
        && imageHeld(imageB, recoveredB) && !recoveredB.connectorStale,
      subscriptionEvidence, hold: subscriptionHold,
      stagedWithoutCommit: { slot: stagedSlotB, ...stagedNoApplyB },
      heartbeatOnly: heartbeatNoApplyB,
      explicitRecovery: { commit: { ...commitB, heartbeatWriteNs: commitB.heartbeatWriteNs.toString() }, state: recoveredB },
    });

    process.stderr.write('M5 client-session-loss case\n');
    const imageC = testImage(3);
    const commitC = await commitImage(controllerSession, nodes, state, epoch1, 3n, imageC);
    await controllerSession.close();
    controllerSession = null;
    const sessionHold = await observeStaleAndHold(observerSession, nodes, imageC, commitC.heartbeatWriteNs);
    controllerSession = await createSession(controllerClient);
    await heartbeatOnly(controllerSession, nodes, state);
    const heartbeatNoApplyC = await verifyNoImplicitApply(observerSession, nodes, imageC, epoch1, 3n);
    const imageD = testImage(4);
    const commitD = await commitImage(controllerSession, nodes, state, epoch1, 4n, imageD);
    const recoveredD = await snapshot(observerSession, nodes);
    cases.push({
      name: 'client-session-loss',
      pass: sessionHold.pass && heartbeatNoApplyC.pass
        && imageHeld(imageD, recoveredD) && !recoveredD.connectorStale,
      hold: sessionHold, heartbeatOnly: heartbeatNoApplyC,
      explicitRecovery: { commit: { ...commitD, heartbeatWriteNs: commitD.heartbeatWriteNs.toString() }, state: recoveredD },
    });

    process.stderr.write('M5 transport-connection-loss case\n');
    const imageE = testImage(5);
    const commitE = await commitImage(controllerSession, nodes, state, epoch1, 5n, imageE);
    await controllerClient.disconnect();
    controllerSession = null;
    const connectionHold = await observeStaleAndHold(observerSession, nodes, imageE, commitE.heartbeatWriteNs);
    controllerClient = createClient();
    await controllerClient.connect(endpointUrl);
    controllerSession = await createSession(controllerClient);
    const imageF = testImage(6);
    const stagedSlotF = await writeStagingOnly(controllerSession, nodes, epoch1, 6n, imageF);
    const stagedNoApplyF = await verifyNoImplicitApply(observerSession, nodes, imageE, epoch1, 5n);
    await heartbeatOnly(controllerSession, nodes, state);
    const heartbeatNoApplyF = await verifyNoImplicitApply(observerSession, nodes, imageE, epoch1, 5n);
    const commitF = await commitImage(controllerSession, nodes, state, epoch1, 6n, imageF);
    const recoveredF = await snapshot(observerSession, nodes);
    cases.push({
      name: 'transport-connection-loss',
      pass: connectionHold.pass && stagedNoApplyF.pass && heartbeatNoApplyF.pass
        && imageHeld(imageF, recoveredF) && recoveredF.appliedEpoch === epoch1.toString()
        && recoveredF.appliedSequence === '6' && !recoveredF.connectorStale,
      hold: connectionHold,
      stagedWithoutCommit: { slot: stagedSlotF, ...stagedNoApplyF },
      heartbeatOnly: heartbeatNoApplyF,
      explicitRecovery: { commit: { ...commitF, heartbeatWriteNs: commitF.heartbeatWriteNs.toString() }, state: recoveredF },
      retainedEpoch: epoch1.toString(),
    });

    const finalState = await snapshot(observerSession, nodes);
    const pass = cases.every((item) => item.pass)
      && finalState.bootIdentity === bootIdentity.toString()
      && finalState.simApplied;
    const payload = {
      schemaVersion: 1, milestone: 'M5', measuredAt: new Date().toISOString(),
      endpointUrl, securityMode: 'SignAndEncrypt', securityPolicy: 'Basic256Sha256',
      pass,
      verdict: pass
        ? 'All practical independent loss cases held the exact last committed image and required an explicit complete recovery commit.'
        : 'At least one practical loss/hold/recovery case failed.',
      staleContract: {
        configuredFloorMs: 500,
        implementation: 'ConnectorStale asserts after more than 25 scans of the 20 ms task without a changed workstation heartbeat.',
      },
      bootIdentity: bootIdentity.toString(), cases,
      serverOnlyLoss: {
        executed: false,
        disposition: 'not-practical-on-this-target',
        reason: 'The Control Win OPC UA server is in-process with the PLC runtime. Stopping it independently is not exposed; restarting Control Win is a PLC restart and resets state, already covered by M2 boot-identity/reset semantics.',
      },
      networkAdapterLoss: {
        executed: false,
        disposition: 'not-applicable-to-local-loopback',
        reason: 'The measured client and server use local loopback; disabling an external adapter would not isolate this connection. Secure-channel transport loss was exercised instead.',
      },
      workstationRestart: {
        executed: false,
        disposition: 'covered-by-M2-without-repetition',
        reason: 'M2 already proved workstation-new-epoch and PLC-new-boot behavior. The accepted handoff forbids repeating M2 without a specific diagnostic reason.',
      },
      finalState,
      limitations: [
        'Observer and controller use separate authenticated OPC UA connections on the same workstation.',
        'A controller disconnect is used for transport loss; no claim is made about a physical Ethernet fault on loopback.',
        'Server-only loss cannot be separated from PLC-runtime loss on this Control Win configuration.',
      ],
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(payload, (key, value) => (
      typeof value === 'bigint' ? value.toString() : value
    ), 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(payload, (key, value) => (
      typeof value === 'bigint' ? value.toString() : value
    ), 2)}\n`);
  } finally {
    if (controllerSession) {
      try { await controllerSession.close(); } catch { /* preserve primary error */ }
    }
    if (observerSession) {
      try { await observerSession.close(); } catch { /* preserve primary error */ }
    }
    try { await controllerClient.disconnect(); } catch { /* already disconnected */ }
    try { await observerClient.disconnect(); } catch { /* preserve primary error */ }
  }
}

main().catch((error) => {
  console.error(`M5 probe failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
