// Asynchronous project preparation: specification → Muse world package → isolated validation →
// bounded repair → review. One job runs at a time; others queue. Every model attempt and every
// validation run is preserved under the version directory. Cancel aborts the in-flight model
// request and kills the validation worker, and the outcome is recorded. A failed or cancelled job
// never touches the active project selection.

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fileExchangeJournal, wonderPricing } from "../campaign/wonder-responses.ts";
import { CONTRACT_SOURCE, type AuthorAccounting, type AuthorInput, type AuthorResult, type WorldAuthor } from "./author.ts";
import { PLAN_GROUPS, type PlannedCheck, type Review, type WorldPackage } from "./types.ts";
import { embeddedIo, parseIoList, type IoRow } from "./io-list.ts";
import { checkM8Compatibility, type Compatibility } from "./m8-compatibility.ts";
import { ACTIVE_STATUSES, ProjectError, type JobRecord, type ProjectStore, type VersionRecord, type VersionStatus } from "./store.ts";
import { safeEnv, type ValidationResult } from "./validate.ts";

const workerScript = fileURLToPath(new URL("../../scripts/project-validate-worker.js", import.meta.url));
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const nowIso = () => new Date().toISOString();

export interface PreparationAccount extends AuthorAccounting { close(): void }
export interface PreparationOptions {
  store: ProjectStore;
  /** Server-side author choice; the browser never chooses a provider or supplies a key. */
  author: () => WorldAuthor;
  account: (jobId: string) => PreparationAccount;
  maxRepairs?: number; validationTimeoutMs?: number;
  /** Campaign capability: whether the configured composition can operate the HMI. */
  hmiCapable?: boolean;
}
export type { Review } from "./types.ts";

export class PreparationService {
  readonly options: PreparationOptions;
  #running = new Map<string, { abort: AbortController; worker?: ChildProcess }>();
  #queue: Array<() => Promise<void>> = [];
  #busy = false;
  constructor(options: PreparationOptions) { this.options = options; }

