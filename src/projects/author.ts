// World authoring for project preparation: the request Muse receives and the package it returns.
//
// The input is this project's own specification text, separately supplied I/O (if any), the
// platform world contract and the selected bench interface. The package is executable TypeScript
// (world, tests), its manifest, assumptions, open questions and a source-linked test plan. Two
// authors share this contract: the real Wonder Responses client (paid, journaled, admitted from
// this request's own bounds) and an offline fixture that is visibly labelled as such.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WorldManifest } from "../proof/contracts.ts";
import { validateManifest } from "../proof/manifest.ts";
import { wonderPricing, type ExchangeJournal } from "../campaign/wonder-responses.ts";
import { digest } from "../campaign/ledger.ts";
import { boolInputs, outputIds, realInputs } from "../live/m8-map.ts";
import { BOUND_CONTROLS, M8_PROFILE, REQUIRED_CONTROLS, REQUIRED_ROLES } from "./m8-compatibility.ts";
import { PLAN_GROUPS, type IoRow, type PlannedCheck, type Question, type WorldPackage } from "./types.ts";

export const CONTRACT_SOURCE = fileURLToPath(new URL("../proof/contracts.ts", import.meta.url));
export { PLAN_GROUPS } from "./types.ts";

export interface AuthorInput {
  projectName: string; specText: string; specSha256: string; specName: string;
  ioText?: string; ioName?: string; ioSha256?: string; ioRows: IoRow[]; ioSource: "separate" | "embedded" | "missing";
}
export type { PlannedCheck, Question, WorldPackage } from "./types.ts";
export interface AuthorResult { package: WorldPackage; responseId: string | null; model: string; usage?: Record<string, unknown>; requestHash: string; durationMs: number }
export interface AuthorAccounting { reserve(requestId: string, usd: number): void }
export interface WorldAuthor {
  readonly id: string; readonly label: string; readonly paid: boolean; readonly fixture: boolean;
  generate(input: AuthorInput, ctx: AuthorCall): Promise<AuthorResult>;
  repair(input: AuthorInput, previous: WorldPackage, diagnostics: string, ctx: AuthorCall): Promise<AuthorResult>;
}
export interface AuthorCall { signal: AbortSignal; journal: ExchangeJournal; requestId: string; accounting: AuthorAccounting; activity(message: string): void;
  /** Reported as soon as a response arrives, before its content is checked, so failed attempts are still accounted. */
  usage?(usage: Record<string, unknown>, responseId: string | null): void }

const str = { type: "string" }, strs = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const signalSchema = obj({ id: str, name: str, direction: { type: "string", enum: ["plc_to_world", "world_to_plc"] },
  dataType: { type: "string", enum: ["BOOL", "SINT", "USINT", "INT", "UINT", "DINT", "UDINT", "REAL", "STRING"] }, normalValue: { type: ["boolean", "number", "string"] },
  deviceId: str, role: str, description: str });
export const packageSchema = obj({
  manifest: obj({ packageVersion: str, stateSchemaVersion: str, worldId: str, name: str, tickMs: { type: "integer", minimum: 10, maximum: 1000 },
    signals: { type: "array", items: signalSchema }, controls: { type: "array", items: obj({ id: str, description: str }) },
    inspectableState: strs, assumptions: strs, faultCapabilities: strs, evidenceTypes: strs,
    capabilities: obj({ snapshot: { type: "boolean" }, migrate: { type: "boolean" }, seededRandom: { type: "boolean" } }) }),
  worldTs: str, worldTestTs: str, assumptionsMd: str, summary: str,
  physicalParameters: { type: "array", items: obj({ name: str, value: str, unit: str, basis: { type: "string", enum: ["specified", "inferred"] }, source: str }) },
  questions: { type: "array", items: obj({ id: str, question: str, blocking: { type: "boolean" }, relatesTo: str }) },
  testPlan: obj({ objective: str, checks: { type: "array", items: obj({ id: str, group: { type: "string", enum: [...PLAN_GROUPS] }, title: str, objective: str,
    requirementRefs: strs, sourceRefs: strs, stimulus: str, expectedObservation: str, expectedBasis: { type: "string", enum: ["specified", "unspecified"] },
    observeSignals: strs, worldControls: strs, needsHmi: { type: "boolean" } }) } })
});

