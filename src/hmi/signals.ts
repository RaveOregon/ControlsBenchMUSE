// HMI view of the versioned M8 map: what the HMI reads, the four operator paths it may write,
// and the M8 fault/precondition rules quoted from codesys/demo (README fault table and
// FB_DemoConveyor). Derived explanations are labelled as HMI evaluations; the PLC stays the authority.

import { m8Map, rawInputs } from "../live/m8-map.ts";
import type { M8Signal } from "../live/m8-map.ts";
import type { PreconditionView, Scalar } from "./protocol.ts";

export const MAP_VERSION = m8Map.mapVersion;
export const EXPECTED_BUILD_ID = 8001;
export const EXPECTED_INTERFACE_VERSION = 1;

/** Every value the HMI displays. Optional map fields are not resolved by the M8 transport and are omitted. */
export const hmiReadSignals: M8Signal[] = m8Map.signals.filter(s => s.required && (
  s.iecPath.startsWith("GVL_BenchRead.") || s.iecPath.startsWith("GVL_DemoRead.") || s.iecPath.startsWith("GVL_DemoWrite.") ||
  ["GVL_BenchWrite.SimRequest", "GVL_BenchWrite.WorkstationHeartbeat", "GVL_BenchWrite.RequestedEpoch", "GVL_BenchWrite.RequestedSequence", "GVL_BenchWrite.RequestedSlot"].includes(s.iecPath)));
export const hmiReadPaths = hmiReadSignals.map(s => s.iecPath);
export const signalType = new Map(m8Map.signals.map(s => [s.iecPath, s.iecType]));

/**
 * The only paths this HMI may write: the M8 operator requests. Field-input images, the bench
 * handshake, simulation selection and WCS fields belong to other owners and are never written here.
 */
export const HMI_WRITE_ALLOWLIST = new Set([
  "GVL_DemoWrite.StartSequence", "GVL_DemoWrite.StopSequence", "GVL_DemoWrite.ResetSequence", "GVL_DemoWrite.AutoRequest"
]);

export const P = {
  buildId: "GVL_DemoRead.BuildId", interfaceVersion: "GVL_DemoRead.InterfaceVersion",
  mode: "GVL_DemoRead.Status.Mode", modeText: "GVL_DemoRead.Status.ModeText",
  faultCode: "GVL_DemoRead.Status.FaultCode", faultText: "GVL_DemoRead.Status.FaultText",
  exceptionCode: "GVL_DemoRead.Status.ExceptionCode", exceptionText: "GVL_DemoRead.Status.ExceptionText",
  motorCmd: "GVL_DemoRead.Status.Motor_RunCmd", d1Cmd: "GVL_DemoRead.Status.D1_ExtendCmd", d2Cmd: "GVL_DemoRead.Status.D2_ExtendCmd",
  startSeq: "GVL_DemoWrite.StartSequence", stopSeq: "GVL_DemoWrite.StopSequence", resetSeq: "GVL_DemoWrite.ResetSequence", autoRequest: "GVL_DemoWrite.AutoRequest",
  startAck: "GVL_DemoRead.Status.StartAck", stopAck: "GVL_DemoRead.Status.StopAck", resetAck: "GVL_DemoRead.Status.ResetAck",
  startAccepted: "GVL_DemoRead.Status.StartAccepted", resetAccepted: "GVL_DemoRead.Status.ResetAccepted",
  itemActive: "GVL_DemoRead.Status.ItemActive", completionPending: "GVL_DemoRead.Status.CompletionPending",
  effectiveRoute: "GVL_DemoRead.Status.EffectiveRoute",
  plcCycle: "GVL_BenchRead.PlcCycle", outputCaptureCycle: "GVL_BenchRead.OutputCaptureCycle", boot: "GVL_BenchRead.PlcBootIdentity",
  simApplied: "GVL_BenchRead.SimApplied", simRequest: "GVL_BenchWrite.SimRequest", connectorStale: "GVL_BenchRead.ConnectorStale"
} as const;
export const active = (name: string) => `GVL_BenchRead.Active_${name}`;
export const ACTIVE_INPUTS = rawInputs;

