# Spec-driven machine visualization and HMI portal

Status: long-term product direction confirmed on 2026-10-31 and subsequently parked by the user to prioritize the hackathon. The immediate scope below takes priority over the broader delivery sequence. This document records direction; generated visualization and continuous HMI capture are not yet delivered.

ControlsBench is a general controls-engineering tool. Spec ingestion must produce a useful visual for the supplied equipment, and Campaign must also show the actual HMI session so the engineer can follow the investigation.

This direction supersedes the first-proof restriction in `docs/architecture-decisions.md`, under “Lightweight visualization scope,” that says not to ask Muse to generate custom renderer code. It retains the lightweight 2D scope and the separation of world truth, PLC observation, and HMI evidence. This plan does not implement a CAD editor or change the campaign runtime.

## Immediate hackathon scope

The user explicitly paused work toward the full end vision. Prioritize an impressive, honest demonstration of Muse product capabilities using the existing conveyor bench.

- Give Muse the accepted conveyor specification, declared world assumptions and current snapshot/signal contract. Ask it to author the machine visual artifact, preferably SVG/HTML with dynamic state bindings, as part of the generated bench package.
- Preserve the generation prompt, actual model response, model identity, artifact hash and available timing/cost information. Make the transition from specification to Muse-authored artifact visible in the demo.
- Use a minimal presentation host to display this generated conveyor artifact against the existing world/PLC evidence. Show moving objects, actuator positions and sensor state from the running/recorded snapshots. Generation happens during preparation; playback/render updates do not require a model call every frame.
- Keep the actual HMI alongside it using the existing tile and a configured WebVisu or practical capture connection when available. Display an explicit unobserved state when no real source exists.
- Prove the short story: imported spec → Muse-created machine artifact/world → acknowledged raw stimulus and actual PLC response → readable finding, with actual HMI observation where connected.

Defer arbitrary-machine ingestion, a complete generic view-package platform, the second-machine acceptance gate, general native-window capture support and vision-driven HMI operation. These remain the longer-term path described below, not hackathon prerequisites. The SVG/HTML choice is the initial approach; no separate image model integration is assumed or claimed.

## Intended workflow

1. Import a functional specification, I/O map and any supplied drawings/screenshots. Preserve file identity, revision and source locations.
2. Muse extracts equipment, connections, signal identities, operating states, geometry supplied by the documents, requirements and open assumptions. Reuse a supplied diagram when useful; generate missing schematic content from the same equipment interpretation used by the world.
3. Muse generates a versioned bench package: world behavior, raw signal contract, a dynamic machine view, view bindings, source references and visible assumptions. The view is a first-class generated artifact, not a hardcoded product screen or a static illustration standing in for live state.
4. Setup previews the generated machine view and exposes assumptions/bindings. An engineer can correct an interpretation in natural language; Muse revises the affected package artifacts. Display preparation, validation and repair progress.
5. Campaign loads the package into a reusable World tile and connects an independent HMI tile. Both use campaign timing and support evidence inspection. Results preserve the package versions and observation references needed to reconstruct the view.

The conveyor becomes one sample package. A pump/tank, press, batching skid or other machine must use this same ingestion and display path.

## Generated view package

Proposed additive package artifacts:

- `equipment.json`: stable equipment and connection identities, extracted source references, supplied geometry and explicit inferred assumptions.
- `view.manifest.json`: view schema version, entry point, package/world compatibility, state bindings, selectable equipment, units and referenced assets.
- `view.html` plus packaged SVG/CSS/JavaScript or compiled equivalents: Muse-authored 2D presentation code. The host does not need a catalog containing every possible machine.
- `view-bindings.json`: references to equipment IDs, entities, world state, logical raw signal IDs and optional observed PLC state. Bindings distinguish generated physical truth from PLC observations.
- Generation/validation record: spec revision, model identity, world/view hashes, assumptions, checks and repair history.

Exact filenames can follow the existing generation-package conventions. Existing packages without a view remain supported with an explicit “Visualization not generated” state; never silently substitute the conveyor diagram.

Reuse vector drawings directly when they are suitable. A raster drawing can serve as a cited background with generated dynamic overlays. A missing drawing does not block Muse from authoring a schematic. A visual layout is not automatically a measured physical dimension: inferred geometry must be declared and consistent with world assumptions.

The view reads snapshots; it does not own machine physics, simulate a second process, infer an acknowledgement from animation, or manufacture PLC state. Object motion, fill levels, actuator positions and indicators are bound to the world/observation snapshot. Unknown, held, bad and stale data remain visible. Replay freezes and advances with the recorded campaign clock, without independent wall-clock animation.

## Generic view host and binding contract

Replace the conveyor-specific component in the application path with a reusable generated-view host. A compact read-only host message supplies:

- contract and package versions, campaign/run identity, replay/live mode and campaign position;
- equipment/entity state and world-state values;
- raw I/O and optional observed controller values, with quality, freshness and source timestamps;
- current experiment, selected equipment and evidence references.

The view can emit equipment/signal selection requests so the portal opens the relevant evidence. Host validation resolves bindings against the imported manifest and available snapshot fields; missing IDs produce an explicit unsupported/unknown state. Values do not depend on parsing generated TypeScript CONFIG text.

Run the generated view in an isolated presentation surface with a narrow messaging bridge. The host owns data access and evidence selection. Generated presentation code has no direct PLC connection, credentials or control authority. This permits flexible model-authored graphics while keeping the coordinator the single owner of applied effects. Bound failed or unresponsive rendering separately from campaign health; a broken view must not stop the PLC observation or spend model budget indefinitely.