function targetInterface(): string {
  const row = (id: string, dir: string, type: string) => `| ${id} | ${dir} | ${type} |`;
  return [`Bench interface: ${M8_PROFILE.platform}, map ${M8_PROFILE.interface}. The workstation writes the COMPLETE raw input image every cycle at ${M8_PROFILE.cadenceHz} Hz.`,
    "The manifest must declare exactly these PLC-facing signals with these ids, directions and types (no other world_to_plc signals; the PLC has no slot for them):",
    "| id | direction | dataType |", "|---|---|---|",
    ...boolInputs.map(id => row(id, "world_to_plc", "BOOL")), ...realInputs.map(id => row(id, "world_to_plc", "REAL")), row("Encoder_Count", "world_to_plc", "UDINT"),
    ...outputIds.map(id => row(id, "plc_to_world", "BOOL")),
    `Required unique roles: ${REQUIRED_ROLES.join(", ")}. Required world controls: ${REQUIRED_CONTROLS.join(", ")}. Controls campaign tools can reach: ${BOUND_CONTROLS.join(", ")}.`,
    "If this specification's machine or I/O cannot be represented on this interface, do not force it: say so in a blocking question and keep the package honest."].join("\n");
}

export function developerPrompt(contract: string): string {
  return `You are Muse Wonder, the world-authoring intelligence inside ControlsBench. An engineer uploaded the machine specification and I/O information below. Prepare an executable simulated world and a reviewable test plan for THIS specification. The PLC application is the system under test.

Return the complete package in the response schema: manifest, world.ts, world.test.ts, assumptions.md, a short summary, the physical parameters you used, open questions and a source-linked test plan. Not a design summary.

World rules:
- Model only the external physical process: devices, raw feedback, sensors derived from physical state, downstream/environment behavior and declared faults. Never implement the PLC's sequencing, routing, alarm, counting or acceptance logic, and never copy a controller state machine into the world to make a check pass.
- Motion is continuous and caused by observed PLC outputs through actuator/drive dynamics, with real acceleration and deceleration. Nothing moves while the drive is stopped. Raw/native feedback and encoder counts come from physical motion, with explicit quantization and wrap. The PLC owns scaling.
- Physical parameters given in the specification are used exactly as specified. Values you must assume are labelled inferred in assumptions.md and physicalParameters. Never invent a PLC acceptance threshold that the specification leaves open.
- TypeScript is the behavioral source of truth: no pseudocode, TODO, ellipses or timelines. Import contract types only with: import type { ... } from "./contracts.ts" (the file sits beside world.ts). world.test.ts imports the world with: import { world } from "./world.ts".
- Export both: export const world: GeneratedWorldModule = ...; export default world.
- manifest.capabilities must declare snapshot, migrate and seededRandom all true (the chassis provides them; use ctx.random for any randomness). world.manifest.json must equal the manifest the module exports.
- Standard TypeScript only, through the supplied WorldContext. No dependencies, filesystem, network, process, timers, eval, Function constructor or dynamic import. Implement initialize, onPlcFrame, onControl, tick, snapshot, migrate and dispose. Every raw input write has a concrete cause; initialize establishes the physically correct normal state from the all-false/zero image.
- Publish each moving item as an entity with numeric positionM and velocityMps in state.
- world.test.ts uses node:test and node:assert/strict, is self-contained, and tests physical invariants (motion only under drive, deceleration on stop, encoder from travel, sensors from position), not constants.
- Strict TypeScript; runs under Node 24 native type stripping.

Test plan rules:
- Derive checks from the specification's requirements and operating contract. Group them as io, startup, normal, functional, faults, edge or runtime. Give each a stable id, the requirement ids and section references it comes from, the stimulus (world controls and operator/WCS actions), the expected observation exactly as the specification states it, and the PLC signals to observe.
- expectedBasis is "specified" only when the specification states the expected behavior; otherwise "unspecified" and say what is missing. Mark needsHmi when the check needs the operator HMI.
- Do not claim any check passed. Preparation runs no PLC test.

Questions: list information the specification leaves open that matters for the world or plan. blocking=true only when the world cannot be built honestly without an answer.

${targetInterface()}

Platform world contract (contracts.ts):

${contract}`;
}

