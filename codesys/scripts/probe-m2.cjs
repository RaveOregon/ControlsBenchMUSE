#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  OPCUAClient,
  DataType,
  MessageSecurityMode,
  SecurityPolicy,
  UserTokenType,
  boolFields,
  realFields,
  outputFields,
  activeNames,
  sleep,
  u64ToBigInt,
  browseWanted,
  readMany,
  writeMany,
  imageWrites,
  compareActive,
} = require('./probe-m1.cjs');

const endpointUrl = process.env.OPC_ENDPOINT || 'opc.tcp://127.0.0.1:4840';
const userName = process.env.OPC_USER;
const password = process.env.OPC_PASSWORD;
const artifactDir = path.resolve(__dirname, '..', 'artifacts');
const resultPath = process.env.M2_OUTPUT || path.join(artifactDir, 'm2-opcua-result.json');
const tracePath = process.env.M2_TRACE || path.join(artifactDir, 'm2-coherence-trace.jsonl');
const postRestart = process.argv.includes('--post-restart');

const counterNames = [
  'AppliedCommitCount', 'DuplicateCommitCount', 'StaleCommitCount',
  'SkippedSequenceCount', 'InvalidSlotCount', 'InvalidPayloadCount',
  'SlotMetadataMismatchCount', 'EpochRejectedCount', 'SessionResetCount',
];
const statusNames = [
  'SimApplied', 'ConnectorStale', 'ActiveSlot', 'AppliedEpoch', 'AppliedSequence',
  'PlcBootIdentity', 'PlcCycle', 'PlcTimeUs', 'OutputCaptureCycle', 'OutputCaptureTimeUs',
  ...counterNames, ...outputFields,
];
const controlNames = [
  'SimRequest', 'SessionResetRequest', 'RequestedSlot', 'RequestedEpoch',
  'RequestedSequence', 'WorkstationHeartbeat',
];
const slotNames = [];
for (const slot of [0, 1]) {
  slotNames.push(`Slot${slot}_Valid`, `Slot${slot}_Epoch`, `Slot${slot}_Sequence`);
  for (const field of boolFields) slotNames.push(`Slot${slot}_${field}`);
  for (const field of realFields) slotNames.push(`Slot${slot}_${field}`);
  slotNames.push(`Slot${slot}_Encoder_Count`);
}
const wantedNames = new Set([...controlNames, ...statusNames, ...slotNames, ...activeNames]);

function createClient() {
  return OPCUAClient.create({
    applicationName: 'NodeOPCUA-Client',
    endpointMustExist: false,
    securityMode: MessageSecurityMode.SignAndEncrypt,
    securityPolicy: SecurityPolicy.Basic256Sha256,
    automaticallyAcceptUnknownCertificate: true,
    connectionStrategy: { initialDelay: 250, maxRetry: 0 },
  });
}

async function connect() {
  const client = createClient();
  await client.connect(endpointUrl);
  const session = await client.createSession({
    type: UserTokenType.UserName,
    userName,
    password: password || '',
  });
  return { client, session };
}

async function disconnect(connection) {
  if (!connection) return;
  try { await connection.session.close(); } finally { await connection.client.disconnect(); }
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

function counterSnapshot(values) {
  return Object.fromEntries(counterNames.map((name) => [name, u64ToBigInt(values[name])]));
}

function counterDelta(before, after) {
  return Object.fromEntries(counterNames.map((name) => [name, (after[name] - before[name]).toString()]));
}

async function waitUntil(session, predicate, names, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = await readMany(session, names.nodes, names.fields);
    if (predicate(values)) return values;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function resetSession(session, nodes, state) {
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
  await waitUntil(
    session,
    (values) => u64ToBigInt(values.SessionResetCount) > u64ToBigInt(before.SessionResetCount)
      && u64ToBigInt(values.AppliedEpoch) === 0n
      && u64ToBigInt(values.AppliedSequence) === 0n,
    { nodes, fields: ['SessionResetCount', 'AppliedEpoch', 'AppliedSequence'] },
    2000,
    'session reset'
  );
  await writeMany(session, nodes, [
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: false },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: '0' },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: '0' },
  ]);
  await sleep(30);
  state.activeSlot = 255;
}

async function stageImage(session, nodes, slot, epoch, sequence, image, valid = true) {
  const writes = [
    // One OPC UA Write service, ordered so Valid guards the complete slot update.
    { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: false },
    ...imageWrites(slot, image),
    { name: `Slot${slot}_Epoch`, dataType: DataType.UInt64, value: epoch.toString() },
    { name: `Slot${slot}_Sequence`, dataType: DataType.UInt64, value: sequence.toString() },
  ];
  if (valid) {
    writes.push(
      { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: true },
    );
  }
  await writeMany(session, nodes, writes);
}