World and view are generated from the same equipment identities. Validate compatibility before activation and swap a compatible package at a defined snapshot boundary. Preserve the previous working view if a revision fails validation. The view describes the model's assumptions; its appearance does not constitute a passed PLC requirement.

## Actual HMI portal tile

The HMI tile represents the actual controller interface, independent of the generated World tile. The engineer should see the same HMI session that the campaign operator or future HMI agent is observing/operating.

Two source adapters:

1. **Embedded WebVisu:** host the configured controller visualization URL when its embedding policy permits it. Preserve the existing URL configuration and distinguish page loaded, current observation, recording and test coverage.
2. **Controlled browser/window view:** maintain a real browser or selected HMI application session and stream its captured viewport/window into the tile. Use this when the HMI is a native application, when embedding is unavailable, or when the campaign needs to operate and record the same session. Mirror actual frames rather than recreating the HMI from tag values. Respect the HMI's embedding/authentication boundaries.

The tile needs a continuously updating preview, source/session identity, capture timestamp, frame age, connection/recording status and an expand/pop-out control. On loss, hold the last frame with a visible disconnected/stale overlay; do not leave it looking live. If no source is connected, show “HMI not observed/tested.”

A capture producer is required: the current UI accepts timestamped media references but does not yet run a browser/window capture service or display a continuous controlled session. Implement that producer and its stream/session lifecycle; a source-ID field by itself does not satisfy the follow-along requirement. Capture/encode outside the PLC scan path, at a bounded independent display cadence.

Append HMI actions and frame/clip references to the evidence ledger using the existing campaign HMI event contract. Retain the original capture timestamps and their correlation to the campaign clock. A visible click, a delivered HMI command and an observed PLC response are separate facts. HMI observation does not automatically pass congruence or control requirements.

Initial scope is follow-along observation and recording. Vision-driven operation can then use the same controlled session and action/evidence path. Opening the tile alone does not enable automated HMI control.

Campaign keeps both tiles adjacent by default, with single-tile focus/expand available. The reusable UI supplies framing, source status and evidence navigation; Muse supplies the machine-specific World content, and the actual HMI supplies the HMI pixels.

## Delivery sequence and acceptance gates

### 1. Define the generated view contract and remove product-level machine assumptions

- Add the versioned package/view contract and generic host interface in the UI lane.
- Inventory hardcoded conveyor dependencies, including context copy, sample fixture loading, geometry extraction and device identities, not only the SVG.
- Move the current conveyor definition into a sample package behind the same host contract.
- Agree the snapshot projection with the runtime lane. Consume the M9 authoritative projection/report for campaign truth; do not create another campaign state model or interpret ledger arrival order as source time.

Gate: the host loads a package by manifest; missing views and missing bindings are explicit; application code has no required conveyor topology or signal names.

### 2. Generate the view as part of ingestion

- Extend the generation request/output package so Muse authors the equipment interpretation, world and visual bindings together.
- Support supplied diagram reuse and missing-diagram generation.
- Compile/load, validate binding references and units, render representative world snapshots, and perform bounded repair on actual validation failures.
- Preserve source citations, assumptions, hashes and the working incumbent on failure.

Gate: a spec with a drawing and a spec without a drawing both yield a bound, inspectable visualization through ordinary ingestion. Engineer corrections regenerate the relevant artifacts.

### 3. Deliver the follow-along HMI session

- Keep the current WebVisu configuration and add actual frame-stream consumption.
- Implement a controlled-browser capture source first, using one persistent session for operation and display. Add selected native-window capture through the same source interface where required.
- Show current captured content in the HMI tile; record timestamped actions and bounded clips/frame references in the ledger.
- Verify source disconnect, recording gaps, replay seeking and timestamp correlation without inventing frames or inferring success from page load.

Gate: an engineer can watch a real HMI session in the tile while an action occurs, then open the corresponding HMI observation and PLC response in the evidence timeline. No HMI source produces the explicit unobserved state.

### 4. Prove that this is not a conveyor product

- Ingest at least two structurally different machines: the conveyor and a pump/tank or batching process.
- Generate both views with Muse through the same workflow, without adding another hand-authored renderer or editing the portal's machine-specific code.
- Drive each view from recorded/observed snapshots; verify selection links, unchanged-but-fresh values, disconnected/unknown data and frozen replay.
- For the HMI, exercise both permitted embedding and controlled-session mirroring, with actual captured evidence.

Gate: adding the second machine changes generated package artifacts and configuration only. The displayed machine follows the ingested spec; the HMI tile follows its actual configured session; requirement verdicts remain grounded in cited observations.

## Ownership and immediate next step

UI lane: generated-view package/host, sample extraction, tile/preview UX, binding validation and capture-stream display. Ingestion/world lane: extracted equipment, model-authored package production, source references and version compatibility. Runtime/connector lane: authoritative state projection, command outcomes and timestamped evidence. Capture integration: persistent browser/window session, frames/clips and capture timing. Coordinate through contracts; do not edit another lane's runtime or CODESYS project as a shortcut.

Start with the generated-view contract, sample-package extraction and one non-conveyor ingestion proof, alongside the real HMI capture producer. This validates the general workflow before expanding visual complexity. The existing portal supplies the framing and evidence inspectors, but these capabilities are not complete today.
