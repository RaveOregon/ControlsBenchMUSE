import type { ToolCall } from "./contracts.ts";
import { ToolFailure } from "./driver.ts";
import { CampaignLedger } from "./ledger.ts";
import { M8OpcUaConnector } from "../live/m8-opcua.ts";
import { preservedConveyorBindings } from "./conveyor-bindings.ts";

export const m8WorldBindings = { ...preservedConveyorBindings,
  describe: { ...(preservedConveyorBindings.describe as object), controller: "M8 build 8001/interface 1", supervisoryTools: ["operator_action", "assign_route", "acknowledge_completion"] } };
export function m8ControllerActions(connector: M8OpcUaConnector, ledger: CampaignLedger) {
  return { async execute(call: ToolCall, signal: AbortSignal) {
    if (signal.aborted) throw new ToolFailure("inconclusive", "Cancelled before controller request");
    let action: "start" | "stop" | "reset" | "offer" | "completion_ack";
    let parameters: Record<string, unknown> = {};
    if (call.name === "assign_route") {
      if (!/^[1-9][0-9]*$/.test(String(call.arguments.itemId))) throw new ToolFailure("rejected", "M8 WCS item ID requires nonzero decimal UDINT");
      parameters = { itemId: Number(call.arguments.itemId), route: call.arguments.route === "A" ? 1 : call.arguments.route === "B" ? 2 : 0 }; action = "offer";
    } else if (call.name === "acknowledge_completion") { parameters = { sequence: call.arguments.sequence }; action = "completion_ack"; }
    else action = call.arguments.action as "start" | "stop" | "reset";
    const observation = await connector.action(action, parameters, call.id);
    if (signal.aborted) throw new ToolFailure("inconclusive", "Controller may have applied request; inspect acknowledgement before retrying");
    const e = ledger.append("controller.action", { actionId: call.id, action, observation });
    return { message: "PLC acknowledged sequenced operator/WCS request; world reacts to observed PLC commands on its next tick", evidenceRefs: [e.id], value: observation.values };
  } };
}
