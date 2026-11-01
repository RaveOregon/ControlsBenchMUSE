import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { createCampaignFactory } from "../src/host/wonder-recorded-factory.ts";
import { HostedSession } from "../ui/src/adapters/host/hosted-session.ts";
import { WorkspaceStore } from "../ui/src/model/workspace-store.ts";
import { replay } from "../src/campaign/ledger.ts";
import type { HostStreamMessage } from "../src/host/protocol.ts";

test("W2: portal consumes recorded activity, costs, actions and findings from the one authoritative ledger", async () => {
  const manifest = JSON.parse(readFileSync(new URL("../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json", import.meta.url), "utf8"));
  const host = new CampaignHost({ factory: createCampaignFactory() });
  const store = new WorkspaceStore("replay", manifest.signals);
  const portal = new HostedSession(store, { mode: "replay" });
  const messages: HostStreamMessage[] = []; let delivered = Promise.resolve();
  const off = host.subscribe(message => { messages.push(message); delivered = delivered.then(() => portal.receive(message)); });
  try {
    assert.equal(host.info.factory.evidenceClass, "preserved_live_plc"); assert.match(host.info.factory.label, /Recorded/);
    host.submit({ contractVersion: 1, requestId: "start-recorded", type: "start" }); await host.idle();
    assert(host.runtime); await host.runtime.runAgent(); await host.runtime.stop();
    // A new subscription flushes the finalized prefix and exercises reconnect/deduplication.
    const disconnect = host.subscribe(message => { delivered = delivered.then(() => portal.receive(message)); }, { campaignId: host.campaignId!, after: portal.lastSequence });
    disconnect(); await delivered;
    const authoritative = replay(host.events);
    assert.deepEqual(host.projection, authoritative);
    assert.deepEqual(store.state.hosted!.projection, authoritative);
    assert.equal(portal.lastSequence, authoritative.sequence);
    assert.equal(store.state.hosted!.projection!.budget.campaignUsd, 0);
    assert.equal(Object.values(store.state.hosted!.projection!.findings).length, 1);
    for (const finding of Object.values(authoritative.findings)) for (const claim of finding.claims) assert.equal(portal.getEnvelope(claim.evidenceId)?.type, "plc.output");
    assert(messages.some(m => m.type === "events" && m.events.some(e => e.type === "agent.activity")));
    assert(host.report()!.claimBoundary!.includes("RECORDED"));
    host.submit({ contractVersion: 1, requestId: "steer-unsupported", type: "steer", payload: { text: "Run a new fault trial" } }); await host.idle(); await delivered;
    assert(messages.some(m => m.type === "ack" && m.ack.requestId === "steer-unsupported" && m.ack.outcome === "rejected" && /not delivered/.test(m.ack.detail)));
    assert.equal(portal.unavailableReason, "Recorded campaign: read-only evidence; no PLC or model commands.");
  } finally { off(); await host.close(); }
});
