import { createRequire } from "node:module";
import { m8Map, requiredSignals, byPath, writeSignals } from "./m8-map.ts";
import type { M8Sample, M8Transport, TransportEvent } from "./m8-opcua.ts";
import type { RawValue } from "../proof/contracts.ts";

// Loading the native OPC package is explicit; ordinary tests use injected transports.
export function createM8NativeTransport(options: { userName: string; password: string; event: TransportEvent; endpoint?: string; modulePath?: string }): M8Transport {
  const require = createRequire(import.meta.url);
  const opc = require(options.modulePath ?? "../../codesys/codesys_handoff/browser_hmi_handoff/opcua_relay/node_modules/node-opcua");
  let client: any, session: any;
  const nodes = new Map<string, string>();
  const allow = new Set(writeSignals.map(s => s.iecPath));
  const typeIds: Record<string, number> = { BOOL: 1, USINT: 3, UINT: 5, UDINT: 7, ULINT: 9, REAL: 10, LREAL: 11 };
  const uaTypes: Record<string, number> = { BOOL: opc.DataType.Boolean, USINT: opc.DataType.Byte, UINT: opc.DataType.UInt16, UDINT: opc.DataType.UInt32, ULINT: opc.DataType.UInt64, REAL: opc.DataType.Float, LREAL: opc.DataType.Double };
  const scalar = (value: any, type: string): RawValue => type === "ULINT" ? Array.isArray(value) ? String((BigInt(value[0]) << 32n) | BigInt(value[1])) : String(value) : value;
  return {
    async open() {
      options.event("connection.attempt", { endpoint: options.endpoint ?? m8Map.endpoint,
        securityMode: "SignAndEncrypt", securityPolicy: "Basic256Sha256", usernameConfigured: !!options.userName });
      client = opc.OPCUAClient.create({ applicationName: "NodeOPCUA-Client", endpointMustExist: false,
        securityMode: opc.MessageSecurityMode.SignAndEncrypt, securityPolicy: opc.SecurityPolicy.Basic256Sha256,
        automaticallyAcceptUnknownCertificate: true, connectionStrategy: { maxRetry: 0 }, requestedSessionTimeout: 60_000 });
      try {
        await client.connect(options.endpoint ?? m8Map.endpoint);
        session = await client.createSession({ type: opc.UserTokenType.UserName, userName: options.userName, password: options.password });
        options.event("connection.established", { authenticated: true });
      } catch (error) {
        options.event("connection.failed", { message: error instanceof Error ? error.message : String(error) });
        throw error;
      } finally { options.password = ""; }
      const candidates = new Map<string, Set<string>>(); const visited = new Set<string>();
      async function walk(nodeId: string, parts: string[], depth: number): Promise<void> {
        if (depth === 0 || visited.has(nodeId)) return; visited.add(nodeId);
        let result = await session.browse({ nodeId, referenceTypeId: "HierarchicalReferences", includeSubtypes: true,
          browseDirection: opc.BrowseDirection.Forward, nodeClassMask: 0, resultMask: 0x3f });
        const refs = [...result.references ?? []];
        while (result.continuationPoint?.length) { result = await session.browseNext(result.continuationPoint, false); refs.push(...result.references ?? []); }
        for (const ref of refs) {
          const path = [...parts, ref.browseName.toString().replace(/^\d+:/, "")];
          if (ref.nodeClass === opc.NodeClass.Variable) for (const s of requiredSignals) if (path.join(".").endsWith(`.${s.iecPath}`)) {
            const matches = candidates.get(s.iecPath) ?? new Set<string>(); matches.add(ref.nodeId.toString()); candidates.set(s.iecPath, matches);
          }
          await walk(ref.nodeId.toString(), path, depth - 1);
        }
      }
      await walk("RootFolder", [], 14);
      const resolved = [], warnings = [];
      for (const s of requiredSignals) {
        const matches = candidates.get(s.iecPath);
        if (matches?.size !== 1) throw new Error(`Missing/ambiguous exact IEC path ${s.iecPath}`);
        const nodeId = [...matches][0];
        const attrs = await session.read([opc.AttributeIds.DataType, opc.AttributeIds.UserAccessLevel, opc.AttributeIds.AccessLevel].map(attributeId => ({ nodeId, attributeId })), 0);
        if (attrs.some((a: any) => !a.statusCode.isGood())) throw new Error(`Bad attribute quality ${s.iecPath}`);
        const type = s.iecType.startsWith("STRING") ? 12 : typeIds[s.iecType];
        if (attrs[0].value.value.value !== type) throw new Error(`Wrong UA type ${s.iecPath}`);
        const access = Number(attrs[1].value.value) & Number(attrs[2].value.value) & 3;
        if (!(access & 1) || s.access === "readWrite" && access !== 3) throw new Error(`Insufficient access ${s.iecPath}`);
        if (s.access === "read" && access & 2) warnings.push(s.iecPath);
        nodes.set(s.iecPath, nodeId); resolved.push({ ...s, nodeId, observedAccess: access, uaTypeId: type });
      }
      options.event("symbols.resolved", { resolved, readGroupWritableWarnings: warnings,
        writePolicy: "Only exact map readWrite paths in GVL_BenchWrite/GVL_DemoWrite; inherited M8 user-authorized read-group exposure exception" });
    },
    async read(paths) {
      if (paths.some(p => !nodes.has(p))) throw new Error("Read of unresolved M8 symbol");
      const values = await session.read(paths.map(p => ({ nodeId: nodes.get(p), attributeId: opc.AttributeIds.Value })), 0);
      const receivedAtIso = new Date().toISOString();
      const samples: Record<string, M8Sample> = Object.fromEntries(paths.map((p, i) => [p, {
        value: scalar(values[i].value.value, byPath.get(p)!.iecType), status: values[i].statusCode.toString(),
        sourceTimestamp: values[i].sourceTimestamp?.toISOString() ?? "", serverTimestamp: values[i].serverTimestamp?.toISOString() ?? "", receivedAtIso
      }]));
      options.event("opc.read", { samples }); return samples;
    },
    async write(items) {
      if (items.some(i => !allow.has(i.path))) throw new Error("Write outside strict M8 allowlist");
      const codes = await session.write(items.map(i => ({ nodeId: nodes.get(i.path), attributeId: opc.AttributeIds.Value,
        value: { value: { dataType: uaTypes[byPath.get(i.path)!.iecType], value: i.value } } })));
      options.event("opc.write", { items: items.map((i, n) => ({ ...i, status: codes[n].toString() })) });
      if (codes.some((c: any) => !c.isGood())) throw new Error("M8 write rejected; stop without retry");
    },
    async close() { try { if (session) await session.close(); } finally { if (client) await client.disconnect(); } }
  };
}
