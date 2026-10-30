// stoplight-opcua-relay
//
// Connects to the CODESYS OPC UA server, then exposes a WebSocket
// endpoint that browsers can use to subscribe to and write variables.
//
// Browsers send JSON commands:
//   { "action": "subscribe", "id": "qRed",  "nodeId": "ns=4;s=|var|...|StopLight.qRed" }
//   { "action": "unsubscribe", "id": "qRed" }
//   { "action": "write", "id": "switch", "nodeId": "ns=4;s=|var|...|PLC_PRG.byDigInByte", "value": 1, "dataType": "Byte" }
//
// And receive:
//   { "type": "value",  "id": "qRed", "value": true,  "ts": 1717... }
//   { "type": "error",  "msg": "..." }
//   { "type": "ready" }
//
// Run with `node relay.js` (after `npm install`).

const {
  OPCUAClient,
  AttributeIds,
  TimestampsToReturn,
  DataType,
  MessageSecurityMode,
  SecurityPolicy,
} = require('node-opcua');
const WebSocket = require('ws');

// ----- Config -----
const OPC_ENDPOINT = process.env.OPC_ENDPOINT || 'opc.tcp://localhost:4840';
const WS_PORT = Number(process.env.WS_PORT || 9876);
const SAMPLE_INTERVAL_MS = 100;
const PUBLISH_INTERVAL_MS = 100;

// Map browser-friendly DataType strings to node-opcua DataType enums.
const DATA_TYPES = {
  Boolean: DataType.Boolean,
  Byte: DataType.Byte,
  Int16: DataType.Int16,
  Int32: DataType.Int32,
  UInt16: DataType.UInt16,
  UInt32: DataType.UInt32,
  Float: DataType.Float,
  Double: DataType.Double,
  String: DataType.String,
};

// ----- Logging helper -----
const log = (...args) => console.log(new Date().toISOString(), ...args);

// ----- OPC UA setup -----
async function openOpc() {
  const client = OPCUAClient.create({
    endpointMustExist: false,
    securityMode: MessageSecurityMode.None,
    securityPolicy: SecurityPolicy.None,
    connectionStrategy: { initialDelay: 1000, maxRetry: 0 },
  });

  client.on('backoff', (retry, delay) =>
    log(`OPC reconnect backoff: retry=${retry} delay=${delay}ms`));

  await client.connect(OPC_ENDPOINT);
  log(`OPC connected: ${OPC_ENDPOINT}`);
  const session = await client.createSession();
  log(`OPC session created`);

  const subscription = await session.createSubscription2({
    requestedPublishingInterval: PUBLISH_INTERVAL_MS,
    requestedLifetimeCount: 100,
    requestedMaxKeepAliveCount: 10,
    maxNotificationsPerPublish: 100,
    publishingEnabled: true,
    priority: 10,
  });
  log(`OPC subscription created`);

  return { client, session, subscription };
}

// ----- WebSocket server -----
async function main() {
  const { client, session, subscription } = await openOpc();

  const wss = new WebSocket.Server({ port: WS_PORT, host: '0.0.0.0' });
  log(`WS server listening on ws://0.0.0.0:${WS_PORT}`);

  wss.on('connection', (ws, req) => {
    const peer = req.socket.remoteAddress + ':' + req.socket.remotePort;
    log(`WS client connected: ${peer}`);

    // Per-connection subscriptions. id (browser-chosen) -> MonitoredItem.
    const subs = new Map();

    const send = (obj) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(obj));
    };

    send({ type: 'ready', endpoint: OPC_ENDPOINT });

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        send({ type: 'error', msg: 'invalid JSON' });
        return;
      }

      try {
        if (msg.action === 'subscribe') {
          if (!msg.id || !msg.nodeId) {
            send({ type: 'error', msg: 'subscribe requires id + nodeId' });
            return;
          }
          // If already subscribed, ignore (idempotent).
          if (subs.has(msg.id)) return;

          const monitoredItem = await subscription.monitor(
            { nodeId: msg.nodeId, attributeId: AttributeIds.Value },
            {
              samplingInterval: SAMPLE_INTERVAL_MS,
              discardOldest: true,
              queueSize: 10,
            },
            TimestampsToReturn.Both
          );

          monitoredItem.on('changed', (dataValue) => {
            send({
              type: 'value',
              id: msg.id,
              value: dataValue.value.value,
              ts: Date.now(),
            });
          });

          subs.set(msg.id, monitoredItem);
          log(`  ${peer} subscribed id=${msg.id} -> ${msg.nodeId}`);
        }

        else if (msg.action === 'unsubscribe') {
          const item = subs.get(msg.id);
          if (item) {
            await item.terminate();
            subs.delete(msg.id);
            log(`  ${peer} unsubscribed id=${msg.id}`);
          }
        }

        else if (msg.action === 'write') {
          if (!msg.nodeId || msg.value === undefined) {
            send({ type: 'error', msg: 'write requires nodeId + value' });
            return;
          }
          const dt = DATA_TYPES[msg.dataType || 'Boolean'];
          if (dt === undefined) {
            send({ type: 'error', msg: `unknown dataType ${msg.dataType}` });
            return;
          }

          const result = await session.write({
            nodeId: msg.nodeId,
            attributeId: AttributeIds.Value,
            value: { value: { dataType: dt, value: msg.value } },
          });
          log(`  ${peer} write ${msg.nodeId} = ${msg.value} (${msg.dataType}) -> ${result.toString()}`);
          send({ type: 'write_ack', id: msg.id, status: result.toString() });
        }

        else if (msg.action === 'browse') {
          // Returns immediate children of the given nodeId. Useful for
          // letting the browser walk the address space if we ever want
          // a generic explorer.
          const r = await session.browse(msg.nodeId || 'RootFolder');
          send({
            type: 'browse',
            nodeId: msg.nodeId || 'RootFolder',
            children: r.references.map((ref) => ({
              browseName: ref.browseName.toString(),
              displayName: ref.displayName.text,
              nodeId: ref.nodeId.toString(),
              isVariable: ref.nodeClass === 2,
            })),
          });
        }

        else {
          send({ type: 'error', msg: `unknown action ${msg.action}` });
        }
      } catch (err) {
        log(`  ${peer} error on ${msg.action}: ${err.message}`);
        send({ type: 'error', msg: err.message, action: msg.action });
      }
    });

    ws.on('close', async () => {
      log(`WS client disconnected: ${peer}`);
      for (const [, item] of subs) {
        try { await item.terminate(); } catch {}
      }
      subs.clear();
    });
  });

  // ---- Graceful shutdown ----
  const shutdown = async () => {
    log('shutting down…');
    try { wss.close(); } catch {}
    try { await subscription.terminate(); } catch {}
    try { await session.close(); } catch {}
    try { await client.disconnect(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
