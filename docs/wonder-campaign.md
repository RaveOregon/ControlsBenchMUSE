# Wonder campaign lane

Base: verified `codex/m10-convergence` `13c55b3` (66 runtime/host/view and 51 UI tests; preserved 302-ack M10 replay). The original checkout's uncommitted task packet and other edits remain untouched. Codex implements; `muse-wonder-1.0`, Standard mode, high reasoning is the product model.

## W0: frozen integration boundary

The six-case M10 executor selects its own sequence and deliberately never calls a provider. The M9 `WonderProvider` allows one preserved-M7 call. Neither proves Wonder-directed live experimentation. Keep both as regressions. `CampaignRuntime` already owns authorization, turn scheduling, plan transitions, semantic tool dispatch, evidence validation, cancellation, budgets, ledger projection and report. Extend that loop rather than implementing another executor.

The new Responses provider submits one `campaign_decision` function per turn: the existing bounded Decision (plan/completion plus up to eight semantic calls), optionally selecting the next reasoning lease. The runtime validates and applies it. The following API turn pairs the originating `call_id` with exact terminal tool results, current revision and bounded evidence. The provider has no PLC authority or experiment policy. Unsupported/text/malformed/incomplete/repeated responses cause a visible hold; no silent retry. Raw request/response bytes are durable before interpretation. Abandoned responses remain artifacts and never execute effects.

Context contains the accepted spec (requirements and assumptions), logical signals/device capabilities, selected scope, current plan/experiment/revision, budget/evidence class, recent relevant outcomes and exact evidence IDs. A bounded evidence-window tool retrieves older exact records. Recorded source IDs, times and hashes remain available. Blind contexts use the existing public observation allowlist, including tool-result filtering; no source events, fault truth or raw model responses. Connection endpoints and credentials never become model context. World truth, requested stimulus, acknowledged raw image, PLC outputs, HMI observations and inference retain distinct types. Prose is interpretation, not certified coverage.

### Process interface for Claude/integrator

This lane does not edit `src/live`, HMI code, PLC programs, credential watchers or recovery. A live factory must consume a completed isolated-process adapter handoff with:

- One host-owned `CampaignLedger`, original coordinator events and exact derived evidence; no parallel ledger.
- Structural CampaignDriver operations: initialize/start/hold/apply/reset/exit, confirmed evidence/snapshot/image, freshness, quarantine and observation subscription. Declared observed signal IDs replace runtime access to coordinator internals.
- A decision-lease controller: begin(policy, originating revision, cancellation), finish(receipt, originating revision, cancellation). Policies are hold, bounded continue, or condition/deadline; hold on expiration/interruption, with a terminal receipt and evidence refs. The child enforces deadlines independently of model/portal event loops. PLC time always continues. Holding the simulated image/world is explicit and logged, never a clock freeze or physics rewrite.
- Sequenced controller/operator actions, original acknowledgements, exclusive ownership, explicit passthrough observation and bounded disposal remain the runtime owner's responsibility. Late or mismatched lease receipts invalidate the decision before any model effect.

No compatible completed handoff exists at W0 inspection (`codex/hmi-process-isolation` at `e6bbf3a`). An injected offline adapter may prove contract behavior; it cannot certify child isolation or live timing. The convergence owner was sent this interface for coordination. W4 must remain not run until handoff/recovery and owner scheduling are recorded.

### Spend boundary and API references

Keep $1 request admission, $3 warning, $5 campaign hard stop, five-minute timeout and $15 durable session cap. Reserve durably before networking, charge uncertain calls fully and block reuse after a crash. Before generation, count the complete rendered input (including stored history), bound output tokens and use the verified Standard rates with no cache discount to reject a request whose maximum exceeds $1. No hosted tools or automatic retry. Reverify pricing before executing W3; a local reservation alone is not a provider billing cap.

Primary docs checked 2026-11-01: [Responses](https://dev.meta.ai/docs/protocols/responses), [tool calling](https://dev.meta.ai/docs/tool-calling), [token counting](https://dev.meta.ai/docs/token-counting), [pricing](https://dev.meta.ai/docs/pricing-rate-limits), [models](https://dev.meta.ai/docs/models). Wonder Standard input $4/M tokens and output $20/M tokens; max output includes reasoning. The [Meta context cookbook](https://github.com/meta-models/meta-model-cookbook/blob/main/02_agent_patterns/03_managing_context/README.md) supports compact running state and selective retrieval. Current task instructions supersede the older playbook's retry and behavior-IR suggestions.

## Gates and launch

W0 contract frozen. W1 offline multi-turn/negative/lease proofs and W2 recorded-M10/portal proof follow. W3 optional paid recorded-evidence checkpoint is prepared only after those pass. W4 live normal/fault/adaptive campaign is separately scheduled with Claude/runtime owner after verified isolation and failed-H2 recovery. No paid call, PLC operation, recovery or HMI live claim is authorized by an offline result.
