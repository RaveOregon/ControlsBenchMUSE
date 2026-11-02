# W4 zero-model commissioning harness and held-state recovery

Branch `codex/w4-commissioning`, worktree `.claude/worktrees/w4-commissioning`. It is based on Lane B's integration candidate `265242b5c354e00373d51de3dc8d94ca66df5b73` (`codex/w4-convergence`), which carries Lane A's adapter unchanged from its pin `9e98da7`.

This lane prepares the bounded zero-model stage that Lane A's review asked for before any paid W4 run, together with a W4-specific recorded recovery path. Everything here is **offline**:

- no PLC connection, credential, Meta call or network use;
- no change to B's adapter, the process port, the runtime, contracts, `package.json` or shared configuration (the proof checks that every change since `265242b` is an added file).

| Commit | Content |
|---|---|
| `1ff8f62be1fe75e35a77d2ffb087c8f9b923eee8` | **Implementation**: harness, recovery, shared library, PowerShell wrapper, proof runner, fixture, tests |
| next commit | Offline evidence and this document |

## Files (all new)

| File | Role |
|---|---|
| `scripts/run-w4-commissioning.js` | Zero-model commissioning harness (`controlsbench.w4-commissioning.v1`) |
| `scripts/recover-w4-held.js` | W4 held-state reconciliation (`controlsbench.w4-recovery.v1`). Inspect-only by default. |
| `scripts/lib/w4-commissioning.ts` | Read-only inspection gate, held-state derivation (`controlsbench.w4-held-state.v1`), classification against recorded paths |
| `scripts/run-w4-commissioning.ps1` | Masked credential prompt and offline gate for the live steps |
| `scripts/run-w4-commissioning-proof.js` | Offline evidence runner |
| `test/w4-commissioning.test.ts` | 9 tests. Each harness and recovery run is the real script, using the real runtime and child. |
| `test/fixtures/w4-bench-transport.ts` | Bench fixture: Lane A's protocol fixture plus hand-written scripted reactions, persisted to a state file. **Not an M8 behaviour model or oracle.** |
| `artifacts/w4-commissioning/.gitattributes` | `-text`, so evidence bytes keep their SHA-256 values |

## Commands

Offline (no PLC):

```powershell
node --test --test-concurrency=1 test/w4-commissioning.test.ts   # 9 tests, about 90 s
node scripts/run-w4-commissioning-proof.js                        # clean tree required; writes artifacts/w4-commissioning/offline-proof/<ts>/
```

Live, for D only, from PowerShell. Each command runs the typecheck and the commissioning tests first unless `-SkipOfflineGate` is given. The password is entered at the masked prompt only.

```powershell
# 1. Read-only baseline: no write, lock held only during the read
scripts/run-w4-commissioning.ps1 -Inspect

# 2. Zero-model commissioning run (needs the W4 manifest environment, see Live prerequisites)
scripts/run-w4-commissioning.ps1 -Run -LoadNote 'portal :5190 open on Machine view; HMI live capture session <id> running'

# 3. If the run stopped held: review read-only, then reconcile only after reviewing the plan
scripts/run-w4-commissioning.ps1 -RecoverFrom artifacts/w4-commissioning/<run>
scripts/run-w4-commissioning.ps1 -RecoverFrom artifacts/w4-commissioning/<run> -Reconcile -Authorize <held-state.json sha256>
```

`-ModuleCheckout <path>` points the harness at a different pinned adapter checkout. The default is the harness's own checkout.

## Harness phases

The harness constructs the real `CampaignRuntime`, using `requireDecisionLeases`, no durable Wonder session account and a zero-cost provider. It uses the integrated adapter's `createWonderSession`, or `openOfflineWonderSession` offline. All steps are declared commissioning steps, not Wonder decisions. The ledger's claim boundary and provider ID (`w4-commissioning-scripted-leases-v1;zero-model`) say so.