async function requestCommit(session, nodes, state, slot, epoch, sequence) {
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    { name: 'RequestedSlot', dataType: DataType.Byte, value: slot },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: epoch.toString() },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: sequence.toString() },
  ]);
}

async function waitForCoherentCommit(session, nodes, epoch, sequence, image, timeoutMs = 2000) {
  const fields = [
    'AppliedEpoch', 'AppliedSequence', 'ActiveSlot', 'PlcCycle', 'OutputCaptureCycle',
    ...activeNames, ...outputFields,
  ];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = await readMany(session, nodes, fields);
    if (u64ToBigInt(values.AppliedEpoch) === epoch
      && u64ToBigInt(values.AppliedSequence) === sequence) {
      const mismatches = compareActive(image, values);
      if (mismatches.length) {
        throw new Error(`Torn active image at ${sequence}: ${mismatches.join(', ')}`);
      }
      const outputReady = u64ToBigInt(values.OutputCaptureCycle) === u64ToBigInt(values.PlcCycle);
      if (outputReady) {
        const expected = expectedOutputs(image);
        const outputMismatches = outputFields.filter((name) => values[name] !== expected[name]);
        if (outputMismatches.length) {
          throw new Error(`Downstream output mismatch at ${sequence}: ${outputMismatches.join(', ')}`);
        }
        return values;
      }
    }
    await sleep(3);
  }
  throw new Error(`Timed out waiting for coherent commit (${epoch}, ${sequence})`);
}

async function commitImage(session, nodes, state, epoch, sequence, image) {
  const slot = state.activeSlot === 0 ? 1 : 0;
  const started = performance.now();
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    // Complete ordered transaction: invalidate, stage, validate, then publish one commit edge.
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
  const values = await waitForCoherentCommit(session, nodes, epoch, sequence, image);
  state.activeSlot = slot;
  return {
    sequence: sequence.toString(),
    slot,
    latencyMs: Number((performance.now() - started).toFixed(3)),
    outputCaptureCycle: u64ToBigInt(values.OutputCaptureCycle).toString(),
  };
}

