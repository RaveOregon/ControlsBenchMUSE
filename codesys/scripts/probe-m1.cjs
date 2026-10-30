#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const relayNodeOpcua = path.resolve(
  __dirname,
  '..',
  'codesys_handoff',
  'browser_hmi_handoff',
  'opcua_relay',
  'node_modules',
  'node-opcua'
);

const {
  OPCUAClient,
  AttributeIds,
  BrowseDirection,
  DataType,
  MessageSecurityMode,
  NodeClass,
  SecurityPolicy,
  UserTokenType,
} = require(relayNodeOpcua);

const endpointUrl = process.env.OPC_ENDPOINT || 'opc.tcp://127.0.0.1:4840';
const userName = process.env.OPC_USER;
const password = process.env.OPC_PASSWORD;
const outputPath = process.env.M1_OUTPUT || path.resolve(__dirname, '..', 'artifacts', 'm1-opcua-result.json');

const boolFields = [
  'PE_Entry', 'PE_D1Approach', 'PE_D2Approach', 'PE_ExitA', 'PE_ExitB',
  'PE_Runout', 'D1_HomeFB', 'D1_ExtendedFB', 'D2_HomeFB', 'D2_ExtendedFB',
  'Drive_RunningFB', 'Drive_Overload', 'ExitA_Ready', 'ExitB_Ready', 'Runout_Ready',
];
const realFields = ['Belt_SpeedActual', 'Drive_Current', 'D1_Position', 'D2_Position'];
const outputFields = ['Motor_RunCmd', 'D1_ExtendCmd', 'D2_ExtendCmd', 'StackLight_Red', 'StackLight_Green'];

const controlNames = [
  'SimRequest', 'SessionResetRequest', 'RequestedSlot', 'RequestedEpoch',
  'RequestedSequence', 'WorkstationHeartbeat',
];
const readNames = [
  'SimApplied', 'ConnectorStale', 'ActiveSlot', 'AppliedEpoch', 'AppliedSequence',
  'PlcBootIdentity', 'PlcCycle', 'PlcTimeUs', 'InvalidPayloadCount',
  ...outputFields,
];
const slotNames = [];
for (const slot of [0, 1]) {
  slotNames.push(`Slot${slot}_Valid`, `Slot${slot}_Epoch`, `Slot${slot}_Sequence`);
  for (const field of boolFields) slotNames.push(`Slot${slot}_${field}`);
  for (const field of realFields) slotNames.push(`Slot${slot}_${field}`);
  slotNames.push(`Slot${slot}_Encoder_Count`);
}
const activeNames = [
  ...boolFields.map((field) => `Active_${field}`),
  ...realFields.map((field) => `Active_${field}`),
  'Active_Encoder_Count',
];
const wantedNames = new Set([...controlNames, ...readNames, ...slotNames, ...activeNames]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function u64ToBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (Array.isArray(value)) return (BigInt(value[0]) << 32n) | BigInt(value[1]);
  return BigInt(value.toString());
}

function float32Bits(value) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, Math.fround(value), true);
  return view.getUint32(0, true);
}

