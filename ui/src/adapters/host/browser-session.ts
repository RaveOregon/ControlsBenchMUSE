import { WorkspaceStore } from "../../model/workspace-store.ts";
import type { SignalDefinition } from "../../model/workspace-store.ts";
import { HostedSession } from "./hosted-session.ts";
import type { HostTransport } from "./hosted-session.ts";

/** Production browser bootstrap: current host activity/commands, independently typed evidence. */
export function createHostedBrowserSession(signals: SignalDefinition[], transport: HostTransport): HostedSession {
  return new HostedSession(new WorkspaceStore("live", signals), { transport });
}
