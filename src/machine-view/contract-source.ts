// Deterministic derivation of the frozen equipment graph and binding contract from the
// accepted specification, the preserved Wonder world package and the M8 signal map. No model
// call. Every identity comes from those sources; disagreement between them is an error.

import {
  VIEW_EQUIPMENT_VERSION, entityFields,
  type BindingContract, type Channel, type Equipment, type EquipmentFile, type EquipmentGeometry, type EquipmentKind, type SourceRef
} from "./contracts.ts";

export interface SourceDocument { path: string; text: string; sha256: string }

export interface ContractSources {
  specification: SourceDocument;
  worldManifest: SourceDocument;
  worldSource: SourceDocument;
  worldAssumptions: SourceDocument;
  signalMap: SourceDocument;
}

interface WorldSignal { id: string; direction: "plc_to_world" | "world_to_plc"; dataType: string; normalValue: boolean | number | string; deviceId: string; role: string; description: string }

const units: Record<string, string> = {
  "diagnostic.beltSpeedActual": "m/s",
  "diagnostic.driveCurrent": "A",
  "diagnostic.divert1Position": "%",
  "diagnostic.divert2Position": "%",
  "motion.encoderCount": "count"
};

export function parseWorldConfig(source: string): Record<string, number> {
  const block = /const\s+CONFIG\s*=\s*\{([\s\S]*?)\}\s*as\s+const/.exec(source);
  if (!block) throw new Error("World source has no CONFIG block");
  const values: Record<string, number> = {};
  for (const match of block[1]!.matchAll(/(\w+)\s*:\s*(-?\d+(?:\.\d+)?)/g)) values[match[1]!] = Number(match[2]);
  return values;
}

function specRowLocator(spec: string, signal: string): string {
  const row = new RegExp(`\\|\\s*(D[IO]-\\d+)\\s*\\|\\s*\`${signal}\``).exec(spec);
  if (row) return `docs/conveyor-machine-spec.md §4 ${row[1]} ${signal}`;
  if (new RegExp(`\`${signal}\``).test(spec)) return `docs/conveyor-machine-spec.md §4 candidate diagnostic ${signal}`;
  throw new Error(`Specification does not mention ${signal}`);
}

