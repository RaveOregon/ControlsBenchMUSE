# Specification-to-project onboarding — handoff

Branch `codex/spec-onboarding` from integration `22b3179` (keeps the 3120053 running-experiment fix). Not merged; the user's app (5192/5193) and live observer (5190/5191) were not touched. Previews used 5194 (fixture author) and 5196 (Muse author), both stopped.

## What the engineer can do

1. **Create project** (Setup). Name it, upload or paste a Markdown/text specification, optionally add a CSV/TSV/JSON/text I/O list. Supported formats and limits are shown; PDF/DOCX/ZIP are refused explicitly. Original bytes are stored with SHA-256 under `artifacts/projects/<project>/<version>/inputs/`; projects reopen after refresh. **Load example conveyor** stays, labelled as the prepared example with its own historical evidence.
2. **Prepare with Muse.** A server-side job (queued → preparing → validating → repairing → ready / needs information / failed / cancelled) sends this project's own specification, separate I/O (or its embedded I/O tables), the world contract and the M8 interface table to Wonder. The page polls; status shows elapsed time, last activity, request/repair count, token usage, conservative reservation and token-cost estimate. Cancel aborts the model request and kills the worker. A spec without any I/O becomes a question without a model request.
3. **Generate and validate.** The package (world.ts, manifest, tests, assumptions, plan, physical parameters, questions) is written per attempt and validated in an isolated worker process (`scripts/project-validate-worker.js`, scrubbed environment, deadline): strict compile; structure and manifest equality; initialization, typed/finite raw image, determinism, snapshot/migrate/dispose; role-based conveyor physics (no motion/encoder/feedback without a run command, run feedback through drive dynamics, encoder from travel, item motion, monotonic deceleration then hold); and the package's own tests. Failures are classified (compiler/structural/behavioral/test defect) and returned to Muse for at most two repairs. Every attempt is kept.
4. **Review.** Summary, Muse's open questions, validation with measured behaviour, M8 mapping (per-signal path/type/direction/role, uploaded-I/O mapping, issues), the source-linked plan grouped by category with stimulus, expected observation (specified / not specified) and availability, physical parameters (specified vs inferred), generated files and generation lineage. **Edit and create revision** makes a new version; earlier artifacts stay.
5. **Use project.** Activation requires a ready, compatible version with at least one runnable check, records spec/I/O/world/manifest hashes and is refused while a campaign runs. Every use re-hashes the files; a mismatch blocks with the file named — there is no fallback to the example.
6. **Campaign and report.** Start is disabled until a project is selected and (for uploaded projects) a runnable prepared check is in the chosen categories. At Start the selection is frozen; the selected world is launched in the real isolated child, which must report the expected world hash. The Muse-prepared plan becomes the campaign's starting plan (with a `prepared_plan` record carrying expected observations and source references); the plan panel then shows each check's recorded outcome and lists campaign-added follow-ups separately. The report shows project/version, spec and world hashes as loaded by the child, the preparing author and response IDs, planned stimulus, the prepared expected behaviour with its source, and prepared checks not run. Finished runs are archived under the project version with report, bundle and ledger, and reopen from Setup → Runs → Open report.

Generation alone never claims a PLC test passed; campaign conclusions stay "observed — not a pass verdict".

## Genuine Muse preparation (paid)

