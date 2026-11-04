# Bench test report — engineer-facing Results and shareable export

Source lane `codex/bench-report`, based on integration `544adcd` (reviewed live S2 proof and submission diagrams), is integrated into `codex/product-integration` at `df8908c` with handoff `f1ee619`. Independent review and the refreshed fixture preview are recorded in `docs/reviews/bench-report-review.md`. The live app on 5190/5191 was not touched or restarted.

## What the engineer gets

**Results** now opens a bench test report for the current host campaign:

- A summary generated from the campaign record (no new model call): execution status, experiment conclusions, recorded requirement verdicts, findings and attention items, each counted separately. Nothing is summed into a pass rate. A completed experiment reads "Observed — conclusion recorded, not a pass verdict"; a completed-but-inconclusive experiment stays inconclusive even though the JSON `untested` list omits it.
- Identity and source: campaign, evidence class, report source (current host campaign vs saved record reviewed offline, historical), start/end/duration, controller build, PLC boot, world, spec and I/O map hashes, model, connector, authorized scope. Missing metadata reads "Unavailable"; the machine name is not in the record and is not guessed.
- Test scope and results: one row per experiment (planned or adaptive follow-up with Muse's rationale), with stimulus/operator actions, the explicit statement that no acceptance criterion was recorded, observed condition checks, discrepancies and cited PLC values, recorded conclusion, requirement verdict, evidence links and limitations.
- Requirement verdicts: only verdicts the campaign recorded (Muse HMI assessments, unreviewed), next to any separate review artifact's note. Requirements merely exercised by an experiment read "No verdict recorded".
- Findings: exact PLC claims grouped by cited output with ✓ when the cited ledger value matches, injected fault truth, Muse inference (unverified), assumptions, uncertainty, priority (not supplied) and engineer review state.
- HMI behaviour: per assessment, Muse's visible-control observation, verdict and review state, cited screenshots with capture time and hash, and whether those pixels were actually sent to Muse (verified against the model exchange log when attached, otherwise the ledger receipt). Captured-only frames and unavailable images keep placeholders with their references. HMI actions show trusted input delivery, PLC acknowledgement and rendered result.
- Recommended next checks (labelled as generated recommendations), remaining work/missing evidence/scope limits, final recorded PLC and connector state (timestamped; historical once the run ends), usage and accounting (conservative reservations and token-cost estimates, neither presented as an invoice), separate review artifacts with their own status and origin, and an evidence appendix (integrity, source files and hashes, Muse decision trail, cited ledger records paginated in the app).

Toolbar: **Download HTML report** (standalone), **Print / Save as PDF**, **Download JSON report** (the unchanged `/api/campaign/report`), **Download full ledger (JSONL)**, **Refresh**, **Open saved report…** (a `report-bundle.json` from the export CLI, shown as a historical record). The earlier preserved bench qualification moved to a collapsed "Historical bench qualification" section, separate from campaign results. Replay mode keeps its own recorded check table. The Campaign page's record panel no longer uses internal milestone names.

## Design

| Layer | File | Role |
| --- | --- | --- |
| Bundle | `src/report/bundle.ts` | Pure data. Carries the authoritative report unchanged plus the evidence slice needed to trace it (cited events, actions, experiment timing, observations, model requests, HMI frames/actions, final recorded state). Shared by host, CLI and portal. |
| Saved resolver | `src/report/saved-campaign.ts` | Bounded: reads only `report.json`, `campaign.jsonl`, `campaign-audit.json`, `s2-audit.json`, `engineering-review.json`, `wonder-exchanges.jsonl`, and images under `vision-frames/` named by the ledger receipt whose bytes match the recorded SHA-256. Verifies the ledger chain, checks the saved report against a reconstruction, embeds the original report bytes for download, scrubs workstation paths, never writes into the evidence directory. |
| Host endpoint | `GET /api/campaign/report/bundle` in `src/host/http.ts` | Additive. Same report as `/api/campaign/report`; frames resolve only through the host's retained frame store, hash-checked. |
| View model | `ui/src/report/view-model.ts` | All labelling and counting rules; vets image sources (inline JPEG/PNG or this host's frame route only). |
| Renderer | `ui/src/report/BenchReport.tsx`, `bench-report.css` | One React component for the app and the export. Report text is React text (escaped), never markup. |
| Standalone | `ui/src/report/standalone.tsx` | `renderToStaticMarkup` plus inlined styles, CSP (`img-src data:`), and a fixed script for evidence links, print expansion and image zoom. Host frames are fetched by the app from vetted routes and embedded only when their hash matches; otherwise a placeholder. |
| App | `ui/src/components/ResultsPage.tsx` | Loads the host bundle (refreshes while running, once on finalization), saved-bundle opening, downloads, print expansion. |

The campaign schema, runtime, ledger and the existing JSON report are unchanged.

## Saved exports and captures

`artifacts/bench-report/saved-exports/` — produced from the original evidence, which is unchanged:

- `w4-adaptive-plc-investigation/` — portal-20261103131442735-1: drive-feedback fault 12, recovery, evidence-dependent D1 contradiction follow-up (fault 21), recovery; 2 findings, 31 exact claims, 4 non-applied actions surfaced; no HMI operation claimed.
- `s2-hmi-operator-trial/` — portal-20261103232137992-1: five Muse requests, 17 image inputs, six HMI actions; UI-01/02/03 pass and UI-04 inconclusive as unreviewed Muse assessments; UI-03's citation of :2783 (captured, not sent) shown next to received :2798; `s2-audit.json` (reference_review_required) and `engineering-review.json` (pass_with_limitations) attached as separate artifacts.
- `s2-first-attempt-partial/` — portal-20261103231427237-1: stopped after a connector-stale pause before any plan or HMI action; its cancelled planning request, own single frame and own final state only.

Each has `report.html` (standalone) and `report-bundle.json`. Screenshots and print renderings are in `artifacts/bench-report/captures/` (see `captures.json`).

Commands:

```
node scripts/export-bench-report.js <campaign-directory> --out <directory> [--title "..."] [--diagnostics]
node scripts/capture-bench-report.js [--app http://127.0.0.1:<fixture-host-port>]
```

`--diagnostics` adds the evidence directory (relative) as internal diagnostics; leave it off for shared copies. The capture script refuses non-fixture hosts and never starts a campaign.

## Validation

All offline; no PLC, model, controller download or library change. The app on 5190/5191 was not touched; previews used a fixture host on 5195 (fake connector) and a static server on 5197, both stopped afterwards.

- New tests: `ui/test/bench-report.test.ts` 6/6 (W4/S2/partial counts and claim boundaries from the saved exports; completed-but-inconclusive; partial run with no inherited screenshots, verdicts or final state; absent HMI data; missing and unsafe media; unknown references; running-campaign labels; escaped model text, CSP, no host URLs or local paths in standalone HTML). `test/bench-report.test.ts` 5/5 (resolver bounds incl. traversal and hash mismatch; original evidence bytes unchanged; committed partial export current; path scrubbing; host bundle endpoint returns the unchanged report).
- UI suite `npm test --prefix ui`: 57/57. UI production build passes (standalone renderer is a separate lazily loaded chunk). Typecheck: root, `tsconfig.portal-check.json` and UI all pass.
- Root suite `npm test` (run alone): 237/238. The one failure, `wonder-process.test.ts` "provider campaign through the Wonder factory…" at line 167 (isolated child exit code 1 instead of 0 at disposal), passed on an isolated rerun of that file (16/16) with no code or threshold change. That path does not use the report code.
- Exports: all three saved reports match a reconstruction from their ledgers. W4 estimate from recorded usage and pricing ≈ $3.5040 (review: 3.50398); S2 ≈ $1.5738 (audit: 1.5738); partial ≈ $0.0930 (audit: 0.09302).
- Captures (`captures.json`): standalone reports at 1440×900 made no network requests and had no horizontal overflow; the print handler opened every key section (4/14/5) and restored them afterwards. PDF renderings were inspected: light print colours, side-by-side fields, no clipped tables, findings and assessment headings kept with their content, the S2 :2783 placeholder and citation check visible. In-app: fixture-host Results report, the saved S2 bundle opened through Open saved report, and its PDF.
- Browser checks in the app: evidence links reveal and highlight the cited appendix row without changing the URL; Download HTML report produces a self-contained file (no `/api/` URLs, embedded original JSON report, CSP, no local paths); no console errors.

## Limits

- The standalone HTML embeds only images whose bytes are available and hash-verified: for S2, frames selected by assessments, HMI action screens and experiment conclusions. Frame :2783 (and other capture-only frames) were never preserved as files, so they appear as placeholders with their reference and hash.
- The full ledger is not embedded (W4 is 17 MB); it is listed with its hash and downloadable from the app while the host is running.
- Printed copies include the first evidence group only; the HTML holds the full cited slice.
- Requirement verdicts exist only where the campaign recorded them (HMI assessments). The report does not derive requirement pass/fail from PLC observations, and no acceptance criteria exist in the plan schema to show as expected behaviour.
- Token-cost estimates need the model exchange log's recorded pricing; a host campaign without one shows tokens and reservations only.
- "Open saved report" accepts bundles produced by the export CLI; there is no in-app picker for evidence directories.

## Integration

Merge `codex/bench-report` into `codex/product-integration` with `git -c core.longpaths=true`. Rebuild the UI (`npm run build --prefix ui`) before launching the app, since static availability is chosen at host start. Update `HANDOFF.md` at integration time; this lane leaves it unchanged to avoid conflicts. `scripts/check-product-browser.js` and `scripts/w4-controlled-browser.js` selectors were updated for the renamed Results/Campaign labels.
