import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { digest } from "../src/campaign/ledger.ts";
import type { CampaignEnvelope } from "../src/host/protocol.ts";
import { createHostedBrowserSession } from "../ui/src/adapters/host/browser-session.ts";
import { eventEvidenceTag } from "../ui/src/components/labels.ts";
import { classifyActivity } from "../ui/src/model/activity.ts";
import { signalHealth } from "../ui/src/model/signal-health.ts";
import { ModeMismatchError } from "../ui/src/model/workspace-store.ts";

test("production live browser bootstrap separates recorded observations/source times from current review liveness", async () => {
  const original = readFileSync(new URL("../artifacts/wonder/2026-11-01T17-38-38-589Z/recorded-campaign.jsonl", import.meta.url), "utf8").trim().split("\n").map(line => JSON.parse(line) as CampaignEnvelope);
  const prefix = original.slice(0, original.findIndex(e => e.type === "plc.output") + 1);
  const session = createHostedBrowserSession([], { send() { throw new Error("No command/network in provenance test"); } });
  assert.equal(session.mode, "live");
  const mapped = await session.ingestEnvelopes(prefix[0]!.campaignId, prefix, undefined, { evidenceClass: "preserved_live_plc" });
  const output = mapped.find(e => e.kind === "plc.output")!, sourceEnvelope = prefix.find(e => e.id === prefix.at(-1)!.data.sourceId)!;
  const source = sourceEnvelope.data.source as any;
  assert.equal(output.provenance.mode, "live", "Transport/review mode remains current");
  assert.equal(output.provenance.evidenceMode, "recorded"); assert.equal(output.provenance.clock, "recorded_wall");
  assert.equal(output.provenance.recordedAt, source.atIso); assert.equal(output.provenance.sourceAtMs, source.atMonotonicMs);
  const badge = eventEvidenceTag(output.provenance);
  assert.equal(badge.text, "PLC · recorded"); assert.doesNotMatch(badge.title, /Observed now|2026-10-30/);
  assert.match(badge.title, /not a current PLC observation/);
  assert.equal(session.store.state.outputs.Motor_RunCmd?.workstationTimestamp, source.atIso);
  assert.match(signalHealth(session.store.state.outputs.Motor_RunCmd, session.store.state, 1e9), /^recorded/);
  if (session.store.state.episode) {
    assert.equal(session.store.state.episode.plcExpected, false); assert.equal(session.store.state.episode.worldExpected, false);
  }
  const last = prefix.at(-1)!;
  const append = (sequence: number, previousHash: string, type: string, data: Record<string, unknown>): CampaignEnvelope => {
    const body = { ...last, sequence, id: `${last.campaignId}:${sequence}`, previousHash, type, data, atIso: new Date().toISOString() };
    const { hash: _old, ...unsigned } = body; return { ...unsigned, hash: digest(unsigned) };
  };
  const running = append(last.sequence + 1, last.hash, "campaign.state", { state: "running", reason: "Current recorded-evidence review" });
  const request = append(running.sequence + 1, running.hash, "agent.request", { requestId: "review-now", phase: "started", model: "offline-fixture", experimentId: "review", elapsedMs: 0 });
  const activity = await session.ingestEnvelopes(last.campaignId, [running, request]);
  assert(activity.every(e => e.provenance.evidenceMode === "current" && e.provenance.clock === "live_wall"));
  const health = classifyActivity(session.store.state, session.store.state.agent.active!.startedAtMs + 60_000);
  assert.equal(health.state, "reasoning"); assert.equal(health.elapsedMs, 60_000);
  assert.match(health.health.plc.value, /recorded/); assert.match(health.health.world.value, /recorded/);
  assert.notEqual(health.health.plc.tone, "stalled"); assert.notEqual(health.health.world.tone, "stalled");
  assert.throws(() => session.store.applyEvents([{ ...output, id: "forbidden-replay", provenance: { ...output.provenance, mode: "replay" } }]), ModeMismatchError);
});