  start(projectId: string, version: string): VersionRecord {
    const store = this.options.store, record = store.version(projectId, version);
    if (record.projectId === "example-conveyor") throw new ProjectError(400, "The prepared example is already prepared; create a project to prepare a new world");
    if (ACTIVE_STATUSES.includes(record.status)) throw new ProjectError(409, "Preparation already queued or running for this version");
    if (record.status === "ready") throw new ProjectError(409, "This version is prepared; edit it to create a new revision");
    const author = this.options.author();
    const job: JobRecord = { id: `job-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`, provider: { id: author.id, label: author.label, paid: author.paid, fixture: author.fixture },
      state: "queued", queuedAtIso: nowIso(), activities: [], requests: 0, repairs: 0, maxRequests: 1 + (this.options.maxRepairs ?? 2),
      usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }, reservationsUsd: 0, estimatedUsd: 0 };
    record.status = "queued"; record.job = job; delete record.package;
    store.saveVersion(record);
    const key = `${projectId}/${version}`, abort = new AbortController();
    this.#running.set(key, { abort });
    this.#queue.push(() => this.#run(projectId, version, author, abort.signal).finally(() => this.#running.delete(key)));
    void this.#drain();
    return record;
  }

  cancel(projectId: string, version: string, by = "engineer"): VersionRecord {
    const record = this.options.store.version(projectId, version);
    const live = this.#running.get(`${projectId}/${version}`);
    if (!live || !ACTIVE_STATUSES.includes(record.status)) throw new ProjectError(409, "No preparation is running for this version");
    live.abort.abort(new Error(`Cancelled by ${by}`));
    live.worker?.kill();
    this.#update(projectId, version, r => { r.status = "cancelled"; r.job!.state = "cancelled"; r.job!.cancelledBy = by; r.job!.endedAtIso = nowIso(); }, "cancelled", `Cancelled by ${by}; in-flight work aborted`);
    return this.options.store.version(projectId, version);
  }

  async #drain(): Promise<void> {
    if (this.#busy) return;
    this.#busy = true;
    try { while (this.#queue.length) await this.#queue.shift()!(); } finally { this.#busy = false; }
  }

  #update(projectId: string, version: string, change: (r: VersionRecord) => void, phase?: string, message?: string): VersionRecord {
    const store = this.options.store, r = store.version(projectId, version);
    change(r);
    if (phase && r.job) { const a = { atIso: nowIso(), phase, message: message ?? phase }; r.job.lastActivity = a; r.job.activities = [...r.job.activities, a].slice(-60); }
    store.saveVersion(r);
    return r;
  }
  #cancelled(projectId: string, version: string) { return this.options.store.version(projectId, version).status === "cancelled"; }

  async #run(projectId: string, version: string, author: WorldAuthor, signal: AbortSignal): Promise<void> {
    const store = this.options.store, dir = store.versionDir(projectId, version);
    if (this.#cancelled(projectId, version)) return;
    const setState = (state: VersionStatus, message: string) => this.#update(projectId, version, r => { r.status = state; r.job!.state = state; if (state === "preparing" && !r.job!.startedAtIso) r.job!.startedAtIso = nowIso(); }, state, message);
    let record = setState("preparing", "Reading the uploaded specification and I/O");
    const job = record.job!;
    const account = this.options.account(job.id);
    try {
      const specText = store.readInput(record, "spec")!, ioText = store.readInput(record, "io");
      let rows: IoRow[] = [], ioSource: VersionRecord["inputs"]["ioSource"] = "missing";
      if (ioText !== undefined) { rows = parseIoList(ioText, record.inputs.io!.name); ioSource = "separate"; }
      else { rows = embeddedIo(specText); ioSource = rows.length ? "embedded" : "missing"; }
      record = this.#update(projectId, version, r => { r.inputs.ioSource = ioSource; }, "io", ioSource === "missing" ? "No I/O list found" : `${rows.length} I/O signals read (${ioSource})`);
      const base: Pick<Review, "schema" | "projectId" | "version" | "jobId" | "author" | "io"> = { schema: "controlsbench.project-review.v1", projectId, version, jobId: job.id, author: job.provider, io: { source: ioSource, rows } };
      if (ioSource === "missing") {
        const review: Review = { ...base, preparedAtIso: nowIso(), summary: "Preparation needs the PLC I/O before a world can be built.", physicalParameters: [],
          questions: [{ id: "Q-IO", question: "Supply the PLC I/O list (CSV, JSON or text with name, direction and type), or include I/O tables in the specification.", blocking: true, relatesTo: "I/O" }],
          plan: { objective: "", checks: [] }, lineage: [] };
        writeFileSync(join(dir, "review.json"), JSON.stringify(review, null, 2) + "\n");
        this.#update(projectId, version, r => { r.status = "needs_information"; r.job!.state = "needs_information"; r.job!.endedAtIso = nowIso(); }, "needs_information", "Waiting for I/O information; no model request was sent");
        return;
      }
      const input: AuthorInput = { projectName: store.project(projectId).name, specText, specSha256: record.inputs.spec.sha256, specName: record.inputs.spec.name,
        ...(ioText !== undefined ? { ioText, ioName: record.inputs.io!.name, ioSha256: record.inputs.io!.sha256 } : {}), ioRows: rows, ioSource };
      mkdirSync(join(dir, "generation"), { recursive: true });
      const journal = fileExchangeJournal(join(dir, "generation", `${job.id}-exchanges.jsonl`));
      const lineage: Review["lineage"] = [];
      let pkg: WorldPackage | undefined, validation: ValidationResult | undefined, attemptDir = "";
      for (let attempt = 1; attempt <= job.maxRequests; attempt++) {
        if (signal.aborted) return;
        const purpose = attempt === 1 ? "generate" : "repair";
        if (purpose === "repair") setState("repairing", `Repair ${attempt - 1}: returning ${validation!.checks.filter(c => c.status === "fail").length} validation failures to Muse`);
        const call = { signal, journal, requestId: `${job.id}-r${attempt}`, accounting: { reserve: (id: string, usd: number) => {
            account.reserve(id, usd); this.#update(projectId, version, r => { r.job!.reservationsUsd += usd; }); } },
          activity: (message: string) => { this.#update(projectId, version, () => {}, purpose, message); },
          usage: (u: any) => this.#update(projectId, version, r => {
            const j = r.job!; j.usage.inputTokens += u.input_tokens ?? 0; j.usage.cachedInputTokens += u.input_tokens_details?.cached_tokens ?? 0;
            j.usage.outputTokens += u.output_tokens ?? 0; j.usage.reasoningTokens += u.output_tokens_details?.reasoning_tokens ?? 0;
            j.estimatedUsd = (j.usage.inputTokens * wonderPricing.inputUsdPerMillion + j.usage.outputTokens * wonderPricing.outputUsdPerMillion) / 1_000_000;
          }) };
        this.#update(projectId, version, r => { r.job!.requests++; if (purpose === "repair") r.job!.repairs++; });
        const result: AuthorResult = purpose === "generate" ? await author.generate(input, call) : await author.repair(input, pkg!, diagnostics(validation!), call);
        if (this.#cancelled(projectId, version)) return;
        pkg = result.package;
        this.#update(projectId, version, () => {}, "received", `Package received (${(result.durationMs / 1000).toFixed(0)} s${result.responseId ? `, ${result.responseId}` : ""})`);
        attemptDir = `attempts/${job.id}-${attempt}`;
        const files = writeAttempt(join(dir, attemptDir), pkg);
        setState("validating", `Validating attempt ${attempt} in an isolated worker (compile, structure, physics, generated tests)`);
        validation = await this.#validate(projectId, version, join(dir, attemptDir));
        if (this.#cancelled(projectId, version)) return;
        writeFileSync(join(dir, attemptDir, "validation.json"), JSON.stringify(validation, null, 2) + "\n");
        lineage.push({ attempt, purpose, directory: attemptDir, responseId: result.responseId, model: result.model, requestHash: result.requestHash, durationMs: result.durationMs,
          ...(result.usage ? { usage: result.usage } : {}), validationOk: validation.ok, files });
        const failed = validation.checks.filter(c => c.status === "fail");
        this.#update(projectId, version, () => {}, "validated", validation.ok ? `Attempt ${attempt} passed ${validation.checks.length} checks` : `Attempt ${attempt}: ${failed.length} failed (${failed.map(c => c.id).join(", ")})`);
        if (validation.ok) break;
      }
      const compatibility = checkM8Compatibility(pkg!.manifest, rows);
      const hmi = this.options.hmiCapable === true;
      const review: Review = { ...base, preparedAtIso: nowIso(), summary: pkg!.summary, physicalParameters: pkg!.physicalParameters, questions: pkg!.questions,
        plan: { objective: pkg!.testPlan.objective, checks: uniqueIds(pkg!.testPlan.checks).map(c => ({ ...c,
          available: PLAN_GROUPS.includes(c.group) && (!c.needsHmi || hmi) && c.worldControls.every(w => compatibility.controls.declared.includes(w)),
          ...(c.needsHmi && !hmi ? { unavailableReason: "Needs HMI operation; the configured campaign composition cannot operate the HMI" }
            : c.worldControls.some(w => !compatibility.controls.declared.includes(w)) ? { unavailableReason: `World control not declared: ${c.worldControls.filter(w => !compatibility.controls.declared.includes(w)).join(", ")}` } : {}) })) },
        compatibility, validation, measured: validation!.measured, lineage };
      writeFileSync(join(dir, "review.json"), JSON.stringify(review, null, 2) + "\n");
      if (!validation!.ok) {
        this.#update(projectId, version, r => { r.status = "failed"; r.job!.state = "failed"; r.job!.endedAtIso = nowIso(); r.job!.error = `Validation still failing after ${r.job!.repairs} repair request(s); attempts preserved`; }, "failed", "Preparation failed validation; nothing was activated");
        return;
      }
      const blocking = pkg!.questions.some(q => q.blocking);
      const read = (f: string) => readFileSync(join(dir, attemptDir, f));
      this.#update(projectId, version, r => {
        r.package = { directory: attemptDir, files: lineage.at(-1)!.files!, worldSha256: sha(read("world.ts")), manifestSha256: sha(read("world.manifest.json")), attempt: lineage.length };
        r.status = blocking ? "needs_information" : "ready"; r.job!.state = r.status; r.job!.endedAtIso = nowIso();
      }, blocking ? "needs_information" : "ready", blocking ? "Validated, but blocking questions need answers before use" : `Ready: ${review.plan.checks.length} planned checks; M8 mapping ${compatibility.compatible ? "compatible" : "incompatible"}`);
    } catch (error) {
      if (this.#cancelled(projectId, version)) return;
      this.#update(projectId, version, r => { r.status = "failed"; r.job!.state = "failed"; r.job!.endedAtIso = nowIso(); r.job!.error = String((error as Error).message ?? error).slice(0, 1000); }, "failed", String((error as Error).message ?? error).slice(0, 300));
    } finally { account.close(); }
  }

  #validate(projectId: string, version: string, attempt: string): Promise<ValidationResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [workerScript, attempt, "m8-conveyor"], { env: safeEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const live = this.#running.get(`${projectId}/${version}`); if (live) live.worker = child;
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("Validation worker exceeded its deadline")); }, this.options.validationTimeoutMs ?? 300_000);
      child.stdout.on("data", d => { out += d; }); child.stderr.on("data", d => { err += d; });
      child.on("close", code => {
        clearTimeout(timer); if (live) live.worker = undefined;
        const line = out.trim().split(/\r?\n/).at(-1);
        try { if (code !== 0 || !line) throw new Error(); resolve(JSON.parse(line) as ValidationResult); }
        catch { reject(new Error(`Validation worker exited ${code}: ${err.slice(0, 500)}`)); }
      });
    });
  }
}