function userPrompt(input: AuthorInput): string {
  const io = input.ioSource === "separate" ? `Separately supplied I/O list (${input.ioName}, sha256 ${input.ioSha256}):\n\n${input.ioText}`
    : input.ioSource === "embedded" ? `No separate I/O list was supplied; the specification embeds its I/O tables (${input.ioRows.length} signals parsed).`
    : "No I/O list was supplied and none was found in the specification.";
  return `Project: ${input.projectName}\nSpecification file: ${input.specName} (sha256 ${input.specSha256})\n\n${io}\n\nSpecification:\n\n${input.specText}`;
}

function repairPrompt(previous: WorldPackage, diagnostics: string): string {
  return `The package you returned failed independent validation. Return the complete corrected package in the same schema.
Fix compiler and structural defects and any world behavior that contradicts the specification or the physical rules. Do not weaken, delete or skip a test to make it pass, do not change specified physical parameters, and do not remove required signals. If a check reveals a genuine specification gap, keep the honest behavior and add a question.

Validation diagnostics:
${diagnostics}

Previous package:
${JSON.stringify(previous)}`;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function parsePackage(text: string): WorldPackage {
  let data: WorldPackage;
  try { data = JSON.parse(text) as WorldPackage; } catch { throw new Error("Model output was not valid package JSON"); }
  if (!data || typeof data.worldTs !== "string" || typeof data.worldTestTs !== "string" || typeof data.assumptionsMd !== "string" || !data.testPlan || !Array.isArray(data.testPlan.checks)
    || !data.manifest || typeof data.manifest !== "object" || !Array.isArray(data.manifest.signals))
    throw new Error("Model output is missing package files, the manifest or the test plan");
  // Manifest rules are enforced by the isolated validator, so a defect becomes repair diagnostics.
  return data;
}

/** Real Wonder Responses client. Each request is admitted from its own bytes and output bound. */
export class WonderWorldAuthor implements WorldAuthor {
  readonly id = "muse-wonder-1.0"; readonly label = "Muse Wonder 1.0 (paid model request)"; readonly paid = true; readonly fixture = false;
  readonly #key: string; readonly #fetch: typeof fetch; readonly #baseUrl: string;
  readonly maxOutputTokens: number; readonly requestTimeoutMs: number; readonly maxReservationUsd: number;
  constructor(options: { apiKey: string; baseUrl?: string; fetch?: typeof fetch; maxOutputTokens?: number; requestTimeoutMs?: number; maxReservationUsd?: number }) {
    if (!options.apiKey) throw new Error("MODEL_API_KEY is required for a Muse preparation");
    this.#key = options.apiKey; this.#fetch = options.fetch ?? fetch; this.#baseUrl = (options.baseUrl ?? "https://api.meta.ai/v1").replace(/\/$/, "");
    this.maxOutputTokens = options.maxOutputTokens ?? 32_000; this.requestTimeoutMs = options.requestTimeoutMs ?? 300_000; this.maxReservationUsd = options.maxReservationUsd ?? 2;
  }
  generate(input: AuthorInput, ctx: AuthorCall) { return this.#request([{ role: "user", content: userPrompt(input) }], ctx, "generate"); }
  repair(input: AuthorInput, previous: WorldPackage, diagnostics: string, ctx: AuthorCall) {
    return this.#request([{ role: "user", content: userPrompt(input) }, { role: "user", content: repairPrompt(previous, diagnostics) }], ctx, "repair");
  }
  async #request(messages: Array<{ role: string; content: string }>, ctx: AuthorCall, purpose: string): Promise<AuthorResult> {
    const body = { model: this.id, reasoning: { effort: "high", summary: "auto" }, max_output_tokens: this.maxOutputTokens,
      input: [{ role: "developer", content: developerPrompt(readFileSync(CONTRACT_SOURCE, "utf8")) }, ...messages],
      text: { format: { type: "json_schema", name: "controlsbench_project_world_package", strict: true, schema: packageSchema } } };
    const requestText = JSON.stringify(body);
    // Conservative bound: at most one token per two request bytes, every input token uncached, the full output allowance.
    const inputTokenBound = Math.ceil(Buffer.byteLength(requestText) / 2);
    const maximumUsd = (inputTokenBound * wonderPricing.inputUsdPerMillion + this.maxOutputTokens * wonderPricing.outputUsdPerMillion) / 1_000_000;
    const reservationUsd = Math.max(1, Math.ceil(maximumUsd));
    ctx.journal.append({ phase: "admission", requestId: ctx.requestId, purpose, inputTokenBound, tokenBasis: "request_bytes_div_2", maxOutputTokens: this.maxOutputTokens, maximumUsd, reservationUsd, pricing: wonderPricing });
    if (reservationUsd > this.maxReservationUsd) throw new Error(`Request bound $${maximumUsd.toFixed(2)} exceeds the $${this.maxReservationUsd} preparation allowance; no request sent`);
    ctx.accounting.reserve(ctx.requestId, reservationUsd);
    ctx.journal.append({ phase: "request", requestId: ctx.requestId, endpoint: "responses", requestText, requestHash: digest(body) });
    ctx.activity(`Waiting for Muse (${purpose}); request bound ${this.maxOutputTokens.toLocaleString("en-US")} output tokens`);
    const started = Date.now();
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(this.requestTimeoutMs)]);
    let response: Response;
    try { response = await this.#fetch(`${this.#baseUrl}/responses`, { method: "POST", signal, headers: { authorization: `Bearer ${this.#key}`, "content-type": "application/json" }, body: requestText }); }
    catch (error) { ctx.journal.append({ phase: "failed", requestId: ctx.requestId, reason: ctx.signal.aborted ? "cancelled; possibly charged" : `transport: ${String((error as Error).message).slice(0, 200)}; possibly charged` }); throw error; }
    const responseText = await response.text();
    const headers = Object.fromEntries([...response.headers].filter(([name]) => name.startsWith("x-ratelimit-") || name === "x-request-id"));
    ctx.journal.append({ phase: "response", requestId: ctx.requestId, endpoint: "responses", httpStatus: response.status, headers, responseText, responseHash: digest(responseText) });
    if (ctx.signal.aborted) throw new Error("Cancelled; late response preserved but not applied");
    let payload: any;
    try { payload = JSON.parse(responseText); } catch { throw new Error(`Muse returned HTTP ${response.status} with a non-JSON body`); }
    if (payload?.usage && typeof payload.usage === "object") ctx.usage?.(payload.usage, typeof payload.id === "string" ? payload.id : null);
    if (!response.ok) throw new Error(`Muse returned HTTP ${response.status}: ${String(payload?.error?.message ?? "").slice(0, 300)}`);
    if (payload.status !== "completed") throw new Error(`Muse response ${payload.id ?? "?"} ended ${payload.status}${payload.incomplete_details ? ` (${JSON.stringify(payload.incomplete_details)})` : ""}`);
    const text = typeof payload.output_text === "string" ? payload.output_text
      : (payload.output ?? []).flatMap((item: any) => item.content ?? []).filter((c: any) => c.type === "output_text" || c.type === "text").map((c: any) => c.text ?? "").join("");
    return { package: parsePackage(text), responseId: payload.id ?? null, model: payload.model ?? this.id, usage: payload.usage, requestHash: digest(body), durationMs: Date.now() - started };
  }
}