Project `p-20261104015133-55daee` "Slow-belt conveyor variant", from `docs/examples/conveyor-slow-belt-spec.md` (the accepted conveyor spec with the belt speed changed from 0.50 to 0.30 m/s; interface unchanged), uploaded through `POST /api/projects` (the UI's API) — spec sha256 `67b665a851e81535af3695c721eb9d4de6fe88773de02ee66c3e19c26b3fda34`.

| Job | Requests | Outcome | Usage (in / out) | Estimate | Reservation |
| --- | --- | --- | --- | --- | --- |
| job-mw1gnr56-c22b3e | 1 | Failed before validation: my first parser rejected a manifest with `seededRandom:false` instead of returning it for repair (fixed). Raw response preserved. | 9,071 / 24,981 | ≈ $0.54 | $1 |
| job-mw1gtust-7ab834 | 2 (1 repair) | **Ready.** Attempt 1 failed independent validation (test typing and manifest capabilities); the repair passed all 13 checks. Responses `resp_6aea91735e83b2b279f34c1a`, `resp_6aea91c8f5435b42cb7b4c2a`. | 39,267 (9,076 cached) / 50,279 | ≈ $1.16 | $2 |

Measured behaviour of the generated world: **0.30 m/s steady speed, 300 encoder counts/s**, 1,000 counts/m, feedback 100 ms after run, stop to rest 500 ms. The prepared example measures 0.50 m/s and 500 counts/s under the same checks: the changed upload changed the generated world. Compatible with `m8-conveyor-1.0.2`; 28 planned checks, 23 runnable (ST-01, R-01, R-12, R-22, FN-01 need HMI operation). Muse raised seven open questions (drive-feedback fault meaning, overload behaviour, inferred geometry/timing, TBD deadlines, WCS symbols, heartbeat/stale behaviour) — they are review items, not blocking.

The same world then ran from the UI as campaign `portal-20261104121915383-1` (offline: real isolated child, fixture M8 transport, fixture campaign provider, no PLC): 23 prepared checks recorded observations, one fixture follow-up, report archived under the run. Spec hash, world hash `6074334f273964aa0e3d5423267396e4e5abaf0530029b82117effd29f2b9241`, project/version and response IDs agree across preparation, the child's loaded identity, campaign provenance, portal and report.

Accounting: preparation reservations ($3 total) are in their own durable file `artifacts/wonder/preparation-session.jsonl` (main checkout); the campaign session account is untouched at its $135 reservation history. Reservations are admission accounting and estimates use recorded list rates; neither is an invoice. The model key stays in the host environment; requests, artifacts and the browser never contain it.

## Live commissioning candidate

`artifacts/spec-onboarding/live-candidate.json`: project/version, spec and world hashes, preparation lineage and accounting, validation and measured behaviour, compatibility, unavailable checks, Muse's open questions, the offline campaign evidence, commands and the live checklist. Status: **candidate, not commissioned.** A fresh generated world does not inherit the prepared example's live qualification. The live `createWonderSession` still loads only the prepared example; the offline session already takes a selected world with an expected hash, and the live entry needs the same seam under a new reviewed pin and handoff manifest — deliberately not loosened here.

## Code

| Area | Files |
| --- | --- |
| Shared types | `src/projects/types.ts` |
| Store, revisions, example | `src/projects/store.ts` |
| I/O parsing | `src/projects/io-list.ts` |
| Authors (Wonder, fixture) and prompt/schema | `src/projects/author.ts` |
| Preparation job | `src/projects/preparation.ts`, `src/projects/accounting.ts` |
| Isolated validation | `src/projects/validate.ts`, `scripts/project-validate-worker.js` |
| M8 compatibility | `src/projects/m8-compatibility.ts` |
| Selection | `src/projects/selection.ts` |
| Host | `src/host/project-api.ts`, `src/host/project-campaign-factory.ts`, `src/host/http.ts`, `scripts/host-portal.js` (`--projects`, `--project-author`, `--campaign project`) |
| Isolated child seam | `src/live/wonder-process/session.ts` (`openOfflineWonderSession({ world })`) |
| Report | `src/report/bundle.ts` (`project`, `preparedPlan`), `ui/src/report/*` |
| UI | `ui/src/components/ProjectSetup.tsx`, `ProjectCampaign.tsx`, `ui/src/projects/*`, `App.tsx`, `ResultsPage.tsx` |

Unchanged: campaign schema/runtime, ledger, existing JSON report, accepted conveyor spec/world/latest pointer, M8 map, immutable pins, live session entry.

## Validation

- `test/project-onboarding.test.ts` 8/8 (repeatable, fixture author and fixture transport): byte-exact upload, hashes, reopen, revisions, refusal of PDF/oversize/traversal; separate and embedded I/O; the author receives each upload, and a changed spec changes the validated world (0.5 → 0.3 m/s, 500 → 300 counts/s); compiler failure → repair with preserved attempts; missing I/O → question with no model call; cancel; incompatible extra PLC write cannot activate; failing world stops after one generation + two repairs; cancel/failure leave the active selection untouched; full API path through the real isolated child with verified identity, seeded plan, follow-up, report linkage, run archive, a second run, and a refused start after tampering. Plus a check of the preserved genuine Muse preparation (requests carry the uploaded text and hash, never a key).
- `ui/test/project-onboarding.test.ts` 2/2: Start gating; report identity, prepared expectations, not-run checks, loaded-world mismatch label.
- Root `npm test` (run alone): **246/246**. UI `npm test`: **59/59**. Root, portal-check and UI typechecks pass; UI production build passes.
- Browser witness `scripts/capture-onboarding.js` against the production portal: **21/21** checks, 14 screenshots in `artifacts/spec-onboarding/witness/` (file upload, live preparation status, review, selection, plan before/after, signal view, report identity and expectations, reopen after refresh, archived report; read-only screenshots of the genuine Muse project and its report).

## Acceptance checklist status

| Gate | Status |
| --- | --- |
| Real project selection reaches child, Muse context, view and report | Done offline (child-verified hash, spec text as campaign spec, signal view, report identity). |
| Reviewable plan before Start | Done: Muse-prepared, source-linked, grouped; persisted with the version; selected categories gate Start. |
| Expected results carried through execution and reporting | Done for prepared checks (expected observation, basis, source refs in the report); conclusions remain observed/inconclusive — no pass is inferred. |
| Bench profile and capability preflight | Partial: M8 profile, mapping and capability-gated checks are shown. A live preflight showing PLC/link identity and simulation state is not part of this offline composition. |
| One coherent requested campaign | Partial: HMI checks are visibly unavailable; routing HMI checks to the S2 HMI-capable composition is not done. |
| Completion, failure and repeat use | Partial: terminal campaign state, a verified second run from the same version, cancellation/failure preserved. Held/faulted recovery gating for live runs is not added here. |
| Persistence and history | Done: projects, versions, selection and run reports reopen after refresh. |
| Honest controls | Steering is disabled with an explanation for hosted campaigns. Other unsupported controls (suppression, hot reload, some connection actions) were not audited in this lane. |

## Integration

Merge `codex/spec-onboarding` into integration with `git -c core.longpaths=true`. Rebuild the UI before launching (`npm run build --prefix ui`). To serve onboarding, launch the host with `--projects artifacts/projects --campaign project` and `--project-author fixture` (offline) or `muse` (needs `MODEL_API_KEY` in the host environment; paid). Hosts launched without `--projects` behave as before. `artifacts/projects/active.json` and `.locks/` are host state and are ignored by Git.