async function browseWanted(session, requestedNames = wantedNames) {
  const found = new Map();
  const visibleVariables = [];
  const visited = new Set();

  async function walk(nodeId, pathParts, depth) {
    if (depth <= 0 || visited.has(nodeId.toString())) return;
    visited.add(nodeId.toString());
    const result = await session.browse({
      nodeId,
      referenceTypeId: 'HierarchicalReferences',
      includeSubtypes: true,
      browseDirection: BrowseDirection.Forward,
      nodeClassMask: 0,
      resultMask: 0x3f,
    });
    for (const ref of result.references || []) {
      const browseName = ref.browseName.toString();
      const qualifiedName = browseName.replace(/^\d+:/, '');
      const simpleName = qualifiedName.split('.').at(-1);
      const nextPath = [...pathParts, browseName];
      if (ref.nodeClass === NodeClass.Variable) {
        visibleVariables.push(qualifiedName);
        if (requestedNames.has(simpleName)) {
          const candidate = {
            nodeId: ref.nodeId.toString(),
            browsePath: nextPath.join('.'),
            qualifiedName,
            score: /(^|\.)GVL_Bench(?:Read|Write)(\.|$)/.test(qualifiedName) ? 2 : 1,
          };
          const current = found.get(simpleName);
          if (!current || candidate.score > current.score) found.set(simpleName, candidate);
        }
      }
      await walk(ref.nodeId, nextPath, depth - 1);
    }
  }

  await walk('RootFolder', [], 14);
  const missing = [...requestedNames].filter((name) => !found.has(name));
  if (missing.length) {
    const benchVariables = visibleVariables.filter((name) => /GVL_Bench|Bench/i.test(name));
    const diagnostic = (benchVariables.length ? benchVariables : visibleVariables).slice(0, 200);
    throw new Error(
      `Missing ${missing.length} published nodes: ${missing.join(', ')}\n` +
      `Visible variable browse names (${diagnostic.length} shown): ${diagnostic.join(', ')}`
    );
  }
  return found;
}

async function readMany(session, nodes, names) {
  const values = await session.read(
    names.map((name) => ({ nodeId: nodes.get(name).nodeId, attributeId: AttributeIds.Value }))
  );
  const result = {};
  names.forEach((name, index) => {
    if (!values[index].statusCode.isGood()) {
      throw new Error(`Read ${name} failed: ${values[index].statusCode.toString()}`);
    }
    result[name] = values[index].value.value;
  });
  return result;
}

async function writeMany(session, nodes, writes) {
  const statuses = await session.write(
    writes.map((write) => ({
      nodeId: nodes.get(write.name).nodeId,
      attributeId: AttributeIds.Value,
      value: { value: { dataType: write.dataType, value: write.value } },
    }))
  );
  statuses.forEach((status, index) => {
    if (!status.isGood()) throw new Error(`Write ${writes[index].name} failed: ${status.toString()}`);
  });
}

function makeImage(boolValue, realValues, encoderCount) {
  const image = { Encoder_Count: encoderCount >>> 0 };
  boolFields.forEach((field, index) => {
    image[field] = typeof boolValue === 'function' ? Boolean(boolValue(index)) : Boolean(boolValue);
  });
  realFields.forEach((field, index) => {
    image[field] = Math.fround(realValues[index]);
  });
  return image;
}

function imageWrites(slot, image) {
  const writes = [];
  for (const field of boolFields) {
    writes.push({ name: `Slot${slot}_${field}`, dataType: DataType.Boolean, value: image[field] });
  }
  for (const field of realFields) {
    writes.push({ name: `Slot${slot}_${field}`, dataType: DataType.Float, value: image[field] });
  }
  writes.push({ name: `Slot${slot}_Encoder_Count`, dataType: DataType.UInt32, value: image.Encoder_Count });
  return writes;
}

function compareActive(image, active) {
  const mismatches = [];
  for (const field of boolFields) {
    if (active[`Active_${field}`] !== image[field]) mismatches.push(field);
  }
  for (const field of realFields) {
    if (float32Bits(active[`Active_${field}`]) !== float32Bits(image[field])) mismatches.push(field);
  }
  if ((active.Active_Encoder_Count >>> 0) !== (image.Encoder_Count >>> 0)) mismatches.push('Encoder_Count');
  return mismatches;
}

async function waitForApplied(session, nodes, epoch, sequence, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const values = await readMany(session, nodes, ['AppliedEpoch', 'AppliedSequence']);
    if (u64ToBigInt(values.AppliedEpoch) === epoch && u64ToBigInt(values.AppliedSequence) === sequence) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`Timed out waiting for applied (${epoch}, ${sequence})`);
}