| Phase | What happens | Passes when | Otherwise |
|---|---|---|---|
| Preconditions | Frozen project hash. Live also checks: clean harness checkout, pinned entry (`verifyOwnerEntry`), manifest environment, `m8Preflight`, lock absent. Offline: lane lock only. | All true | `refused`, no PLC contact |
| Baseline | Takes the lock, then reads only through a gate that refuses every write (`baseline.json`), then releases the lock | Connector stopped baseline: Mode 0, fault 0, no item, no pending completion, motor off | `refused`, no write. A non-clean PLC is never "fixed" here. |
| Session | The child takes the lock and connects with `requireStoppedBaseline`. The harness waits for the child to confirm Start, then checks boot identity against the baseline. | Running, same boot | `held` if anything was written |
| Normal | Plan, then Reset and Start. Wait for Auto, belt running and release ready. WCS offer item 401 to route A, introduce carton, PLC tracks it, completion. | Exit 1, disposition 1, item 401, route 1, `CountExitA` +1, others unchanged; carton leaves; acknowledgement re-enables release | `held` |
| Leases | Six scripted turns, described in the next table | Exact receipt sequence; late decisions never applied; holds show an unchanged image while the PLC cycle advances | `held` |
| Fault | Auto with the belt running, then a declared `fault.setOverload` | Fault 10, Faulted, motor off; latched for 500 ms; clear in the image; operator Reset brings it to Stopped | `held` |
| Shutdown | Stopped baseline with an empty world, then `finish_campaign` and dispose (drain, close, release). Then a read-only post-stop inspection. | Final applied epoch, sequence and image equal the last acknowledged commit; stopped baseline; lock `released` | `failed_final_state` and then `held` |

The PLC is left Stopped and fault-free, with simulation selected and the last at-rest image held, as in M10. There is no passthrough. `ConnectorStale` asserts after close, as M8 is designed to; it is not a machine fault.

The lease turns (provider keyed by finished leases, so a lease that ends at `begin` keeps the script aligned):

| Turn | Lease the turn runs under | Scripted provider | Expected receipt |
|---|---|---|---|
| 1 | `hold` (runtime default) | 700 ms | `released`, valid |
| 2 | `continue` 3 s | 300 ms | `released`, valid |
| 3 | `condition_deadline`, `ItemActive == true`, 3 s (unmet) | 300 ms, then introduces an unassigned carton | `released`, valid |
| 4 | `condition_deadline`, `ItemActive == true`, 6 s | Returns after the PLC reports the carton | `condition_met`, invalid, world held; the late decision is not applied. The runtime pauses, and the harness resumes it after 1 s. |
| 5 | `condition_deadline` (unmet; the carton has finished at runout and been acknowledged) | 200 ms | `released`, valid |
| 6 | `continue` 400 ms | 1.5 s synchronous parent event-loop stall | `expired`, invalid, world held during the stall; the late decision is not applied. Then Resume. |

Each Resume waits for the child's Start confirmation; see finding 1.

## Run directory

`artifacts/w4-commissioning/<ts>/`:

| File | Contents |
|---|---|
| `result.json` | Status, phases, identities (harness/module commits, entry attestation, preflight, child identity, loaded world and project), measurements (cadence, lease receipts, stall commits, held windows), final state, evidence hashes |
| `baseline.json`, `final-inspection.json` | The two read-only inspections |
| `inspection-transport.jsonl` | Their transport events |
| `campaign.jsonl` | The host ledger (one ledger) |
| `wonder-process/*` | Lane A's child and parent journals |
| `report.json` | Ledger report |
| `held-state.json` | Only when the run stopped after writing |

## Held-state record (`controlsbench.w4-held-state.v1`)

Written when the run stopped for any reason other than pass and the child wrote to the PLC. It is derived from the child's own journals, which record what it actually did, and cross-checked with the host ledger:

- **PLC identity at stop:** boot identity, applied epoch and sequence, PLC cycle and time, simulation and stale flags.
- **Exact applied raw image:** all 20 inputs, plus its SHA-256.
- **Commits:** the last acknowledged commit (epoch, sequence, slot, image), and the in-flight commit if one was requested without an acknowledgement.
- **In-flight commands:** sequenced commands requested without an applied acknowledgement.
- **Uncertain writes:**
  - outstanding at close;
  - outstanding at quarantine;
  - late settlements;
  - whether the child recorded a close (`not_recorded` after a crash).
- **Last full observation:** every controller and output value, with the active image.
- **Item and completion state:** Mode, fault, `ItemActive`/`ActiveItemId`, completion sequence, item, route, exit, disposition and pending flag, and the counters.
- **World:** cartons at the last advanced tick, the faults the run injected, and the faults it cleared.
- **Ownership:**
  - the lock the child acquired (nonce, pids);
  - its close result (`released` or `retained_uncertain`);
  - whether the lock is present and still the run's own;
  - the lock's SHA-256.
