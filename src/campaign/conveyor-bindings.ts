import type { ControlBinding } from "./driver.ts";
import { ToolFailure } from "./driver.ts";
import { obj, validate } from "./contracts.ts";

const active = { type: "boolean" };
const divert = { enum: [1, 2] };
const sensor = { enum: ["PE_Entry", "PE_D1Approach", "PE_D2Approach", "PE_ExitA", "PE_ExitB", "PE_Runout"] };
const faults = {
  "fault.setDriveFeedbackFailure": obj({ active }), "fault.setOverload": obj({ active }),
  "fault.setDivertJam": obj({ divert, active }), "fault.setContradictoryLimits": obj({ divert, active }),
  "fault.setSensorStuck": obj({ signalId: sensor, active, value: active }, ["value"]),
  "fault.setSensorBounce": obj({ signalId: sensor, durationMs: { type: "integer", minimum: 100, maximum: 30_000 } }),
  "fault.setCartonJam": obj({ cartonId: { type: "string", minLength: 1 }, active }), "fault.clearAll": obj({})
};
// Semantic adapter only; there is no experiment selection, routing logic or diagnostic policy here.
export const preservedConveyorBindings: ControlBinding = {
  describe: { world: "preserved Muse conveyor 0.5.0", controls: faults,
    limitations: ["No WCS assign-route capability; requestedRoute on carton introduction is world metadata, not a PLC WCS acknowledgement", "No connected HMI by default"] },
  translate(call) {
    const p = call.arguments;
    if (call.name === "introduce_carton") return { id: "carton.introduce", payload: p, cause: call.id };
    if (call.name === "set_downstream_readiness") return { id: "downstream.setReady", payload: p, cause: call.id };
    if (call.name === "assign_route") throw new ToolFailure("rejected", "Preserved world has no route-assignment/WCS control");
    if (call.name === "inject_fault" || call.name === "clear_fault") {
      const id = String(p.controlId);
      if (!Object.hasOwn(faults, id)) throw new ToolFailure("rejected", "Unsupported fault control");
      validate(faults[id as keyof typeof faults], p.parameters);
      const parameters = p.parameters as Record<string, unknown>;
      if (call.name === "clear_fault" && id !== "fault.clearAll" && parameters.active !== false) throw new ToolFailure("rejected", "Clear requires active=false or fault.clearAll");
      if (call.name === "inject_fault" && (id === "fault.clearAll" || parameters.active === false)) throw new ToolFailure("rejected", "Injection must activate a fault");
      return { id, payload: parameters, cause: call.id };
    }
    throw new ToolFailure("rejected", `No world binding for ${call.name}`);
  }
};
