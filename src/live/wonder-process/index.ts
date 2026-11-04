// Stable entry for controlsbench.wonder-process.v1. The Wonder campaign factory
// (src/host/wonder-campaign-factory.ts) imports createWonderSession(context) from this file after
// verifying its pinned commit and the reviewed handoff manifest. See docs/w4-process-handoff.md.
export { createWonderSession, openOfflineWonderSession, liveTiming, worldSeed } from "./session.ts";
export type { OfflineSessionOptions, SelectedWorld, WonderProcessSession } from "./session.ts";
export type { IsolatedLeaseReceipt } from "./driver.ts";
export { CONTRACT, WIRE, CADENCE_MS, MAXIMUM_STEP_MS } from "./protocol.ts";
