import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CampaignRuntime } from "../campaign/runtime.ts";
import { CampaignBudget, acceptedBudgetLimits } from "../campaign/budget.ts";
import { DurableSessionAccount } from "../campaign/session-account.ts";
import { commonWonderPaths } from "../campaign/wonder-paths.ts";
import { WonderResponsesProvider, fileExchangeJournal, wonderPricing } from "../campaign/wonder-responses.ts";
import { digest } from "../campaign/ledger.ts";
import { fileHash } from "../campaign/harness.ts";
import { verifyOwnerEntry, verifyOwnerHandoff } from "../campaign/owner-handoff.ts";
import type { IsolatedWonderSession } from "../campaign/process-port.ts";
import type { CampaignProvider } from "../campaign/provider.ts";
import type { CampaignFactory, CampaignFactoryContext } from "./campaign-factory.ts";
import { selectWonderScope, wonderScope } from "./wonder-scope.ts";

const root = new URL("../../", import.meta.url);
// Verified convergence checkout uses Git's CRLF conversion; historical M10 recorded LF bytes.
// Pin both explicitly. Neither world nor view bytes are rewritten by this lane.
const convergenceWorldCheckoutHash = "277992048f8ca9a8b36f2f90c0d4c33ef479cb8b3c355d6a2233a272850698f5";
export interface WonderFactoryOptions {
  processModule?: string;
  handoffCommit?: string;
  handoffPath?: string;
  handoffSha256?: string;
  pricingReviewedOn?: string;
  /** Offline injection only: always labeled fake_connector and cannot authorize a paid provider. */
  openSession?: (context: CampaignFactoryContext) => Promise<IsolatedWonderSession>;
  provider?: () => CampaignProvider;
}

