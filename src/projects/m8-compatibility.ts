// Compatibility of a generated world with the configured CODESYS M8 conveyor bench interface.
//
// Activation needs the complete PLC-facing image: every raw input the workstation owns, with the
// exact direction and native type, the observed PLC outputs, the required roles and the world
// controls campaign tools rely on. Same names or the same signal count are not enough; extra or
// mistyped PLC writes block activation. Compatibility is never live qualification.

import type { WorldManifest } from "../proof/contracts.ts";
import { boolInputs, byLogical, m8Map, outputIds, rawInputs, realInputs, signalByLeaf } from "../live/m8-map.ts";
import type { Compatibility, CompatibilityIssue, IoRow, SignalMapping, UploadedMapping } from "./types.ts";

export const M8_PROFILE = { id: "m8-conveyor", interface: m8Map.mapVersion, endpoint: m8Map.endpoint, platform: "CODESYS Control Win · M8 conveyor application",
  cadenceHz: 10, note: "The workstation owns the complete simulated raw input image; on link loss it holds the last image with bench diagnostics. PLC scaling and application logic stay in the PLC." } as const;
export const REQUIRED_ROLES = ["drive.runCommand", "drive.runningFeedback", "motion.encoderCount", "sensor.entry"];
export const REQUIRED_CONTROLS = ["carton.introduce"];
/** World controls the campaign's semantic tools can reach (src/campaign/conveyor-bindings.ts). */
export const BOUND_CONTROLS = ["carton.introduce", "downstream.setReady", "fault.setDriveFeedbackFailure", "fault.setOverload", "fault.setDivertJam",
  "fault.setContradictoryLimits", "fault.setSensorStuck", "fault.setSensorBounce", "fault.setCartonJam", "fault.clearAll"];

export type { Compatibility, CompatibilityIssue, SignalMapping, UploadedMapping } from "./types.ts";

const expectedType = (id: string) => boolInputs.includes(id) ? "BOOL" : realInputs.includes(id) ? "REAL" : id === "Encoder_Count" ? "UDINT" : outputIds.includes(id) ? "BOOL" : undefined;
const m8Of = (id: string) => { try { const s = signalByLeaf(id); return { iecPath: s.iecPath, iecType: s.iecType }; } catch { const s = byLogical.get(id); return s ? { iecPath: s.iecPath, iecType: s.iecType } : undefined; } };

export function checkM8Compatibility(manifest: WorldManifest, uploaded: IoRow[] = []): Compatibility {
  const issues: CompatibilityIssue[] = [];
  const signals: SignalMapping[] = [];
  const byId = new Map(manifest.signals.map(s => [s.id, s]));
  for (const id of [...rawInputs, ...outputIds]) {
    const want = expectedType(id)!, dir = rawInputs.includes(id) ? "world_to_plc" : "plc_to_world", s = byId.get(id);
    if (!s) { issues.push({ severity: "blocking", code: "missing_signal", signal: id, message: `${id} (${dir === "world_to_plc" ? "raw input" : "PLC output"}, ${want}) is missing from the generated world` });
      signals.push({ id, direction: dir, dataType: want, role: "", m8: m8Of(id), status: "missing" }); continue; }
    const status = s.direction !== dir ? "direction_mismatch" : s.dataType !== want ? "type_mismatch" : "mapped";
    if (status !== "mapped") issues.push({ severity: "blocking", code: status, signal: id, message: `${id} is ${s.direction}/${s.dataType}; the M8 interface needs ${dir}/${want}` });
    signals.push({ id, direction: s.direction, dataType: s.dataType, role: s.role, m8: m8Of(id), status });
  }
  for (const s of manifest.signals) {
    if (rawInputs.includes(s.id) || outputIds.includes(s.id)) continue;
    if (s.direction === "world_to_plc") {
      issues.push({ severity: "blocking", code: "extra_plc_write", signal: s.id, message: `${s.id} would be written to the PLC but has no M8 raw-input slot` });
      signals.push({ id: s.id, direction: s.direction, dataType: s.dataType, role: s.role, status: "extra" });
    } else {
      issues.push({ severity: "warning", code: "unobservable_output", signal: s.id, message: `${s.id} is read by the world but the M8 interface does not publish it; the world will never observe it` });
      signals.push({ id: s.id, direction: s.direction, dataType: s.dataType, role: s.role, status: "unobservable" });
    }
  }
  const roles = new Set(manifest.signals.map(s => s.role));
  for (const role of REQUIRED_ROLES) if (!roles.has(role)) issues.push({ severity: "blocking", code: "missing_role", message: `Required role ${role} is not declared` });
  const declared = manifest.controls.map(c => c.id);
  const missingRequired = REQUIRED_CONTROLS.filter(c => !declared.includes(c));
  for (const c of missingRequired) issues.push({ severity: "blocking", code: "missing_control", message: `World control ${c} is required by the campaign tools` });
  const unbound = declared.filter(c => !BOUND_CONTROLS.includes(c));
  for (const c of unbound) issues.push({ severity: "warning", code: "unbound_control", message: `World control ${c} is declared but no campaign tool can invoke it` });

  const names = new Set([...rawInputs, ...outputIds]);
  const uploadedMapping: UploadedMapping[] = uploaded.map(r => {
    const want = expectedType(r.name);
    if (!want) return { name: r.name, direction: r.direction, nativeType: r.nativeType, status: "not_on_interface", source: r.source };
    const dir = rawInputs.includes(r.name) ? "world_to_plc" : "plc_to_world";
    return { name: r.name, direction: r.direction, nativeType: r.nativeType, m8Type: want, source: r.source,
      status: r.direction !== "unknown" && r.direction !== dir ? "direction_differs" : r.nativeType && r.nativeType !== want ? "type_differs" : "mapped" };
  });
  for (const m of uploadedMapping.filter(m => m.status === "type_differs" || m.status === "direction_differs"))
    issues.push({ severity: "warning", code: `upload_${m.status}`, signal: m.name, message: `Uploaded I/O lists ${m.name} as ${m.direction}/${m.nativeType ?? "?"}; the M8 interface uses ${m.m8Type}` });
  const missingFromUpload = uploaded.length ? [...names].filter(n => !uploaded.some(r => r.name === n)) : [];
  const compatible = !issues.some(i => i.severity === "blocking");
  return { profile: M8_PROFILE, compatible, liveReady: false,
    liveReadyReason: compatible ? "Compatible with the M8 interface for offline campaigns. Live use needs a fresh commissioning run for this world; it does not inherit the prepared example's qualification." : "Not compatible with the M8 interface; cannot be activated.",
    issues, signals, controls: { declared, bound: declared.filter(c => BOUND_CONTROLS.includes(c)), unbound, missingRequired }, uploaded: uploadedMapping, missingFromUpload };
}
