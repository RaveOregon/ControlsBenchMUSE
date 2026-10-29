import type { GeneratedWorldModule, MigrationRequest, WorldSnapshot } from "./contracts.ts";
import type { InstrumentedWorldContext } from "./world-context.ts";
import { validateManifest } from "./manifest.ts";

export interface ActiveWorld {
  versionId: string;
  module: GeneratedWorldModule;
  context: InstrumentedWorldContext;
}

export interface ReloadRecord {
  sequence: number;
  candidateVersion: string;
  previousVersion: string;
  disposition: "activated" | "rolled_back";
  reason: string;
  snapshot: WorldSnapshot;
  migratedSnapshot?: WorldSnapshot;
}

export class HotReloadCoordinator {
  readonly history: ReloadRecord[] = [];
  #sequence = 0;
  active: ActiveWorld;

  constructor(active: ActiveWorld) {
    this.active = active;
    validateManifest(active.module.manifest);
  }

  async attemptActivation(input: {
    candidateVersion: string;
    candidate: GeneratedWorldModule;
    candidateContext: InstrumentedWorldContext;
    healthCheck: (candidate: GeneratedWorldModule, context: InstrumentedWorldContext, migrated: WorldSnapshot) => Promise<void>;
  }): Promise<{ activated: boolean; record: ReloadRecord }> {
    const previous = this.active;
    const snapshot = await previous.module.snapshot(previous.context);
    try {
      validateManifest(input.candidate.manifest);
      await input.candidate.initialize(input.candidateContext, { seed: 20261029, worldVersion: input.candidateVersion });
      const migrationRequest: MigrationRequest = { fromWorldVersion: previous.versionId, toWorldVersion: input.candidateVersion };
      const migratedSnapshot = await input.candidate.migrate(input.candidateContext, snapshot, migrationRequest);
      await input.healthCheck(input.candidate, input.candidateContext, migratedSnapshot);
      this.active = { versionId: input.candidateVersion, module: input.candidate, context: input.candidateContext };
      const record: ReloadRecord = {
        sequence: ++this.#sequence,
        candidateVersion: input.candidateVersion,
        previousVersion: previous.versionId,
        disposition: "activated",
        reason: "Candidate compiled, migrated, and passed shadow health check",
        snapshot,
        migratedSnapshot
      };
      this.history.push(record);
      return { activated: true, record };
    } catch (error) {
      try { await input.candidate.dispose(input.candidateContext, "candidate activation failed"); } catch { /* rollback must survive cleanup failure */ }
      this.active = previous;
      const record: ReloadRecord = {
        sequence: ++this.#sequence,
        candidateVersion: input.candidateVersion,
        previousVersion: previous.versionId,
        disposition: "rolled_back",
        reason: error instanceof Error ? error.message : String(error),
        snapshot
      };
      this.history.push(record);
      return { activated: false, record };
    }
  }
}
