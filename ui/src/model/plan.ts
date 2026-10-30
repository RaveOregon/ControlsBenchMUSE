import type { EvidenceClass } from "./events.ts";

export type PlanGroupId = "io" | "startup" | "functional" | "runtime" | "faults" | "normal" | "edge" | "adaptive";

export interface PlanGroup {
  id: PlanGroupId;
  title: string;
  blurb: string;
}

/** Where a check's evidence can come from in this build. */
export type CheckAvailability =
  | "recorded" // a preserved Gate A-D or M0-M2 record backs it; replay can present it
  | "awaiting_live"; // needs the live connector/coordinator (M3-M7); replay will finish it as not run

export interface PlanCheck {
  id: string;
  /** "evidence" is the closing preservation step shown beneath the eight engineering groups. */
  group: PlanGroupId | "evidence";
  title: string;
  requirement?: string;
  manipulate: string;
  observe: string;
  oracle: string;
  evidenceClass: EvidenceClass;
  availability: CheckAvailability;
  /** Human-readable pointer to the preserved record or the measurement it awaits. */
  evidenceSource: string;
  addedBy: "plan" | "muse";
  /** Checks that must also be in scope for this one to run. */
  dependsOn?: string[];
}

export const PLAN_GROUPS: readonly PlanGroup[] = [
  { id: "io", title: "I/O checks", blurb: "Transport, access rights, and raw typed values at the interceptor boundary." },
  { id: "startup", title: "Startup and mode checks", blurb: "Zero-image simulation start and drive command/feedback causality." },
  { id: "functional", title: "Functional checks", blurb: "Routing by actual divert position: A, B, missed divert, unassigned runout." },
  { id: "runtime", title: "Runtime and timing checks", blurb: "Raw encoder counts, commit/acknowledgement latency, rate and task impact, not-hung guards." },
  { id: "faults", title: "Alarms, faults, and recovery", blurb: "Injected sensor, drive, and divert faults with cleanup; PLC restart identity." },
  { id: "normal", title: "Normal operation", blurb: "Carton travel, sensor geometry, decelerating stop and hold." },
  { id: "edge", title: "Edge and stress checks", blurb: "Rejected payloads, adversarial sequencing, contradictory inputs." },
  { id: "adaptive", title: "Adaptive investigations", blurb: "Blind diagnosis and follow-ups Muse adds from what it observes." }
];

