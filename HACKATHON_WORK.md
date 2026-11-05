# Hackathon work and reused material

This file shows what was built for ControlsBench Muse during the Meta Global AI Developer Hackathon and what came from elsewhere. The hackathon rules ask entrants to identify new work clearly. If you find something here that is wrong or missing, treat it as a defect.

**Draft status.** This draft reflects the repository as of **2026-11-01 21:38 EST** (2026-11-02 02:38 UTC). Several branches were still active then, including the offline W4 lanes. Items marked **[BUILDER TO CONFIRM]** need an answer from the builder before submission. Regenerate the commit list just before submitting (see the end of this file).

## Event window

| Event | Time |
|---|---|
| Kickoff | 2026-10-26 17:00 UTC (1:00 PM EDT) |
| Building period on the event page | Oct 27 – Nov 4, 2026 |
| Submission deadline | 2026-11-04 9:00 PM EST (2026-11-05 02:00 UTC) |

## Repository history

- The first commit, `1514ed9`, is dated 2026-10-29 09:12 EDT.
- At the time of this draft the repository held 110 commits across all branches. All of them are dated between 2026-10-29 and 2026-11-01, inside the event window.
- Every commit is authored by the builder's single Git identity. Some commits also carry a `Co-Authored-By` trailer for an AI coding agent (see [AI coding assistance](#ai-coding-assistance)).
- History has not been squashed or rewritten. Keep it that way, so judges can check dates.

## Built during the hackathon

Each row is new work, committed during the event. Times are the builder's local time (EDT until 2026-11-01 02:00, then EST).

| Component | Main paths | Commits | Dates |
|---|---|---|---|
| Product design, conveyor specification, decision register, fault library, first-proof contract | `docs/` (`conveyor-machine-spec.md`, `architecture-decisions.md`, `design-review.md`, `fault-library.md`, `first-proof-contract.md`) | `1514ed9` – `d01fbd7`, later doc updates | Oct 29 onward |
| Model selection spike: Muse Wonder 1.0 vs Muse Spark 1.3 on the same spec | `scripts/run-model-spike.js`, `artifacts/model-spikes/`, `docs/model-selection.md` | `0be5354` | Oct 29 |
| Generated-world contract and proof chassis, Gates A–D (CP-0 to CP-12) | `src/proof/`, `scripts/generate-world-package.js`, `scripts/repair-*.js`, `scripts/run-gate-*.js`, `scripts/continue-gate-c.js`, `test/proof-chassis.test.ts`, `test/budget-guard.test.ts` | `de88c12` – `d862889` | Oct 29 |
| CODESYS measurement fixture and OPC UA connector qualification, M0–M6 | `codesys/gngnf.project`, `codesys/scripts/`, `codesys/artifacts/`, `docs/codesys-*.md` | `b997dff`, `27be60c` (fixture), `f29f5d7`, `949158d`, `c733f86`, `36a5dce`, `cc4395e` | Oct 29 – Oct 31 |
| Live closed-loop coordinator and M7 run | `src/live/coordinator.ts`, `src/live/connector.ts`, `scripts/run-m7-live.*`, `scripts/audit-m7.js`, `artifacts/m7/` | `d58be42`, `9b20ed1` | Oct 30 |
| Engineering portal (Setup, Campaign, Results, evidence replay) | `ui/` | `e94884d`, `cd3b5e7`, `90c15c6`, `0897bc5` | Oct 30 – Oct 31 |
| Campaign runtime, ledger, tools and budgets (M9) | `src/campaign/`, `docs/m9-*.md`, `docs/contracts/`, `artifacts/m9/` | `f1a5420` | Oct 31 |
| M8 conveyor controller program and its live acceptance tests | `codesys/conveyordemo.project`, `codesys/demo/` | `40a544c` | Oct 31 |
| M10 live integration: M8 connector, operator/WCS bindings, six-scenario live run | `src/live/m8-*.ts`, `src/campaign/m8-bindings.ts`, `src/campaign/m10-rehearsal.ts`, `scripts/run-m10-live.*`, `scripts/audit-m10.js`, `artifacts/m10/` | `808d393`, `571e5c0`, `3ab99ff` | Oct 31 |
| Muse-generated machine view: contract, validator, sandboxed host, audits | `src/machine-view/`, `scripts/*machine-view*.js`, `artifacts/machine-view/` | `52f8857` – `042cc6a` | Oct 31 |
| Portal host: hosted campaign, command acknowledgement, HMI capture tile | `src/host/`, `ui/src/adapters/host/` | `7886dfd` | Oct 31 |
| Convergence: hosted M8 campaign factory, machine-view mount, preserved M10 replay page | `src/host/m8-campaign-factory.ts`, `ui/src/components/GeneratedMachineView.tsx`, `ui/src/M10Replay.tsx`, `artifacts/m10-convergence/` | `5d67a91` – `5f29d3e` | Oct 31 – Nov 1 |
| Browser operator HMI for the M8 controller and its live verification | `src/hmi/`, `scripts/run-hmi*.js`, `scripts/audit-hmi-h2.js`, `artifacts/hmi/`, `docs/screenshots/hmi/` | `2db3f24` – `1a4a986`, review corrections `8e9d325` | Oct 31 – Nov 1 |
| Multi-turn Wonder campaign provider, bounded paid checkpoint, and the W3 recorded-evidence checkpoint (partial) | `src/campaign/wonder-responses.ts`, `src/campaign/model-context.ts`, `docs/wonder-campaign.md`, `docs/wonder-w3-checkpoint.md`, `artifacts/wonder/`, `artifacts/wonder-verification/`, `test/wonder-paid-replay.test.ts` | `560a8c0`, `4a2ce22` – `e435a02`, `1acdb60` – `83d473a`, `7d8d85a` – `91c868d` | Nov 1 |
| Independent reviews of the Wonder and HMI handoffs | `docs/wonder-review-*.md`, `artifacts/wonder-review/` (convergence branch) | `dbafddc`, `c338199`, `10b2b05`, `7c1a4dd`, `de0a796` | Nov 1 |
| Integrated application: Wonder and HMI merges, one product launcher, verification, W4 lane packet | `scripts/run-product.ps1`, `docs/product-integration.md`, `docs/w4-parallel-lanes.md`, `artifacts/product-integration/` (integration branch) | `5664a54`, `82a7e57`, `de89a87`, `44b12aa`, `a5f3261`, review `b78e654` | Nov 1 |
| W4 lane A: isolated Wonder process adapter (offline; not live-qualified) | `src/live/wonder-process/`, `docs/w4-process-handoff.md` (process-adapter branch) | `ce533e7` – `85da842` | Nov 1 |
| W4 lanes B and C: integration candidate and product QA (in progress) | W4 convergence and QA branches, `docs/w4-product-qa.md` | `3e2e51e` – `ce592ff`, `f43dd05` | Nov 1 |
| Reusable CODESYS interceptor library: prototypes 0.1.0.0 and 0.2.0.0 (compiled only), machine maps, File-Based Storage pilot, versioning and capability matrix | `codesys/library/`, `docs/plc-adapter-standard.md` | `3d86189`, `b64a7eb`, `87a7ca9`, `1eb0f4a`, `2b404aa` | Nov 1 |
| Submission materials | `README.md`, `HACKATHON_WORK.md`, `docs/submission/` | this branch | Nov 1 |

