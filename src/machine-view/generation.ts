// Muse generation request format and package assembly for the machine view.
// The request is fully materialised (and preserved) before any network call.

import {
  VIEW_BINDINGS_VERSION, VIEW_GENERATION_REQUEST_VERSION, VIEW_PACKAGE_VERSION, VIEW_PROTOCOL_VERSION, VIEW_SNAPSHOT_VERSION, entityFields,
  type Binding, type BindingContract, type EquipmentFile, type GenerationInputRef, type GenerationRequestRecord, type ViewBindingsFile, type ViewManifest
} from "./contracts.ts";
import { jsonText, normalizeBinding, sha256Hex } from "./package.ts";
import { allowedElements } from "./svg.ts";

const allowedElementsList = [...allowedElements];

export const PROMPT_VERSION = "machine-view-prompt-v1";
export const OUTPUT_SCHEMA_NAME = "controlsbench_machine_view_v1";

const nullable = (type: string) => ({ type: [type, "null"] });
const bindingSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    kind: { type: "string", enum: ["anchor", "state", "text", "rotate", "belt", "entities"] },
    element: { type: "string" },
    channel: nullable("string"),
    equipmentId: nullable("string"),
    decimals: nullable("integer"),
    inputMin: nullable("number"),
    inputMax: nullable("number"),
    angleMin: nullable("number"),
    angleMax: nullable("number"),
    pivotX: nullable("number"),
    pivotY: nullable("number"),
    periodPx: nullable("number"),
    container: nullable("string"),
    entityType: nullable("string"),
    rotateWithPath: nullable("boolean")
  },
  required: ["id", "kind", "element", "channel", "equipmentId", "decimals", "inputMin", "inputMax", "angleMin", "angleMax", "pivotX", "pivotY", "periodPx", "container", "entityType", "rotateWithPath"]
};

export const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    svg: { type: "string" },
    entityPaths: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          points: { type: "array", items: { type: "object", additionalProperties: false, properties: { m: { type: "number" }, x: { type: "number" }, y: { type: "number" } }, required: ["m", "x", "y"] } }
        },
        required: ["path", "points"]
      }
    },
    bindings: { type: "array", items: bindingSchema },
    layoutAssumptions: { type: "array", items: { type: "string" } },
    designNotes: { type: "string" }
  },
  required: ["svg", "entityPaths", "bindings", "layoutAssumptions", "designNotes"]
};

export interface GeneratedView {
  svg: string;
  entityPaths: Array<{ path: string; points: Array<{ m: number; x: number; y: number }> }>;
  bindings: unknown[];
  layoutAssumptions: string[];
  designNotes: string;
}