export const PLAN_CHECKS: readonly PlanCheck[] = [
  {
    id: "IO-1",
    group: "io",
    title: "Authenticated OPC UA session and access rights",
    manipulate: "Open a SignAndEncrypt session; write a writable probe and two read-only symbols.",
    observe: "Endpoint identity, user token policy, write status codes, PLC cycle advance, negotiated intervals.",
    oracle: "Writable probe echoes; read-only symbols reject with BadNotWritable; PLC cycle advances.",
    evidenceClass: "plc_measurement",
    availability: "recorded",
    evidenceSource: "codesys/artifacts/m0-opcua-session.json (M0)",
    addedBy: "plan"
  },
  {
    id: "IO-2",
    group: "io",
    title: "Typed raw scalar round-trip (15 BOOL, 4 REAL, 1 UDINT)",
    manipulate: "Commit zero, one, bound, UDINT max, and rollover images through the double-buffered slots.",
    observe: "Application-visible active image, applied epoch/sequence, PLC output types.",
    oracle: "Every mapped signal round-trips bit-exact at its declared width; outputs exposed as BOOL.",
    evidenceClass: "plc_measurement",
    availability: "recorded",
    evidenceSource: "codesys/artifacts/m1-opcua-result.json (M1)",
    addedBy: "plan"
  },
  {
    id: "SM-1",
    group: "startup",
    title: "Zero-image startup",
    requirement: "Sim activation",
    manipulate: "Initialize the complete world-to-PLC image to false/zero before world readiness.",
    observe: "Initial raw effects and their causes, world activity, snapshot schema.",
    oracle: "World starts coherently with every startup raw effect attributed.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-a-trace.json (CP-1)",
    addedBy: "plan"
  },
  {
    id: "SM-2",
    group: "startup",
    title: "Drive command/feedback causality",
    requirement: "R-01",
    manipulate: "Surrogate PLC drives Motor_RunCmd false → true → false → true.",
    observe: "Drive_RunningFB delay, belt speed, encoder counts.",
    oracle: "Feedback and motion follow the observed command through declared drive dynamics only.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-a-trace.json (CP-2)",
    addedBy: "plan"
  },
  {
    id: "FN-1",
    group: "functional",
    title: "Carton assigned A diverts at D1 by actual position",
    requirement: "R-02",
    manipulate: "Introduce carton CP5-A with D1_ExtendCmd asserted before the decision point.",
    observe: "D1 limit feedback, photoeye sequence, carton path, exit evidence.",
    oracle: "Carton physically exits A because D1 was actually extended at the interaction time.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-b-trace.json · cp5-routed-a (CP-5)",
    addedBy: "plan"
  },
  {
    id: "FN-2",
    group: "functional",
    title: "Requested A without divert actuation reaches runout",
    requirement: "R-13",
    manipulate: "Introduce carton CP5-MISSED-A requesting A with no D1 command.",
    observe: "Carton path past D1 and D2, runout photoeye, exit evidence.",
    oracle: "The world does not honour the requested route; the carton runs out (a misroute for the PLC to report).",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-b-trace.json · cp5-missed-a (CP-5)",
    addedBy: "plan"
  },
  {
    id: "FN-3",
    group: "functional",
    title: "Carton assigned B passes D1 and diverts at D2",
    requirement: "R-03",
    manipulate: "Introduce carton CP6-B with D2_ExtendCmd asserted.",
    observe: "D2 travel and limits, D2 approach and exit B photoeyes.",
    oracle: "Carton physically exits B; D1 remains home.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-b-trace.json · cp6-routed-b (CP-6)",
    addedBy: "plan"
  },
  {
    id: "FN-4",
    group: "functional",
    title: "Unassigned carton runs out",
    requirement: "R-04",
    manipulate: "Introduce an unassigned carton with both diverts home.",
    observe: "Photoeye sequence to runout and exit evidence.",
    oracle: "Carton continues straight to runout as a normal disposition.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-b-trace.json · cp6-runout (CP-6)",
    addedBy: "plan"
  },
  {
    id: "FN-5",
    group: "functional",
    title: "PLC routing decisions against the real controller",
    requirement: "R-02 – R-04",
    manipulate: "Drive the same world through the live interceptor with WCS route offers.",
    observe: "Actual PLC divert commands, completion counts, misroute reporting.",
    oracle: "PLC routes A/B/runout correctly from real outputs (not surrogate fixtures).",
    evidenceClass: "world_model",
    availability: "awaiting_live",
    evidenceSource: "Awaits M7 closed-loop slice",
    addedBy: "plan"
  },
  {
    id: "RT-1",
    group: "runtime",
    title: "Raw encoder counts from physical travel",
    manipulate: "Run the belt for controlled intervals, then stop.",
    observe: "Encoder_Count raw UDINT before and after, including coast.",
    oracle: "Counts derive from continuous motion (1000/m, floored, wraps 2^32) and stop once motion settles.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-a-trace.json (CP-3)",
    addedBy: "plan"
  },
  {
    id: "RT-2",
    group: "runtime",
    title: "Coherent image commit and acknowledgement latency",
    manipulate: "Stream 10,000 alternating images through alternating staging slots.",
    observe: "Applied sequence echo, per-commit latency, PLC output-capture cycle.",
    oracle: "Zero torn images; complete sequence coverage; latency distribution recorded.",
    evidenceClass: "plc_measurement",
    availability: "recorded",
    evidenceSource: "codesys/artifacts/m2-coherence-trace.jsonl (M2)",
    addedBy: "plan"
  },
  {
    id: "RT-3",
    group: "runtime",
    title: "Sustained-rate tier (5/10/20/50 Hz)",
    manipulate: "Stream images for ten minutes per rate at 1×, 2×, and full signal counts.",
    observe: "Send-to-applied latency, loss/coalescing, IEC cycle and jitter.",
    oracle: "Methodical ≥10 Hz p99 ≤250 ms; runtime 20 Hz 99.9% ≤150 ms.",
    evidenceClass: "plc_measurement",
    availability: "awaiting_live",
    evidenceSource: "Awaits M3",
    addedBy: "plan"
  },
  {
    id: "RT-4",
    group: "runtime",
    title: "PLC task impact",
    manipulate: "Compare disconnected, subscribed, methodical, runtime, and maximum demo load.",
    observe: "IEC cycle interval p99, absolute jitter, watchdog/omitted cycles.",
    oracle: "No watchdog; p99 interval and jitter within 1.20× disconnected baseline.",
    evidenceClass: "plc_measurement",
    availability: "awaiting_live",
    evidenceSource: "Awaits M6",
    addedBy: "plan"
  },
  {
    id: "RT-5",
    group: "runtime",
    title: "Not-hung and budget guards",
    manipulate: "Exercise slow request, repeated failed repair, exhausted budget, stalled heartbeat, held wait.",
    observe: "Guard classification, elapsed time, preserved world version.",
    oracle: "Each case is distinguished; hard limits stop model calls and preserve state.",
    evidenceClass: "audit",
    availability: "recorded",
    evidenceSource: "gate-c-result.json (CP-11)",
    addedBy: "plan"
  },
  {
    id: "FR-1",
    group: "faults",
    title: "Photoeye stuck-high and bounce",
    requirement: "R-09, R-10",
    manipulate: "Hold PE_Entry stuck true, clear, then bounce it for 240 ms.",
    observe: "Raw PE_Entry versus physical occupancy; fault evidence and cleanup.",
    oracle: "Committed fault changes raw behaviour only; cleanup restores physical derivation.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-b-trace.json · cp7-sensor (CP-7)",
    addedBy: "plan"
  },
  {
    id: "FR-2",
    group: "faults",
    title: "Run command without drive feedback",
    requirement: "R-11",
    manipulate: "Suppress Drive_RunningFB while Motor_RunCmd is true; introduce a carton.",
    observe: "Drive feedback, encoder, carton motion; recovery after clear.",
    oracle: "No feedback, no motion, encoder held at 0; drive recovers after cleanup.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-b-trace.json · cp7-drive (CP-7)",
    addedBy: "plan"
  },
  {
    id: "FR-3",
    group: "faults",
    title: "Divert 1 jammed home",
    requirement: "R-13",
    manipulate: "Jam D1 then command D1_ExtendCmd.",
    observe: "D1 limits and position despite command; recovery after clear.",
    oracle: "D1 stays home under command while jammed and travels after cleanup.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-b-trace.json · cp7-divert (CP-7)",
    addedBy: "plan"
  },
  {
    id: "FR-4",
    group: "faults",
    title: "PLC cold restart requires a new boot identity and epoch",
    manipulate: "Operator cold reset between M2 phases; workstation opens a fresh epoch.",
    observe: "Boot identity, cleared epoch/sequence state, first post-restart commit.",
    oracle: "New boot identity observed; old continuity not inferred; sequence 1 accepted in a new epoch.",
    evidenceClass: "plc_measurement",
    availability: "recorded",
    evidenceSource: "codesys/artifacts/m2-opcua-result.json (M2 post-restart)",
    addedBy: "plan"
  },
  {
    id: "FR-5",
    group: "faults",
    title: "Connector loss holds the last simulated image",
    requirement: "R-21",
    manipulate: "Drop client, server, adapter, and subscription during simulation.",
    observe: "BenchLinkStale, held image, reconnect commit behaviour.",
    oracle: "PLC holds last image, stays simulated, flags stale after max(500 ms, 3× publish).",
    evidenceClass: "plc_measurement",
    availability: "awaiting_live",
    evidenceSource: "Awaits M5",
    addedBy: "plan"
  },
  {
    id: "NO-1",
    group: "normal",
    title: "Carton travel, sensor geometry, decelerating stop and hold",
    requirement: "R-01",
    manipulate: "Introduce a carton on a running belt, then remove the run command.",
    observe: "Continuous carton position, PE_Entry occupancy, coast distance, settle time.",
    oracle: "Belt decelerates and coasts per declared dynamics, then carton and sensors hold.",
    evidenceClass: "surrogate_contract",
    availability: "recorded",
    evidenceSource: "gate-a-trace.json (CP-4)",
    addedBy: "plan"
  },
  {
    id: "NO-2",
    group: "normal",
    title: "Closed-loop conveyor slice on the real PLC",
    manipulate: "Start, accelerate, move one carton through a photoeye, stop, hold — through the interceptor.",
    observe: "Command → world response → raw commit → PLC ack → PLC output, every edge attributed.",
    oracle: "Live trace correlates each edge; surrogate and live evidence remain separately labeled.",
    evidenceClass: "world_model",
    availability: "awaiting_live",
    evidenceSource: "Awaits M7",
    addedBy: "plan"
  },
  {
    id: "ES-1",
    group: "edge",
    title: "Invalid payloads rejected without changing the active image",
    manipulate: "Commit negative belt speed, non-finite current, and out-of-range divert position.",
    observe: "Active image, InvalidPayload diagnostic counter.",
    oracle: "Each is rejected and attributed; the active image is unchanged.",
    evidenceClass: "plc_measurement",
    availability: "recorded",
    evidenceSource: "codesys/artifacts/m1-opcua-result.json (M1)",
    addedBy: "plan"
  },
  {
    id: "ES-2",
    group: "edge",
    title: "Adversarial sequencing: duplicate, stale, skipped, invalid, old epoch",
    manipulate: "Send duplicate, stale, skipped, invalid-slot, incomplete, premature-valid, mismatched, reconnect, and old-epoch commits.",
    observe: "Applied sequence and each diagnostic counter.",
    oracle: "Rejected commits leave the active image unchanged and increment exactly the expected counter once.",
    evidenceClass: "plc_measurement",
    availability: "recorded",
    evidenceSource: "codesys/artifacts/m2-opcua-result.json (M2)",
    addedBy: "plan"
  },
  {
    id: "ES-3",
    group: "edge",
    title: "Contradictory limits and impossible exit combinations",
    requirement: "R-15, R-16",
    manipulate: "Force both D1 limits true; assert two exit photoeyes with one carton.",
    observe: "PLC alarm/diagnostic response and counts.",
    oracle: "No verified-divert claim and no double completion (PROBE: report observation and uncertainty).",
    evidenceClass: "world_model",
    availability: "awaiting_live",
    evidenceSource: "World supports fault.setContradictoryLimits; no PLC run recorded yet",
    addedBy: "plan"
  },
  {
    id: "AI-1",
    group: "adaptive",
    title: "Blind diagnosis of a hidden committed fault",
    manipulate: "Commit hidden fault truth, then give a fresh filtered Muse context only permitted observations.",
    observe: "Muse hypotheses, evidence citations, seal ordering, truth reveal.",
    oracle: "Diagnosis sealed before reveal; scoring distinguishes correct, incorrect, insufficient evidence.",
    evidenceClass: "agent_record",
    availability: "recorded",
    evidenceSource: "gate-c/* (CP-8)",
    addedBy: "plan"
  },
  {
    id: "AI-3",
    group: "adaptive",
    title: "World revision with hot reload and rollback",
    manipulate: "Muse revises the world while the incumbent runs; a deliberately failing successor follows.",
    observe: "Compile/check, state migration hash, activation, rollback disposition.",
    oracle: "Valid candidate activates with preserved state; failing candidate rolls back to the healthy module.",
    evidenceClass: "agent_record",
    availability: "recorded",
    evidenceSource: "gate-c-result.json (CP-10)",
    addedBy: "plan"
  }
];