At the time of this draft several of these components live on separate branches that have not been merged into `main`. The branch for each is listed in `docs/submission/claims-checklist.md`.

## Produced by Meta models during the event

These files were written by Muse models through the Meta Model API, inside ControlsBench, during the event. Request and response records are preserved next to each output.

| Output | Model | Evidence |
|---|---|---|
| Conveyor world: `world.ts`, `world.manifest.json`, `assumptions.md`, `world.test.ts`, plus repair lineage | `muse-wonder-1.0` | `artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/` |
| Model-selection artifacts | `muse-wonder-1.0`, `muse-spark-1.3` | `artifacts/model-spikes/` |
| Gate C sealed diagnosis, follow-up experiment, hot-reload candidate and repairs | `muse-wonder-1.0` | `artifacts/generated-world/.../gate-c/` |
| Gate D adversarial reviews of the connector measurement plan | `muse-wonder-1.0` | `artifacts/generated-world/.../gate-d/` |
| Machine-view SVG and bindings, then two refinement passes that took screenshots of the rendered view as input | `muse-wonder-1.0` | `artifacts/machine-view/` (three generation directories) |
| W3 checkpoint: a two-experiment plan, three evidence-window inspections, two findings and the campaign finish, over the recorded M10 run (three responses) | `muse-wonder-1.0` | `artifacts/wonder/checkpoint-2026-11-01T22-14-56-275Z/` on the Wonder branch. The rejected first attempt, which sent no generation request, is in `checkpoint-2026-11-01T22-10-17-207Z/`. |

## Reused or pre-existing material

### Builder's earlier CODESYS notes and examples (`codesys/codesys_handoff/`)

- **Origin.** A bundle of the builder's earlier CODESYS learning material. Its own `AGENT_HANDOFF.md` says it was built and validated in May 2026 against CODESYS V3.5 SP22.20. That is before the hackathon.
- **Imported.** Commit `27be60c`, 2026-10-30. Not changed for this project.
- **Contents.** Agent steering notes (`codesys_agent_kit/`). A CODESYS Test Manager guide with examples (`test_manager_handoff/`). Its `reference/` folder holds four sample scripts that the bundle describes as shipped with CODESYS. Browser-HMI patterns (`browser_hmi_handoff/`): MQTT and OPC UA designs, a CODESYS POU library folder named `AmznBrowserHmi`, a JavaScript widget library, and a Node.js OPC UA-to-WebSocket relay.
- **How ControlsBench uses it.**
  - Reference reading for the coding agents.
  - At runtime, `src/live/m8-native-transport.ts` (and `src/host/m8-campaign-factory.ts` on the convergence branch) loads the third-party `node-opcua` package from the relay's `node_modules` folder. That folder is installed from the relay's `package.json`. No product code imports source files from the bundle.
