import type { RawValue, WorldManifest, WorldSignal } from "./contracts.ts";

const rawTypes = new Set(["BOOL", "SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid world manifest: ${message}`);
}

function valueMatchesType(value: RawValue, type: WorldSignal["dataType"]): boolean {
  if (value === null) return false;
  if (type === "BOOL") return typeof value === "boolean";
  if (type === "STRING") return typeof value === "string";
  return typeof value === "number" && Number.isFinite(value);
}

export function validateManifest(candidate: unknown): WorldManifest {
  assert(candidate && typeof candidate === "object", "root must be an object");
  const manifest = candidate as WorldManifest;
  for (const key of ["packageVersion", "stateSchemaVersion", "worldId", "name"] as const) {
    assert(typeof manifest[key] === "string" && manifest[key].length > 0, `${key} is required`);
  }
  assert(Number.isInteger(manifest.tickMs) && manifest.tickMs >= 10 && manifest.tickMs <= 1000, "tickMs must be an integer from 10 to 1000");
  assert(Array.isArray(manifest.signals) && manifest.signals.length > 0, "signals must not be empty");
  assert(Array.isArray(manifest.controls), "controls must be an array");
  assert(Array.isArray(manifest.inspectableState), "inspectableState must be an array");
  assert(Array.isArray(manifest.assumptions), "assumptions must be an array");
  assert(Array.isArray(manifest.faultCapabilities), "faultCapabilities must be an array");
  assert(Array.isArray(manifest.evidenceTypes), "evidenceTypes must be an array");
  assert(manifest.capabilities?.snapshot === true, "snapshot capability is required");
  assert(manifest.capabilities?.migrate === true, "migrate capability is required");
  assert(manifest.capabilities?.seededRandom === true, "seededRandom capability is required");

  const ids = new Set<string>();
  const roles = new Set<string>();
  for (const signal of manifest.signals) {
    assert(typeof signal.id === "string" && signal.id.length > 0, "every signal needs an id");
    assert(!ids.has(signal.id), `duplicate signal id ${signal.id}`);
    ids.add(signal.id);
    assert(typeof signal.name === "string" && signal.name.length > 0, `${signal.id} needs a name`);
    assert(signal.direction === "plc_to_world" || signal.direction === "world_to_plc", `${signal.id} has an invalid direction`);
    assert(rawTypes.has(signal.dataType), `${signal.id} has unsupported dataType ${signal.dataType}`);
    assert(valueMatchesType(signal.normalValue, signal.dataType), `${signal.id} normalValue does not match ${signal.dataType}`);
    assert(typeof signal.deviceId === "string" && signal.deviceId.length > 0, `${signal.id} needs a deviceId`);
    assert(typeof signal.role === "string" && signal.role.length > 0, `${signal.id} needs a role`);
    assert(!roles.has(signal.role), `duplicate signal role ${signal.role}`);
    roles.add(signal.role);
    assert(typeof signal.description === "string", `${signal.id} needs a description`);
  }

  const controlIds = new Set<string>();
  for (const control of manifest.controls) {
    assert(typeof control.id === "string" && control.id.length > 0, "every control needs an id");
    assert(!controlIds.has(control.id), `duplicate control id ${control.id}`);
    controlIds.add(control.id);
    assert(typeof control.description === "string" && control.description.length > 0, `${control.id} needs a description`);
  }
  return manifest;
}

export function signalByRole(manifest: WorldManifest, role: string): WorldSignal {
  const signal = manifest.signals.find((entry) => entry.role === role);
  if (!signal) throw new Error(`World manifest does not declare signal role ${role}`);
  return signal;
}
