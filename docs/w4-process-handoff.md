# W4 Lane A: isolated Wonder process adapter

Contract: `controlsbench.wonder-process.v1`, as typed in the frozen `src/campaign/process-port.ts`. The child-process wire protocol is `controlsbench.wonder-process.wire.v1`.
Branch: `codex/w4-process-adapter`. Worktree: `.claude/worktrees/w4-process-adapter`, based on product integration `a5f3261`.

**Status: offline implementation complete and tested. Not live-qualified. No PLC, credential, model or network contact was made.** I did not write a W4 manifest. Lanes B and D assemble that from the pin and evidence files below.

## Pins

| What | Value |
|---|---|
| Implementation commit | `9e98da72ed667368078922a8a5233b08886a8476` |
| Stable module path | `src/live/wonder-process/index.ts` |
| Live export | `createWonderSession(context): Promise<IsolatedWonderSession>` |
| Offline export, for B's fake-transport integration | `openOfflineWonderSession(context, options)` |
| Child launcher | `scripts/wonder-process-child.js` (forked by `src/live/wonder-process/channel.ts`) |
| Offline evidence | `artifacts/w4-process/2026-11-02T00-02-35-343Z/` (`sourceCommit` = the implementation commit, clean tree) |

This document and the evidence are committed after the implementation commit and reference it. Nothing in the implementation references its own commit, so there is no self-pin. The module never hardcodes a commit; it reads the pin and manifest from the environment and verifies them (see below).

`src/live/wonder-process/.gitattributes` sets `-text` so the adapter's bytes are identical in every checkout. The stricter entry check on `codex/wonder-campaign` (`91c868d:src/campaign/owner-handoff.ts`) compares the entry's exact bytes with its pinned blob, so this matters.

## Files and ownership

All files are new; no existing file was modified.

- `src/live/wonder-process/`
  - `protocol.ts`: wire messages, stream record shapes and timing constants.
  - `engine.ts`: the child engine (world time, cadence, interventions, leases, reset/exit/close).
  - `write-gate.ts`: refuses every write after quarantine and tracks uncertain writes.
  - `ownership.ts`: the shared lock.
  - `channel.ts`: parent-side fork/IPC, stream integrity and the boundary journal.
  - `driver.ts`: parent-side `CampaignDriver`, decision leases, controller and passthrough adapter.
  - `session.ts`: live and offline session construction.
  - `index.ts`: the stable entry.
- `scripts/wonder-process-child.js`: the child launcher.
- `scripts/run-wonder-process-proof.js`: the offline evidence runner.
- `test/wonder-process.test.ts`: 14 tests, each running the real child process.
- `test/fixtures/wonder-process-transport.ts`: fake M8 transport. It builds on the existing protocol fixture and is never an oracle for M8 behaviour.
- `test/fixtures/wonder-process-parent.ts`: a stand-in host process for the parent-loss tests.

The HMI source, provider loop, portal UI, machine controller, runtime, process port, contracts, ledger and generated packages are all unchanged.

**For B:** `package.json` is B's file, so I left it alone. Add `test/wonder-process.test.ts` to the `test` script. `tsconfig.json` already covers `src/live/**` and `test/**`.

## Interface

`process-port.ts` is unchanged, so B does not need a contract revision. The adapter's additions are all additive:

- **Lease receipts** carry an extra `boundary` object: `contract`, `childNonce`, `state`, `policy`, `boundaryRevision`, `basisSeq`, `beganAtIso`, `terminalAtIso`, `elapsedMs`, `worldHeld` and `plcScanContinues: true`. The runtime already preserves whole receipts in `agent.response`, so this detail becomes durable evidence.
- **The driver** also exposes:
  - `tick()` for the manual cadence (`start(false)`);
  - `boundaryRevision`;
  - `dispose()`.
- **The session** also exposes `process`: offline flag, child identity (pid, nonce, `timeOriginEpochMs`), loaded world and journal directory.

### Session construction

Construction is read-only: it causes no PLC contact, takes no lock and opens no transport.

**Live: `createWonderSession(context)`**

