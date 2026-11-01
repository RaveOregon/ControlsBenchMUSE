// Bridges the operator HMI service and Lane B's portal HMI hub when both run in one process.
// The portal's controlled browser (CdpWebVisuSource) renders the HMI page; its frames are what the
// portal tile shows. This bridge records that session's inputs and frames in the HMI journal and
// delivers agent clicks to the same session, keeping four records separate:
//   requested HMI action → delivered browser input → observed screen frame → PLC acknowledgement.

import type { HmiHub } from "../host/hmi.ts";
import type { CdpWebVisuSource } from "../host/cdp-webvisu.ts";
import type { HmiActionRef, HmiFrameRef, HmiSessionView } from "../host/protocol.ts";
import type { AgentActionView, CommandView } from "./protocol.ts";
import type { HmiService } from "./service.ts";

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const TERMINAL = new Set(["applied", "rejected", "timed_out", "failed", "refused"]);

export class PortalSessionBridge {
  readonly service: HmiService;
  readonly hub: HmiHub;
  readonly captureLabel: string;
  #source?: CdpWebVisuSource;
  #lastState?: string;

  constructor(service: HmiService, hub: HmiHub, captureLabel = "portal") { this.service = service; this.hub = hub; this.captureLabel = captureLabel; }

  /** Lane B hmiSourceFactory hook: keep the controlled source the portal displays. */
  attachSource(source: CdpWebVisuSource): CdpWebVisuSource { this.#source = source; return source; }

  /** Lane B HmiHub onChange hook. */
  onHubChange(view: HmiSessionView, change: { frame?: HmiFrameRef; action?: HmiActionRef }): void {
    const j = this.service.journal;
    const key = `${view.state}|${view.sessionId ?? ""}`;
    if (key !== this.#lastState) {
      this.#lastState = key;
      j.append("portal.session", { state: view.state, sessionId: view.sessionId, sourceId: view.sourceId, url: view.url, browser: view.browser, detail: view.detail });
    }
    if (change.frame) j.append("portal.frame", { reference: change.frame.reference, capturedAtIso: change.frame.capturedAtIso, requestedAtIso: change.frame.requestedAtIso, sha256: change.frame.sha256, pageUrl: change.frame.pageUrl });
    if (change.action) j.append("portal.input", { reference: change.action.reference, kind: change.action.kind, atIso: change.action.atIso, x: change.action.x, y: change.action.y, origin: change.action.origin });
  }

  /** The HMI client session rendered by the portal's controlled browser. */
  portalClient(): string | undefined {
    return this.service.state().clients.filter(c => c.label === this.captureLabel).sort((a, b) => b.connectedAtIso.localeCompare(a.connectedAtIso))[0]?.clientSessionId;
  }

  async executeAgentAction(body: Record<string, unknown>): Promise<{ action: AgentActionView; command?: CommandView }> {
    const clientSessionId = this.portalClient();
    if (!clientSessionId || !this.#source || !this.hub.observing) throw Object.assign(new Error("No observed portal HMI session to operate"), { status: 409 });
    const requested = this.service.requestAgentAction({ ...body, clientSessionId });
    if (requested.status === "inconclusive" || !requested.targetRect) return { action: requested };
    const r = requested.targetRect;
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
    const dispatchStartedAtIso = new Date().toISOString();
    await this.#source.deliverPointer(x, y);
    this.service.agentActionDelivered({ reference: requested.reference, atIso: dispatchStartedAtIso, x, y, browserSession: this.hub.view.sessionId,
      via: `CDP Input.dispatchMouseEvent (press+release) on the portal's controlled browser; dispatch completed ${new Date().toISOString()}` });
    // Wait for the page's own input report, then for any PLC command it caused to reach a terminal outcome.
    const deadline = Date.now() + 4000;
    let action = this.service.agentAction(requested.reference)!;
    while (Date.now() < deadline) {
      action = this.service.agentAction(requested.reference)!;
      const command = action.commandRequestId ? this.service.commands.get(action.commandRequestId) : undefined;
      if (action.pageInput && (!action.targetId.startsWith("cmd.") || (command && TERMINAL.has(command.outcome)))) break;
      await sleep(25);
    }
    await sleep(300); // let the page render the outcome before the evidence frame
    const frame = await this.hub.captureNow();
    const command = action.commandRequestId ? this.service.commands.get(action.commandRequestId) : undefined;
    const rendered = command && [...this.service.journal.tail].reverse().find(rec => rec.type === "ui.rendered" && rec.data.requestId === command.requestId);
    const observed = this.service.agentActionObserved({ reference: requested.reference, frameRef: frame.reference, capturedAtIso: frame.capturedAtIso, sha256: frame.sha256,
      renderedStatus: rendered ? `page rendered: ${String(rendered.data.text)} at ${rendered.atIso}` : command ? "page has not reported rendering this outcome" : undefined });
    return { action: observed, command };
  }
}