/** Investigations that Muse adds during a run; they are not in the initial plan. */
export const MUSE_ADDED_CHECKS: Readonly<Record<string, PlanCheck>> = {
  "AI-2": {
    id: "AI-2",
    group: "adaptive",
    title: "Belt-motion discrimination experiment",
    manipulate: "Muse-authored: hold diverts home, run the belt for a bounded 4 s, then stop.",
    observe: "Entry indication, downstream photoeyes, encoder, belt speed, drive feedback.",
    oracle: "Reduce uncertainty between a real stationary carton and an entry indication stuck true.",
    evidenceClass: "agent_record",
    availability: "recorded",
    evidenceSource: "gate-c/followup-observations.json (CP-9)",
    addedBy: "muse",
    dependsOn: ["AI-1"]
  }
};

/** Deterministic audit that closes the campaign and preserves evidence. */
export const EVIDENCE_AUDIT_CHECK: PlanCheck = {
  id: "EV-1",
  group: "evidence",
  title: "Evidence package audit",
  manipulate: "Re-hash package, lineage, traces, model-call accounting, and verdicts.",
  observe: "12 deterministic audit checks and disclosed warnings.",
  oracle: "No critical gap; warnings disclosed rather than hidden.",
  evidenceClass: "audit",
  availability: "recorded",
  evidenceSource: "gate-d-result.json (CP-12)",
  addedBy: "plan"
};

export function allPlannedChecks(): PlanCheck[] {
  return [...PLAN_CHECKS, EVIDENCE_AUDIT_CHECK];
}

export function findCheck(id: string): PlanCheck | undefined {
  return allPlannedChecks().find((check) => check.id === id) ?? MUSE_ADDED_CHECKS[id];
}

/** Default scope: everything planned. Engineers narrow it before Start Campaign. */
export function defaultScope(): Record<string, boolean> {
  return Object.fromEntries(allPlannedChecks().map((check) => [check.id, true]));
}