export function developerPrompt(equipment: EquipmentFile, contract: BindingContract): string {
  const type = equipment.entityTypes[0]!;
  const paths = type.paths.map(p => `${p.id}: ${p.fromM}-${p.toM} m${p.branchFrom ? ` (starts at ${p.branchFrom.path} ${p.branchFrom.atM} m)` : ""}`).join("; ");
  return `
You are Muse Wonder acting as the machine-view author inside ControlsBench.

Author the lightweight 2D operating view for the accepted conveyor bench: one SVG document plus the bindings that connect its elements to host-supplied snapshots. The view shows SIMULATED PHYSICAL TRUTH (the generated world's raw image and carton entities) and OBSERVED PLC OUTPUTS. It is NOT the PLC HMI and must say so in a small visible caption. It owns no physics, has no credentials, network access or command authority, and never animates on its own: every changing appearance comes from a snapshot the host applies.

HARD RULES (a validator rejects violations; there is no repair call):
- Return one well-formed SVG: root <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 W H"> with a numeric viewBox (suggested 0 0 1200 560). Include your own background rect. Keep it under 60 KB.
- Allowed elements only: ${allowedElementsList.join(", ")}. No script, foreignObject, image, a, iframe, animate/set/animateTransform, filter, DOCTYPE or entities other than &amp; &lt; &gt; &quot; &apos;.
- No event-handler attributes (on*), no external references of any kind (http:, https:, //, data:, javascript:), url() only as url(#localId), href only as "#localId" on <use>.
- CSS lives in one <style> element. No @import, @font-face, @keyframes, animation, transition or !important. Do not target html, body, :root, div or *. Do not use ids or classes beginning with "cb-".
- Do not author the host-owned attributes data-cb-value, data-cb-health, data-cb-source, data-cb-selected, data-cb-clone, data-cb-entity, data-cb-path, data-cb-route, data-cb-jammed, data-cb-outside. The host sets them on every frame.
- Ids: unique, matching [A-Za-z_][A-Za-z0-9_.-]*.
- Draw no carton statically and imply no state before data arrives: the host marks every bound element "unknown" until the first snapshot.

SELECTION: put data-cb-equipment="<equipment id>" on one group per equipment so the engineer can click it to open evidence. All ${equipment.equipment.length} equipment ids must be selectable: ${equipment.equipment.map(e => e.id).join(", ")}.

BINDING KINDS (fields not used by a kind must be null):
- anchor {element, equipmentId, rotateWithPath}: the host sets transform="translate(x y)" (plus rotate(path angle) when rotateWithPath) placing the element at that equipment's station, computed from equipment.json geometry through YOUR entityPaths. Draw the device glyph around its local origin (0,0) with the conveyor running along local +x. Required for: ${contract.anchoredEquipment.join(", ")}. The anchored element's own transform attribute is overwritten; give it no other transform binding.
- state {element, channel}: the host sets data-cb-value ("true", "false", a number string or "unknown"), data-cb-health (good|stale|held|bad|unknown), data-cb-source ("world" or "plc") and aria-label. Style states with attribute selectors such as #pe_entry_beam[data-cb-value="true"]{...}. The host itself dims and dashes non-good health; keep "unknown" visually different from "false".
- text {element, channel, decimals}: the host replaces the element's text with the formatted value or "unknown". Use on <text>/<tspan>.
- rotate {element, channel, inputMin, inputMax, angleMin, angleMax, pivotX, pivotY}: the host sets transform="rotate(angle pivotX pivotY)" mapping the channel linearly and clamped from [inputMin,inputMax] to [angleMin,angleMax] degrees in the element's parent coordinates. Required for ${contract.rotateChannels.join(", ")} (0-100 %, actual divert position). Home (0 %) must lie along the lane edge; extended (100 %) must visibly cross the main lane toward its exit branch. Nest the rotating paddle inside the anchored divert group.
- belt {element, channel, periodPx}: the host sets transform="translate(offset 0)", offset = (Encoder_Count / ${equipment.encoder?.countsPerM ?? 1000} counts per metre x main-path px per metre) mod periodPx. Required for ${contract.beltChannels.join(", ")}. Use it on a group of periodic belt marks along the horizontal main lane, drawn one period beyond each end and clipped to the belt with a clipPath.
- entities {element, container, entityType}: element is a template group for one ${type.type} drawn centred on (0,0) along +x at nominal length ${type.nominalLengthM} m on the main-path scale; container is an empty <g> the host fills with clones. The host sets each clone's transform from (path, positionM) through entityPaths and sets data-cb-health, data-cb-path, data-cb-route (A, B or unassigned), data-cb-jammed and data-cb-entity, and fills descendants marked data-cb-field with one of: ${entityFields.join(", ")}. Include at least data-cb-field="itemId". The template must not be inside the container, and no other binding may target an element inside the template.

ENTITY PATHS: return entityPaths, one polyline per path in SVG user units with metre stations m (strictly increasing), covering ${paths}. Branch paths must begin exactly at the main path's point for their divert station. Use one common pixel-per-metre scale for all paths and draw the visible belt and chutes on these lines. Path value "runout" is drawn on "main".

COVERAGE: every channel in the binding contract must be bound by at least one state, text, rotate or belt binding. PLC commands (source plc_output) and world feedback (world_raw) for the same device must be visibly distinct and both shown, so a device is never painted as moving because a command is on: style [data-cb-source="plc"] differently from [data-cb-source="world"]. Equipment without a specified location (drive, encoder, stack light) belongs in a clearly labelled side panel; do not imply a measured location.

Geometry values in equipment.json are the generated world's inferred demo layout, not measured dimensions or PLC thresholds. Record every visual choice you make (scale, branch angles, panel placement, colours meaning) in layoutAssumptions. Return only the structured object required by the response schema.
`.trim();
}