- **Child and ledger:** child pid, nonce and exit code; whether the parent was lost; whether the ledger's last acknowledgement agrees with the child's.
- **Post-stop inspection:** the read-only observation once the child had gone, and whether its image equals the applied image.
- **Evidence:** SHA-256 of the ledger and the four journals.

`result.json` records `heldState.sha256`. That hash is the authorization token for a reconciliation.

## Recovery procedure (`scripts/recover-w4-held.js`)

**Preconditions, before any PLC contact:**

- The reference is a direct child of the W4 artifacts root, and its result status is `held`.
- `held-state.json` matches the recorded hash, and every evidence file still matches its recorded hash.
- The child transport journal's last acknowledged commit matches the record.
- The frozen project and world bytes are unchanged.
- The ownership path is the same.
- The run's child pid is not running.
- Live only: preflight passes (project, legacy sessions, native module, credentials).

**Ownership:**
- If the lock is free, it is taken with `wx`.
- If the lock is present, it is adopted only if all of these hold: it is a `wonder-process-v1` lock carrying this run's nonce and campaign, its host pid is not running, and its bytes equal the recorded `lockSha256`.
- Any other owner causes a refusal.
- Inspect-only restores an adopted lock byte for byte.
- A pass, or any run that wrote nothing, releases the lock. A failure after the first write retains it.

**Read-only inspection:**
- It runs through `ReadOnlyTransport`: every write throws until `authorize()` is recorded on the same connection.
- The observation is classified against the record. The result goes to `<run>/recovery-<ts>/inspection.json` and `result.json`.

**Common checks:**
- Boot is unchanged.
- Simulation is still applied.
- The applied epoch and sequence equal the run's last acknowledged commit, or its recorded in-flight commit.
- The active image equals that commit's image exactly.
- `CountExitA/B`, `CountRunout` and `CountMisroute` are unchanged.
- Every uncertain write is on a path that observation can resolve:
  - commit-protocol paths, by the commit match;
  - session paths, by simulation and epoch;
  - command paths, by their acknowledgement fields.
- A changed command acknowledgement is allowed only for a recorded in-flight command, and only as +1.
- A late in-flight commit is accepted only if the controller shows no reaction that the run never observed.
- Only `controller.EncoderDelta` may settle to 0 while the image is held.

**Supported paths.** Each one is a held-state change recorded on this M8 build, paired with the write sequence that then reconciled it live in H2:

| Path | Recorded state (R) → current state (C) | Write sequence | Live evidence for the sequence |
|---|---|---|---|
| `stopped-clean` | Clean stopped, unchanged | **None.** The next initialize does its own session reset. | — |
| `held-running` | Auto, motor on, no item, no fault; unchanged. Held image is running and at rest. | Stop → session reset + 5 fresh at-rest commits → re-commit until Stopped (≤ 3 s) | H2 `recovery-2026-11-01T15-12-24-875Z` |
| `transit-timeout` | Auto with a tracked carton → only the recorded transit-timeout fields changed: fault 33, Faulted, motor and diverts off, carton aborted once (disposition 4, no exit, sequence +1, same item), `CountFaulted` +1 | Stop → fresh world → `CompletionAck` (exact sequence) → Reset | H2 `recovery-2026-11-01T14-54-13-612Z` |
| `transit-pending` | Auto with a tracked carton, unchanged | **Refused, no write.** Re-inspect after at least 30 s of held Auto. | — |
| `held-overload` | Fault 10 from the run's own uncleared overload, held at rest in the image; optionally a recorded in-flight Reset that landed and was rejected | Stop → fresh world → Reset | H2 `recovery-2026-11-01T15-05-01-135Z` |
| `start-feedback-timeout` | Clean stopped with a recorded in-flight Start → `StartAck` +1, fault 11, Faulted | Stop → Reset (image unchanged) | H2 `recovery-2026-11-01T14-58-55-527Z` |
| Anything else | e.g. an undeclared fault, completion pending, an in-flight commit with an unobserved reaction | **Refused, no write.** Decide separately with the bench owner. | — |

The transit-timeout field set is taken from the H2 diff of the last recorded observation against the PLC at recovery. The diffs for all four H2 recoveries were recomputed from the saved traces for this lane.

