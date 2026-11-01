// Package loading and validation. Two tiers:
//   contractValid - frozen equipment/channel contract is intact, so the deterministic fallback
//                   can be shown against snapshots;
//   viewValid     - the generated SVG and bindings may be mounted in the isolated host.

import {
  VIEW_BINDINGS_VERSION, VIEW_EQUIPMENT_VERSION, VIEW_PACKAGE_VERSION, VIEW_SNAPSHOT_VERSION, VIEW_VALIDATION_VERSION, bindingKinds,
  type Binding, type BindingContract, type EquipmentFile, type ValidationCheck, type ValidationReport, type ViewBindingsFile, type ViewManifest
} from "./contracts.ts";
import { applyFrame, buildSnapshot, resolveFrame, type LoadedPackage } from "./frame.ts";
import { pointAt, pxPerMetre } from "./geometry.ts";
import { credentialPattern, inspectSvg, parseSvg, walk, type SvgElement } from "./svg.ts";

export const PACKAGE_FILES = ["view.manifest.json", "equipment.json", "view-bindings.json", "view.svg"] as const;

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Canonical JSON text used for every hashed JSON artifact. */
export const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const idOk = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z_][\w.-]{0,79}$/.test(v);

/**
 * Normalises a model-authored flat binding (nullable fields for every kind) into the typed
 * union, returning problems rather than guessing missing parameters.
 */
export function normalizeBinding(raw: unknown, index: number): { binding: Binding | null; problems: string[] } {
  const where = `bindings[${index}]`;
  if (!isRecord(raw)) return { binding: null, problems: [`${where} must be an object`] };
  const problems: string[] = [];
  const kind = raw.kind;
  if (!bindingKinds.includes(kind as Binding["kind"])) return { binding: null, problems: [`${where}.kind ${String(kind)} is not supported`] };
  if (!idOk(raw.id)) problems.push(`${where}.id is invalid`);
  if (!idOk(raw.element)) problems.push(`${where}.element is invalid`);
  const need = (key: string, test: (v: unknown) => boolean, label: string) => { if (!test(raw[key])) problems.push(`${where} (${String(kind)}) needs ${key} as ${label}`); };
  const id = String(raw.id), element = String(raw.element);
  let binding: Binding | null = null;
  switch (kind) {
    case "anchor":
      need("equipmentId", idOk, "an equipment id");
      binding = { id, kind, element, equipmentId: String(raw.equipmentId), rotateWithPath: raw.rotateWithPath === true };
      break;
    case "state":
      need("channel", v => typeof v === "string", "a channel id");
      binding = { id, kind, element, channel: String(raw.channel) };
      break;
    case "text":
      need("channel", v => typeof v === "string", "a channel id");
      if (raw.decimals !== null && raw.decimals !== undefined) need("decimals", v => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 6, "an integer 0-6");
      binding = { id, kind, element, channel: String(raw.channel), decimals: Number.isInteger(raw.decimals) ? raw.decimals as number : null };
      break;
    case "rotate":
      need("channel", v => typeof v === "string", "a channel id");
      for (const key of ["inputMin", "inputMax", "angleMin", "angleMax", "pivotX", "pivotY"]) need(key, finite, "a finite number");
      if (finite(raw.inputMin) && finite(raw.inputMax) && raw.inputMin === raw.inputMax) problems.push(`${where} inputMin and inputMax must differ`);
      binding = { id, kind, element, channel: String(raw.channel), inputMin: Number(raw.inputMin), inputMax: Number(raw.inputMax), angleMin: Number(raw.angleMin), angleMax: Number(raw.angleMax), pivotX: Number(raw.pivotX), pivotY: Number(raw.pivotY) };
      break;
    case "belt":
      need("channel", v => typeof v === "string", "a channel id");
      need("periodPx", v => finite(v) && (v as number) > 0 && (v as number) <= 400, "a positive number <= 400");
      binding = { id, kind, element, channel: String(raw.channel), periodPx: Number(raw.periodPx) };
      break;
    case "entities":
      need("container", idOk, "an element id");
      need("entityType", v => typeof v === "string", "an entity type");
      binding = { id, kind, element, container: String(raw.container), entityType: String(raw.entityType) };
      break;
  }
  return { binding: problems.length ? null : binding, problems };
}