/**
 * Offline fixture author for repeatable tests and the browser witness: NOT Muse. It templates the
 * prepared example world with the belt speed parsed from the uploaded text and derives the plan
 * from the specification's requirement table, so a changed upload still changes the result.
 */
export class FixtureWorldAuthor implements WorldAuthor {
  readonly id = "fixture-author"; readonly label = "Fixture author (offline test; not Muse)"; readonly paid = false; readonly fixture = true;
  readonly options: { delayMs?: number; failFirstCompile?: boolean; questions?: Question[]; breakWorld?: "extra_write" | "missing_signal" };
  calls: Array<{ purpose: string; specSha256: string; ioSha256?: string; specBytes: number }> = [];
  constructor(options: FixtureWorldAuthor["options"] = {}) { this.options = options; }
  async generate(input: AuthorInput, ctx: AuthorCall) { return this.#build(input, ctx, "generate", this.options.failFirstCompile === true); }
  async repair(input: AuthorInput, _previous: WorldPackage, _diagnostics: string, ctx: AuthorCall) { return this.#build(input, ctx, "repair", false); }
  async #build(input: AuthorInput, ctx: AuthorCall, purpose: string, broken: boolean): Promise<AuthorResult> {
    this.calls.push({ purpose, specSha256: sha(input.specText), ioSha256: input.ioText ? sha(input.ioText) : undefined, specBytes: Buffer.byteLength(input.specText) });
    ctx.journal.append({ phase: "fixture.request", requestId: ctx.requestId, purpose, specSha256: sha(input.specText), ioSha256: input.ioText ? sha(input.ioText) : null, author: this.label });
    ctx.activity(`Fixture author ${purpose} (offline, no model call)`);
    if (this.options.delayMs) await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, this.options.delayMs); ctx.signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Cancelled")); }, { once: true });
    });
    const dir = new URL("../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/", import.meta.url);
    const speed = /belt speed[^0-9\n]{0,60}(\d+(?:\.\d+)?)\s*m\/s/i.exec(input.specText)?.[1];
    const local = (s: string) => s.replaceAll("../../../src/proof/contracts.ts", "./contracts.ts");
    let worldTs = local(readFileSync(new URL("world.ts", dir), "utf8"));
    if (speed) worldTs = worldTs.replace(/beltSpeedMps: 0\.5,/, `beltSpeedMps: ${Number(speed)},`);
    if (broken) worldTs = worldTs.replace("export default world;", "export default world;\nconst brokenOnPurpose: number = \"fixture compile defect\";");
    const manifest = validateManifest({ ...JSON.parse(readFileSync(new URL("world.manifest.json", dir), "utf8")), worldId: `fixture-${sha(input.specText).slice(0, 8)}`, packageVersion: "0.1.0-fixture" });
    // Deliberately incompatible fixtures change the module's own manifest and its JSON copy alike.
    if (this.options.breakWorld === "extra_write") {
      const extra = { id: "Extra_Valve", name: "Extra_Valve", direction: "world_to_plc" as const, dataType: "BOOL" as const, normalValue: false, deviceId: "valve", role: "valve.extra", description: "Fixture extra PLC write" };
      manifest.signals.push(extra);
      worldTs += `\nworld.manifest.signals.push(${JSON.stringify(extra)});\n`;
    }
    if (this.options.breakWorld === "missing_signal") {
      manifest.signals = manifest.signals.filter(s => s.id !== "PE_Runout");
      worldTs += `\nworld.manifest.signals.splice(world.manifest.signals.findIndex(s => s.id === "PE_Runout"), 1);\n`;
    }
    worldTs = worldTs.replace(/packageVersion: "0\.5\.0", stateSchemaVersion: "1\.0\.0", worldId: "conveyor-demo-baseline"/, `packageVersion: "0.1.0-fixture", stateSchemaVersion: "1.0.0", worldId: "${manifest.worldId}"`);
    const checks: PlannedCheck[] = [...input.specText.matchAll(/^\|\s*(R-\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/gm)].slice(0, 8).map(m => {
      const [id, title, stimulus, expected] = [m[1]!, m[2]!.trim(), m[3]!.trim(), m[4]!.trim()];
      const group = /fault|overload|jam|fail|stuck|bounce|contradict|disagree|feedback/i.test(title) ? "faults" : /HMI/i.test(title) ? "functional" : /start|stop/i.test(title) ? "startup" : "normal";
      return { id: `CHK-${id}`, group, title, objective: title, requirementRefs: [id], sourceRefs: [`§9 ${id}`], stimulus, expectedObservation: expected,
        expectedBasis: /TBD/i.test(expected) ? "unspecified" : "specified", observeSignals: ["Motor_RunCmd"], worldControls: ["carton.introduce"], needsHmi: /HMI/i.test(`${title} ${stimulus}`) } as PlannedCheck;
    });
    // The example's own tests encode its 0.5 m/s timing; the fixture ships speed-agnostic invariants instead.
    const pkg: WorldPackage = { manifest, worldTs, worldTestTs: FIXTURE_TESTS,
      assumptionsMd: `# Fixture assumptions\n\nOffline fixture author, not Muse. Prepared example world with belt speed ${speed ?? "0.5 (not found in upload)"} m/s from the uploaded specification.\n`,
      summary: `Fixture package for ${input.projectName}: prepared example world with belt speed ${speed ?? "unchanged"} m/s; ${checks.length} checks parsed from the requirement table.`,
      physicalParameters: [{ name: "belt speed", value: speed ?? "0.5", unit: "m/s", basis: speed ? "specified" : "inferred", source: speed ? "uploaded specification" : "prepared example default" }],
      questions: this.options.questions ?? [], testPlan: { objective: `Fixture plan for ${input.projectName}`, checks } };
    return { package: pkg, responseId: null, model: this.id, requestHash: sha(input.specText), durationMs: this.options.delayMs ?? 0 };
  }
}