async function assertActiveUnchanged(session, nodes, expectedEpoch, expectedSequence, expectedImage, label) {
  await sleep(70);
  const values = await readMany(session, nodes, ['AppliedEpoch', 'AppliedSequence', ...activeNames]);
  if (u64ToBigInt(values.AppliedEpoch) !== expectedEpoch
    || u64ToBigInt(values.AppliedSequence) !== expectedSequence) {
    throw new Error(`${label} changed the applied revision`);
  }
  const mismatches = compareActive(expectedImage, values);
  if (mismatches.length) throw new Error(`${label} changed active image: ${mismatches.join(', ')}`);
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function runPreRestart() {
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(tracePath, '', 'utf8');
  const trace = [];
  let traceFlushed = 0;
  const stressStarted = performance.now();
  let connection;
  let nodes;
  let state;

  try {
    connection = await connect();
    nodes = await browseWanted(connection.session, wantedNames);
    const controlValues = await readMany(connection.session, nodes, ['WorkstationHeartbeat']);
    state = {
      heartbeat: u64ToBigInt(controlValues.WorkstationHeartbeat),
      activeSlot: 255,
    };
    const initialStatus = await readMany(connection.session, nodes, ['PlcBootIdentity', ...counterNames]);
    const bootIdentity = u64ToBigInt(initialStatus.PlcBootIdentity);
    const countersBefore = counterSnapshot(initialStatus);
    await resetSession(connection.session, nodes, state);

    const epoch = (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
    let currentSequence = 0n;
    let currentImage = encodedImage(epoch, 0n);

    for (let index = 1; index <= 10000; index += 1) {
      currentSequence = BigInt(index);
      currentImage = encodedImage(epoch, currentSequence);
      const record = await commitImage(
        connection.session, nodes, state, epoch, currentSequence, currentImage
      );
      trace.push(record);
      if (index % 100 === 0) {
        fs.appendFileSync(
          tracePath,
          `${trace.slice(traceFlushed).map((item) => JSON.stringify(item)).join('\n')}\n`,
          'utf8'
        );
        traceFlushed = trace.length;
        const elapsedMs = performance.now() - stressStarted;
        const etaMinutes = ((elapsedMs / index) * (10000 - index)) / 60000;
        process.stderr.write(
          `M2 progress: ${index}/10000 coherent images; ` +
          `elapsed ${(elapsedMs / 60000).toFixed(1)} min; ETA ${etaMinutes.toFixed(1)} min\n`
        );
      }
    }

    // Duplicate revision in the inactive slot.
    let slot = state.activeSlot === 0 ? 1 : 0;
    await stageImage(connection.session, nodes, slot, epoch, currentSequence, currentImage, true);
    await writeMany(connection.session, nodes, [
      { name: 'RequestedEpoch', dataType: DataType.UInt64, value: '0' },
      { name: 'RequestedSequence', dataType: DataType.UInt64, value: '0' },
    ]);
    await sleep(30);
    await requestCommit(connection.session, nodes, state, slot, epoch, currentSequence);
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'duplicate');

    // Stale revision.
    const staleSequence = currentSequence - 1n;
    await stageImage(connection.session, nodes, slot, epoch, staleSequence, encodedImage(epoch, staleSequence), true);
    await requestCommit(connection.session, nodes, state, slot, epoch, staleSequence);
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'stale');

    // Skipped sequence is accepted but attributed.
    currentSequence += 2n;
    currentImage = encodedImage(epoch, currentSequence);
    await stageImage(connection.session, nodes, slot, epoch, currentSequence, currentImage, true);
    await requestCommit(connection.session, nodes, state, slot, epoch, currentSequence);
    await waitForCoherentCommit(connection.session, nodes, epoch, currentSequence, currentImage);
    state.activeSlot = slot;

    // Invalid requested slot.
    await requestCommit(connection.session, nodes, state, 2, epoch, currentSequence + 1n);
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'invalid-slot');

    // Incomplete slot: matching metadata but Valid remains false.
    slot = state.activeSlot === 0 ? 1 : 0;
    const incompleteSequence = currentSequence + 2n;
    await stageImage(
      connection.session, nodes, slot, epoch, incompleteSequence,
      encodedImage(epoch, incompleteSequence), false
    );
    await requestCommit(connection.session, nodes, state, slot, epoch, incompleteSequence);
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'incomplete-slot');

    // Premature Valid alone must not apply. Complete the same slot before changing the request.
    const prematureSequence = currentSequence + 1n;
    const prematureImage = encodedImage(epoch, prematureSequence);
    await writeMany(connection.session, nodes, [
      { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: true },
    ]);
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'premature-valid');
    await writeMany(connection.session, nodes, [
      ...imageWrites(slot, prematureImage),
      { name: `Slot${slot}_Epoch`, dataType: DataType.UInt64, value: epoch.toString() },
      { name: `Slot${slot}_Sequence`, dataType: DataType.UInt64, value: prematureSequence.toString() },
    ]);
    await requestCommit(connection.session, nodes, state, slot, epoch, prematureSequence);
    await waitForCoherentCommit(connection.session, nodes, epoch, prematureSequence, prematureImage);
    state.activeSlot = slot;
    currentSequence = prematureSequence;
    currentImage = prematureImage;

    // Slot metadata does not match the requested sequence.
    slot = state.activeSlot === 0 ? 1 : 0;
    const correctNextSequence = currentSequence + 1n;
    await stageImage(
      connection.session, nodes, slot, epoch, correctNextSequence,
      encodedImage(epoch, correctNextSequence), true
    );
    await requestCommit(connection.session, nodes, state, slot, epoch, correctNextSequence + 1n);
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'metadata-mismatch');

    // Reconnect with a completely staged image; nothing applies until the explicit commit.
    await disconnect(connection);
    connection = await connect();
    nodes = await browseWanted(connection.session, wantedNames);
    state.heartbeat += 1n;
    await writeMany(connection.session, nodes, [
      { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    ]);
    await sleep(30);
    const fresh = await readMany(connection.session, nodes, ['ConnectorStale']);
    if (fresh.ConnectorStale) throw new Error('Connector remained stale after reconnect heartbeat');
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'reconnect-before-commit');
    await requestCommit(connection.session, nodes, state, slot, epoch, correctNextSequence);
    const reconnectImage = encodedImage(epoch, correctNextSequence);
    await waitForCoherentCommit(connection.session, nodes, epoch, correctNextSequence, reconnectImage);
    state.activeSlot = slot;
    currentSequence = correctNextSequence;
    currentImage = reconnectImage;

    // A different old epoch is rejected while the link is fresh.
    const oldEpoch = epoch > 1n ? epoch - 1n : epoch + 1n;
    slot = state.activeSlot === 0 ? 1 : 0;
    await stageImage(connection.session, nodes, slot, oldEpoch, 1n, encodedImage(oldEpoch, 1n), true);
    await requestCommit(connection.session, nodes, state, slot, oldEpoch, 1n);
    await assertActiveUnchanged(connection.session, nodes, epoch, currentSequence, currentImage, 'old-epoch');

    // Explicit workstation restart authorization clears continuity for a new epoch.
    await resetSession(connection.session, nodes, state);
    const newEpoch = epoch + 0x100000001n;
    const newImage = encodedImage(newEpoch, 1n);
    const newCommit = await commitImage(connection.session, nodes, state, newEpoch, 1n, newImage);

    const finalStatus = await readMany(connection.session, nodes, ['PlcBootIdentity', ...counterNames]);
    if (u64ToBigInt(finalStatus.PlcBootIdentity) !== bootIdentity) {
      throw new Error('PLC boot identity changed during pre-restart phase');
    }
    const countersAfter = counterSnapshot(finalStatus);
    const deltas = counterDelta(countersBefore, countersAfter);
    const requiredDeltas = {
      AppliedCommitCount: 10004n,
      DuplicateCommitCount: 1n,
      StaleCommitCount: 1n,
      SkippedSequenceCount: 1n,
      InvalidSlotCount: 1n,
      InvalidPayloadCount: 1n,
      SlotMetadataMismatchCount: 1n,
      EpochRejectedCount: 1n,
      SessionResetCount: 2n,
    };
    for (const [name, expected] of Object.entries(requiredDeltas)) {
      const actual = countersAfter[name] - countersBefore[name];
      if (actual !== expected) throw new Error(`${name} delta ${actual} did not equal ${expected}`);
    }

    if (traceFlushed < trace.length) {
      fs.appendFileSync(
        tracePath,
        `${trace.slice(traceFlushed).map((record) => JSON.stringify(record)).join('\n')}\n`,
        'utf8'
      );
    }
    for (let index = 1; index < trace.length; index += 1) {
      if (BigInt(trace[index].outputCaptureCycle)
        <= BigInt(trace[index - 1].outputCaptureCycle)) {
        throw new Error(`Output capture cycle was not monotonic at trace index ${index}`);
      }
    }
    const latencies = trace.map((record) => record.latencyMs).sort((a, b) => a - b);
    const payload = {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      endpointUrl,
      securityMode: 'SignAndEncrypt',
      securityPolicy: 'Basic256Sha256',
      phase: 'pre-restart',
      pass: true,
      imageCount: trace.length,
      tornImages: 0,
      bootIdentity: bootIdentity.toString(),
      stressEpoch: epoch.toString(),
      workstationRestartEpoch: newEpoch.toString(),
      finalCommit: newCommit,
      counterDeltas: deltas,
      latencyMs: {
        min: latencies[0],
        p50: percentile(latencies, 0.50),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        max: latencies.at(-1),
      },
      cases: [
        '10000-alternating-images', 'duplicate', 'stale', 'skipped-sequence',
        'invalid-slot', 'incomplete-slot', 'premature-valid',
        'mismatched-slot-sequence', 'reconnect-explicit-commit',
        'old-epoch-after-reconnect', 'workstation-restart-new-epoch',
      ],
      tracePath,
      postRestart: null,
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
  } finally {
    await disconnect(connection);
  }
}

