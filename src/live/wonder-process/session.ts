// Builds an IsolatedWonderSession (src/campaign/process-port.ts) around the isolated child.
// Construction is read-only: it forks the child, which hashes and imports the preserved world and
// reports the bytes it actually loaded. Runtime ownership, the PLC connection and simulation
// initialization happen only in driver.initialize(), i.e. after the host accepts Start.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CampaignFactoryContext } from "../../host/campaign-factory.ts";
import type { IsolatedWonderSession } from "../../campaign/process-port.ts";
import { commonWonderPaths } from "../../campaign/wonder-paths.ts";
import { verifyOwnerHandoff } from "../../campaign/owner-handoff.ts";
import { m8WorldBindings } from "../../campaign/m8-bindings.ts";
import { m8Preflight } from "../../host/m8-campaign-factory.ts";
import { m8Map } from "../m8-map.ts";
import { WonderProcessChannel } from "./channel.ts";
import { IsolatedProcessDriver } from "./driver.ts";
import { CONTRACT } from "./protocol.ts";
import type { ChildIdentity, LoadedWorld, TimingOptions } from "./protocol.ts";

const root = new URL("../../../", import.meta.url);
const file = (path: string) => fileURLToPath(new URL(path, root));
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
export const worldPath = file("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts");
export const projectPath = file("codesys/conveyordemo.project");
/** Same seed as the M10/portal compositions of the preserved world. */
export const worldSeed = 20261031;
/** Accepted M8 live bounds (M10 rehearsal/H2): 5 s operations, 60 s initialization. Not relaxed. */
export const liveTiming: TimingOptions = { operationTimeoutMs: 5000, initializeTimeoutMs: 60_000, parentSilenceMs: 15_000, drainMs: 10_000 };

export interface WonderProcessSession extends IsolatedWonderSession {
  driver: IsolatedProcessDriver;
  process: { offline: boolean; identity: ChildIdentity; loaded: LoadedWorld; journalDirectory?: string; channel: WonderProcessChannel };
}
export interface OfflineSessionOptions {
  /** Absolute path of a test module exporting createTransport(options, { event }): M8Transport. */
  transportModule: string;
  transportOptions?: Record<string, unknown>;
  /** A lane-specific lock path. The shared main-checkout lock is refused for offline sessions. */
  ownershipPath: string;
  timing?: Partial<TimingOptions>;
  /** Defaults to <artifactDirectory>/wonder-process when the host supplies one. */
  journalDirectory?: string;
  /** Explicit project selection; omitted means the fixed prepared example. */
  world?: SelectedWorld;
}
/**
 * A selected project world. The child must report exactly expectedWorldSha256 for the bytes it
 * loaded, or construction fails; there is no fallback to the prepared example.
 */
export interface SelectedWorld { worldPath: string; specPath: string; expectedWorldSha256: string; label: string }

/**
 * Live entry for the Wonder campaign factory. Requires the pinned commit, the reviewed handoff
 * manifest and its SHA-256 in the environment, a clean checkout at that commit and a passing
 * read-only M8 preflight. No PLC or model contact happens here.
 */
export async function createWonderSession(context: CampaignFactoryContext): Promise<WonderProcessSession> {
  const pin = process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT, handoffPath = process.env.CONTROLSBENCH_WONDER_HANDOFF, handoffSha = process.env.CONTROLSBENCH_WONDER_HANDOFF_SHA256;
  if (!pin || !/^[a-f0-9]{40}$/.test(pin) || !handoffPath || !handoffSha) throw new Error("W4 process adapter not ready: pinned commit, reviewed handoff manifest and its SHA-256 are required; no PLC/model contact");
  const handoff = verifyOwnerHandoff(resolve(handoffPath), handoffSha, pin);
  verifyOwnCheckout(pin);
  if (!context.artifactDirectory) throw new Error("Live isolated session requires the host's persistent artifact directory");
  const ownershipPath = commonWonderPaths().ownership;
  const preflight = m8Preflight({ ownershipPath });
  if (!preflight.ready) throw new Error(`M8 preflight failed (${JSON.stringify({ projectUnchanged: preflight.projectUnchanged, runtimeOwned: preflight.runtimeOwned,
    legacySessionActive: preflight.legacySessionActive, nativeModuleAvailable: preflight.nativeModuleAvailable, credentialsPresent: preflight.credentialsPresent })}); no PLC contact made`);
  return open(context, { offline: false, ownershipPath, timing: liveTiming, journalDirectory: join(context.artifactDirectory, "wonder-process"),
    handoff: { commit: pin, isolationVerified: true, recoveryVerified: true, evidenceRef: handoff.evidenceRef },
    initialize: { modulePath: preflight.modulePath }, env: childEnvironment(true) });
}

/**
 * Offline session: the same child, driver and protocol with an injected fake M8 transport.
 * Labeled as an unqualified fixture; it never carries a live handoff or the shared lock.
 */
