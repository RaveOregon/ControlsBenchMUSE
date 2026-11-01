// Browser transport to the portal host: EventSource downstream, JSON POST upstream.
import type { HostCommand, HostInfo, HostStreamMessage } from "../../../../src/host/protocol.ts";
import { HOST_PROTOCOL_VERSION } from "../../../../src/host/protocol.ts";
import type { HostedSession, HostTransport } from "./hosted-session.ts";

/** Returns the host description when this page is served by (or proxied to) a portal host. */
export async function detectHost(base = "", timeoutMs = 1500): Promise<HostInfo | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/host`, { signal: controller.signal, headers: { accept: "application/json" } });
    if (!response.ok || !String(response.headers.get("content-type")).includes("application/json")) return null;
    const info = await response.json() as HostInfo;
    return info.protocolVersion === HOST_PROTOCOL_VERSION ? info : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function fetchTransport(base = ""): HostTransport {
  return {
    async send(command: HostCommand) {
      const response = await fetch(`${base}/api/commands`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
      // 202 means received, not applied. The acknowledgement arrives on the stream.
      if (response.status !== 202) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${response.status}`);
    }
  };
}

const MESSAGE_TYPES = ["hello", "campaign", "events", "ack", "hmi", "heartbeat"] as const;

/** Connects the session to the host stream. EventSource resumes with Last-Event-ID; duplicates are deduplicated. */
export function connectHostStream(session: HostedSession, base = ""): { close(): void } {
  const source = new EventSource(`${base}/api/stream`);
  for (const type of MESSAGE_TYPES) source.addEventListener(type, event => {
    let message: HostStreamMessage;
    try { message = JSON.parse((event as MessageEvent<string>).data) as HostStreamMessage; } catch { return; }
    void session.receive(message).catch(error => console.error("Host message rejected", error));
  });
  source.onerror = () => session.setConnected(false);
  return { close: () => source.close() };
}
