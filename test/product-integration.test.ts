import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { selectWonderScope, wonderScope } from "../src/host/wonder-scope.ts";
import { verifyOwnerEntry } from "../src/campaign/owner-handoff.ts";
import { defaultScope } from "../ui/src/model/plan.ts";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { createCampaignFactory } from "../src/host/wonder-recorded-factory.ts";
import { HostedSession } from "../ui/src/adapters/host/hosted-session.ts";
import { WorkspaceStore } from "../ui/src/model/workspace-store.ts";
import { eventEvidenceTag } from "../ui/src/components/labels.ts";

test("Wonder scope uses the host's explicit categories and rejects legacy check/rate authorization", () => {
  const scope = Object.fromEntries(wonderScope.choices.map(c => [c.id, true]));
  const resolved = selectWonderScope(scope, wonderScope);
  assert.ok(resolved.includes("functional")); assert.ok(resolved.includes("adaptive"));
  scope.faults = false;
  assert.ok(!selectWonderScope(scope, wonderScope).includes("faults"));
  for (const legacy of [defaultScope(), { ...defaultScope(), "IO-1": false }, { "CQ-50": true }, { invented: true }, {}])
    assert.throws(() => selectWonderScope(legacy, wonderScope), /explicit category selections/);
  assert.deepEqual(selectWonderScope({ normal: true, adaptive: false }, wonderScope), ["normal"]);
});

test("Owner entry verification covers a tracked entry outside src/scripts and rejects changed or untracked code", () => {
  const dir = mkdtempSync(join(tmpdir(), "cb-owner-entry-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  try {
    git("init"); git("config", "user.name", "Offline fixture"); git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    const entry = join(dir, "adapter.ts");
    writeFileSync(entry, "export const marker = 'pinned';\n");
    git("add", "adapter.ts"); git("commit", "-m", "pin offline fixture");
    const pin = git("rev-parse", "HEAD");
    assert.equal(verifyOwnerEntry(entry, pin).entryRelative, "adapter.ts");
    writeFileSync(entry, "export const marker = 'changed';\n");
    assert.throws(() => verifyOwnerEntry(entry, pin), /entry bytes differ/);
    writeFileSync(join(dir, "untracked.ts"), "throw new Error('must never import');\n");
    assert.throws(() => verifyOwnerEntry(join(dir, "untracked.ts"), pin));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("Production live HostedSession starts recorded review while physical evidence stays historical and current review activity stays live", async () => {
  const host = new CampaignHost({ factory: createCampaignFactory() });
  const store = new WorkspaceStore("live", []);
  const portal = new HostedSession(store, { transport: { send(command) { host.submit(command); } } });
  let delivered = Promise.resolve();
  const off = host.subscribe(message => { delivered = delivered.then(() => portal.receive(message)); });
  try {
    await delivered;
    assert.equal(portal.start().ok, true);
    await host.idle();
    assert.ok(host.runtime, "normal browser Start reached the recorded factory");
    await host.runtime!.runAgent();
    await host.runtime!.stop();
    const disconnect = host.subscribe(message => { delivered = delivered.then(() => portal.receive(message)); }, { campaignId: host.campaignId!, after: portal.lastSequence });
    disconnect(); await delivered;
    const output = store.state.timeline.find(e => e.kind === "plc.output")!;
    assert.ok(output);
    assert.equal(output.provenance.mode, "live", "presentation channel is the currently hosted review");
    assert.equal(output.provenance.evidenceMode, "recorded", "physical evidence has its own historical origin");
    assert.equal(output.provenance.clock, "recorded_wall");
    assert.equal(eventEvidenceTag(output.provenance).text, "PLC · recorded");
    assert.ok(store.state.timeline.some(e => e.provenance.evidenceClass === "agent_record" && e.provenance.mode === "live" && e.provenance.evidenceMode === "current"));
    assert.equal(store.state.episode?.plcIncluded, false, "historical samples do not start live PLC health expectations");
    assert.equal(store.state.episode?.connectorExpected, false);
    assert.equal(store.state.episode?.worldExpected, false);
    assert.throws(() => store.applyEvents([{ ...output, provenance: { ...output.provenance, mode: "replay" } }]), /labeled replay/);
  } finally { off(); await host.close(); }
});