export async function openOfflineWonderSession(context: CampaignFactoryContext, options: OfflineSessionOptions): Promise<WonderProcessSession> {
  if (resolve(options.ownershipPath) === resolve(commonWonderPaths().ownership)) throw new Error("Offline sessions must not take the shared main-checkout runtime lock");
  const journalDirectory = options.journalDirectory ?? (context.artifactDirectory ? join(context.artifactDirectory, "wonder-process") : undefined);
  return open(context, { offline: true, ownershipPath: options.ownershipPath, timing: { ...liveTiming, ...options.timing }, journalDirectory,
    handoff: { commit: "offline-unpinned", isolationVerified: true, recoveryVerified: true,
      evidenceRef: "offline fixture only: real isolated child with an injected fake M8 transport; not a live handoff, timing or recovery qualification" },
    initialize: { transportModule: resolve(options.transportModule), transportOptions: options.transportOptions ?? {} }, env: childEnvironment(false), ...(options.world ? { world: options.world } : {}) });
}

interface OpenConfig {
  offline: boolean; ownershipPath: string; timing: TimingOptions; journalDirectory?: string;
  handoff: IsolatedWonderSession["handoff"]; initialize: Record<string, unknown>; env: NodeJS.ProcessEnv; world?: SelectedWorld;
}
async function open(context: CampaignFactoryContext, config: OpenConfig): Promise<WonderProcessSession> {
  const { ledger } = context;
  const driver = new IsolatedProcessDriver({ ledger, binding: m8WorldBindings, timing: config.timing,
    initialize: { campaignId: ledger.campaignId, ownershipPath: config.ownershipPath, seed: worldSeed, timing: config.timing, ...config.initialize } });
  const channel = new WonderProcessChannel({ offline: config.offline, env: config.env, journalDirectory: config.journalDirectory,
    onRecord: (record, seq) => driver.ingest(record, seq), onIntegrity: message => driver.integrityFault(message),
    onExit: (code, signal) => driver.childExited(code, signal), onBoundary: revision => driver.noteBoundary(revision),
    knownCampaignRevision: () => ledger.state.revision });
  driver.attach(channel);
  try {
    const identity = await channel.ready();
    const selected = config.world;
    const loaded = (await channel.request<LoadedWorld>("load", { worldPath: selected?.worldPath ?? worldPath, projectPath, ...(config.journalDirectory ? { journalDir: config.journalDirectory } : {}) }, 30_000)).value;
    if (selected && loaded.worldSha256 !== selected.expectedWorldSha256) throw new Error(`Isolated child loaded world sha256 ${loaded.worldSha256}, not the selected ${selected.label} (${selected.expectedWorldSha256}); refusing to run`);
    driver.declareObservedOutputs(loaded.observedOutputIds);
    const provenance = {
      spec: `sha256:${sha256(selected?.specPath ?? file("docs/conveyor-machine-spec.md"))}`, ioMap: `sha256:${sha256(file("codesys/demo/signal-map-v1.json"))}`,
      plcBuild: config.offline ? `offline-fixture-transport;project-bytes-sha256:${loaded.projectSha256}` : `8001/interface-1/sha256:${loaded.projectSha256}`,
      worldModule: `sha256:${loaded.worldSha256};worldVersion:${loaded.worldVersion};loaded-by-child:${identity.pid}`,
      model: "assigned-by-host-provider",
      connector: `${config.offline ? "fixture-m8-transport" : "m8-opcua-v1"}/${m8Map.mapVersion};${CONTRACT};child:${identity.nonce}` };
    return { contract: CONTRACT, handoff: config.handoff, ledger, provenance, ownershipPath: config.ownershipPath, driver,
      controller: driver.controller, simulationExit: driver.simulationExit,
      async dispose() { await driver.dispose(); },
      process: { offline: config.offline, identity, loaded, ...(config.journalDirectory ? { journalDirectory: config.journalDirectory } : {}), channel } };
  } catch (error) { await driver.dispose("Session construction failed").catch(() => {}); throw error; }
}

/** The child needs no model key or other secrets; live keeps only the OPC credentials. */
function childEnvironment(live: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key) && !/^OPC_/i.test(key)) env[key] = value;
  if (live) { env.OPC_USER = process.env.OPC_USER; env.OPC_PASSWORD = process.env.OPC_PASSWORD; }
  return env;
}
/** Defense in depth beside the factory's entry check: this module runs from its pinned, clean checkout. */
function verifyOwnCheckout(pin: string): void {
  const cwd = fileURLToPath(root);
  const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  if (git("rev-parse", "HEAD") !== pin) throw new Error("Isolated adapter checkout differs from its pinned commit");
  if (git("status", "--porcelain", "--", "src", "scripts")) throw new Error("Isolated adapter src/scripts differ from the pinned commit");
}