**Reconcile** (`--reconcile --authorize <held-state sha256>`):
1. Re-inspect on the same connection, immediately before the first write.
2. Require the identical path and plan.
3. Record the authorization on the gate, citing the evidence basis.
4. Run the fixed steps. The completion acknowledgement re-checks its sequence.
5. Verify the stopped baseline.

There is no retry and no Reset outside the fixed path. The procedure never exits simulation.

**Outcomes:**

| Status | Meaning |
|---|---|
| `inspected` | Supported plan, nothing written |
| `no_reconciliation_required` | `stopped-clean` |
| `refused` | No write |
| `pass` | Reconciled and verified |
| `failed` | Stopped after a write; lock retained |

## Offline results

All runs used this workstation with Node v24.15.0, at `1ff8f62`.

| Check | Result |
|---|---|
| `test/w4-commissioning.test.ts` (the proof runner, clean tree) | **9/9** |
| `tsc --noEmit` | Pass. The library is checked through the test import. |
| Union: B's full `npm test` list plus the new file, in PowerShell with the Chrome path | **187/187** (178 + 9) |
| Ownership boundary | Every change since `265242b` is an addition (8 files) |

Measured in the pass sample (offline child, fixture transport):

- **Runtime:** about 26.5 s.
- **Cadence:** 206 commits, gap p50 108 ms, p95 123 ms, max 129 ms, none over 300 ms, 18 coordinator overruns recorded.
- **Lease receipts:**

  | Mode | State | Valid | Elapsed |
  |---|---|---|---|
  | hold | released | yes | 731 ms |
  | continue | released | yes | 326 ms |
  | condition | released | yes | 324 ms |
  | condition | condition_met | no | 642 ms |
  | condition | released | yes | 224 ms |
  | continue | expired | no | 415 ms |

- **Parent stall:** 1,500 ms, with 14 child commits during it and a 121 ms maximum gap.
- **Held windows:** 9 and 11 samples, each with one distinct image, while the PLC cycle went 86→94 and 187→197.
- **Final state:** post-stop image and sequence equal the last applied commit; stopped baseline; lock released.

What the tests cover:

| Test | Shows |
|---|---|
| Refusals | Held lock: no transport opened. Unclean baseline: zero writes, no child. Live-mode hooks refused. Live run without pins refused. |
| Pass | Every phase, plus the measurements above |
| Held mid-transit | Exact record. `transit-pending` refused with no write. The recorded timeout evolution is then classified as `transit-timeout`. Nine refusals, each with zero writes. Then an authorized reconciliation writes Stop first and Reset last, in the recorded order. |
| Uncertain write (hung WCS offer) | Quarantine; `retained_uncertain` lock. The offer is resolved by observation (acknowledgement unchanged). The adopted lock is restored byte for byte, then the state is reconciled as `held-running`. |
| Child exit (code 70) | Lock retained with the run's nonce. Refused while the recorded host pid is alive. Inspection restores the lock byte for byte. |
| Undeclared fault 12 | Held, then refused as outside the recorded paths, with zero writes |
| Held at stopped baseline | `no_reconciliation_required`, zero writes |
| Classification units | Overload (injected or not, Reset landed or not), start-feedback timeout, late in-flight commit (matching, mismatched, reacted), unknown uncertain path, unexplained controller change |
| Gate | Refuses every write until authorized |

### Evidence

`artifacts/w4-commissioning/offline-proof/2026-11-02T03-18-37-656Z/`, with scope `offline-fake-transport` and `liveCommissioningQualified: false`, `liveRecoveryQualified: false`:

| File | SHA-256 |
|---|---|
| `result.json` | `c2842ee87011aea900724dca762e3a896032e994f75e5746c57794fbad0116c6` |
| `tests.tap` | `5bc76532b8bd7d40c6ad6d450f25c71a45b9edffa27e28f601c836587b2bd103` |
| `tests.txt` | `e257b9020eeb7d1f47ab827701b51be93480c15eda1b5bdfb122eea5b6d59f97` |
| `typecheck.txt` (empty = pass) | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `union-suite.txt` (UTF-8, LF) | `c9192c8e9c446519b0ecff0390ad7f506e97816679c28163ac83b325ebd2c00b` |

The samples are:
- `samples/pass/`: the complete pass run;
- `samples/held-transit/`: the held run, 12 recovery directories and its held-state;
- `samples/held-uncertain-write/`: the held run and its held-state.

