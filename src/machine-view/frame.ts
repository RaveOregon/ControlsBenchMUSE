// Snapshot -> presentation frame. Pure functions shared by the isolated host, the static
// renderer, tests and the fallback. Nothing here owns physics or invents a value: a missing,
// bad or unknown sample is shown as unknown; stale and held samples keep their last value but
// are marked so the drawing cannot look current.

import {
  VIEW_SNAPSHOT_VERSION, entityFields, evidenceClasses, healthStates, linkStates, writableAttributes,
  type Binding, type Channel, type ChannelSample, type EntitySample, type EquipmentFile, type FrameOp, type Health,
  type LinkState, type Motion, type ScalarValue, type ViewBindingsFile, type ViewEvidenceClass, type ViewManifest, type ViewSnapshot
} from "./contracts.ts";
import { PathMap, round } from "./geometry.ts";
import { cloneElement, walk, type SvgElement } from "./svg.ts";

export interface LoadedPackage {
  manifest: ViewManifest;
  equipment: EquipmentFile;
  bindings: ViewBindingsFile;
  svg: string | null;
}

export const evidenceLabels: Record<ViewEvidenceClass, string> = {
  surrogate_contract: "surrogate contract · no PLC",
  fake_connector: "fake connector · no PLC",
  preserved_live_plc: "preserved live-PLC evidence",
  live_plc: "live PLC"
};

const truthLabels = { world_raw: "simulated world truth", plc_output: "observed PLC output" } as const;
const MAX_ENTITIES = 64;
const MAX_STRING = 200;

// ---------------------------------------------------------------------------------------------
// Snapshot construction and validation

export interface SnapshotInput {
  packageId: string;
  mode: "replay" | "live";
  evidenceClass: ViewEvidenceClass;
  sequence: number;
  campaignSequence?: number | null;
  sourceTimeMs?: number | null;
  label?: string | null;
  link: { state: LinkState; ageMs?: number | null; reason?: string | null };
  /** World raw image keyed by logical signal ID. `undefined` means not observed. */
  raw?: Record<string, ScalarValue | undefined>;
  /** Observed PLC outputs keyed by logical signal ID. */
  outputs?: Record<string, ScalarValue | undefined>;
  /** Optional per-channel quality from the source (for example OPC UA status). */
  quality?: Record<string, Health>;
  /** Channel observation times; used for live aging only. Replay never ages values. */
  observedAtMs?: Record<string, number>;
  nowMs?: number;
  staleAfterMs?: number;
  evidenceRefs?: Record<string, string>;
  /** `null`/omitted: the host has no entity source, so entity positions are unknown. */
  entities?: EntitySample[] | null;
  entityEvidenceRef?: string | null;
  selection?: { equipmentId?: string | null; entityId?: string | null };
}