/** Prepared W4 gate. No native transport fallback; only a pinned, completed owner handoff. */
export function createCampaignFactory(options: WonderFactoryOptions = {}): CampaignFactory {
  const injected = !!options.openSession;
  const evidenceClass = injected ? "fake_connector" as const : "live_plc" as const;
  const claimBoundary = injected ? "Offline isolated-process contract fixture; no real PLC or paid model."
    : "Wonder-directed M8 campaign through the runtime owner's verified isolated adapter. Scope-limited experiment evidence; no certified controller coverage. HMI frames remain separate.";
  return { id: injected ? "wonder-process-fixture" : "wonder-isolated-m8", label: injected ? "Wonder process contract · offline fixture" : "Muse Wonder 1.0 · isolated M8 campaign",
    evidenceClass, claimBoundary, connectorId: "isolated-m8-process-v1", outputIds: ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"],
    limits: { ...acceptedBudgetLimits }, supportsExitSimulation: true, scope: wonderScope,
    async create(context) {
      const scope = selectWonderScope(context.scope, wonderScope);
      const processModule = options.processModule ?? process.env.CONTROLSBENCH_WONDER_PROCESS_MODULE;
      const pin = options.handoffCommit ?? process.env.CONTROLSBENCH_WONDER_PROCESS_COMMIT;
      const pricing = options.pricingReviewedOn ?? process.env.CONTROLSBENCH_WONDER_PRICING_REVIEWED;
      const handoffPath = options.handoffPath ?? process.env.CONTROLSBENCH_WONDER_HANDOFF;
      const handoffSha256 = options.handoffSha256 ?? process.env.CONTROLSBENCH_WONDER_HANDOFF_SHA256;
      if (!injected && (!processModule || !pin || !/^[a-f0-9]{40}$/.test(pin) || !handoffPath || !handoffSha256)) throw new Error("W4 not ready: completed isolated coordinator/recovery handoff module, full owner commit and pinned evidence manifest required; no PLC/model contact");
      const handoff = injected ? undefined : verifyOwnerHandoff(resolve(handoffPath!), handoffSha256!, pin!);
      const ownerEntry = injected ? undefined : verifyOwnerEntry(processModule!, pin!);
      if (!injected && pricing !== wonderPricing.checkedOn) throw new Error("Reverify documented Wonder Standard rates and set CONTROLSBENCH_WONDER_PRICING_REVIEWED; no model contact");
      if (!injected && (!context.artifactDirectory || !process.env.MODEL_API_KEY)) throw new Error("Persistent campaign artifacts and local MODEL_API_KEY are required");
      const paths = commonWonderPaths();
      let account: DurableSessionAccount | undefined, session: IsolatedWonderSession | undefined;
      try {
        if (!injected) { mkdirSync(dirname(paths.session), { recursive: true }); account = new DurableSessionAccount(paths.session, context.ledger.campaignId); }
        // Recheck immediately before import; import only the attested resolved entry.
        if (!injected && verifyOwnerEntry(processModule!, pin!).entrySha256 !== ownerEntry!.entrySha256) throw new Error("Owner entry changed before import");
        if (ownerEntry) context.ledger.append("world.evidence", { source: { kind: "owner_adapter_entry", ownerCommit: pin,
          entryRelative: ownerEntry.entryRelative, entryBlob: ownerEntry.entryBlob, entrySha256: ownerEntry.entrySha256, handoff: handoff!.evidenceRef } }, "truth");
        const open = options.openSession ?? (await import(pathToFileURL(ownerEntry!.entryPath).href)).createWonderSession;
        if (typeof open !== "function") throw new Error("Owner module must export createWonderSession(context) for controlsbench.wonder-process.v1");
        session = await open(context);
        if (session!.contract !== "controlsbench.wonder-process.v1" || session!.ledger !== context.ledger || !session!.driver.decisionLeases
          || !session!.driver.observedOutputIds?.length || !session!.handoff.isolationVerified || !session!.handoff.recoveryVerified
          || !session!.handoff.evidenceRef || (!injected && (session!.handoff.commit !== pin || session!.handoff.evidenceRef !== handoff!.evidenceRef || resolve(session!.ownershipPath) !== resolve(paths.ownership))))
          throw new Error("Owner handoff lacks verified isolation/recovery, exact ledger, observed outputs, revision leases or shared ownership");
        const baseline = JSON.parse(readFileSync(new URL("artifacts/m10/2026-11-01T00-58-43-185Z/result.json", root), "utf8"));
        const world = new URL("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/", root);
        const worldHash = fileHash(new URL("world.ts", world));
        if (![baseline.worldSha256, convergenceWorldCheckoutHash].includes(worldHash) || fileHash(new URL("codesys/conveyordemo.project", root)) !== baseline.projectSha256)
          throw new Error("Frozen world/PLC bytes differ; no Wonder call allowed");
        if (!injected && (!session!.provenance.plcBuild.includes(baseline.projectSha256) || !session!.provenance.worldModule.includes(worldHash)))
          throw new Error("Owner adapter provenance does not match preserved build/world");
        const provider = options.provider?.() ?? (injected ? undefined : new WonderResponsesProvider({ apiKey: process.env.MODEL_API_KEY!, explicitlyAuthorized: true,
          journal: fileExchangeJournal(join(context.artifactDirectory!, "wonder-exchanges.jsonl")) }));
        if (!provider || (injected && provider.paid)) throw new Error("Offline process injection requires a zero-cost fixture provider");
        const budget = new CampaignBudget(context.ledger, undefined, 5, account);
        const manifest = JSON.parse(readFileSync(new URL("world.manifest.json", world), "utf8"));
        const signals = [...manifest.signals, ...session!.driver.observedOutputIds!.filter(id => !manifest.signals.some((s: any) => s.id === id)).map(id => ({ id, direction: "plc_to_world", description: "Declared observed M8 controller diagnostic; see accepted spec" }))];
        const runtime = new CampaignRuntime({ ledger: context.ledger, provider, budget, driver: session!.driver, controller: session!.controller, hmi: context.hmi,
          paidAuthorized: !injected, requireDecisionLeases: true, evidenceClass, claimBoundary, categories: scope,
          provenance: { ...session!.provenance, model: provider.id, ioMap: digest(signals) }, spec: readFileSync(new URL("docs/conveyor-machine-spec.md", root), "utf8"), signals,
          capabilities: { world: "preserved Muse conveyor 0.5.0", semantic: session!.driver.binding.describe,
            authorizedCategories: scope, maximumCadenceHz: 10, qualification: "20/50 Hz and transport/task requalification are not authorized",
            operator: "configured direct sequenced controller adapter; not an HMI click", decisionLeases: ["hold", "continue", "condition_deadline"],
            hmi: "host frame capture only; actions/clips unsupported unless host explicitly implements them", branch: "snapshot only; no fork execution", rewrite: "unsupported" } });
        const active = session;
        return { runtime, simulationExit: active!.simulationExit, dispose: async () => { try { await active!.dispose(); } finally { account?.close(); } } };
        // Intentionally omit HostedCampaign.run(): the host invokes CampaignRuntime.runAgent().
      } catch (error) { try { await session?.dispose(); } finally { account?.close(); } throw error; }
    } };
}