1. Requires these environment variables: `CONTROLSBENCH_WONDER_PROCESS_COMMIT`, `CONTROLSBENCH_WONDER_HANDOFF` and `CONTROLSBENCH_WONDER_HANDOFF_SHA256`.
2. Verifies the manifest with the existing `verifyOwnerHandoff`.
3. Checks that its own checkout's HEAD equals the pin and that `src` and `scripts` are clean.
4. Requires the host's artifact directory.
5. Runs the existing read-only `m8Preflight` against the shared main-checkout lock (`commonWonderPaths().ownership` = `artifacts/m10/live.lock`).
6. Forks the child, which hashes and imports the preserved world and reports the bytes it loaded.

The resulting handoff is `{ commit: <pin>, isolationVerified: true, recoveryVerified: true, evidenceRef: "sha256:<manifest>" }`. Provenance is `plcBuild: 8001/interface-1/sha256:<project bytes>` and `worldModule: sha256:<bytes the child loaded>`.

The child environment drops `MODEL_API_KEY` and every key, token, secret or password variable except `OPC_USER`/`OPC_PASSWORD`. The child deletes the password from its environment once the native transport exists.

**Offline: `openOfflineWonderSession(context, { transportModule, ownershipPath, timing?, transportOptions?, journalDirectory? })`**

This uses the same child, driver and protocol with an injected `M8Transport` module. It refuses the shared lock path. Its handoff evidence reference reads "offline fixture only…", it is never a live handoff, and its provenance is labelled `offline-fixture-transport`.

To exercise the whole provider/driver/controller/lease path, inject it through the existing factory:

```ts
createCampaignFactory({ provider: () => zeroCostProvider,
  openSession: context => openOfflineWonderSession(context, { transportModule: "<abs>/test/fixtures/wonder-process-transport.ts", ownershipPath: "<lane-specific lock>" }) });
```

The "provider campaign through the Wonder factory" test does exactly this.

`initialize()` (after Start) is where the child acquires runtime ownership first, then opens the M8 connector with `requireStoppedBaseline: true` and initializes the coordinator and world. If the lock is held, it refuses without contacting the PLC.

## Process boundary

The parent forks the child with IPC, `detached: true` and above-normal priority.

The child reuses `LiveWorldCoordinator`, `M8OpcUaConnector` and the in-process driver's tick semantics:

- a 100 ms cadence with no catch-up burst;
- an elapsed world step bounded by the **300 ms** observation guard;
- the full freshness, boot, epoch, sequence and capture-cycle correlation checks;
- held ticks that re-commit the unchanged image without advancing world time.

It keeps no campaign ledger, imports neither `CampaignRuntime`/`CampaignLedger` nor H2's plan (a test checks this statically), and owns no experiment policy.

### Wire protocol