export function deriveContract(sources: ContractSources): { equipment: EquipmentFile; contract: Omit<BindingContract, "equipmentSha256"> } {
  const manifest = JSON.parse(sources.worldManifest.text) as { worldId: string; name: string; packageVersion: string; stateSchemaVersion: string; signals: WorldSignal[] };
  const signalMap = JSON.parse(sources.signalMap.text) as { mapVersion: string; countsPerMetre: number; signals: Array<{ logical: string; iecType: string }> };
  const config = parseWorldConfig(sources.worldSource.text);
  const spec = sources.specification.text;
  const assumptionsText = sources.worldAssumptions.text;

  const ref = (doc: SourceDocument, locator: string): SourceRef => ({ document: doc.path, sha256: doc.sha256, locator });
  const need = (key: string): number => {
    const value = config[key];
    if (value === undefined || !Number.isFinite(value)) throw new Error(`World CONFIG lacks ${key}`);
    return value;
  };

  // Geometry stations: world CONFIG is the executable truth; the preserved assumptions must state the same value.
  const stations: Record<string, { key: string; phrase: RegExp }> = {
    peEntryM: { key: "peEntryM", phrase: /entry PE at (\d+(?:\.\d+)?) m/ },
    peD1ApproachM: { key: "peD1ApproachM", phrase: /D1 approach PE at (\d+(?:\.\d+)?) m/ },
    divert1M: { key: "divert1M", phrase: /divert 1 decision point at (\d+(?:\.\d+)?) m/ },
    peExitAM: { key: "peExitAM", phrase: /exit A PE at (\d+(?:\.\d+)?) m/ },
    peD2ApproachM: { key: "peD2ApproachM", phrase: /D2 approach PE at (\d+(?:\.\d+)?) m/ },
    divert2M: { key: "divert2M", phrase: /divert 2 decision point at (\d+(?:\.\d+)?) m/ },
    peExitBM: { key: "peExitBM", phrase: /exit B PE at (\d+(?:\.\d+)?) m/ },
    peRunoutM: { key: "peRunoutM", phrase: /runout PE at (\d+(?:\.\d+)?) m/ }
  };
  for (const { key, phrase } of Object.values(stations)) {
    const stated = phrase.exec(assumptionsText);
    if (!stated) throw new Error(`World assumptions do not state ${key}`);
    if (Number(stated[1]) !== need(key)) throw new Error(`World assumptions state ${key}=${stated[1]} but CONFIG has ${need(key)}`);
  }
  const g = (key: string) => need(key);

  // Channels from the world manifest, checked against the M8 signal map identities and types.
  const mapTypes = new Map(signalMap.signals.map(s => [s.logical, s.iecType]));
  const channels: Channel[] = manifest.signals.map(s => {
    const logical = s.direction === "world_to_plc" ? `raw.slot0.${s.id}` : s.id;
    const mapped = mapTypes.get(logical);
    if (mapped === undefined) throw new Error(`Signal map ${signalMap.mapVersion} lacks ${logical}`);
    if (mapped !== s.dataType) throw new Error(`Signal ${s.id} is ${s.dataType} in the world manifest but ${mapped} in the signal map`);
    specRowLocator(spec, s.id);
    const source = s.direction === "world_to_plc" ? "world_raw" as const : "plc_output" as const;
    return {
      id: `${source === "world_raw" ? "world" : "plc"}.${s.id}`,
      source,
      signal: s.id,
      dataType: s.dataType,
      equipmentId: s.deviceId,
      truthClass: source === "world_raw" ? "simulated_physical_truth" as const : "observed_plc_output" as const,
      unit: units[s.role] ?? (s.dataType === "BOOL" ? "boolean" : "value"),
      normalValue: s.normalValue,
      description: s.description
    };
  });
  const channelsOf = (deviceId: string) => channels.filter(c => c.equipmentId === deviceId).map(c => c.id);

  const configRef = (keys: string[]) => ref(sources.worldSource, `world.ts CONFIG ${keys.join(", ")}`);
  const assumptionRef = ref(sources.worldAssumptions, "assumptions.md Inferred configuration: geometry");
  const geometryNote = "Station is the generated world's inferred demo layout, not a measured dimension or PLC threshold.";

  const signalRefs = (deviceId: string): SourceRef[] => manifest.signals.filter(s => s.deviceId === deviceId)
    .map(s => ref(sources.specification, specRowLocator(spec, s.id)));
  const make = (id: string, kind: EquipmentKind, label: string, description: string, geometry: EquipmentGeometry | null, extraRefs: SourceRef[], assumptions: string[]): Equipment => ({
    id, kind, label, description, channels: channelsOf(id), geometry,
    sources: [...signalRefs(id), ...extraRefs, ref(sources.worldManifest, `signals[].deviceId == "${id}"`)].filter((r, i, all) => all.findIndex(o => o.locator === r.locator && o.document === r.document) === i),
    assumptions
  });
  const layoutRef = ref(sources.specification, "§2 Physical and logical layout");

  const equipment: Equipment[] = [
    { id: "mainLane", kind: "conveyor_lane", label: "Main lane belt", description: "Infeed/main lane with one powered belt from entry to straight runout.", channels: [],
      geometry: { path: "main", fromM: 0, toM: g("runoutEndM") }, sources: [layoutRef, configRef(["runoutEndM"]), assumptionRef], assumptions: ["Lane length to carton removal is world configuration."] },
    make("drive", "drive", "Belt drive", "Drive command, actual running feedback, overload and diagnostic speed/current.", null, [ref(sources.worldSource, "world.ts CONFIG driveStartDelayMs, driveStopDelayMs, beltAccelMps2")], ["Drive location is unspecified; its drawing position implies no measured location."]),
    make("encoder", "encoder", "Belt encoder", "Raw encoder counts from actual belt travel.", null, [configRef(["encoderCountsPerM", "encoderModulus"])], ["1000 counts/m, floored, wrapping modulo 2^32 (world configuration)."]),
    make("peEntry", "photoeye", "Entry photoeye", "Carton blocks the entry beam.", { path: "main", stationM: g("peEntryM") }, [configRef(["peEntryM"]), assumptionRef], [geometryNote]),
    make("peD1Approach", "photoeye", "Divert 1 approach photoeye", "Carton in the decision window before divert 1.", { path: "main", stationM: g("peD1ApproachM") }, [configRef(["peD1ApproachM"]), assumptionRef], [geometryNote]),
    make("divert1", "divert", "Divert 1 (to exit A)", "Two-position divert; extended sends a carton to exit A. Actual position at the decision point decides the path.", { path: "main", stationM: g("divert1M") }, [configRef(["divert1M", "divertTravelMs"]), assumptionRef], [geometryNote]),
    make("exitA", "destination", "Exit A", "Diverted exit A chute and downstream readiness.", { path: "exitA", fromM: g("divert1M"), toM: g("exitAEndM"), stationM: g("exitAEndM") }, [configRef(["exitAEndM"]), layoutRef], ["Chute length to carton removal is world configuration."]),
    make("peExitA", "photoeye", "Exit A photoeye", "Carton passes diverted exit A.", { path: "exitA", stationM: g("peExitAM") }, [configRef(["peExitAM"]), assumptionRef], [geometryNote]),
    make("peD2Approach", "photoeye", "Divert 2 approach photoeye", "Carton continues on the main lane toward divert 2.", { path: "main", stationM: g("peD2ApproachM") }, [configRef(["peD2ApproachM"]), assumptionRef], [geometryNote]),
    make("divert2", "divert", "Divert 2 (to exit B)", "Two-position divert; extended sends a carton to exit B.", { path: "main", stationM: g("divert2M") }, [configRef(["divert2M", "divertTravelMs"]), assumptionRef], [geometryNote]),
    make("exitB", "destination", "Exit B", "Diverted exit B chute and downstream readiness.", { path: "exitB", fromM: g("divert2M"), toM: g("exitBEndM"), stationM: g("exitBEndM") }, [configRef(["exitBEndM"]), layoutRef], ["Chute length to carton removal is world configuration."]),
    make("peExitB", "photoeye", "Exit B photoeye", "Carton passes diverted exit B.", { path: "exitB", stationM: g("peExitBM") }, [configRef(["peExitBM"]), assumptionRef], [geometryNote]),
    make("runout", "destination", "Straight runout", "Straight runout (jackpot) and its readiness.", { path: "main", fromM: g("divert2M"), toM: g("runoutEndM"), stationM: g("runoutEndM") }, [configRef(["runoutEndM"]), layoutRef], ["Runout end is the world's carton-removal point."]),
    make("peRunout", "photoeye", "Runout photoeye", "Carton passes the straight runout.", { path: "main", stationM: g("peRunoutM") }, [configRef(["peRunoutM"]), assumptionRef], [geometryNote]),
    make("stackLight", "indicator", "Stack light", "Optional PLC indications, observed only.", null, [], ["Stack light location is unspecified."])
  ];

  const declared = new Set(equipment.map(e => e.id));
  for (const s of manifest.signals) if (!declared.has(s.deviceId)) throw new Error(`World signal ${s.id} names undeclared device ${s.deviceId}`);
  for (const c of channels) if (!equipment.some(e => e.channels.includes(c.id))) throw new Error(`Channel ${c.id} has no equipment`);

  const equipmentFile: EquipmentFile = {
    schemaVersion: VIEW_EQUIPMENT_VERSION,
    machineId: manifest.worldId,
    name: manifest.name,
    specification: ref(sources.specification, "accepted conveyor bench specification v0.5"),
    world: {
      worldId: manifest.worldId,
      packageVersion: manifest.packageVersion,
      stateSchemaVersion: manifest.stateSchemaVersion,
      manifest: ref(sources.worldManifest, "world.manifest.json"),
      source: ref(sources.worldSource, "world.ts"),
      assumptions: ref(sources.worldAssumptions, "assumptions.md")
    },
    signalMap: { ...ref(sources.signalMap, "codesys/demo/signal-map-v1.json"), mapVersion: signalMap.mapVersion },
    units: { length: "m", speed: "m/s", position: "%", count: "count", current: "A" },
    equipment,
    entityTypes: [{
      type: "carton",
      fields: [...entityFields],
      paths: [
        { id: "main", fromM: 0, toM: g("runoutEndM"), branchFrom: null },
        { id: "exitA", fromM: g("divert1M"), toM: g("exitAEndM"), branchFrom: { path: "main", atM: g("divert1M") } },
        { id: "exitB", fromM: g("divert2M"), toM: g("exitBEndM"), branchFrom: { path: "main", atM: g("divert2M") } }
      ],
      pathAliases: { runout: "main" },
      nominalLengthM: g("cartonLengthM")
    }],
    encoder: { channel: "world.Encoder_Count", countsPerM: g("encoderCountsPerM"), modulus: g("encoderModulus") },
    assumptions: [
      "Equipment identities are the preserved generated world's device IDs; signal identities and types agree with the world manifest and M8 signal map.",
      "Geometry stations come from the world's inferred demo configuration (world.ts CONFIG, restated in assumptions.md); they are not measured dimensions or PLC thresholds.",
      "Carton positionM is distance along the carton's current path; exit A/B chutes continue from their divert station.",
      "The world assigns path 'runout' only when a carton is removed; it is drawn on the main lane.",
      "Drive, encoder and stack light have no specified location."
    ]
  };
  if (signalMap.countsPerMetre !== equipmentFile.encoder!.countsPerM) throw new Error("Signal map and world disagree on encoder counts per metre");

  const contract: Omit<BindingContract, "equipmentSha256"> = {
    schemaVersion: "controlsbench.machine-view.binding-contract.v1",
    channels,
    anchoredEquipment: equipment.filter(e => e.geometry?.stationM !== undefined).map(e => e.id),
    rotateChannels: ["world.D1_Position", "world.D2_Position"],
    beltChannels: ["world.Encoder_Count"],
    entityTypes: ["carton"]
  };
  return { equipment: equipmentFile, contract };
}
