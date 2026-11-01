// Negative tests for the H2 audit's frame evidence, on a temporary copy of a preserved passing run.
// The preserved run itself is only read.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
// @ts-expect-error plain JavaScript audit script without declarations
import { auditHmiH2 } from "../scripts/audit-hmi-h2.js";

const PRESERVED = "artifacts/hmi/h2/2026-11-01T15-12-23-772Z";
type Audit = { pass: boolean; checks: Array<{ id: string; pass: boolean; detail: string }> };
const frameCheck = (a: Audit) => a.checks.find(c => c.id === "cited-frames-preserved")!;

const copy = mkdtempSync(join(tmpdir(), "hmi-audit-"));
// The per-second capture store is gitignored and not part of the preserved evidence.
cpSync(PRESERVED, copy, { recursive: true, filter: source => !source.replace(/\\/g, "/").includes("/portal-hmi/hmi-frames") });
const frames = join(copy, "evidence-frames");
const restoreFrames = () => { rmSync(frames, { recursive: true, force: true }); cpSync(join(PRESERVED, "evidence-frames"), frames, { recursive: true }); };
test.after(() => rmSync(copy, { recursive: true, force: true }));

test("the preserved passing run audits 13/13 from a copy", () => {
  restoreFrames();
  const a = auditHmiH2(copy) as Audit;
  assert.equal(a.pass, true, JSON.stringify(a.checks.filter(c => !c.pass)));
  assert.equal(a.checks.length, 13);
});

test("one cited frame missing fails the audit", () => {
  restoreFrames();
  rmSync(join(frames, readdirSync(frames)[0]));
  const a = auditHmiH2(copy) as Audit;
  assert.equal(a.pass, false);
  assert.match(frameCheck(a).detail, /frame bytes are missing/);
});

test("an empty evidence-frames directory fails the audit (review reproduction)", () => {
  restoreFrames();
  for (const f of readdirSync(frames)) rmSync(join(frames, f));
  const a = auditHmiH2(copy) as Audit;
  assert.equal(a.pass, false);
  assert.equal(frameCheck(a).pass, false);
});

test("an empty cited frame file fails the audit", () => {
  restoreFrames();
  writeFileSync(join(frames, readdirSync(frames)[0]), "");
  const a = auditHmiH2(copy) as Audit;
  assert.equal(a.pass, false);
  assert.match(frameCheck(a).detail, /empty/);
});

test("changed frame bytes fail the audit", () => {
  restoreFrames();
  const f = join(frames, readdirSync(frames).at(-1)!);
  writeFileSync(f, Buffer.from("not the captured frame"));
  const a = auditHmiH2(copy) as Audit;
  assert.equal(a.pass, false);
  assert.match(frameCheck(a).detail, /bytes differ/);
});