export function userPrompt(inputs: { equipmentText: string; contractText: string; assumptionsText: string; specificationText: string }): string {
  return [
    "EQUIPMENT GRAPH (equipment.json, frozen):", inputs.equipmentText,
    "BINDING CONTRACT (channels and required bindings, frozen):", inputs.contractText,
    "GENERATED WORLD ASSUMPTIONS (assumptions.md):", inputs.assumptionsText,
    "ACCEPTED SPECIFICATION (docs/conveyor-machine-spec.md):", inputs.specificationText
  ].join("\n\n");
}

export interface RequestBuildInput {
  requestId: string;
  createdAt: string;
  endpoint: string;
  model: string;
  maxOutputTokens: number;
  reservationUsd: number;
  perRequestHardUsd: number;
  timeoutMs: number;
  equipment: EquipmentFile;
  contract: BindingContract;
  texts: { equipmentText: string; contractText: string; assumptionsText: string; specificationText: string; worldManifestText: string };
  paths: { equipment: string; contract: string; assumptions: string; specification: string; worldManifest: string };
}

export async function buildGenerationRequest(input: RequestBuildInput): Promise<GenerationRequestRecord> {
  const developer = developerPrompt(input.equipment, input.contract);
  const user = userPrompt(input.texts);
  const body = {
    model: input.model,
    reasoning: { effort: "high", summary: "auto" },
    max_output_tokens: input.maxOutputTokens,
    input: [
      { role: "developer", content: developer },
      { role: "user", content: user }
    ],
    text: { format: { type: "json_schema", name: OUTPUT_SCHEMA_NAME, description: "ControlsBench generated machine view: SVG plus snapshot bindings.", strict: true, schema: outputSchema } }
  };
  const ref = async (role: GenerationInputRef["role"], path: string, text: string): Promise<GenerationInputRef> => ({ role, path, sha256: await sha256Hex(text), bytes: new TextEncoder().encode(text).length });
  const protocolText = `${VIEW_PROTOCOL_VERSION}\n${VIEW_SNAPSHOT_VERSION}\n${VIEW_BINDINGS_VERSION}`;
  return {
    schemaVersion: VIEW_GENERATION_REQUEST_VERSION,
    requestId: input.requestId,
    createdAt: input.createdAt,
    purpose: "machine_view_generation",
    endpoint: input.endpoint,
    model: { id: input.model, reasoning: { effort: "high", summary: "auto" }, maxOutputTokens: input.maxOutputTokens },
    budget: { reservationUsd: input.reservationUsd, perRequestHardUsd: input.perRequestHardUsd, timeoutMs: input.timeoutMs, maxCalls: 1, automaticRetries: 0, repairCalls: 0 },
    inputs: [
      await ref("specification", input.paths.specification, input.texts.specificationText),
      await ref("equipment", input.paths.equipment, input.texts.equipmentText),
      await ref("binding_contract", input.paths.contract, input.texts.contractText),
      await ref("world_manifest", input.paths.worldManifest, input.texts.worldManifestText),
      await ref("world_assumptions", input.paths.assumptions, input.texts.assumptionsText),
      await ref("view_protocol", "src/machine-view/contracts.ts", protocolText)
    ],
    promptVersion: PROMPT_VERSION,
    promptSha256: await sha256Hex(`${developer}\n\n${user}`),
    outputSchemaName: OUTPUT_SCHEMA_NAME,
    outputSchemaSha256: await sha256Hex(jsonText(outputSchema)),
    body,
    bodySha256: await sha256Hex(JSON.stringify(body))
  };
}