async function commitImage(session, nodes, epoch, sequence, image, state) {
  const status = await readMany(session, nodes, ['ActiveSlot']);
  const activeSlot = Number(status.ActiveSlot);
  const slot = activeSlot === 0 ? 1 : 0;

  await writeMany(session, nodes, [
    { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: false },
  ]);
  await writeMany(session, nodes, [
    ...imageWrites(slot, image),
    { name: `Slot${slot}_Epoch`, dataType: DataType.UInt64, value: epoch.toString() },
    { name: `Slot${slot}_Sequence`, dataType: DataType.UInt64, value: sequence.toString() },
  ]);
  await writeMany(session, nodes, [
    { name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: true },
  ]);

  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    { name: 'RequestedSlot', dataType: DataType.Byte, value: slot },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: epoch.toString() },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: sequence.toString() },
  ]);

  await waitForApplied(session, nodes, epoch, sequence);
  const active = await readMany(session, nodes, activeNames);
  const mismatches = compareActive(image, active);
  if (mismatches.length) throw new Error(`Active image mismatch: ${mismatches.join(', ')}`);
  return { slot, sequence: sequence.toString() };
}

async function expectRejectedImage(session, nodes, epoch, requestSequence, image, state, label) {
  const before = await readMany(session, nodes, ['ActiveSlot', 'AppliedSequence', 'InvalidPayloadCount']);
  const slot = Number(before.ActiveSlot) === 0 ? 1 : 0;
  await writeMany(session, nodes, [{ name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: false }]);
  await writeMany(session, nodes, [
    ...imageWrites(slot, image),
    { name: `Slot${slot}_Epoch`, dataType: DataType.UInt64, value: epoch.toString() },
    { name: `Slot${slot}_Sequence`, dataType: DataType.UInt64, value: requestSequence.toString() },
  ]);
  await writeMany(session, nodes, [{ name: `Slot${slot}_Valid`, dataType: DataType.Boolean, value: true }]);
  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
    { name: 'RequestedSlot', dataType: DataType.Byte, value: slot },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: epoch.toString() },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: requestSequence.toString() },
  ]);
  await sleep(100);
  const after = await readMany(session, nodes, ['AppliedSequence', 'InvalidPayloadCount']);
  if (u64ToBigInt(after.AppliedSequence) !== u64ToBigInt(before.AppliedSequence)) {
    throw new Error(`${label} payload was applied`);
  }
  if (u64ToBigInt(after.InvalidPayloadCount) <= u64ToBigInt(before.InvalidPayloadCount)) {
    throw new Error(`${label} payload was not attributed`);
  }
}