/** Fault table: PLC text is authoritative; cause/response are quoted from codesys/demo/README.md. */
export const M8_FAULTS: Record<number, { cause: string; response: string; operation: string[]; engineering: string[] }> = {
  10: { cause: "Drive overload input is on.", response: "Faulted, motor off.", operation: ["motor"], engineering: ["Drive_Overload", "Drive_RunningFB"] },
  11: { cause: "Motor running feedback was not seen within 1500 ms of a start.", response: "Faulted, motor off.", operation: ["motor"], engineering: ["Drive_RunningFB", "Motor_RunCmd"] },
  12: { cause: "Motor running feedback dropped for more than 500 ms while running.", response: "Faulted, motor off.", operation: ["motor"], engineering: ["Drive_RunningFB", "Motor_RunCmd"] },
  13: { cause: "Drive feedback or encoder did not reach rest within 4 s of Stop.", response: "Faulted, motor off.", operation: ["motor"], engineering: ["Drive_RunningFB", "Encoder_Count"] },
  21: { cause: "D1 home and extended limits are both on.", response: "Faulted.", operation: ["d1"], engineering: ["D1_HomeFB", "D1_ExtendedFB"] },
  22: { cause: "D2 home and extended limits are both on.", response: "Faulted.", operation: ["d2"], engineering: ["D2_HomeFB", "D2_ExtendedFB"] },
  23: { cause: "D1 extended feedback was absent 1200 ms after the extend command.", response: "Faulted; drive and divert commands removed; active carton aborted.", operation: ["d1"], engineering: ["D1_ExtendCmd", "D1_ExtendedFB", "D1_HomeFB"] },
  24: { cause: "D2 extended feedback was absent 1200 ms after the extend command.", response: "Faulted; drive and divert commands removed; active carton aborted.", operation: ["d2"], engineering: ["D2_ExtendCmd", "D2_ExtendedFB", "D2_HomeFB"] },
  25: { cause: "D1 home feedback was absent 1200 ms after the return command (Auto/Stopping).", response: "Faulted.", operation: ["d1"], engineering: ["D1_ExtendCmd", "D1_HomeFB"] },
  26: { cause: "D2 home feedback was absent 1200 ms after the return command (Auto/Stopping).", response: "Faulted.", operation: ["d2"], engineering: ["D2_ExtendCmd", "D2_HomeFB"] },
  27: { cause: "An assigned exit was observed without verified divert limits.", response: "Faulted; no false sort success.", operation: ["item"], engineering: ["PE_ExitA", "PE_ExitB", "D1_ExtendedFB", "D2_ExtendedFB"] },
  30: { cause: "Unexpected entry: a second carton or entry while not ready (single-carton capacity).", response: "Faulted.", operation: ["item"], engineering: ["PE_Entry"] },
  31: { cause: "Multiple exit beams for one carton.", response: "Faulted.", operation: ["item"], engineering: ["PE_ExitA", "PE_ExitB", "PE_Runout"] },
  32: { cause: "An exit beam was seen without an active tracked carton.", response: "Faulted.", operation: ["item"], engineering: ["PE_ExitA", "PE_ExitB", "PE_Runout"] },
  33: { cause: "The active carton reached no exit for 30 s continuously in Auto.", response: "Faulted; active carton aborted.", operation: ["item"], engineering: ["PE_Entry", "PE_D1Approach", "PE_D2Approach"] },
  34: { cause: "Runout became unavailable while in Auto.", response: "Faulted, motor off.", operation: ["destinations"], engineering: ["Runout_Ready"] }
};
export const M8_EXCEPTIONS: Record<number, { cause: string; response: string }> = {
  1: { cause: "Assigned route unavailable or assignment too late; the carton uses runout.", response: "Non-stopping exception; recorded on the completion." },
  2: { cause: "Observed exit differs from the requested route.", response: "Non-stopping exception; misroute counted." }
};
export function faultInfo(code: number) {
  return M8_FAULTS[code] ?? { cause: "Code not in the M8 fault table for map " + MAP_VERSION + ". See the PLC text.", response: "Unknown.", operation: [], engineering: [] };
}