export function extractOutputText(payload: { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }): string {
  if (typeof payload.output_text === "string") return payload.output_text;
  return (payload.output ?? []).flatMap(item => item.content ?? []).filter(c => c.type === "output_text" || c.type === "text").map(c => c.text ?? "").join("");
}

export interface AssembledPackage {
  files: { "view.manifest.json": string; "equipment.json": string; "view-bindings.json": string; "view.svg"?: string };
  normalizationProblems: string[];
  manifest: ViewManifest;
}

/**
 * Builds package files. With `generated === null` the result is a contract-only package whose
 * host state is the explicit fallback ("not generated").
 */
export async function assemblePackage(input: {
  equipmentText: string;
  contract: BindingContract;
  generated: GeneratedView | null;
  provenance: { model: string | null; responseId: string | null; generatedAt: string | null };
}): Promise<AssembledPackage> {
  const equipment = JSON.parse(input.equipmentText) as EquipmentFile;
  const contractSha256 = await sha256Hex(jsonText(input.contract));
  const problems: string[] = [];
  const bindings: Binding[] = [];
  for (const [i, raw] of (input.generated?.bindings ?? []).entries()) {
    const { binding, problems: p } = normalizeBinding(raw, i);
    problems.push(...p);
    if (binding) bindings.push(binding);
  }
  const bindingsFile: ViewBindingsFile = {
    schemaVersion: VIEW_BINDINGS_VERSION,
    contractSha256,
    channels: input.contract.channels,
    entityPaths: input.generated?.entityPaths ?? [],
    bindings
  };
  const bindingsText = jsonText(bindingsFile);
  const svg = input.generated?.svg;
  const files: AssembledPackage["files"] = { "view.manifest.json": "", "equipment.json": input.equipmentText, "view-bindings.json": bindingsText };
  const fileHashes: Record<string, string> = { "equipment.json": await sha256Hex(input.equipmentText), "view-bindings.json": await sha256Hex(bindingsText) };
  let entry: ViewManifest["entry"] = null;
  if (typeof svg === "string") {
    files["view.svg"] = svg;
    fileHashes["view.svg"] = await sha256Hex(svg);
    entry = { file: "view.svg", mediaType: "image/svg+xml", sha256: fileHashes["view.svg"] };
  }
  const identity = await sha256Hex(`${fileHashes["equipment.json"]}:${fileHashes["view-bindings.json"]}:${fileHashes["view.svg"] ?? "none"}`);
  const manifest: ViewManifest = {
    schemaVersion: VIEW_PACKAGE_VERSION,
    packageId: `${equipment.machineId}.view.${identity.slice(0, 12)}`,
    name: `${equipment.name}: generated machine view`,
    status: entry ? "generated" : "not_generated",
    entry,
    files: fileHashes,
    compatibility: {
      machineId: equipment.machineId,
      worldId: equipment.world.worldId,
      worldPackageVersion: equipment.world.packageVersion,
      stateSchemaVersion: equipment.world.stateSchemaVersion,
      worldManifestSha256: equipment.world.manifest.sha256,
      worldSourceSha256: equipment.world.source.sha256,
      specificationSha256: equipment.specification.sha256,
      signalMapVersion: equipment.signalMap.mapVersion,
      snapshotSchema: VIEW_SNAPSHOT_VERSION,
      protocol: VIEW_PROTOCOL_VERSION
    },
    selectableEquipment: equipment.equipment.map(e => e.id),
    units: equipment.units,
    truthBoundary: "Shows simulated physical truth (generated world raw image and entities) and observed PLC outputs from host-supplied snapshots. Not the PLC HMI and not evidence of PLC correctness. No credentials, network access or command authority.",
    authority: { plcCommands: false, credentials: false, network: false, scripts: "host_runtime_only" },
    provenance: { generation: "generation.json", validation: "validation.json", ...input.provenance },
    layoutAssumptions: input.generated?.layoutAssumptions ?? []
  };
  files["view.manifest.json"] = jsonText(manifest);
  return { files, normalizationProblems: problems, manifest };
}