async function runM1(session, nodes) {
  const epoch = (BigInt(Date.now()) << 16n) | BigInt(Math.floor(Math.random() * 0xffff));
  const initialControl = await readMany(session, nodes, ['WorkstationHeartbeat']);
  const state = {
    heartbeat: u64ToBigInt(initialControl.WorkstationHeartbeat),
  };
  let sequence = 0n;
  const cases = [];

  state.heartbeat += 1n;
  await writeMany(session, nodes, [
    { name: 'SimRequest', dataType: DataType.Boolean, value: true },
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: true },
    { name: 'WorkstationHeartbeat', dataType: DataType.UInt64, value: state.heartbeat.toString() },
  ]);
  await sleep(60);
  await writeMany(session, nodes, [
    { name: 'SessionResetRequest', dataType: DataType.Boolean, value: false },
    { name: 'RequestedEpoch', dataType: DataType.UInt64, value: '0' },
    { name: 'RequestedSequence', dataType: DataType.UInt64, value: '0' },
  ]);
  await sleep(30);

  const accepted = [
    ['all-zero', makeImage(false, [0, 0, 0, 0], 0)],
    ['all-one', makeImage(true, [1.25, 2.5, 25, 75], 1)],
    ['upper-bounds', makeImage((i) => i % 2 === 0, [100, 10000, 100, 100], 0xfffffffe)],
    ['udint-max', makeImage((i) => i % 2 === 1, [0.1, 0.2, 33.333, 66.667], 0xffffffff)],
    ['declared-rollover', makeImage(false, [0, 0, 0, 0], 0)],
  ];

  for (const [name, image] of accepted) {
    sequence += 1n;
    const commit = await commitImage(session, nodes, epoch, sequence, image, state);
    cases.push({ name, accepted: true, ...commit });
  }

  for (let index = 0; index < 20; index += 1) {
    sequence += 1n;
    const image = makeImage(
      (bit) => ((index + bit) & 1) === 1,
      [index / 10, index / 5, index % 101, (100 - index) % 101],
      index
    );
    await commitImage(session, nodes, epoch, sequence, image, state);
  }
  cases.push({ name: 'rapid-alternation-20', accepted: true, commits: 20 });

  await expectRejectedImage(
    session, nodes, epoch, sequence + 1n,
    makeImage(false, [-1, 0, 0, 0], 123), state, 'negative-speed'
  );
  cases.push({ name: 'negative-speed-rejected', accepted: false, attributed: true });

  await expectRejectedImage(
    session, nodes, epoch, sequence + 2n,
    makeImage(false, [0, Number.NaN, 0, 0], 124), state, 'non-finite-current'
  );
  cases.push({ name: 'non-finite-current-rejected', accepted: false, attributed: true });

  await expectRejectedImage(
    session, nodes, epoch, sequence + 3n,
    makeImage(false, [0, 0, 101, 0], 125), state, 'position-out-of-range'
  );
  cases.push({ name: 'position-out-of-range-rejected', accepted: false, attributed: true });

  const timingBefore = await readMany(session, nodes, ['PlcTimeUs', 'PlcBootIdentity']);
  await sleep(60);
  const timingAfter = await readMany(session, nodes, ['PlcTimeUs', 'PlcBootIdentity']);
  if (u64ToBigInt(timingBefore.PlcBootIdentity) === 0n) throw new Error('PLC boot identity is zero');
  if (u64ToBigInt(timingAfter.PlcTimeUs) <= u64ToBigInt(timingBefore.PlcTimeUs)) {
    throw new Error('PLC monotonic time did not advance');
  }

  const outputs = await readMany(session, nodes, outputFields);
  for (const name of outputFields) {
    if (typeof outputs[name] !== 'boolean') throw new Error(`Output ${name} is not BOOL`);
  }

  return {
    pass: true,
    epoch: epoch.toString(),
    finalAppliedSequence: sequence.toString(),
    signalCounts: { bool: boolFields.length, real: realFields.length, udint: 1, outputs: outputFields.length },
    cases,
    bootIdentity: u64ToBigInt(timingAfter.PlcBootIdentity).toString(),
    plcTimeAdvanced: true,
    outputTypes: Object.fromEntries(outputFields.map((name) => [name, typeof outputs[name]])),
  };
}

async function main() {
  if (!userName) throw new Error('OPC_USER is required');
  const client = OPCUAClient.create({
    applicationName: 'NodeOPCUA-Client',
    endpointMustExist: false,
    securityMode: MessageSecurityMode.SignAndEncrypt,
    securityPolicy: SecurityPolicy.Basic256Sha256,
    automaticallyAcceptUnknownCertificate: true,
    connectionStrategy: { initialDelay: 250, maxRetry: 0 },
  });

  await client.connect(endpointUrl);
  try {
    const session = await client.createSession({
      type: UserTokenType.UserName,
      userName,
      password: password || '',
    });
    try {
      const nodes = await browseWanted(session);
      const result = await runM1(session, nodes);
      const payload = {
        schemaVersion: 1,
        measuredAt: new Date().toISOString(),
        endpointUrl,
        securityMode: 'SignAndEncrypt',
        securityPolicy: 'Basic256Sha256',
        publishedNodeCount: nodes.size,
        result,
      };
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } finally {
      await session.close();
    }
  } finally {
    await client.disconnect();
  }
}

module.exports = {
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
  float32Bits,
  browseWanted,
  readMany,
  writeMany,
  makeImage,
  imageWrites,
  compareActive,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`M1 probe failed: ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