- **Not presented as hackathon work** and not shown as a feature in the demo.
- **Rights: [BUILDER TO CONFIRM].** The Official Rules require that the submission be the entrant's own work, owned by the entrant, and not infringe anyone's IP or contract rights. Before the repository is public, confirm the builder holds the rights to publish every file in this folder, or exclude the folder. Check in particular:
  - the four CODESYS sample scripts in `test_manager_handoff/reference/`;
  - the `AmznBrowserHmi` library and the notes about other projects (StopLight, IBIS);
  - whether any of it was created for an employer or client.

  If the folder is excluded, `node-opcua` must be installed from somewhere else first. That is a code change and is not part of this branch.

### Builder-owned Machine Agent and HMaI projects

- **Sources.** Machine Agent (`RaveOregon/industrialintelligence`) and HMaI (`RaveOregon/HMaI`) belong to the builder. `docs/design-review.md` records the reuse audit. It inspected Machine Agent GitHub `main` at `5a11581` (local checkout `0666195`) and HMaI at `3b7505f`, and proposed adapting selected patterns.
- **What was found in this repository.** On 2026-11-01 a search covered `src/`, `scripts/`, `test/`, `ui/src/` and `ui/test/` on every lane branch. It looked for identifiers and file names specific to those projects, such as `opcua-machine-adapter`, `cycle-aggregator`, `CONTROL_TYPES`, `GVL_AgentVisible`, `openai-copilot` and `tag-mapping`. Nothing matched. The design review's ideas, such as a direct OPC UA adapter with readback and provenance-linked findings, informed the design.
- **[BUILDER TO CONFIRM]** that no code was copied or adapted from either project. If any was, list each file with its source path and source revision here.

### Early scaffold

- `src/core/`, `src/connectors/simulated-plc.js`, `src/providers/meta-model-api.js` and `src/server.js` arrived in the first commit (`1514ed9`, 2026-10-29).
- `docs/design-review.md` calls this scaffold unapproved, untested and not the foundation. The accepted architecture and the demo do not use it.
- On `main`, root `npm start` and `npm run dev` still launch `src/server.js`. On `codex/product-integration`, `npm start` runs the product launcher, while `npm run dev` and `npm run legacy:start` still launch the scaffold.
- **[BUILDER TO CONFIRM]** that it was written during the event.

### Planning packet

`HANDOFF.md` mentions an earlier handoff packet in the builder's Downloads folder, used as historical context. **[BUILDER TO CONFIRM]** whether any of its text was copied into the first-day documents. If so, say which.

## Third-party software and services

These are dependencies or tools, not original work. None is presented as part of the submission.

| Component | Use | License or terms |
|---|---|---|
| Meta Model API: `muse-wonder-1.0`, `muse-spark-1.3` (Standard mode) | Product model calls | Meta Model API terms |
| CODESYS Development System 3.5.22.30, CODESYS Control Win, CODESYS OPC UA Server, CODESYS MCP Server 1.1.0.0 (CODESYS GmbH) | PLC programming, soft-PLC runtime, OPC UA endpoint, IDE automation | CODESYS license terms. Not redistributed. The `.project` and `.library` files in `codesys/` were authored with these tools. |
| `node-opcua` 2.173.1, `ws` 8.20.1 | OPC UA client; WebSocket (relay dependency) | MIT |
| TypeScript 7.0.2, `@types/node` 26.6.6 | Type checking and Node type definitions | Apache-2.0; MIT |
| React 19.3.0, React DOM 19.3.0, Vite 8.3.4, `@vitejs/plugin-react` 6.1.2, `@types/react` 19.3.0 | Portal UI and build | MIT |
| Node.js 22+ | Runtime, including `node:test` | Node.js license |
| Google Chrome or Microsoft Edge, controlled over the DevTools protocol | HMI capture and headless view checks | Not redistributed |

Versions are the ones installed in the builder's checkout on 2026-11-01. Check them again on the final merged branch.

## AI coding assistance

The builder used AI coding agents to write and review code and documentation in this repository. **[BUILDER TO CONFIRM the list and wording.]** The evidence:

- worktree folders for OpenAI Codex (`.codex/`, `.worktrees/`), Anthropic Claude Code (`.claude/`) and Kiro (`.kiro/`), none of them tracked;
- `Co-Authored-By: Claude Opus 5.5` trailers on HMI-lane commits;
- lane prompts in `docs/` that name the agents.

These tools helped build the repository. They are not the product's use of Meta models. Muse Code use is not claimed.

## What the demo video shows

The video shows only features built during the event (rows in [Built during the hackathon](#built-during-the-hackathon)). The CODESYS IDE and runtime appear as third-party tools that run the builder's controller program. The video does not show the imported CODESYS bundle as a feature.

## Regenerating the commit evidence

Run this just before submitting, and update the counts and ranges above:

```powershell
git log --all --reverse --date-order --format='%h %aI %s'
git log --all --format='%aI' | Sort-Object | Select-Object -First 1 -Last 1
```
