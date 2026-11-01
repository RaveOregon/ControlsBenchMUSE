# M10 lane C: generated machine view

Status, 2026-10-31: delivered on branch `view/m10-machine-view` from `m10-base`. One bounded Muse Wonder call produced a view that passed every validation error check on the first attempt. Portal mounting belongs to lane B and is not done here; this lane did not edit `ui/`.

The view shows **simulated physical truth** (the generated world's raw image and carton entities) and **observed PLC outputs**, taken only from host-supplied snapshots. It is not the PLC HMI and is not evidence that the PLC is correct. The package holds no credentials, opens no network connection, owns no physics, and has no command authority.

## Package

`artifacts/machine-view/latest.json` points to the current package: `artifacts/machine-view/2026-11-01T02-31-53-148Z-muse-wonder-1.0/` (UTC timestamp), package ID `conveyor-demo-baseline.view.9aaafe9d3766`.

| File | Author | Content |
|---|---|---|
| `equipment.json` | deterministic | 15 equipment identities, the generated world's device IDs, with source references, stations in metres and assumptions |
| `view-bindings.json` | channels: deterministic; paths and bindings: Muse | the 25 channels from the frozen contract, Muse's path polylines, and 40 bindings (11 anchor, 20 state, 5 text, 2 rotate, 1 belt, 1 entities) |
| `view.svg` | Muse | the SVG, byte-identical to the model output |
| `view.manifest.json` | deterministic | file hashes, world/spec/signal-map compatibility, selectable equipment, authority flags (all false), provenance, Muse layout assumptions |
| `validation.json` | deterministic | 29 checks; `contractValid` and `viewValid` |
| `generation.json` | deterministic | identity, timing, usage, cost, hashes, validation summary, browser check, repair lineage (empty) |
| `generation/request.json` | deterministic | the preserved request (format below), written before the call |
| `generation/response.json`, `generation/output.json` | provider | raw HTTP response body and the extracted structured output |
| `browser-check/` | deterministic | headless-Chrome results, screenshots and harness pages |

`.gitattributes` in `artifacts/machine-view/` disables line-ending conversion so the recorded SHA-256 hashes stay valid after checkout.

### Frozen contract (no model call)

`scripts/build-machine-view-contract.js` derives `artifacts/machine-view/contract/{equipment.json,binding-contract.json,sources.json}` from:

- `docs/conveyor-machine-spec.md`: every signal must appear, and DI/DO IDs are cited;
- the preserved world package `world.manifest.json`, `world.ts` `CONFIG` and `assumptions.md`: device IDs and signal roles come from the manifest, and each station from `CONFIG`, which must equal the value stated in `assumptions.md`;
- `codesys/demo/signal-map-v1.json` (`m8-conveyor-1.0.2`): every world signal must exist with the same IEC type, and the encoder must be 1000 counts/m.

Any disagreement between these sources is an error; the script does not guess. `--check` fails if the committed artifacts are stale. The script also writes `contract/fallback-package/`, a contract-only package that validates for fallback and has no view.

Channels are `world.<signal>` (20, `world_raw`, simulated physical truth) and `plc.<signal>` (5, `plc_output`, observed PLC output). Controller status symbols (mode, counts, WCS state) are deliberately excluded; they belong to the HMI and the M9 report.

## Binding kinds

The SVG contains no script. The host resolves each snapshot into presentation operations, and a trusted runtime inside the sandbox applies them.

| Kind | Host effect |
|---|---|
| `anchor` | `translate(x y)` placing equipment at its `equipment.json` station through the path drawings, so sensors and cartons share one mapping |
| `state` | `data-cb-value` (`true`/`false`/number/`unknown`), `data-cb-health`, `data-cb-source` (`world`/`plc`), `aria-label` |
| `text` | text content = formatted value or `unknown` |
| `rotate` | `rotate(angle px py)` from `D1_Position`/`D2_Position` (actual position, not the command) |
| `belt` | belt-mark offset from raw `Encoder_Count`, so stopping and coasting follow the recorded counts |
| `entities` | clones a carton template per supplied entity, placed from `(path, positionM)`; `runout` is drawn on `main` |

## Snapshot interface (`controlsbench.machine-view.snapshot.v1`)

```ts
{ schemaVersion, packageId, mode: "replay" | "live",
  evidenceClass: "surrogate_contract" | "fake_connector" | "preserved_live_plc" | "live_plc",
  frame: { sequence, campaignSequence, sourceTimeMs, label },
  link: { state: "fresh" | "stale" | "held" | "quarantined" | "passthrough" | "disconnected" | "not_connected", ageMs, reason },
  channels: { [channelId]: { value, health: "good" | "stale" | "held" | "bad" | "unknown", observedAtMs?, evidenceRef? } },
  entities: { supplied, health, items: [{ id, type: "carton", state: { itemId, requestedRoute, path, positionM, velocityMps, jammed, lengthM }, evidenceRef? }] },
  selection: { equipmentId, entityId } }
```

`validateSnapshot` rejects undeclared channels, wrong types, extra top-level fields (for example an endpoint) and undeclared entity fields. `buildSnapshot(channels, { raw, outputs, entities, link, quality, observedAtMs, nowMs, staleAfterMs, evidenceRefs, ... })` builds a snapshot directly from an M9 projection's `rawImage`/`outputs` or the portal store. Live values age to `stale` after `staleAfterMs`; replay never ages.

Display rules:

- A missing, `null`, `bad` or `unknown` value is shown as `unknown`. No angle or position is drawn for an unknown value.
- `stale` and `held` values keep their last value but are dimmed and dashed by trusted CSS. Generated CSS cannot override this because `!important` is forbidden to it.
- A link that is `stale`, `disconnected` or `quarantined` turns every good sample `stale`, and the banner turns red with the age and reason.
- `passthrough` holds world values. PLC outputs stay current.
- `entities.supplied: false` shows no cartons, and the banner says that positions are unknown.
- The trusted banner always shows the mode, the evidence class and "simulated physical truth, not the PLC HMI".

## Isolated host

`src/machine-view/host.ts`:

- `buildSrcdoc(pkg, token, nonce)` builds the iframe document. It sets this CSP: `default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline'; img-src/font-src/connect-src/media-src/object-src/frame-src/worker-src 'none'; form-action 'none'; base-uri 'none'`. The only script is the host runtime. Every bound element starts with `unknown` health.
- Mount the view in `<iframe sandbox="allow-scripts">`. Do **not** add `allow-same-origin`.
- `MachineViewController` handles the protocol (`controlsbench.machine-view.protocol.v1`). The view sends `ready` with its element IDs, then `applied` for each frame, `select`, or `error`. Messages are bound to a per-mount token. The controller also runs the ready timeout (5 s) and the frame-acknowledgement timeout (2 s), and returns `EvidenceSelection` (channel values, truth class and `evidenceRef`s) when equipment or a carton is clicked or activated by keyboard.
- An invalid snapshot is rejected, and the last valid frame is shown as `HELD`.
- The controller never throws into the caller. A missing element, a runtime error, a slow acknowledgement or a failed post moves it to `fallback`. Its `fallback()`/`fallbackHtml()` then show a machine-independent equipment/signal table built from the contract and the latest snapshot. The table never draws a substitute machine.
- `mountMachineView(container, { document, window }, options)` is a minimal DOM helper that uses structural types.

### Mounting in the portal (lane B)

```ts
import { validatePackage } from "../../src/machine-view/package.ts";
import { MachineViewController } from "../../src/machine-view/host.ts";
import { buildSnapshot } from "../../src/machine-view/frame.ts";
// load the four package files + artifacts/machine-view/contract/binding-contract.json
const { report, pkg } = await validatePackage({ files, contract, worldManifestText });
const controller = new MachineViewController({ pkg, report, post: m => iframe.contentWindow?.postMessage(m, "*"), onSelect: openEvidence, onStatus });
iframe.setAttribute("sandbox", "allow-scripts"); if (controller.srcdoc) iframe.srcdoc = controller.srcdoc;
window.addEventListener("message", e => { if (e.source === iframe.contentWindow) controller.receive(e.data); });
controller.push(buildSnapshot(pkg.bindings.channels, { packageId: pkg.manifest.packageId, mode, evidenceClass, sequence, link, raw: projection.rawImage, outputs: projection.outputs, entities, evidenceRefs }));
```

Mount only when `report.viewValid`. Otherwise render `controller.fallbackHtml()` (or the structured `fallback()`). The campaign continues either way. The module typechecks under the UI's flags (`tsconfig.portal-check.json`: DOM lib, `erasableSyntaxOnly`, `noUncheckedIndexedAccess`). Carton entities are not part of the public M9 projection, so the host must supply them from coordinator world events. Without them, the view honestly shows cartons as unknown.

## Validation (`validatePackage`)

**Contract tier.** The tier checks:

- file integrity hashes;
- that the channels equal the frozen contract, and the contract cites the frozen `equipment.json` hash;
- world/spec compatibility, including the actual world-manifest hash when it is supplied;
- that the authority flags are false;
- that no credential, endpoint or node-ID pattern (`opc.tcp://`, `password`, `api_key`, `Bearer`, `ns=…;`) appears.

**View tier.** The tier checks:

- that the SVG is well-formed under a strict parser (no DOCTYPE or entities);
- an element allowlist: no `script`, `foreignObject`, `image`, `a`, SMIL animation or `filter`;
- no `on*` handlers and no external references; `url()` and `href` may only point to in-document fragments;
- CSS: no `@import`, `@font-face`, animation, transition or `!important`, and no `html`/`body`/`div`/`*`/`cb-*` selectors;
- that the generated markup does not author host-reserved attributes;
- binding references and parameters;
- that all 25 channels are bound;
- that all 11 stationed devices are anchored;
- that the divert positions drive `rotate` bindings and the encoder drives the belt;
- carton template isolation and one transform owner per element;
- that every equipment ID is selectable;
- path coverage, with branches joining their divert station within 3 px and staying inside the viewBox;
- that a `data-cb-value` style exists;
- a render smoke test with unknown, normal and fully asserted snapshots.

A damaged SVG fails only the view tier, so the contract fallback still works.

## Generation request format (`controlsbench.machine-view.generation-request.v1`)

`generation/request.json` records:

- the request ID, timestamp, purpose and endpoint;
- the model, reasoning effort and output cap;
- the budget: `reservationUsd`, `perRequestHardUsd`, `timeoutMs`, `maxCalls: 1`, `automaticRetries: 0`, `repairCalls: 0`;
- every input with its path, SHA-256 and size: specification, equipment, binding contract, world manifest, world assumptions and view protocol;
- the prompt version and hash, and the output schema name and hash;
- the **exact JSON body** sent, with its hash. The authorization header is never stored.

`buildGenerationRequest` is deterministic for the same inputs. `scripts/generate-machine-view.js` refuses a second paid call unless `--allow-another-call` is passed. It re-derives the contract to prove the inputs are current, writes the request before sending, reserves $1 through `ModelBudgetGuard` and settles that amount even on failure, preserves the raw response, assembles and validates the package, runs the browser check, and writes `generation.json`. A failed view is not repaired automatically. It stays in contract-fallback state for engineer review.

## Result of the single Wonder call

| | |
|---|---|
| Model / response | `muse-wonder-1.0` / `resp_6ae6a4c76cadb5210abb4efc`, status `completed`, HTTP 200 |
| Duration | 46.8 s |
| Usage | 20,699 input (0 cached), 13,800 output including 3,835 reasoning tokens |
| Cost | $1.00 accounted (conservative reservation); about $0.36 estimated at published $4 / $20 per million input/output tokens ([LiteLLM listing](https://models.litellm.ai/models/muse-wonder-1.0)). Not a billing record. |
| Request body SHA-256 | recorded in `generation.json` and checked by a test |
| Validation | contract valid, view valid, 28 of 29 checks pass; 0 errors |
| Warning | `style.source`: the CSS does not style `data-cb-source`. Command and feedback are distinguished by shape and position (purple squares for PLC outputs, circles for world truth), as Muse's layout assumptions state. |
| Repairs | none |

Muse's layout:

- 200 px/m on every path;
- a horizontal main lane;
- 35° exit chutes that join exactly at 1.6 m and 2.8 m;
- divert paddles rotating 0–55° across the lane;
- drive, encoder and stack light in a side panel labelled as having no measured location;
- a "NOT the PLC HMI" caption.

All of its assumptions are in `view.manifest.json`.

## Verification

- Root typecheck passes. The portal-flag typecheck (`tsconfig.portal-check.json`) passes.
- `npm test`: 47/47 (31 existing + 16 machine-view). `npm run proof:view` runs the contract `--check`, the machine-view tests and the portal-flag typecheck.
- The tests cover:
  - deterministic derivation and the frozen artifacts;
  - rejection of disagreeing sources;
  - fallback before and after snapshots;
  - 13 unsafe-markup cases;
  - coverage, anchor, motion, selection, geometry and structure failures;
  - integrity, contract, world and credential failures;
  - frames following snapshots;
  - Gate B routed-A replay onto exit A;
  - stale, held, passthrough, bad, missing, unsupplied and out-of-range values;
  - narrow snapshot validation;
  - the host handshake, timeouts and selection evidence;
  - srcdoc/CSP;
  - the request format;
  - re-validation of the preserved Wonder package (output bytes = `view.svg`, request hash, and Gate B routed-B replay with no missing elements).
- Headless Chrome (`browser-check/browser-check.json`) passed eight scenarios through the real sandboxed runtime:
  - no data;
  - A approach, A diverted, B diverted and runout;
  - stale;
  - PLC-only/unknown world;
  - the full 59-frame routed-A replay.

  Every scenario had zero missing elements and zero errors. In a CSP probe, script and an `onload` handler injected directly into srcdoc, bypassing the validator, never reached the host.

## Presentation audit, second pass and smooth motion (2026-11-01)

Validation proves the view is safe and fully bound. It does not check whether the view reads cleanly. `scripts/audit-machine-view.js` covers that: it renders the package in headless Chrome and measures every label and indicator across 7 fixed scenarios and a sweep of every third frame of 4 Gate B runs. Scenarios include no data and worst-case values ("unknown" and 10-digit counts). The audit reports:

- label/label overlap and labels covering state indicators;
- content outside the visible view;
- smeared (outlined) text;
- fonts under 10 px;
- overlaps while a carton passes;
- carton step jumps, abrupt heading changes and belt-mark strobing.

It writes `audit/audit.json`, clean screenshots, and annotated screenshots. Logic lives in `src/machine-view/audit.ts`.

**First view:** 9 errors and 9 warnings. Errors were divert labels on top of each other and on lamps/paddles, and position values hitting photoeye labels. Warnings were cartons covering labels, 9.6 px text and a 35° heading snap at each branch.

**Second pass:** `scripts/refine-machine-view.js` made one bounded Wonder call at `reasoning: max`. It sent the incumbent SVG/bindings, the audit findings and 4 screenshots as vision input, and asked Wonder to also review the screenshots itself. The call was `resp_6ae6a9e22423a0a969914e65`, 235 s, 31,869 input / 42,179 output tokens (29,907 reasoning). It is accounted at a $1.25 reservation; about $0.97 at published rates. A candidate is promoted only if it is view-valid, passes the browser check and has fewer audit errors.

**Result:** 0 errors and 0 warnings. `latest.json` now points to `…-refine-01`, and the original package stays preserved as its parent. Wonder's `visualReview` lists 13 issues it addressed, 6 of which it found itself beyond the audit (for example, photoeye lamps hidden under cartons and a decorative line through labels).

**Host fixes:**

- After the second pass, the screenshot showed values smeared by Wonder's `[data-cb-source]` stroke rule, which also hit text. The audit now treats outlined text as an error. The trusted host CSS sets `text[data-cb-source]{stroke:none !important}`, so this cannot recur in any generated view. The SVG bytes remain Muse's.
- **Smooth motion:** frames now carry numeric motion for good-health transforms, and the runtime reuses carton elements by key. Between directly consecutive frames on a current link, the runtime eases linearly from the drawn value to the new recorded value over the recorded interval (100 ms at 10 Hz, capped at 250 ms). It never extrapolates past the latest snapshot. Stale, held, bad or unknown values snap, as do scrubs, gaps, new cartons and `prefers-reduced-motion`. See `tweenFor` in `host.ts`.
- Wonder's curved chutes spread the branch turn across about 6 frames.

`npm run view:preview` plays the current package smoothly.

### Third pass: divert paddles (2026-11-01)

The engineer reported that the extended paddles looked as if they sat in front of the lane and blocked the conveyor before the divert. The audit now has an **actuator sweep**. For each divert at home and at full travel, it draws probe cartons along the route a carton physically takes:

- **homed:** the main lane;
- **extended:** the main lane up to the station, then the branch.

It then hit-tests the paddle shape against each carton body in Chrome. It also checks that cartons are painted above actuators. `refine-01` failed with 4 errors, all paddle-through-carton, and 2 warnings that cartons were painted beneath the paddles. The generation prompt (v2) now states the rule as well.

**Wonder pass 3:** `resp_6ae6ae0cdb37ab3a51a04b95`, reasoning max, 268 s, 26,692 input / 44,082 output tokens. It is accounted at a $1.25 reservation; about $0.99 at published rates. Wonder moved the pivot downstream and to the outer side, so the extended paddle forms a guide wall along the turn and the homed paddle lies flush on the far edge. It painted cartons last and removed the overflowing route text from cartons.

The automatic gate initially kept the incumbent. The candidate's only errors were outlined "unknown" value text, and the cause was a **host bug**, not Wonder's. `prepareSvg` marked text bindings with `data-cb-value="unknown"` and never cleared that attribute, so Wonder's unknown-indicator styling outlined the values and, after the stroke fix, hid them. Bound text now carries health only, and a test covers it. After the fix, `scripts/promote-machine-view.js` re-validated, browser-checked and re-audited the preserved candidate with no model call: 0 errors, 0 warnings. It was promoted and the decision is recorded in `promotion.json`. Its generation record still shows the original automatic disposition.

Accounted spend for the four view calls: $1.00 + $1.25 + $1.25 = $3.50 (about $2.32 at published rates).

## Limitations

- The replay evidence is Gate B `surrogate_contract`, a world trace with no PLC, and is labelled that way. Live M8 snapshots depend on lane A/B feeding `buildSnapshot`.
- The audit measures text and bound indicators, not every decorative line. Wonder's own screenshot review covered the rest in this pass.
- Selection returns evidence references present in the snapshot. Opening the evidence is the portal's job.
- One machine only. The broader arbitrary-machine ingestion path remains deferred, as `ui/docs/spec-driven-visuals-plan.md` records.
