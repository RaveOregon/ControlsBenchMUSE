#!/usr/bin/env node

// Bounded M0 OPC UA probe for the disposable CODESYS Control Win fixture.
// Credentials are optional environment variables and are never printed.

const path = require('path');
const fs = require('fs');

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
  TimestampsToReturn,
  UserTokenType,
} = require(relayNodeOpcua);

const endpointUrl = process.env.OPC_ENDPOINT || 'opc.tcp://127.0.0.1:4840';
const runSession = process.argv.includes('--session');
const runSecureConnect = process.argv.includes('--secure-connect') || runSession;
const wantedNames = new Set(['WriteProbe', 'EchoProbe', 'PlcCycle']);

function enumName(enumObject, value) {
  return enumObject[value] || String(value);
}

async function browseWanted(session) {
  const found = new Map();
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
      const simpleName = browseName.replace(/^\d+:/, '');
      const nextPath = [...pathParts, browseName];

      if (ref.nodeClass === NodeClass.Variable && wantedNames.has(simpleName)) {
        found.set(simpleName, {
          name: simpleName,
          browsePath: nextPath.join('.'),
          nodeId: ref.nodeId.toString(),
        });
      }

      if (ref.nodeClass !== NodeClass.Variable) {
        await walk(ref.nodeId, nextPath, depth - 1);
      }
    }
  }

  await walk('RootFolder', [], 14);
  return found;
}

async function readNode(session, node) {
  const [value, accessLevel, userAccessLevel] = await Promise.all([
    session.read({ nodeId: node.nodeId, attributeId: AttributeIds.Value }),
    session.read({ nodeId: node.nodeId, attributeId: AttributeIds.AccessLevel }),
    session.read({ nodeId: node.nodeId, attributeId: AttributeIds.UserAccessLevel }),
  ]);
  return {
    ...node,
    value: value.value.value,
    valueStatus: value.statusCode.toString(),
    accessLevel: accessLevel.value.value,
    userAccessLevel: userAccessLevel.value.value,
  };
}

async function writeUInt32(session, nodeId, value) {
  const status = await session.write({
    nodeId,
    attributeId: AttributeIds.Value,
    value: { value: { dataType: DataType.UInt32, value } },
  });
  return status.toString();
}

async function runSessionProbe(client) {
  const userName = process.env.OPC_USER;
  const password = process.env.OPC_PASSWORD;
  const identity = userName
    ? { type: UserTokenType.UserName, userName, password: password || '' }
    : undefined;
  const session = await client.createSession(identity);

  try {
    const nodes = await browseWanted(session);
    if (nodes.size !== wantedNames.size) {
      throw new Error(`Expected ${wantedNames.size} M0 nodes, found ${nodes.size}`);
    }

    const before = await Promise.all([...nodes.values()].map((node) => readNode(session, node)));
    const testValue = 0x5a5a;
    const writeProbeStatus = await writeUInt32(session, nodes.get('WriteProbe').nodeId, testValue);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const after = await Promise.all([...nodes.values()].map((node) => readNode(session, node)));
    const echoProbeWriteStatus = await writeUInt32(session, nodes.get('EchoProbe').nodeId, testValue + 1);
    const plcCycleWriteStatus = await writeUInt32(session, nodes.get('PlcCycle').nodeId, testValue + 2);

    const requestedPublishingInterval = 20;
    const requestedSamplingInterval = 20;
    const subscription = await session.createSubscription2({
      requestedPublishingInterval,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    });
    let negotiatedSubscription;
    try {
      const monitoredItem = await subscription.monitor(
        { nodeId: nodes.get('PlcCycle').nodeId, attributeId: AttributeIds.Value },
        { samplingInterval: requestedSamplingInterval, discardOldest: true, queueSize: 10 },
        TimestampsToReturn.Both
      );
      negotiatedSubscription = {
        requestedPublishingInterval,
        revisedPublishingInterval: subscription.publishingInterval,
        requestedSamplingInterval,
        revisedSamplingInterval: monitoredItem.monitoringParameters.samplingInterval,
        revisedLifetimeCount: subscription.lifetimeCount,
        revisedMaxKeepAliveCount: subscription.maxKeepAliveCount,
      };
      await monitoredItem.terminate();
    } finally {
      await subscription.terminate();
    }

    return {
      identity: userName ? 'username' : 'anonymous',
      before,
      writeResults: {
        WriteProbe: writeProbeStatus,
        EchoProbe: echoProbeWriteStatus,
        PlcCycle: plcCycleWriteStatus,
      },
      after,
      echoMatched: after.find((item) => item.name === 'EchoProbe')?.value === testValue,
      plcCycleAdvanced:
        after.find((item) => item.name === 'PlcCycle')?.value !==
        before.find((item) => item.name === 'PlcCycle')?.value,
      negotiatedSubscription,
    };
  } finally {
    await session.close();
  }
}

async function main() {
  const discoveryClient = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { initialDelay: 250, maxRetry: 0 },
  });

  await discoveryClient.connect(endpointUrl);
  let inventory;
  try {
    const endpoints = await discoveryClient.getEndpoints();
    inventory = endpoints.map((endpoint) => ({
      endpointUrl: endpoint.endpointUrl,
      securityMode: enumName(MessageSecurityMode, endpoint.securityMode),
      securityPolicyUri: endpoint.securityPolicyUri,
      securityLevel: endpoint.securityLevel,
      serverApplicationUri: endpoint.server?.applicationUri || null,
      serverProductUri: endpoint.server?.productUri || null,
      userIdentityTokens: (endpoint.userIdentityTokens || []).map((token) => ({
        policyId: token.policyId,
        tokenType: enumName(UserTokenType, token.tokenType),
        securityPolicyUri: token.securityPolicyUri || null,
      })),
    }));
  } finally {
    await discoveryClient.disconnect();
  }

  let secureConnect = null;
  let sessionProbe = null;
  if (runSecureConnect) {
    const secureClient = OPCUAClient.create({
      // Match node-opcua's default generated client certificate application URI.
      applicationName: 'NodeOPCUA-Client',
      endpointMustExist: false,
      securityMode: MessageSecurityMode.SignAndEncrypt,
      securityPolicy: SecurityPolicy.Basic256Sha256,
      automaticallyAcceptUnknownCertificate: true,
      connectionStrategy: { initialDelay: 250, maxRetry: 0 },
    });

    await secureClient.connect(endpointUrl);
    try {
      secureConnect = {
        securityMode: 'SignAndEncrypt',
        securityPolicy: 'Basic256Sha256',
        connected: true,
      };
      if (runSession) sessionProbe = await runSessionProbe(secureClient);
    } finally {
      await secureClient.disconnect();
    }
  }

  const payload = { endpointUrl, endpoints: inventory, secureConnect, sessionProbe };
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  if (process.env.M0_OUTPUT) {
    const outputPath = path.resolve(process.env.M0_OUTPUT);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, serialized, 'utf8');
  }
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(`M0 OPC UA endpoint probe failed: ${error.message}`);
  process.exitCode = 1;
});
