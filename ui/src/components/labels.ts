import type { EvidenceClass, Provenance, SourceMode, TimelineLane } from "../model/events.ts";
import type { CheckAvailability } from "../model/plan.ts";

export const LANE_LABEL: Record<TimelineLane, string> = {
  world: "World action",
  raw_input: "Raw input commit",
  plc_ack: "PLC acknowledgement",
  plc_output: "PLC output",
  hmi: "HMI action / frame",
  fault: "Fault",
  agent: "Agent action",
  conclusion: "Conclusion"
};

export const LANE_COLOR: Record<TimelineLane, string> = {
  world: "var(--carton)",
  raw_input: "var(--beam)",
  plc_ack: "var(--ok)",
  plc_output: "var(--accent)",
  hmi: "var(--wait)",
  fault: "var(--bad)",
  agent: "var(--reason)",
  conclusion: "var(--text)"
};

export function evidenceTag(evidenceClass: EvidenceClass, mode: SourceMode, availability?: CheckAvailability): { text: string; cls: string; title: string } {
  if (availability === "awaiting_live") return { text: "awaiting live", cls: "awaiting", title: "Needs the live connector/coordinator; replay finishes it as not run." };
  const recorded = mode === "replay";
  switch (evidenceClass) {
    case "surrogate_contract":
      return { text: "surrogate", cls: "surrogate", title: "Generated world against the surrogate PLC-output driver. No PLC involved." };
    case "plc_measurement":
      return recorded ? { text: "PLC · recorded", cls: "plc", title: "Measured against CODESYS Control Win on 2026-10-30; replayed, not live." } : { text: "PLC · live", cls: "live", title: "Observed now from the attached coordinator." };
    case "world_model":
      return recorded ? { text: "world · recorded", cls: "surrogate", title: "Generated world evidence replayed from a record." } : { text: "world · live", cls: "live", title: "Generated world driving the PLC now." };
    case "agent_record":
      return { text: recorded ? "Muse · recorded" : "Muse · live", cls: "agent", title: "Muse model calls, assessments, and authored actions." };
    case "audit":
      return { text: "audit", cls: "audit", title: "Deterministic verdict or audit over preserved artifacts." };
    case "engineer_local":
      return { text: "engineer", cls: "audit", title: "Command or configuration made in this workspace." };
  }
}

export function shortSource(provenance: Provenance): string {
  const source = provenance.source;
  if (source.startsWith("replay:") || source.startsWith("live:") || source === "workspace") return source;
  const file = source.split("/").at(-1) ?? source;
  return provenance.run ? `${file} · ${provenance.run}` : file;
}

export const CLOCK_LABEL: Record<Provenance["clock"], string> = {
  world_virtual: "virtual world time (surrogate trace)",
  recorded_wall: "recorded wall-clock duration",
  derived_latency: "reconstructed from recorded ack latency",
  discrete: "untimed record — spacing is presentation only",
  live_wall: "live wall clock"
};
