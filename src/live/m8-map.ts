import { readFileSync } from "node:fs";
import type { GeneratedWorldModule, RawValue, WorldSignal } from "../proof/contracts.ts";

export interface M8Signal { logical: string; iecPath: string; iecType: string; access: string; required: boolean }
export const m8Map = JSON.parse(readFileSync(new URL("../../codesys/demo/signal-map-v1.json", import.meta.url), "utf8")) as {
  mapVersion: string; endpoint: string; signals: M8Signal[];
};
export const boolInputs = ["PE_Entry", "PE_D1Approach", "PE_D2Approach", "PE_ExitA", "PE_ExitB", "PE_Runout", "D1_HomeFB", "D1_ExtendedFB", "D2_HomeFB", "D2_ExtendedFB", "Drive_RunningFB", "Drive_Overload", "ExitA_Ready", "ExitB_Ready", "Runout_Ready"];
export const realInputs = ["Belt_SpeedActual", "Drive_Current", "D1_Position", "D2_Position"];
export const rawInputs = [...boolInputs, ...realInputs, "Encoder_Count"];
export const outputIds = ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"];
export const controllerSignals = m8Map.signals.filter(s => s.logical.startsWith("controller.") && !outputIds.includes(s.logical.slice(11)) &&
  ["BOOL", "UINT", "UDINT", "STRING(16)", "STRING(80)"].includes(s.iecType));
export const observedSignals = [...m8Map.signals.filter(s => outputIds.includes(s.logical)), ...controllerSignals];
export const requiredSignals = m8Map.signals.filter(s => s.required);
export const writeSignals = m8Map.signals.filter(s => s.access === "readWrite" && /^(GVL_BenchWrite|GVL_DemoWrite)\./.test(s.iecPath));
export const byLogical = new Map(m8Map.signals.map(s => [s.logical, s]));
export const byPath = new Map(m8Map.signals.map(s => [s.iecPath, s]));
export function signalByLeaf(name: string): M8Signal {
  const signal = m8Map.signals.find(s => s.iecPath.startsWith("GVL_BenchRead.") && s.iecPath.split(".").at(-1) === name)
    ?? m8Map.signals.find(s => s.iecPath.startsWith("GVL_BenchWrite.") && s.iecPath.split(".").at(-1) === name)
    ?? m8Map.signals.find(s => s.iecPath === `GVL_DemoWrite.${name}` || s.iecPath === `GVL_DemoRead.${name}`);
  if (!signal) throw new Error(`Unknown M8 signal ${name}`); return signal;
}
export function validateM8Image(candidate: Readonly<Record<string, RawValue>>): Record<string, RawValue> {
  if (Object.keys(candidate).length !== rawInputs.length || rawInputs.some(k => !Object.hasOwn(candidate, k))) throw new Error("M8 requires the exact complete 20-input image");
  const image: Record<string, RawValue> = {};
  for (const k of boolInputs) { if (typeof candidate[k] !== "boolean") throw new Error(`${k} requires BOOL`); image[k] = candidate[k]; }
  for (const k of realInputs) { if (typeof candidate[k] !== "number" || !Number.isFinite(candidate[k]) || !Number.isFinite(Math.fround(candidate[k] as number))) throw new Error(`${k} requires finite Float32`); image[k] = Math.fround(candidate[k] as number); }
  const count = candidate.Encoder_Count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 0xffffffff) throw new Error("Encoder_Count requires UDINT");
  image.Encoder_Count = count; return image;
}
export function withM8Observations(world: GeneratedWorldModule): GeneratedWorldModule {
  const signals: WorldSignal[] = controllerSignals.map(s => ({ id: s.logical, name: s.logical, direction: "plc_to_world",
    dataType: s.iecType.startsWith("STRING") ? "STRING" : s.iecType as "BOOL" | "UINT" | "UDINT",
    normalValue: s.iecType === "BOOL" ? false : s.iecType.startsWith("STRING") ? "" : 0,
    deviceId: "m8-controller", role: `observed.${s.logical}`, description: `Observed internal signal ${s.iecPath}; ${s.iecType}` }));
  return { ...world, manifest: { ...world.manifest, signals: [...world.manifest.signals, ...signals] } };
}