const FIXTURE_TESTS = `import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawInputEffect, RawValue, WorldContext } from "./contracts.ts";
import { world } from "./world.ts";

function harness() {
  const inputs: Record<string, RawValue> = {}, outputs: Record<string, RawValue> = { Motor_RunCmd: false, D1_ExtendCmd: false, D2_ExtendCmd: false, StackLight_Red: false, StackLight_Green: false };
  const entities = new Map<string, Record<string, unknown>>();
  let now = 0, tick = 0;
  const ctx: WorldContext = {
    time: { get nowMs() { return now; }, get deltaMs() { return world.manifest.tickMs; }, get tick() { return tick; } },
    random: { next: () => 0.5, integer: (a: number) => a },
    plc: { readRawOutput: id => outputs[id] ?? null, writeRawInput: (e: RawInputEffect) => { inputs[e.signalId] = e.value; },
      currentOutputFrame: () => ({ sequence: tick, observedAtMs: now, values: { ...outputs } }), currentInputState: () => ({ ...inputs }) },
    schedule: { at: () => "none", cancel: () => {} },
    entities: { publish: s => { entities.set(s.id, s.state); }, remove: id => { entities.delete(id); } },
    evidence: { append: () => {} }, status: { report: () => {} }
  };
  const run = async (ms: number) => { for (let t = 0; t < ms; t += world.manifest.tickMs) { now += world.manifest.tickMs; tick++;
    await world.onPlcFrame(ctx, ctx.plc.currentOutputFrame()); await world.tick(ctx, { nowMs: now, deltaMs: world.manifest.tickMs, tick }); } };
  return { ctx, inputs, outputs, entities, run };
}

test("nothing moves and the encoder holds while the drive is off", async () => {
  const h = harness(); await world.initialize(h.ctx, { seed: 1, worldVersion: world.manifest.packageVersion });
  await world.onControl(h.ctx, { id: "carton.introduce", payload: { itemId: "T1" }, cause: "test" });
  const before = { ...h.inputs }; await h.run(1000);
  assert.equal(h.inputs.Encoder_Count, before.Encoder_Count); assert.equal(h.inputs.Drive_RunningFB, false);
});

test("running the drive advances the encoder; stopping decelerates to rest", async () => {
  const h = harness(); await world.initialize(h.ctx, { seed: 1, worldVersion: world.manifest.packageVersion });
  h.outputs.Motor_RunCmd = true; await h.run(2000);
  const moving = Number(h.inputs.Encoder_Count); assert.ok(moving > 0); assert.ok(Number(h.inputs.Belt_SpeedActual) > 0);
  h.outputs.Motor_RunCmd = false; await h.run(3000);
  assert.equal(Number(h.inputs.Belt_SpeedActual), 0); const rest = Number(h.inputs.Encoder_Count);
  await h.run(1000); assert.equal(Number(h.inputs.Encoder_Count), rest);
});
`;