export const ENUMS = m8Map as unknown as { enums: Record<string, Record<string, string>> };
export const enumText = (kind: "mode" | "route" | "exit" | "disposition", value: Scalar) =>
  value === null || value === undefined ? "—" : (ENUMS.enums[kind]?.[String(value)] ?? `Code ${value}`);

type Values = Record<string, Scalar>;
const beamNames = ["PE_Entry", "PE_D1Approach", "PE_D2Approach", "PE_ExitA", "PE_ExitB", "PE_Runout"];
const flag = (v: Values, path: string): boolean | null => typeof v[path] === "boolean" ? v[path] as boolean : null;
const all = (...xs: Array<boolean | null>) => xs.some(x => x === null) ? null : xs.every(Boolean);
const none = (...xs: Array<boolean | null>) => xs.some(x => x === null) ? null : !xs.some(Boolean);
const show = (x: Scalar | undefined) => x === undefined ? "unread" : String(x);

/** HMI evaluation of FB_DemoConveyor readyToStart over observed active inputs. */
function readyToStart(v: Values): PreconditionView[] {
  return [
    { id: "overload", label: "Drive overload clear", met: none(flag(v, active("Drive_Overload"))), observed: `Drive_Overload=${show(v[active("Drive_Overload")])}` },
    { id: "d1_home", label: "D1 home, not extended", met: all(flag(v, active("D1_HomeFB")), none(flag(v, active("D1_ExtendedFB")))), observed: `home=${show(v[active("D1_HomeFB")])} ext=${show(v[active("D1_ExtendedFB")])}` },
    { id: "d2_home", label: "D2 home, not extended", met: all(flag(v, active("D2_HomeFB")), none(flag(v, active("D2_ExtendedFB")))), observed: `home=${show(v[active("D2_HomeFB")])} ext=${show(v[active("D2_ExtendedFB")])}` },
    { id: "runout", label: "Runout ready", met: flag(v, active("Runout_Ready")), observed: `Runout_Ready=${show(v[active("Runout_Ready")])}` }
  ];
}
function beamsClear(v: Values): PreconditionView {
  const blocked = beamNames.filter(n => v[active(n)] === true);
  return { id: "beams", label: "All photo-eyes clear", met: none(...beamNames.map(n => flag(v, active(n)))), observed: blocked.length ? `blocked: ${blocked.join(", ")}` : "clear" };
}
function completion(v: Values): PreconditionView {
  return { id: "completion", label: "Completion acknowledged by WCS", met: none(flag(v, P.completionPending)), observed: `CompletionPending=${show(v[P.completionPending])}` };
}

export function startPreconditions(v: Values): PreconditionView[] {
  const mode = v[P.mode];
  const resume = v[P.itemActive] === true;
  return [
    { id: "mode", label: "Mode is Stopped", met: mode === undefined ? null : mode === 0, observed: `Mode=${enumText("mode", mode ?? null)}` },
    { id: "auto", label: "Auto request is on", met: flag(v, P.autoRequest), observed: `AutoRequest=${show(v[P.autoRequest])}` },
    ...(resume ? [{ id: "resume", label: "Tracked carton: resume rule applies (selected divert may be extended)", met: null, observed: "ItemActive=true" } satisfies PreconditionView] : [...readyToStart(v), beamsClear(v)]),
    completion(v)
  ];
}

export function resetPreconditions(v: Values): PreconditionView[] {
  const mode = v[P.mode];
  return [
    { id: "mode", label: "Mode is not Auto or Stopping", met: mode === undefined ? null : mode !== 1 && mode !== 2, observed: `Mode=${enumText("mode", mode ?? null)}` },
    ...readyToStart(v),
    { id: "drive", label: "Drive running feedback off", met: none(flag(v, active("Drive_RunningFB"))), observed: `Drive_RunningFB=${show(v[active("Drive_RunningFB")])}` },
    beamsClear(v),
    completion(v)
  ];
}