**Parent to child:**
- `{ type: "request", id, op, args, knownCampaignRevision }`
- `{ type: "ping", knownCampaignRevision }`, every 250 ms (unref'd).

**Child to parent:**
- `{ type: "ready", identity }`
- `{ type: "stream", nonce, seq, record }`
- `{ type: "reply", id, ok, value | outcome+message, boundaryRevision, throughSeq }`

**Ops:**

| Group | Ops |
|---|---|
| Lifecycle | `load` (read-only), `initialize`, `start`, `hold`, `tick`, `close`, `status` |
| Interventions | `apply`, `cancel`, `controller` |
| Leases | `leaseBegin`, `leaseFinish`, `leaseInterrupt` |
| Simulation | `reset`, `exit` |
| Test only | `fixture` (offline child only; refused in live) |

**Stream records:**

| Record | What it carries |
|---|---|
| `source` | Original `CoordinatorEvent`. Origin `live-coordinator` for coordinator records, `campaign-driver` for direct hold/reset commits, as in-process. |
| `world` | Original `InstrumentedWorldContext` record. |
| `stimulus` | Action ID, control, visibility, campaign revision and boundary revision, emitted before application. |
| `fresh` | Freshness observation. |
| `tick` | Confirmed image, snapshot, child confirmation time, world time, step and tick durations, and whether the world advanced or was held (and by what). |
| `delayed` | Coordinator overrun. |
| `lease` | Terminal lease transition decided by the child. |
| `hold` | Parent-silence hold. |
| `fault` | Quarantine, with the uncertain writes. |
| `write` | Settlement of a write that was uncertain after quarantine. |
| `controller` | Sequenced command outcome, with `afterCancellation`. |

### Evidence derivation

The parent ingests records in order:

- `source` goes through the existing `appendCoordinatorEvent`. The ledger's own reference checks bind each `world.raw_image`, `plc.acknowledged` and `plc.output` to its exact source.
- `world` becomes `world.evidence` (truth lane).
- `stimulus` becomes `world.stimulus`.
- `fresh` and `fault` become `connector.state`.
- `delayed` and `hold` become `agent.activity`.
- `controller` becomes `controller.action`.

The parent also re-checks that coordinator sequences are contiguous, direct-commit sequences increase, and boot/epoch/workstation sequence stay consistent. Any violation is an integrity fault.

### Sequence, gap and duplicate rule

Records must arrive exactly once, in order, from one child nonce:

- `seq === last + 1`: ingested.
- A repeat of an already-ingested seq with byte-identical content (canonical SHA-256, 512-record window): dropped and journaled.
- Any of the following is an integrity fault: different content for an ingested seq, a skipped or reordered seq, a foreign nonce, or a reply whose `throughSeq` is ahead of the ingested stream.

After an integrity fault, nothing more is ingested, with no reassembly or replay. The driver quarantines, the runtime holds through `onFault`, and the parent stops the child's loop with `hold { stopClock: true }`.

### Revisions and identities

Every `apply` and `controller` request carries:
- the original action ID;
- `campaignRevision`, the runtime's originating `basedOnRevision`;
- `boundaryRevision`, the latest child boundary revision the parent had received.

The child refuses, as stale or rejected, without applying or replaying anything:
- a duplicate ID, including one that bypassed the parent's own duplicate check;
- a campaign revision older than the newest it has seen (from any parent message);
- a changed boundary revision;
- any request while held, quarantined, reset, exited, closed, or while a reasoning lease is open.

The child boundary revision changes on Start/Resume, hold, lease hold, release or termination, an applied intervention or controller command, reset, exit and faults. **Ordinary sampling ticks change neither revision**, so a turn stays valid while the PLC keeps being sampled.

### Reasoning leases

All lease timing is enforced on the child's monotonic clock: a timer, checked again on every tick.

| Policy | During reasoning | Child ends the lease when | `finish` within bounds |
|---|---|---|---|
| `hold` | World and image held. The unchanged image is re-committed every 100 ms and the PLC scans. | The deadline passes. | Valid; releases the hold. |
| `continue` | World runs. | The deadline passes, then the world is held. | Valid; the world keeps running. |
| `condition_deadline` | World runs. | The declared PLC observation equals the value in a confirmed commit (including at begin), or the deadline passes. Then the world is held. | Valid; the world keeps running. |

Expiry, condition met, model cancellation or timeout in the parent (`leaseInterrupt` on the model's abort signal), campaign hold, quarantine and parent silence all end the lease as `expired`, `condition_met` or `interrupted`. The world then stays held, and `finish` returns `valid: false` with the reason. The frozen runtime responds by pausing without applying the late decision. Resume clears the hold.

Receipts cite the `plc.output` of the confirmed commit they rest on. Every hold receipt states: "PLC scan and timers continue; the unchanged complete image is re-committed every 100 ms without advancing world time."

### Parent silence

If no parent message (pings included) arrives for `parentSilenceMs` (15 s live), the child holds the world and reports it. The driver calls `onFault`, so the runtime pauses, but it does not quarantine. An engineer Resume restarts the world.

### Cancellation and uncertain writes

**Cancellation:**
- A control not yet in a tick is withdrawn with no world change.
- A cancel that arrives while a control is in a tick is honoured if the control has not yet been applied.
- A controller command already in flight is never undone. The runtime receives `inconclusive` ("may have applied request"), and the late PLC acknowledgement is still recorded as `controller.action` with `afterCancellation: true` in the child stream.

**Uncertain writes:**
- When a tick, commit or command exceeds `operationTimeoutMs` (5 s live), the session quarantines and the outstanding writes are reported as uncertain.
- The write gate then refuses **every later write**. Without it, the M8 connector's serial queue would run a queued operation once the timed-out write settled.
- A late settlement is recorded and the session stays quarantined.
- There is no silent retry, automatic Reset or implicit passthrough.
- A timed-out IPC reply for `apply`, `controller` or `reset` also quarantines the parent driver. For `exit`, the child's own operation deadline quarantines it.

### Stop, reset, exit and dispose

| Operation | What it does |
|---|---|
| Stop/finalize | `hold(true)` drains the in-flight tick and stops the clock. No passthrough. |
| `reset()` | Commits a complete zero image as a direct `campaign.reset` commit, records `simulation.reset`, and keeps simulation selected and held. A new campaign is required. |
| `exit()` | Writes `SimRequest=false` and returns the observed passthrough. The driver records `simulation.exited` and `connector.state: passthrough`. |
| `dispose()` | Drains bounded outstanding work (`drainMs` 10 s live), then closes the coordinator and connector. It never resets or exits simulation. |

### Ownership and process loss

The child takes the shared lock at `initialize`, recording `owner: "wonder-process-v1"`, campaign, child and parent pids and a nonce.

- **Release:** only after a drained close with no uncertain write, and only if the file still carries its own nonce.
- **Retention:** otherwise the lock is kept (`retained_uncertain`) for explicit reconciliation. Nothing deletes another owner's lock.
- **Child killed:** the driver quarantines ("outcome unknown"), the runtime holds and the lock stays.
- **Parent lost:** the IPC channel closes. The child freezes world time at once, drains, closes and exits, and writes `parent.lost` and `closed` to its lifecycle journal.

The child must be detached for this to work. On Windows, libuv places non-detached children in a kill-on-close job, so a killed host would also kill the child, mid-write, before it could drain. The H2 coordinator child had that limitation.

### Journals

Under `<campaign artifacts>/wonder-process/`:

- `child-stream.jsonl`: every record the child produced, independent of what the parent ingested.
- `child-transport.jsonl`: M8 transport events, never credentials.
- `child-lifecycle.jsonl`: load, ownership, stream faults (fixture), `parent.lost`, `closed`.
- `parent-boundary.jsonl`: requests and replies with revisions, deadlines, duplicates, integrity faults, cancel results and terminal leases.

Source `atMonotonicMs` values are child-process monotonic; `child.ready` records the child's `timeOriginEpochMs`.

## Offline results

All runs were on this workstation with Node v24.15.0.

| Check | Result |
|---|---|
| Real-child tests (`test/wonder-process.test.ts`) | **14/14** |
| `tsc --noEmit` | Pass |
| Existing suite plus the new file, in PowerShell with the gate's Chrome path | **169/169** (155 existing + 14) |
| Existing suite under the Bash sandbox | 153/155. The two CDP capture tests can't start Chrome there; both pass in PowerShell, as recorded in earlier lanes. |
| Live entry fail-closed probe (scratch, not committed) | Scratch manifest citing these files, pinned to the then-HEAD `75ec0a1`, with no credentials in the environment. The manifest and own-checkout checks passed. The entry then refused without an artifact directory, then stopped at the M8 preflight (`credentialsPresent: false`), **before forking a child**. It took no lock and made no PLC contact. |

Measured values (`measurements.jsonl`):

- **Parent stall:** a 1,500 ms parent event-loop stall under a 400 ms `continue` lease.
  - The child expired the lease at 409 ms, during the stall.
  - It committed 14 times during the stall, with a 110 ms maximum gap.
  - It then held the world: 11 samples at constant world time while PLC cycle 6 advanced to 16.
  - The late decision had no effect.
- **Hold lease:** 707 ms of reasoning under a `hold` lease. Six held samples, world time frozen, PLC cycle 2 to 7, a valid receipt, and an unchanged campaign revision.
- **Condition lease:** the unmet case was released when the decision returned. The met case held 86 ms after the scripted output change, citing the matching `plc.output`.
- **Delayed write:** a write delayed 2,600 ms under a 1,500 ms operation timeout.
  - The session quarantined as `timed_out`, with `Slot0_Valid` uncertain.
  - No write started afterwards.
  - The write settled at 2,614 ms.
  - The session then drained and the lock was released.
- **Parent loss:**
  - Steady state: drained, closed, lock released.
  - With a hanging write: not drained, one uncertain write, lock **retained**.

Evidence files in `artifacts/w4-process/2026-11-02T00-02-35-343Z/` (SHA-256):

| File | SHA-256 |
|---|---|
| `isolation.json` | `5f33de1b52722d6316aa3b2de91bb83b4df5b661b6738aa83f816f56c15336c0` |
| `recovery.json` | `a0069c7907a60f1e40fa2b9073f932b72d2a4c677395ff3686322bc7819c476b` |
| `campaign-port.json` | `0020a42a5711ddcdd710e88a679df0d1a233507bc68de9773d2c634d89b2ba41` |
| `result.json` (blob and SHA-256 of every implementation file and executed dependency) | `cbacff21be5afd9cddb7fb3c0c1e9d902d484351f7beac029353fe2daea95fe7` |
| `tests.tap` | `33c7b652aaab704907a0ad05a0fc2514cae5fd0c79f1dad7c5137d0f02a84bdf` |
| `measurements.jsonl` | `8accc407cd48a7a9f460a3c698532207b3e370e89d28556f679e2d9339c04a03` |
| `union-suite.txt` (169/169 log, commit line first) | `138e5d58bf53c8684c1f6f0492a29485dc3607279a7e75e668a9ea054776719a` |

`samples/factory-campaign` and `samples/parent-stall` hold the host ledger (`campaign.jsonl`) and all four journals. They let a reviewer recheck lineage from the child's records to the ledger.

Each check file has `status: "pass"` together with `scope: "offline-fake-transport"`, `realChildProcess: true`, `livePlcExecuted: false`, `liveTimingQualified: false` and `liveRecoveryQualified: false`, plus explicit `establishes` and `doesNotEstablish` lists. `verifyOwnerHandoff` reads only `status`. **Citing these offline files in a live manifest is the runtime owner's scope decision**; they are not live timing or recovery qualification.

### Implementation source identity at the pin

Git blob and SHA-256 of the blob bytes:

| File | Blob | SHA-256 |
|---|---|---|
| `src/live/wonder-process/index.ts` | `e4d44773285dd9a8da22556bf826ab18baf4f332` | `f580e76622ea523e39b91418498b6980f1382649056da8a60e1e51b78a64c379` |
| `src/live/wonder-process/session.ts` | `a5bc5ec269e354d037381b39d9802ddb7353a5f8` | `89fbceb66295a2f8da63d74e88631c42d480debbfe27e554efb512b98b5372f7` |
| `src/live/wonder-process/driver.ts` | `fff476f5ae1fc175c0252b50eba25c3ca9a9e917` | `68f3f910c98b52343d36e74b4664c97548a6480b08285902ac3df8b4d7b1a1dd` |
| `src/live/wonder-process/channel.ts` | `b4251b977122fac3b00959116ced08774e60a87d` | `aadaa7a713b1cdde87ff071df8a29a247339c24cb7ba818b89677674ec9ad85f` |
| `src/live/wonder-process/engine.ts` | `e9d97ebe85076613ad35c5d39281814f9f8a3e36` | `4f60d8b16907d63da82f8c975353346cde15db08286cfe32b95016a36d2c4f34` |
| `src/live/wonder-process/protocol.ts` | `e33d09879aaf82e6ecd19d1152850c5d1d869e17` | `eecbfcf0c9d56139be6749c9cd9f66a2e2f9a379dca20dcf9dc1bd86a5a47974` |
| `src/live/wonder-process/write-gate.ts` | `97b28d9b729c1c2a1be3963b57ccc9960a52edbb` | `1e00f6287f23cdc2472bef814074eaea114e17705f2404f35b58ff35f88ef337` |
| `src/live/wonder-process/ownership.ts` | `0ee5992189ee0a7a5f0c3f01e11bae3fd5837c78` | `7c10704916787f7afab0673cba16071f3555df4b30c73d7d1db539857c1badf4` |
| `src/live/wonder-process/.gitattributes` | `4a057e2dd1c467993fb4efbc254b5ca73eeb76d5` | `a2db3b265bf480a7bfc92b0576f4e127f31c4563d6df882905e09f6eee45a601` |
| `scripts/wonder-process-child.js` | `9e7090199a84d16bceb0a8ec6ffb6327e08ce5b5` | `b0bb9e415772ab5bd88dc5f79b79dd4a10ed8634ce7f489091ee0e9e02fe1166` |
| `scripts/run-wonder-process-proof.js` | `1a07fa19f064d11a5d52467a769ce9c194d22d03` | `7e22061401b7a07fcd33437161dc5b6707b2ddc5c23ec8ba1f138fbf59d50e4a` |
| `test/wonder-process.test.ts` | `09bf79355d188a036d01aad63b75cee4aee0f1e7` | `11706beb302d475c980f305c17f6eac3a33338d46e0da5545a5883df30faf7f7` |
| `test/fixtures/wonder-process-transport.ts` | `ef0f839347fa28056d06238824b8a41834496dea` | `2d3c3acdf8ba6dfa0edc606f881e799a4b999d3193ff4d23015568761fb988a5` |
| `test/fixtures/wonder-process-parent.ts` | `f2fdc20ade99952455257c1bac93ffce8b9da530` | `0348751dbde095cc18c3c8f434d24e75457cec6eb196ba9c3841d98192089aa4` |

The factory's entry check requires the checkout HEAD to equal the manifest's `ownerCommit`.

- If D loads the entry from B's integration commit, that commit is the owner pin.
- In that case these blobs must match B's tree byte for byte: `git ls-tree <pin> -- src/live/wonder-process scripts/wonder-process-child.js`.
- The offline evidence above then describes the identical adapter, but its `sourceCommit` remains `9e98da7…`.

### Commands

```powershell
node --test --test-concurrency=1 test/wonder-process.test.ts
node scripts/run-wonder-process-proof.js   # clean checkout required; writes artifacts/w4-process/<ts>/ and latest.json
npm run typecheck
```

## Existing recovery evidence

**Still applies:**
- **H2's live isolated-coordinator evidence** (`artifacts/hmi/h2/`, three 13/13 audited runs). On this bench a separate above-normal-priority coordinator process kept the M8 heartbeat while HMI, portal and capture ran in the parent. That is prior live evidence for the isolation approach, not for this child: H2's child, plan and private ledger differ.
- **The recorded held-state reconciliations** (`scripts/recover-hmi-h2-baseline.js`, four passing) and **M10's `scripts/prepare-m10-baseline.js`**. They remain valid, explicitly authorized procedures **only for their own run formats and preconditions**. The H2 script accepts only a saved H2 run directory under `artifacts/hmi/h2`; neither recognizes a W4 campaign directory.

**A W4 held state therefore has no applicable recorded recovery yet.** It needs an exactly matching procedure written and reviewed for W4's evidence, or an explicit user-directed reconciliation. This adapter performs no recovery, Reset or passthrough on its own.

## Live cases not yet verified (for D)

1. The native OPC UA session inside the detached child. This covers credential handoff by environment and deletion, the `requireStoppedBaseline` refusal on a dirty controller, and clean session close.
2. 10 Hz cadence and the 300 ms guard on the bench with the portal, browser HMI capture and paid model calls running together. Late steps must fail and be recorded, never relaxed.
3. Lease expiry, condition and interruption timing against real PLC commits, including a real model timeout.
4. A real OPC UA write timeout and its settlement, and the PLC's `ConnectorStale` watchdog once the child stops committing after quarantine, parent loss or dispose.
5. Parent loss on the bench: the detached child's drain and close with the native module, and lock release or retention under `artifacts/m10/live.lock`.
6. M8's response to a zero-image reset, and to exit/passthrough observed on the real PLC.
7. Sequenced controller commands (Start/Stop/Reset, WCS offer, completion acknowledgement) and late acknowledgements after cancellation, against M8.
8. Ownership contention with an active M8 or H2 session, and a stale lock from a killed child.

## Design notes for B and D

- **Boundary revision.** Requests carry the latest child revision the parent had received, so the check catches child changes still in flight. Child-initiated holds also reject interventions directly.
- **Lease condition at begin.** A condition that is already true at begin ends the lease immediately as `condition_met`.
- **Model failure after a valid `finish`.** A valid `finish` releases a hold-mode lease. If the model failed without aborting its signal, the frozen runtime pauses straight after `finish`. The world can therefore run for up to one parent turn, at most about one tick, before that hold. No decision effect is applied.
- **Parent silence.** Silence holds the world but does not quarantine. Resume requires the engineer.
- **Ledger origins.** Coordinator events keep the existing `coordinator.event` origins, so `contracts.ts` is unchanged. Child identity and wire metadata live in the journals and lease receipts.
- **Detached child.** A host killed outright leaves the child running for at most `drainMs` plus close. A new campaign during that window is refused by the lock, which is the intended behaviour.