function writeAttempt(dir: string, pkg: WorldPackage): Record<string, string> {
  mkdirSync(dir, { recursive: true });
  const files: Record<string, string> = { "world.ts": pkg.worldTs, "world.test.ts": pkg.worldTestTs, "world.manifest.json": `${JSON.stringify(pkg.manifest, null, 2)}\n`,
    "assumptions.md": pkg.assumptionsMd, "plan.json": `${JSON.stringify({ ...pkg.testPlan, physicalParameters: pkg.physicalParameters, questions: pkg.questions, summary: pkg.summary }, null, 2)}\n` };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, { flag: "wx" });
  copyFileSync(CONTRACT_SOURCE, join(dir, "contracts.ts"));
  return Object.fromEntries([...Object.entries(files).map(([n, t]) => [n, sha(t)]), ["contracts.ts", sha(readFileSync(CONTRACT_SOURCE))]]);
}

function diagnostics(v: ValidationResult): string {
  return v.checks.filter(c => c.status === "fail").map(c => `[${c.classification ?? "failure"}] ${c.id} — ${c.title}\n${c.detail}`).join("\n\n").slice(0, 12_000);
}

/** Check IDs become campaign experiment IDs: keep them ledger-safe and unique. */
function uniqueIds(checks: PlannedCheck[]): PlannedCheck[] {
  const seen = new Set<string>();
  return checks.map((c, i) => {
    let id = String(c.id).replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) || `CHK-${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { ...c, id };
  });
}