Their held-state hashes are `c1dc5b92…bf40b7` for `held-transit` and `49a5f144…9828ee` for `held-uncertain-write`. Files over 256 KB are gzipped, and `result.json` records both the original and the `.gz` SHA-256. `result.json` also pins the 7 implementation files and 24 executed dependencies (the adapter, runtime, connector, fixtures, project, map and world) by Git blob and SHA-256.

## Findings for B and A

1. **A host-driven tool right after Start or Resume is refused as stale.**
   - Cause: `IsolatedProcessDriver.start()` does not wait for the child, so a tool sent before the child's start reply carries the pre-start boundary revision.
   - The child refuses it correctly: `Child boundary revision is 2, not 1`, nothing applied.
   - The model path is unaffected, because every turn first awaits `leaseBegin`. M10-style host steps after Start are affected.
   - The harness waits for the boundary revision to change. B or A may want to make `start` awaitable or document the ordering. No change was made here.
2. **A late in-flight commit can land after the last observation.** The controller may then react to an image the run never saw a response to. The child-crash test reproduces this: commit 14 put the carton on the entry photo-eye, and the fixture PLC tracked it. The recovery refuses this explicitly instead of reading it as a held-state change.
3. **The live HMI service already treats `artifacts/m10/live.lock` as a runtime owner.** While the lock is held, it disables its own commands and drops to 1 s polling. So the HMI capture and portal can stay open during the run, and the HMI is read-only for that time.

## Remaining live prerequisites (D)

1. **B's final integration pin and gate.** When this lane was written, B's handoff said `npm run verify:w4:offline` was still running against `31b78e4`, and `docs/w4-convergence-handoff.md` was uncommitted. Use B's final passing commit.
2. **One pinned checkout.** Preferred: B merges `codex/w4-commissioning` into the integration candidate. D then pins that commit and requalifies it with B's gate and `node scripts/run-w4-commissioning-proof.js`. The harness, runtime and adapter then share one clean checkout, which is what `verifyOwnerEntry`/`verifyOwnCheckout` require.

   Alternative: run the harness from this branch with `-ModuleCheckout <B's pinned checkout>`. In that case the runtime and ledger come from this checkout, at `265242b` lineage. Do not weaken the pin checks either way.
3. **The W4 manifest environment.**
   - Set `CONTROLSBENCH_WONDER_PROCESS_COMMIT`, `CONTROLSBENCH_WONDER_HANDOFF` and `CONTROLSBENCH_WONDER_HANDOFF_SHA256` from `scripts/prepare-w4-handoff.js`. The manifest lives outside the pinned checkout.
   - No pricing or `MODEL_API_KEY` is needed: the harness constructs no model provider, and the child strips keys.
4. **DUT identity and current state.**
   - The connector requires build 8001/interface 1, but cannot tell which project bytes are on the PLC.
   - The main checkout's modified `conveyordemo.project` and File-Based Storage conversion must be reconciled with the intended DUT by D, as the lane packet says.
   - Run `-Inspect` first. The latest recorded state this lane found was clean Stopped (H2 recovery, 2026-11-01 15:12), but that is not a current observation.
   - If the PLC is not clean and not a saved W4 held run, neither this procedure nor the H2/M10 scripts apply: decide separately.
5. **Ownership.** There must be no `artifacts/m10/live.lock` and no active operator-status file in the main checkout, and the native `node-opcua` module must exist at the preflight path.
6. **Load conditions.** Start the product portal (`scripts/run-product.ps1`) and the actual HMI capture session first. Describe them in `-LoadNote`. The harness measures the child cadence and records late steps; it does not relax the 10 Hz or 300 ms bounds.
7. **Credentials** at the masked prompt only. Cleared on every exit path.

## What a live pass would and would not establish

A passing live `-Run` would show:
- a native session in the isolated child;
- source, image and acknowledgement delivery;
- 10 Hz cadence under the declared load;
- child-enforced lease return, condition and expiry, including a real parent stall;
- the sequenced Reset, Start, WCS offer and completion acknowledgement;
- the overload fault and Reset;
- a clean shutdown, verified read-only.

It would still not establish:
- real OPC UA write timeouts or uncertain settlement;
- bench parent loss or child crash;
- any recovery path run live on a W4 held state (only the H2-proven sequences exist);
- multi-carton behaviour;
- a Wonder-directed investigation;
- spend or a W4 pass.

The offline evidence here is not live qualification. The fixture's reactions are scripted, not M8 behaviour.