async function runPostRestart() {
  if (!fs.existsSync(resultPath)) throw new Error(`Missing pre-restart result: ${resultPath}`);
  const payload = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (!payload.pass || payload.phase !== 'pre-restart') {
    throw new Error('M2 pre-restart phase has not passed');
  }
  const oldBootIdentity = BigInt(payload.bootIdentity);
  let connection;
  try {
    connection = await connect();
    const nodes = await browseWanted(connection.session, wantedNames);
    const initial = await readMany(connection.session, nodes, [
      'PlcBootIdentity', 'AppliedEpoch', 'AppliedSequence', 'WorkstationHeartbeat',
    ]);
    const newBootIdentity = u64ToBigInt(initial.PlcBootIdentity);
    if (newBootIdentity === oldBootIdentity) {
      throw new Error('PLC boot identity did not change; perform Online > Reset Cold and start RUN');
    }
    if (u64ToBigInt(initial.AppliedEpoch) !== 0n || u64ToBigInt(initial.AppliedSequence) !== 0n) {
      throw new Error('PLC restart did not clear applied epoch/sequence');
    }
    const state = {
      heartbeat: u64ToBigInt(initial.WorkstationHeartbeat),
      activeSlot: 255,
    };
    await resetSession(connection.session, nodes, state);
    const epoch = (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
    const image = encodedImage(epoch, 1n);
    const commit = await commitImage(connection.session, nodes, state, epoch, 1n, image);
    payload.phase = 'complete';
    payload.measuredCompleteAt = new Date().toISOString();
    payload.postRestart = {
      pass: true,
      oldBootIdentity: oldBootIdentity.toString(),
      newBootIdentity: newBootIdentity.toString(),
      resetStateObserved: true,
      acceptedEpoch: epoch.toString(),
      acceptedSequence: '1',
      commit,
    };
    fs.writeFileSync(resultPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return payload;
  } finally {
    await disconnect(connection);
  }
}

async function main() {
  if (!userName) throw new Error('OPC_USER is required');
  const payload = postRestart ? await runPostRestart() : await runPreRestart();
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

main().catch((error) => {
  console.error(`M2 probe failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