export function buildSnapshot(channels: readonly Channel[], input: SnapshotInput): ViewSnapshot {
  const samples: Record<string, ChannelSample> = {};
  for (const channel of channels) {
    const sourceValues = channel.source === "world_raw" ? input.raw : input.outputs;
    const value = sourceValues?.[channel.signal];
    if (value === undefined) continue;
    let health: Health = input.quality?.[channel.id] ?? (value === null ? "unknown" : "good");
    const observedAtMs = input.observedAtMs?.[channel.id];
    if (input.mode === "live" && health === "good" && observedAtMs !== undefined && input.nowMs !== undefined
      && input.nowMs - observedAtMs > (input.staleAfterMs ?? 1000)) health = "stale";
    samples[channel.id] = { value, health, observedAtMs: observedAtMs ?? null, evidenceRef: input.evidenceRefs?.[channel.id] ?? null };
  }
  const supplied = Array.isArray(input.entities);
  return {
    schemaVersion: VIEW_SNAPSHOT_VERSION,
    packageId: input.packageId,
    mode: input.mode,
    evidenceClass: input.evidenceClass,
    frame: { sequence: input.sequence, campaignSequence: input.campaignSequence ?? null, sourceTimeMs: input.sourceTimeMs ?? null, label: input.label ?? null },
    link: { state: input.link.state, ageMs: input.link.ageMs ?? null, reason: input.link.reason ?? null },
    channels: samples,
    entities: {
      supplied,
      health: supplied ? "good" : "unknown",
      items: supplied ? input.entities!.map(e => ({ ...e, evidenceRef: e.evidenceRef ?? input.entityEvidenceRef ?? null })) : []
    },
    selection: { equipmentId: input.selection?.equipmentId ?? null, entityId: input.selection?.entityId ?? null }
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const scalarOk = (v: unknown): v is ScalarValue => v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && v.length <= MAX_STRING);

function typeMatches(dataType: string, value: ScalarValue): boolean {
  if (value === null) return true;
  if (dataType === "BOOL") return typeof value === "boolean";
  if (dataType === "STRING" || dataType.startsWith("STRING")) return typeof value === "string";
  if (["UDINT", "UINT", "USINT", "ULINT"].includes(dataType)) return typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (["DINT", "INT", "SINT", "LINT"].includes(dataType)) return typeof value === "number" && Number.isInteger(value);
  return typeof value === "number";
}

/** Returns a list of problems; an empty list means the snapshot may be rendered. */
export function validateSnapshot(pkg: LoadedPackage, snapshot: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(snapshot)) return ["Snapshot must be an object"];
  const allowedTop = ["schemaVersion", "packageId", "mode", "evidenceClass", "frame", "link", "channels", "entities", "selection"];
  for (const key of Object.keys(snapshot)) if (!allowedTop.includes(key)) errors.push(`Unexpected snapshot field ${key}`);
  if (snapshot.schemaVersion !== VIEW_SNAPSHOT_VERSION) errors.push(`Unsupported snapshot schema ${String(snapshot.schemaVersion)}`);
  if (snapshot.packageId !== pkg.manifest.packageId) errors.push(`Snapshot targets package ${String(snapshot.packageId)}, mounted ${pkg.manifest.packageId}`);
  if (snapshot.mode !== "replay" && snapshot.mode !== "live") errors.push("mode must be replay or live");
  if (!evidenceClasses.includes(snapshot.evidenceClass as ViewEvidenceClass)) errors.push("Unknown evidenceClass");
  const frame = snapshot.frame;
  if (!isRecord(frame) || !Number.isInteger(frame.sequence) || (frame.sequence as number) < 0) errors.push("frame.sequence must be a non-negative integer");
  else {
    for (const key of ["campaignSequence", "sourceTimeMs"]) if (frame[key] !== null && !(typeof frame[key] === "number" && Number.isFinite(frame[key]))) errors.push(`frame.${key} must be a number or null`);
    if (frame.label !== null && !(typeof frame.label === "string" && frame.label.length <= MAX_STRING)) errors.push("frame.label must be a short string or null");
  }
  const link = snapshot.link;
  if (!isRecord(link) || !linkStates.includes(link.state as LinkState)) errors.push("link.state is invalid");
  else {
    if (link.ageMs !== null && !(typeof link.ageMs === "number" && link.ageMs >= 0)) errors.push("link.ageMs must be a non-negative number or null");
    if (link.reason !== null && !(typeof link.reason === "string" && link.reason.length <= MAX_STRING)) errors.push("link.reason must be a short string or null");
  }
  const byId = new Map(pkg.bindings.channels.map(c => [c.id, c]));
  if (!isRecord(snapshot.channels)) errors.push("channels must be an object");
  else for (const [id, sample] of Object.entries(snapshot.channels)) {
    const channel = byId.get(id);
    if (!channel) { errors.push(`Undeclared channel ${id}`); continue; }
    if (!isRecord(sample)) { errors.push(`Channel ${id} sample must be an object`); continue; }
    for (const key of Object.keys(sample)) if (!["value", "health", "observedAtMs", "evidenceRef"].includes(key)) errors.push(`Channel ${id} has unexpected field ${key}`);
    if (!scalarOk(sample.value)) errors.push(`Channel ${id} value must be a JSON scalar`);
    else if (!typeMatches(channel.dataType, sample.value)) errors.push(`Channel ${id} value does not match ${channel.dataType}`);
    if (!healthStates.includes(sample.health as Health)) errors.push(`Channel ${id} health is invalid`);
    if (sample.evidenceRef !== undefined && sample.evidenceRef !== null && !(typeof sample.evidenceRef === "string" && sample.evidenceRef.length <= MAX_STRING)) errors.push(`Channel ${id} evidenceRef is invalid`);
  }
  const entities = snapshot.entities;
  const types = new Set(pkg.equipment.entityTypes.map(t => t.type));
  if (!isRecord(entities) || typeof entities.supplied !== "boolean" || !healthStates.includes(entities.health as Health) || !Array.isArray(entities.items)) errors.push("entities must be { supplied, health, items[] }");
  else {
    if (entities.items.length > MAX_ENTITIES) errors.push(`At most ${MAX_ENTITIES} entities may be supplied`);
    if (!entities.supplied && entities.items.length > 0) errors.push("entities.items must be empty when supplied is false");
    for (const item of entities.items as unknown[]) {
      if (!isRecord(item) || typeof item.id !== "string" || item.id.length > 80 || !types.has(String(item.type)) || !isRecord(item.state)) { errors.push("Entity must be { id, declared type, state }"); continue; }
      const allowed = [...entityFields, "lengthM"] as string[];
      for (const [k, v] of Object.entries(item.state)) {
        if (!allowed.includes(k)) errors.push(`Entity ${item.id} has undeclared field ${k}`);
        else if (!scalarOk(v)) errors.push(`Entity ${item.id}.${k} must be a scalar`);
      }
      if (typeof item.state.positionM !== "number" || typeof item.state.path !== "string") errors.push(`Entity ${item.id} needs numeric positionM and string path`);
    }
  }
  const selection = snapshot.selection;
  if (!isRecord(selection)) errors.push("selection must be an object");
  else {
    if (selection.equipmentId !== null && !pkg.equipment.equipment.some(e => e.id === selection.equipmentId)) errors.push("selection.equipmentId is not declared");
    if (selection.entityId !== null && typeof selection.entityId !== "string") errors.push("selection.entityId must be a string or null");
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Health and value display

export function linkAdjusted(health: Health, link: LinkState, source: Channel["source"]): Health {
  if (health !== "good") return health;
  switch (link) {
    case "fresh": case "not_connected": return "good";
    case "stale": case "disconnected": case "quarantined": return "stale";
    case "held": return "held";
    case "passthrough": return source === "world_raw" ? "held" : "good";
  }
}

export interface ResolvedSample { channel: Channel; value: ScalarValue; health: Health; shown: boolean; display: string; evidenceRef: string | null }

export function formatValue(value: ScalarValue, decimals: number | null = null): string {
  if (value === null) return "unknown";
  if (typeof value === "number") return decimals === null ? String(round(value, 3)) : value.toFixed(Math.max(0, Math.min(6, decimals)));
  return String(value);
}

export function resolveSample(channel: Channel, snapshot: ViewSnapshot, decimals: number | null = null): ResolvedSample {
  const sample = snapshot.channels[channel.id];
  if (!sample) return { channel, value: null, health: "unknown", shown: false, display: "unknown", evidenceRef: null };
  const health = sample.value === null ? "unknown" : linkAdjusted(sample.health, snapshot.link.state, channel.source);
  const shown = health === "good" || health === "stale" || health === "held";
  return { channel, value: sample.value, health, shown, display: shown ? formatValue(sample.value, decimals) : "unknown", evidenceRef: sample.evidenceRef ?? null };
}

export function bannerFor(pkg: LoadedPackage, snapshot: ViewSnapshot): { level: "info" | "warn" | "bad"; text: string } {
  const parts = [`${snapshot.mode === "replay" ? "Replay" : "Live"} · ${evidenceLabels[snapshot.evidenceClass]}${snapshot.frame.label ? ` · ${snapshot.frame.label}` : ""}`];
  let level: "info" | "warn" | "bad" = "info";
  const age = snapshot.link.ageMs === null ? "" : ` for ${(snapshot.link.ageMs / 1000).toFixed(1)} s`;
  const reason = snapshot.link.reason ? ` (${snapshot.link.reason})` : "";
  switch (snapshot.link.state) {
    case "stale": case "disconnected": case "quarantined":
      level = "bad"; parts.push(`${snapshot.link.state.toUpperCase()}${age}${reason}: values held from the last snapshot`); break;
    case "held": level = "warn"; parts.push(`HELD${reason}: image held, not advancing`); break;
    case "passthrough": level = "warn"; parts.push(`PASSTHROUGH${reason}: simulation not applied; world image is not driving the PLC`); break;
    case "not_connected": parts.push("no PLC connection in this record"); break;
    case "fresh": break;
  }
  if (!snapshot.entities.supplied) { level = level === "bad" ? "bad" : "warn"; parts.push(`${pkg.equipment.entityTypes.map(t => t.type).join("/")} positions not supplied: unknown`); }
  const unknown = pkg.bindings.channels.filter(c => !resolveSample(c, snapshot).shown).length;
  if (unknown > 0) parts.push(`${unknown} of ${pkg.bindings.channels.length} signals unknown`);
  parts.push("simulated physical truth, not the PLC HMI");
  return { level, text: parts.join(" · ") };
}

// ---------------------------------------------------------------------------------------------
// Frame resolution

function healthAttrs(r: ResolvedSample): Record<string, string> {
  return {
    "data-cb-health": r.health,
    "data-cb-source": r.channel.source === "world_raw" ? "world" : "plc",
    "aria-label": `${r.channel.signal} = ${r.display} (${r.health}) · ${truthLabels[r.channel.source]}`
  };
}

export function resolveFrame(pkg: LoadedPackage, snapshot: ViewSnapshot): FrameOp[] {
  const ops: FrameOp[] = [];
  const channels = new Map(pkg.bindings.channels.map(c => [c.id, c]));
  const equipment = new Map(pkg.equipment.equipment.map(e => [e.id, e]));
  const entityTypes = new Map(pkg.equipment.entityTypes.map(t => [t.type, t]));
  const primaryType = pkg.equipment.entityTypes[0];
  const paths = new PathMap(pkg.bindings.entityPaths, primaryType);
  const encoder = pkg.equipment.encoder;
  const beltScale = primaryType ? paths.scale(primaryType.paths[0]?.id ?? "") : 0;

  for (const binding of pkg.bindings.bindings) {
    switch (binding.kind) {
      case "anchor": {
        const geometry = equipment.get(binding.equipmentId)?.geometry;
        const station = geometry?.stationM ?? geometry?.fromM;
        const p = geometry && station !== undefined ? paths.position(geometry.path, station) : null;
        if (p) ops.push({ op: "attrs", id: binding.element, attrs: { transform: `translate(${round(p.x)} ${round(p.y)})${binding.rotateWithPath && p.angleDeg !== 0 ? ` rotate(${round(p.angleDeg)})` : ""}` } });
        break;
      }
      case "state": {
        const channel = channels.get(binding.channel);
        if (!channel) break;
        const r = resolveSample(channel, snapshot);
        ops.push({ op: "attrs", id: binding.element, attrs: { ...healthAttrs(r), "data-cb-value": r.shown ? String(r.value) : "unknown" } });
        break;
      }
      case "text": {
        const channel = channels.get(binding.channel);
        if (!channel) break;
        const r = resolveSample(channel, snapshot, binding.decimals);
        ops.push({ op: "attrs", id: binding.element, attrs: healthAttrs(r) });
        ops.push({ op: "text", id: binding.element, text: r.display });
        break;
      }
      case "rotate": {
        const channel = channels.get(binding.channel);
        if (!channel) break;
        const r = resolveSample(channel, snapshot);
        const attrs = healthAttrs(r);
        let motion: Motion | undefined;
        if (r.shown && typeof r.value === "number" && binding.inputMax !== binding.inputMin) {
          const t = Math.min(1, Math.max(0, (r.value - binding.inputMin) / (binding.inputMax - binding.inputMin)));
          const angle = round(binding.angleMin + t * (binding.angleMax - binding.angleMin));
          attrs.transform = `rotate(${angle} ${round(binding.pivotX)} ${round(binding.pivotY)})`;
          if (r.health === "good") motion = { kind: "rotate", angle, px: round(binding.pivotX), py: round(binding.pivotY) };
        }
        ops.push({ op: "attrs", id: binding.element, attrs, ...(motion ? { motion } : {}) });
        break;
      }
      case "belt": {
        const channel = channels.get(binding.channel);
        if (!channel) break;
        const r = resolveSample(channel, snapshot);
        const attrs = healthAttrs(r);
        let motion: Motion | undefined;
        if (r.shown && typeof r.value === "number" && encoder && encoder.countsPerM > 0 && binding.periodPx > 0 && beltScale > 0) {
          const travelPx = (r.value / encoder.countsPerM) * beltScale;
          const offset = round(((travelPx % binding.periodPx) + binding.periodPx) % binding.periodPx);
          attrs.transform = `translate(${offset} 0)`;
          if (r.health === "good") motion = { kind: "belt", offset, period: binding.periodPx };
        }
        ops.push({ op: "attrs", id: binding.element, attrs, ...(motion ? { motion } : {}) });
        break;
      }
      case "entities": {
        const type = entityTypes.get(binding.entityType);
        const health = snapshot.entities.supplied ? linkAdjusted(snapshot.entities.health, snapshot.link.state, "world_raw") : "unknown";
        const items = snapshot.entities.items.filter(e => e.type === binding.entityType).map(e => {
          const s = e.state;
          const path = String(s.path ?? "");
          const positionM = typeof s.positionM === "number" ? s.positionM : NaN;
          const p = Number.isFinite(positionM) ? paths.position(path, positionM) : null;
          const attrs: Record<string, string> = {
            "data-cb-entity": e.id,
            "data-cb-health": p ? health : "unknown",
            "data-cb-path": path || "unknown",
            "data-cb-route": s.requestedRoute === null || s.requestedRoute === undefined ? "unassigned" : String(s.requestedRoute),
            "data-cb-jammed": String(s.jammed === true),
            "aria-label": `${String(s.itemId ?? e.id)} on ${path || "unknown path"} at ${Number.isFinite(positionM) ? positionM.toFixed(3) : "unknown"} m (${p ? health : "unknown"})`
          };
          if (p) attrs.transform = `translate(${round(p.x)} ${round(p.y)})${p.angleDeg !== 0 ? ` rotate(${round(p.angleDeg)})` : ""}`;
          const motion: Motion | undefined = p && health === "good" && !p.clamped ? { kind: "pose", x: round(p.x), y: round(p.y), angle: round(p.angleDeg) } : undefined;
          if (p?.clamped) attrs["data-cb-outside"] = "true";
          const fields: Record<string, string> = {
            itemId: String(s.itemId ?? e.id),
            requestedRoute: attrs["data-cb-route"]!,
            path: path || "unknown",
            positionM: Number.isFinite(positionM) ? positionM.toFixed(3) : "unknown",
            velocityMps: typeof s.velocityMps === "number" ? s.velocityMps.toFixed(2) : "unknown",
            jammed: s.jammed === true ? "JAM" : ""
          };
          return { key: e.id, attrs, fields, ...(motion ? { motion } : {}) };
        });
        if (type) ops.push({ op: "entities", template: binding.element, container: binding.container, items });
        break;
      }
    }
  }
  ops.push({ op: "selected", equipmentId: snapshot.selection.equipmentId, entityId: snapshot.selection.entityId });
  ops.push({ op: "banner", ...bannerFor(pkg, snapshot) });
  return ops;
}

// ---------------------------------------------------------------------------------------------
// Static application (Node renderer and tests). Mirrors the in-frame runtime semantics.

export const RESERVED_FIELD_ATTR = "data-cb-field";

function stripIds(el: SvgElement): void {
  delete el.attrs.id;
  for (const child of el.children) if (child.type === "element") stripIds(child);
}

export function applyFrame(root: SvgElement, ops: readonly FrameOp[]): { missing: string[]; banner: { level: string; text: string } | null } {
  const ids = new Map<string, SvgElement>();
  for (const { el } of walk(root)) if (el.attrs.id !== undefined) ids.set(el.attrs.id, el);
  const missing: string[] = [];
  let banner: { level: string; text: string } | null = null;
  for (const op of ops) {
    if (op.op === "attrs") {
      const el = ids.get(op.id);
      if (!el) { missing.push(op.id); continue; }
      for (const [k, v] of Object.entries(op.attrs)) if (writableAttributes.includes(k)) el.attrs[k] = v;
    } else if (op.op === "text") {
      const el = ids.get(op.id);
      if (!el) { missing.push(op.id); continue; }
      el.children = [{ type: "text", text: op.text, cdata: false }];
    } else if (op.op === "entities") {
      const template = ids.get(op.template);
      const container = ids.get(op.container);
      if (!template || !container) { missing.push(!template ? op.template : op.container); continue; }
      container.children = container.children.filter(c => c.type !== "element" || c.attrs["data-cb-clone"] === undefined);
      for (const item of op.items) {
        const clone = cloneElement(template);
        stripIds(clone);
        delete clone.attrs["data-cb-template"];
        clone.attrs["data-cb-clone"] = item.key;
        for (const [k, v] of Object.entries(item.attrs)) if (writableAttributes.includes(k)) clone.attrs[k] = v;
        for (const { el } of walk(clone)) {
          const field = el.attrs[RESERVED_FIELD_ATTR];
          if (field !== undefined && Object.hasOwn(item.fields, field)) el.children = [{ type: "text", text: item.fields[field]!, cdata: false }];
        }
        container.children.push(clone);
      }
    } else if (op.op === "selected") {
      for (const { el } of walk(root)) {
        const selected = (op.equipmentId !== null && el.attrs["data-cb-equipment"] === op.equipmentId) || (op.entityId !== null && el.attrs["data-cb-entity"] === op.entityId);
        if (selected) el.attrs["data-cb-selected"] = "true"; else delete el.attrs["data-cb-selected"];
      }
    } else if (op.op === "banner") banner = { level: op.level, text: op.text };
  }
  return { missing, banner };
}

// ---------------------------------------------------------------------------------------------
// Fallback: deterministic, machine-independent equipment/signal table built from the frozen
// contract. It never draws a substitute machine and never fills in values.

export interface FallbackModel {
  title: string;
  reason: string;
  banner: { level: "info" | "warn" | "bad"; text: string } | null;
  equipment: Array<{ id: string; label: string; kind: string; values: Array<{ channel: string; signal: string; truth: string; display: string; health: Health; evidenceRef: string | null }> }>;
  entities: Array<{ id: string; label: string; display: string; health: Health; evidenceRef: string | null }>;
  entitiesSupplied: boolean;
}

export function buildFallback(pkg: Pick<LoadedPackage, "equipment" | "bindings"> & { manifest?: ViewManifest }, snapshot: ViewSnapshot | null, reason: string): FallbackModel {
  const channels = new Map(pkg.bindings.channels.map(c => [c.id, c]));
  const blank: ViewSnapshot | null = snapshot;
  const resolve = (channel: Channel): ResolvedSample => blank ? resolveSample(channel, blank) : { channel, value: null, health: "unknown", shown: false, display: "unknown", evidenceRef: null };
  const entityHealth: Health = snapshot && snapshot.entities.supplied ? linkAdjusted(snapshot.entities.health, snapshot.link.state, "world_raw") : "unknown";
  return {
    title: "Generated machine view unavailable: showing contract fallback",
    reason,
    banner: snapshot && pkg.manifest ? bannerFor(pkg as LoadedPackage, snapshot) : null,
    equipment: pkg.equipment.equipment.map(e => ({
      id: e.id, label: e.label, kind: e.kind,
      values: e.channels.map(id => channels.get(id)).filter((c): c is Channel => Boolean(c)).map(c => {
        const r = resolve(c);
        return { channel: c.id, signal: c.signal, truth: truthLabels[c.source], display: r.display, health: r.health, evidenceRef: r.evidenceRef };
      })
    })),
    entities: (snapshot?.entities.items ?? []).map(e => ({
      id: e.id,
      label: String(e.state.itemId ?? e.id),
      display: `${String(e.state.path ?? "unknown")} @ ${typeof e.state.positionM === "number" ? e.state.positionM.toFixed(3) : "unknown"} m`,
      health: entityHealth,
      evidenceRef: e.evidenceRef ?? null
    })),
    entitiesSupplied: Boolean(snapshot?.entities.supplied)
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderFallbackHtml(model: FallbackModel): string {
  const rows = model.equipment.map(e => `<tr><th scope="row" data-equipment="${esc(e.id)}">${esc(e.label)}<br><small>${esc(e.kind)}</small></th><td>${e.values.map(v =>
    `<span class="v h-${v.health}" title="${esc(`${v.truth}${v.evidenceRef ? ` · ${v.evidenceRef}` : ""}`)}"><code>${esc(v.signal)}</code> ${esc(v.display)} <em>${esc(v.health)}</em></span>`).join(" ")}</td></tr>`).join("");
  const entities = model.entitiesSupplied
    ? (model.entities.length ? model.entities.map(e => `<li class="h-${e.health}">${esc(e.label)}: ${esc(e.display)} <em>${esc(e.health)}</em></li>`).join("") : "<li>none present</li>")
    : "<li class=\"h-unknown\">positions not supplied: unknown</li>";
  return `<section class="cb-fallback" role="status"><h3>${esc(model.title)}</h3><p>${esc(model.reason)}</p>${model.banner ? `<p class="banner ${model.banner.level}">${esc(model.banner.text)}</p>` : ""}<table><tbody>${rows}</tbody></table><h4>Entities</h4><ul>${entities}</ul></section>`;
}

export type { Binding };
