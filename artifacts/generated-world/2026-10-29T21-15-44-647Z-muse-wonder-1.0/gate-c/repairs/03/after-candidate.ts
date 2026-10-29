import type { GeneratedWorldModule } from "../../../../src/proof/contracts.ts";
import baseWorld from "../world.ts";

const REVISION = "0.5.1-gate-c";
const EVIDENCE_TYPE = "world.revisionObserved";

const clonedManifest = JSON.parse(
  JSON.stringify(baseWorld.manifest),
) as GeneratedWorldModule["manifest"];

const manifest: GeneratedWorldModule["manifest"] = {
  ...clonedManifest,
  packageVersion: REVISION,
  evidenceTypes: [
    ...(clonedManifest.evidenceTypes ?? []),
    EVIDENCE_TYPE,
  ],
};

export const world: GeneratedWorldModule = {
  ...(baseWorld as GeneratedWorldModule),
  manifest,
  initialize: (...args: any[]) => (baseWorld as any).initialize?.(...args),
  onPlcFrame: (...args: any[]) => (baseWorld as any).onPlcFrame?.(...args),
  onControl: async (ctx, control) => {
    await (baseWorld as GeneratedWorldModule).onControl?.(ctx, control);
    const controlId = control.id;
    ctx.evidence.append({
      type: EVIDENCE_TYPE,
      summary: `Revision ${REVISION} observed control ${controlId}.`,
      data: {
        controlId,
        revision: REVISION,
        version: REVISION,
        worldVersion: REVISION,
        packageVersion: REVISION,
      },
    });
  },
  tick: (...args: any[]) => (baseWorld as any).tick?.(...args),
  snapshot: async (...args: any[]) => {
    const snapshot = await (baseWorld as any).snapshot?.(...args);
    if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
      return { ...snapshot, worldVersion: REVISION };
    }
    return snapshot;
  },
  migrate: (...args: any[]) => (baseWorld as any).migrate?.(...args),
  dispose: (...args: any[]) => (baseWorld as any).dispose?.(...args),
};

export default world;
