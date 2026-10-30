// One-shot: connect to the CODESYS OPC UA server, find variables in
// our project's address space, and dump them to nodeids.json.
//
// Run: `node dump_nodeids.js`

const {
  OPCUAClient,
  AttributeIds,
  NodeClass,
  MessageSecurityMode,
  SecurityPolicy,
  BrowseDirection,
  ReferenceTypeIds,
  resolveNodeId,
} = require('node-opcua');
const fs = require('fs');

const ENDPOINT = process.env.OPC_ENDPOINT || 'opc.tcp://localhost:4840';
const OUT_PATH = 'nodeids.json';

// Variables we want to find. We search by browseName ending in any of
// these exact strings (case-sensitive).
const WANTED = [
  'qRed', 'qYellow', 'qGreen', 'qState', 'qStateChanged', 'qPrevState',
  'xSwitch',
  'byDigInByte', 'byDigOutByte',
  'rAnaInReal', 'rAnaOutReal',
  'xDigInBool', 'xDigOutBool',
  '_cycleArmed',
];

const log = (...args) => console.log(...args);

async function browseChildren(session, nodeId) {
  const result = await session.browse({
    nodeId,
    referenceTypeId: 'HierarchicalReferences',
    includeSubtypes: true,
    browseDirection: BrowseDirection.Forward,
    nodeClassMask: 0,           // all classes
    resultMask: 0x3F,           // browseName + displayName + nodeClass + ref + ...
  });
  return result.references || [];
}

// Recursive walk, depth-limited, that records every Variable we find with
// browseName matching one of WANTED.
async function walk(session, nodeId, path, depth, found, visited) {
  if (depth <= 0) return;
  if (visited.has(nodeId.toString())) return;
  visited.add(nodeId.toString());

  let children;
  try {
    children = await browseChildren(session, nodeId);
  } catch (err) {
    return;
  }

  for (const ref of children) {
    const name = ref.browseName.toString();
    const display = ref.displayName.text;
    const nid = ref.nodeId.toString();
    const subPath = path ? `${path}.${name}` : name;

    // Variable nodes (NodeClass 2)
    if (ref.nodeClass === NodeClass.Variable) {
      // Match if the simple-name portion (after the last colon namespace)
      // matches anything in WANTED.
      const simple = name.replace(/^\d+:/, '');
      if (WANTED.includes(simple)) {
        if (!found.find((f) => f.nodeId === nid)) {
          found.push({
            name: simple,
            displayName: display,
            browseName: name,
            path: subPath,
            nodeId: nid,
          });
        }
      }
      // Don't recurse into variables; their children are usually datatype-related.
      continue;
    }

    // Recurse into objects / folders
    await walk(session, ref.nodeId.toString(), subPath, depth - 1, found, visited);
  }
}

async function main() {
  log(`connecting: ${ENDPOINT}`);
  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { initialDelay: 500, maxRetry: 0 },
  });
  await client.connect(ENDPOINT);
  const session = await client.createSession();
  log('connected, browsing...');

  const found = [];
  const visited = new Set();
  // Walk from RootFolder; depth 12 should be more than enough to reach
  // RootFolder -> Objects -> DeviceSet -> ... -> Application -> POU -> var.
  await walk(session, 'RootFolder', '', 12, found, visited);

  log(`found ${found.length} matching variables`);
  for (const v of found) log(`  ${v.path.padEnd(80)} -> ${v.nodeId}`);

  fs.writeFileSync(OUT_PATH, JSON.stringify(found, null, 2));
  log(`written: ${OUT_PATH}`);

  await session.close();
  await client.disconnect();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
