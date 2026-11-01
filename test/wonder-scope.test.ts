import assert from "node:assert/strict";
import test from "node:test";
import { createCampaignFactory } from "../src/host/wonder-campaign-factory.ts";
import { CampaignHost } from "../src/host/campaign-host.ts";
import { CampaignLedger } from "../src/campaign/ledger.ts";
import { FakeProvider } from "../src/campaign/provider.ts";
import { fixtureProvenance } from "../src/campaign/harness.ts";
import type { IsolatedWonderSession } from "../src/campaign/process-port.ts";
import { createHostedBrowserSession } from "../ui/src/adapters/host/browser-session.ts";
import { defaultScope } from "../ui/src/model/plan.ts";
import type { HostCommand } from "../src/host/protocol.ts";

const hmi = { async perform() { throw new Error("No HMI fixture"); } };
function fixtureFactory() {
  let constructed = 0;
  const factory = createCampaignFactory({ provider: () => new FakeProvider(() => new Promise(() => {})),
    async openSession({ ledger }): Promise<IsolatedWonderSession> {
      constructed++;
      return { contract: "controlsbench.wonder-process.v1", ledger, ownershipPath: "offline", provenance: fixtureProvenance("offline"),
        handoff: { commit: "offline", isolationVerified: true, recoveryVerified: true, evidenceRef: "offline contract fixture" },
        driver: { binding: { describe: {}, translate() { throw new Error("No world effects"); } }, observedOutputIds: ["Motor_RunCmd"], operationTimeoutMs: 100,
          lastImage: {}, lastSnapshot: undefined, lastEvidenceRefs: [], evidenceAgeMs: 0, quarantined: false,
          async initialize() {}, start() {}, async hold() {}, async apply() { throw new Error("No effects"); }, async reset() { return []; }, async exit() {}, subscribe() { return () => {}; },
          decisionLeases: { async begin(_p, revision) { return { id: "offline-lease", basedOnRevision: revision, valid: true, reason: "offline", evidenceRefs: [] }; }, async finish(receipt) { return receipt; } } },
        controller: { async execute() { throw new Error("No controller effects"); } }, simulationExit: { async exit() { throw new Error("No PLC"); } }, async dispose() {} };
    } });
  return { factory, get constructed() { return constructed; } };
}

for (const variant of ["default", "narrowed", "historical-deselection"] as const) test(`actual browser HostedSession.start sends explicit Wonder scope: ${variant}`, async () => {
  const fixture = fixtureFactory(), host = new CampaignHost({ factory: fixture.factory });
  const commands: HostCommand[] = [];
  const client = createHostedBrowserSession([], { send(c) { commands.push(c); host.submit(c); } });
  if (variant === "historical-deselection") client.store.setScope(["FN-1"], false);
  const checksBefore = structuredClone(client.store.state.scope);
  let delivered = Promise.resolve(); const off = host.subscribe(message => { delivered = delivered.then(() => client.receive(message)); });
  try {
    await delivered;
    assert.deepEqual(client.store.state.scope, checksBefore, "Never overwrite per-check selections");
    const categories = host.info.factory.scope!.choices.map(c => c.id);
    if (variant === "historical-deselection") {
      assert.equal(client.start().ok, false); assert.equal(commands.length, 0); assert.equal(fixture.constructed, 0);
      assert(Object.values(client.store.state.categoryScope!).every(v => !v));
      assert.equal(client.store.setScope(["normal"], true).ok, true);
    } else if (variant === "narrowed") {
      client.store.setScope(categories, false); client.store.setScope(["normal"], true);
    }
    assert.equal(client.store.setScope(["CQ-20", "CQ-50"], true).ok, false);
    assert.equal(client.start().ok, true); await host.idle(); await delivered;
    assert.equal(fixture.constructed, 1);
    const sent = commands.find(c => c.type === "start")!.payload!.scope as Record<string, boolean>;
    assert(Object.keys(sent).every(id => categories.includes(id)));
    const expected = variant === "default" ? categories : ["normal"];
    assert.deepEqual(Object.entries(sent).filter(([, value]) => value).map(([id]) => id), expected);
    assert.deepEqual(host.events.find(e => e.type === "campaign.authorized")!.data.categories, expected);
    assert.deepEqual(client.store.state.scope, checksBefore);
    assert.equal(host.runtime!.agentContext().capabilities && (host.runtime!.agentContext().capabilities as any).maximumCadenceHz, 10);
  } finally { off(); await host.close(); }
});

test("direct legacy check IDs and rate qualification cannot authorize the Wonder factory", async () => {
  const fixture = fixtureFactory();
  await assert.rejects(fixture.factory.create({ ledger: new CampaignLedger("check-scope"), hmi, scope: defaultScope() }), /explicit category/);
  await assert.rejects(fixture.factory.create({ ledger: new CampaignLedger("rate-scope"), hmi, scope: { runtime: true, "CQ-20": true } }), /explicit category/);
  assert.equal(fixture.constructed, 0);
});