export interface PackageInput {
  files: Partial<Record<(typeof PACKAGE_FILES)[number], string>>;
  /** Expected binding contract (from the frozen contract artifact). */
  contract: BindingContract;
  /** Optional actual world manifest text for compatibility checking. */
  worldManifestText?: string;
}

export async function validatePackage(input: PackageInput): Promise<{ report: ValidationReport; pkg: LoadedPackage | null }> {
  const checks: ValidationCheck[] = [];
  const check = (id: string, passed: boolean, detail: string, severity: "error" | "warning" = "error") => { checks.push({ id, passed, severity, detail }); return passed; };
  const hashes: Record<string, string> = {};
  for (const [name, text] of Object.entries(input.files)) if (typeof text === "string") hashes[name] = await sha256Hex(text);

  const parse = <T>(name: string): T | null => {
    const text = input.files[name as keyof typeof input.files];
    if (typeof text !== "string") { check(`file.${name}`, false, `${name} is missing`); return null; }
    try { const value = JSON.parse(text) as T; check(`file.${name}`, true, `${name} parsed`); return value; }
    catch (error) { check(`file.${name}`, false, `${name} is not JSON: ${(error as Error).message}`); return null; }
  };
  const manifest = parse<ViewManifest>("view.manifest.json");
  const equipment = parse<EquipmentFile>("equipment.json");
  const bindings = parse<ViewBindingsFile>("view-bindings.json");

  // ------------------------------------------------------------------ contract tier
  let contractOk = Boolean(manifest && equipment && bindings);
  if (manifest) {
    contractOk = check("manifest.schema", manifest.schemaVersion === VIEW_PACKAGE_VERSION && typeof manifest.packageId === "string" && manifest.packageId.length > 0,
      `schema ${String(manifest.schemaVersion)}, packageId ${String(manifest.packageId)}`) && contractOk;
    contractOk = check("manifest.authority", manifest.authority?.plcCommands === false && manifest.authority?.credentials === false && manifest.authority?.network === false && manifest.authority?.scripts === "host_runtime_only",
      "Package declares no PLC command, credential or network authority; scripts come from the host runtime only") && contractOk;
    contractOk = check("manifest.snapshot_protocol", manifest.compatibility?.snapshotSchema === VIEW_SNAPSHOT_VERSION, `snapshot schema ${String(manifest.compatibility?.snapshotSchema)}`) && contractOk;
    for (const [name, expected] of Object.entries(manifest.files ?? {})) {
      if (name === "view.svg") continue; // view tier: a damaged view must not disable the contract fallback
      contractOk = check(`integrity.${name}`, hashes[name] === expected, hashes[name] === expected ? `${name} sha256 matches` : `${name} sha256 ${hashes[name] ?? "missing"} != manifest ${expected}`) && contractOk;
    }
    for (const name of ["equipment.json", "view-bindings.json"]) if (!manifest.files || !(name in manifest.files)) contractOk = check(`integrity.${name}`, false, `${name} hash not recorded in manifest`) && contractOk;
  }
  if (equipment) {
    const ids = equipment.equipment?.map(e => e.id) ?? [];
    contractOk = check("equipment.schema", equipment.schemaVersion === VIEW_EQUIPMENT_VERSION && ids.length > 0 && new Set(ids).size === ids.length && Array.isArray(equipment.entityTypes),
      `${ids.length} unique equipment identities`) && contractOk;
  }
  if (bindings) {
    contractOk = check("bindings.schema", bindings.schemaVersion === VIEW_BINDINGS_VERSION && Array.isArray(bindings.channels) && Array.isArray(bindings.bindings) && Array.isArray(bindings.entityPaths),
      `schema ${String(bindings.schemaVersion)}`) && contractOk;
    const contractHash = await sha256Hex(jsonText(input.contract));
    const sameChannels = JSON.stringify(bindings.channels) === JSON.stringify(input.contract.channels);
    contractOk = check("bindings.contract", bindings.contractSha256 === contractHash && sameChannels,
      sameChannels ? (bindings.contractSha256 === contractHash ? "Channels equal the frozen binding contract" : `contractSha256 ${bindings.contractSha256} != ${contractHash}`) : "Channels differ from the frozen binding contract") && contractOk;
  }
  if (equipment && bindings) {
    const equipmentHash = hashes["equipment.json"];
    contractOk = check("contract.equipment_hash", input.contract.equipmentSha256 === equipmentHash, `contract equipment ${input.contract.equipmentSha256} vs package ${equipmentHash}`) && contractOk;
    const channelIds = new Set(bindings.channels.map(c => c.id));
    const unknown = equipment.equipment.flatMap(e => e.channels).filter(c => !channelIds.has(c));
    contractOk = check("equipment.channels", unknown.length === 0, unknown.length ? `Equipment cites undeclared channels ${unknown.join(", ")}` : "Every equipment channel is declared") && contractOk;
  }
  if (manifest && equipment) {
    const compat = manifest.compatibility;
    let ok = compat?.machineId === equipment.machineId && compat?.worldId === equipment.world.worldId && compat?.worldManifestSha256 === equipment.world.manifest.sha256
      && compat?.worldSourceSha256 === equipment.world.source.sha256 && compat?.specificationSha256 === equipment.specification.sha256;
    let detail = ok ? `world ${compat.worldId} ${compat.worldPackageVersion}, manifest ${compat.worldManifestSha256.slice(0, 12)}` : "Manifest compatibility does not match equipment sources";
    if (ok && input.worldManifestText !== undefined) {
      const actual = await sha256Hex(input.worldManifestText);
      ok = actual === compat.worldManifestSha256;
      if (!ok) detail = `Mounted world manifest ${actual.slice(0, 12)} differs from package ${compat.worldManifestSha256.slice(0, 12)}`;
    }
    contractOk = check("compatibility.world", ok, detail) && contractOk;
  }
  const leaked = Object.entries(input.files).filter(([, text]) => typeof text === "string" && credentialPattern.test(text)).map(([name]) => name);
  contractOk = check("security.no_credentials", leaked.length === 0, leaked.length ? `Credential or endpoint pattern found in ${leaked.join(", ")}` : "No credential, endpoint or node-ID pattern in package files") && contractOk;

  const contractValid = contractOk;
  const pkg: LoadedPackage | null = contractValid && manifest && equipment && bindings ? { manifest, equipment, bindings, svg: null } : null;

  // ------------------------------------------------------------------ view tier
  let viewOk = contractValid && manifest?.status === "generated";
  if (manifest && manifest.status !== "generated") check("view.generated", false, "Package has no generated view; host shows the contract fallback");
  const svgText = input.files["view.svg"];
  if (viewOk && manifest && equipment && bindings && pkg) {
    viewOk = check("view.entry", manifest.entry?.file === "view.svg" && typeof svgText === "string" && manifest.entry.sha256 === hashes["view.svg"],
      typeof svgText === "string" ? "view.svg present and hash-matched" : "view.svg missing") && viewOk;
    const inspection = typeof svgText === "string" ? inspectSvg(svgText) : { error: "view.svg missing" };
    if ("error" in inspection) viewOk = check("svg.parse", false, inspection.error) && false;
    else {
      check("svg.parse", true, `${inspection.elementCount} elements, viewBox ${inspection.viewBox ? `${inspection.viewBox.width}x${inspection.viewBox.height}` : "missing"}`);
      viewOk = check("svg.safety", inspection.issues.length === 0, inspection.issues.length ? inspection.issues.slice(0, 20).join("; ") : "No script, external reference, animation, event handler or reserved override") && viewOk;

      const ids = inspection.ids;
      const problems: string[] = [];
      const seen = new Set<string>();
      for (const [i, b] of bindings.bindings.entries()) {
        const { problems: p } = normalizeBinding(b, i);
        problems.push(...p);
        if (seen.has(b.id)) problems.push(`Duplicate binding id ${b.id}`);
        seen.add(b.id);
        if (!ids.has(b.element)) problems.push(`Binding ${b.id} targets missing element #${b.element}`);
        if (b.kind === "entities" && !ids.has(b.container)) problems.push(`Binding ${b.id} targets missing container #${b.container}`);
        if ("channel" in b && !bindings.channels.some(c => c.id === b.channel)) problems.push(`Binding ${b.id} cites undeclared channel ${b.channel}`);
        if (b.kind === "anchor" && !equipment.equipment.some(e => e.id === b.equipmentId && e.geometry && (e.geometry.stationM !== undefined || e.geometry.fromM !== undefined))) problems.push(`Anchor ${b.id} cites equipment without geometry: ${b.equipmentId}`);
        if (b.kind === "entities" && !equipment.entityTypes.some(t => t.type === b.entityType)) problems.push(`Binding ${b.id} cites undeclared entity type ${b.entityType}`);
      }
      viewOk = check("bindings.references", problems.length === 0, problems.length ? problems.slice(0, 20).join("; ") : `${bindings.bindings.length} bindings resolve to declared elements, channels and equipment`) && viewOk;

      const valueBound = new Set(bindings.bindings.filter(b => "channel" in b).map(b => (b as { channel: string }).channel));
      const unbound = bindings.channels.filter(c => !valueBound.has(c.id)).map(c => c.id);
      viewOk = check("coverage.channels", unbound.length === 0, unbound.length ? `Unbound channels: ${unbound.join(", ")}` : `All ${bindings.channels.length} channels are bound`) && viewOk;
      const anchored = new Set(bindings.bindings.filter(b => b.kind === "anchor").map(b => (b as { equipmentId: string }).equipmentId));
      const unanchored = input.contract.anchoredEquipment.filter(id => !anchored.has(id));
      viewOk = check("coverage.anchors", unanchored.length === 0, unanchored.length ? `Equipment not anchored to its station: ${unanchored.join(", ")}` : "Every stationed device is placed from equipment geometry") && viewOk;
      const rotated = new Set(bindings.bindings.filter(b => b.kind === "rotate").map(b => (b as { channel: string }).channel));
      const belts = new Set(bindings.bindings.filter(b => b.kind === "belt").map(b => (b as { channel: string }).channel));
      const motionMissing = [...input.contract.rotateChannels.filter(c => !rotated.has(c)).map(c => `rotate ${c}`), ...input.contract.beltChannels.filter(c => !belts.has(c)).map(c => `belt ${c}`)];
      viewOk = check("coverage.motion", motionMissing.length === 0, motionMissing.length ? `Missing motion bindings: ${motionMissing.join(", ")}` : "Actuator and belt motion come from snapshot position/encoder channels") && viewOk;
      const entityBindings = bindings.bindings.filter(b => b.kind === "entities") as Extract<Binding, { kind: "entities" }>[];
      const missingTypes = input.contract.entityTypes.filter(t => !entityBindings.some(b => b.entityType === t));
      viewOk = check("coverage.entities", missingTypes.length === 0, missingTypes.length ? `No entity template for ${missingTypes.join(", ")}` : "Carton entities are drawn from supplied snapshots") && viewOk;

      // Structural: transform ownership, template isolation.
      const structure: string[] = [];
      const transformOwners = new Map<string, string>();
      for (const b of bindings.bindings) if (["anchor", "rotate", "belt"].includes(b.kind)) {
        const owner = transformOwners.get(b.element);
        if (owner) structure.push(`#${b.element} has two transform bindings (${owner}, ${b.id})`);
        transformOwners.set(b.element, b.id);
      }
      for (const b of entityBindings) {
        const template = ids.get(b.element);
        if (!template) continue;
        const inside = new Set<string>();
        for (const { el } of walk(template)) if (el.attrs.id !== undefined && el !== template) inside.add(el.attrs.id);
        for (const other of bindings.bindings) if (other !== b && (inside.has(other.element) || other.element === b.element)) structure.push(`Binding ${other.id} targets an element inside the entity template`);
        if (inside.has(b.container)) structure.push("Entity container is inside its template");
        if (![...walk(template)].some(({ el }) => el.attrs["data-cb-field"] === "itemId")) structure.push("Entity template has no data-cb-field=\"itemId\" label");
        const container = ids.get(b.container);
        if (container && [...walk(container)].some(({ el }) => el === template)) structure.push("Entity template must not be inside its container");
      }
      const badFields = [...walk(inspection.root)].map(({ el }) => el.attrs["data-cb-field"]).filter((f): f is string => f !== undefined && !(equipment.entityTypes[0]?.fields ?? []).includes(f));
      if (badFields.length) structure.push(`Unknown data-cb-field values: ${[...new Set(badFields)].join(", ")}`);
      viewOk = check("bindings.structure", structure.length === 0, structure.length ? structure.join("; ") : "One transform owner per element; entity template isolated") && viewOk;

      // Selection
      const declared = new Set(equipment.equipment.map(e => e.id));
      const unknownRefs = [...inspection.equipmentRefs].filter(id => !declared.has(id));
      const notSelectable = [...declared].filter(id => !inspection.equipmentRefs.has(id));
      const manifestSelectable = new Set(manifest.selectableEquipment ?? []);
      const selectionOk = unknownRefs.length === 0 && notSelectable.length === 0 && manifestSelectable.size === declared.size && [...declared].every(id => manifestSelectable.has(id));
      viewOk = check("selection.equipment", selectionOk, selectionOk ? `All ${declared.size} equipment identities are selectable` : `unknown refs [${unknownRefs.join(", ")}], not selectable [${notSelectable.join(", ")}]`) && viewOk;

      // Geometry coherence with the frozen equipment graph.
      const geometry: string[] = [];
      const warnings: string[] = [];
      const type = equipment.entityTypes[0];
      const drawings = new Map(bindings.entityPaths.map(d => [d.path, [...d.points].sort((a, b) => a.m - b.m)]));
      const vb = inspection.viewBox;
      if (type) for (const p of type.paths) {
        const pts = drawings.get(p.id);
        if (!pts || pts.length < 2) { geometry.push(`Path ${p.id} is not drawn`); continue; }
        const raw = bindings.entityPaths.find(d => d.path === p.id)!.points;
        if (raw.some((pt, i) => i > 0 && !(pt.m > raw[i - 1]!.m))) geometry.push(`Path ${p.id} stations must strictly increase`);
        if (raw.some(pt => !finite(pt.m) || !finite(pt.x) || !finite(pt.y))) geometry.push(`Path ${p.id} has non-numeric points`);
        if (pts[0]!.m > p.fromM + 1e-6 || pts[pts.length - 1]!.m < p.toM - 1e-6) geometry.push(`Path ${p.id} covers ${pts[0]!.m}-${pts[pts.length - 1]!.m} m, needs ${p.fromM}-${p.toM} m`);
        if (vb && pts.some(pt => pt.x < vb.x || pt.y < vb.y || pt.x > vb.x + vb.width || pt.y > vb.y + vb.height)) geometry.push(`Path ${p.id} leaves the viewBox`);
        if (p.branchFrom) {
          const parent = drawings.get(p.branchFrom.path);
          if (parent && parent.length >= 2) {
            const a = pointAt(parent, p.branchFrom.atM), b = pointAt(pts, p.branchFrom.atM);
            const gap = Math.hypot(a.x - b.x, a.y - b.y);
            if (gap > 3) geometry.push(`Path ${p.id} starts ${gap.toFixed(1)} px from ${p.branchFrom.path} at ${p.branchFrom.atM} m`);
          }
        }
      }
      for (const d of bindings.entityPaths) if (!type?.paths.some(p => p.id === d.path)) geometry.push(`Undeclared path drawing ${d.path}`);
      if (type) {
        const scales = type.paths.map(p => drawings.get(p.id)).filter((pts): pts is NonNullable<typeof pts> => Boolean(pts && pts.length >= 2)).map(pts => pxPerMetre(pts));
        if (scales.length > 1 && Math.max(...scales) / Math.min(...scales) > 1.25) warnings.push(`Path scales differ by ${(Math.max(...scales) / Math.min(...scales)).toFixed(2)}x; distances are not to a common scale`);
      }
      viewOk = check("geometry.paths", geometry.length === 0, geometry.length ? geometry.join("; ") : "Path drawings cover every world path and branches join their divert station") && viewOk;
      for (const w of warnings) check("geometry.scale", false, w, "warning");

      // Styling hooks: state must change appearance; command and feedback should look different.
      viewOk = check("style.state", /data-cb-value/.test(inspection.css), /data-cb-value/.test(inspection.css) ? "CSS styles data-cb-value states" : "CSS never references data-cb-value, so state changes would be invisible") && viewOk;
      check("style.source", /data-cb-source/.test(inspection.css), /data-cb-source/.test(inspection.css) ? "CSS distinguishes PLC command from world feedback" : "CSS does not style data-cb-source; command/feedback rely on layout alone", "warning");

      // Render smoke: unknown, normal and fully asserted snapshots apply without missing elements.
      if (viewOk && typeof svgText === "string") {
        const loaded: LoadedPackage = { ...pkg, svg: svgText };
        const normal: Record<string, boolean | number> = {};
        const asserted: Record<string, boolean | number> = {};
        for (const c of bindings.channels) {
          normal[c.signal] = typeof c.normalValue === "boolean" || typeof c.normalValue === "number" ? c.normalValue : 0;
          asserted[c.signal] = c.dataType === "BOOL" ? true : 50;
        }
        const missing = new Set<string>();
        const base = { packageId: manifest.packageId, mode: "replay" as const, evidenceClass: "surrogate_contract" as const, link: { state: "not_connected" as const } };
        const snapshots = [
          buildSnapshot(bindings.channels, { ...base, sequence: 0 }),
          buildSnapshot(bindings.channels, { ...base, sequence: 1, raw: normal, outputs: normal, entities: [] }),
          buildSnapshot(bindings.channels, { ...base, sequence: 2, raw: asserted, outputs: asserted, entities: (type?.paths ?? []).map((p, i) => ({ id: `probe-${i}`, type: type!.type, state: { positionM: (p.fromM + p.toM) / 2, velocityMps: 0.5, path: p.id, requestedRoute: null, itemId: `probe-${p.id}`, jammed: false } })) })
        ];
        for (const snapshot of snapshots) {
          const root: SvgElement = parseSvg(svgText);
          for (const id of applyFrame(root, resolveFrame(loaded, snapshot)).missing) missing.add(id);
        }
        viewOk = check("render.smoke", missing.size === 0, missing.size ? `Frames reference missing elements: ${[...missing].join(", ")}` : "Unknown, normal and asserted snapshots render without missing elements") && viewOk;
      }
    }
  }

  const errors = checks.filter(c => !c.passed && c.severity === "error").map(c => `${c.id}: ${c.detail}`);
  const warnings = checks.filter(c => !c.passed && c.severity === "warning").map(c => `${c.id}: ${c.detail}`);
  const report: ValidationReport = {
    schemaVersion: VIEW_VALIDATION_VERSION,
    contractValid,
    viewValid: Boolean(viewOk) && contractValid,
    packageId: manifest?.packageId ?? null,
    hashes,
    checks,
    errors,
    warnings
  };
  return { report, pkg: pkg ? { ...pkg, svg: report.viewValid && typeof svgText === "string" ? svgText : null } : null };
}
