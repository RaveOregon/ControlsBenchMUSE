import type { HostScopeDefinition } from "./protocol.ts";

export const wonderScope: HostScopeDefinition = {
  mode: "categories", choices: [
    { id: "io", title: "I/O evidence" }, { id: "startup", title: "Startup and modes" },
    { id: "functional", title: "Functional experiments" }, { id: "runtime", title: "Runtime observations at qualified 10 Hz" },
    { id: "faults", title: "Declared world faults" }, { id: "normal", title: "Normal operation" },
    { id: "edge", title: "Declared edge cases" }, { id: "adaptive", title: "Evidence-dependent follow-up" }
  ], description: "Select categories for Wonder-authored experiments. The historical per-check qualification list is separate. This authorizes only the configured 10 Hz bench; no 20/50 Hz qualification, transport requalification, PLC recovery or code changes."
};
export const recordedWonderScope: HostScopeDefinition = { mode: "categories", choices: [
  { id: "evidence", title: "Recorded M10 evidence review" }, { id: "adaptive", title: "Recorded evidence comparison" }
], description: "This fixed offline review requires both categories. It reviews recorded evidence and performs no new PLC actions or paid model calls. Historical per-check selections are retained separately." };

export function selectWonderScope(scope: Record<string, boolean>, definition: HostScopeDefinition): string[] {
  const allowed = new Set(definition.choices.map(c => c.id));
  if (!Object.keys(scope).length || Object.keys(scope).some(id => !allowed.has(id)))
    throw new Error("This Wonder factory requires explicit category selections advertised by the host; historical check IDs are not campaign authorization");
  const selected = Object.entries(scope).filter(([, value]) => value === true).map(([id]) => id);
  if (!selected.length) throw new Error("Select at least one Wonder category");
  return selected;
}
