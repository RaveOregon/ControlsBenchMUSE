// Presentation audit for a validated view. Validation proves the view is safe and bound;
// this audit judges whether it reads cleanly and moves smoothly. Layout findings come from
// boxes measured in a real browser; motion findings come from resolved replay frames.

import type { FrameOp, Motion, ViewSnapshot } from "./contracts.ts";
import { resolveFrame, type LoadedPackage } from "./frame.ts";

export const AUDIT_VERSION = "controlsbench.machine-view.audit.v1" as const;

export interface Box { x: number; y: number; width: number; height: number }

/** One measured element in screen pixels, from the browser. */
export interface MeasuredItem {
  key: string;
  kind: "text" | "indicator";
  text: string;
  box: Box;
  fontPx: number | null;
  /** Rendered outline width on text; a heavy stroke smears glyphs. */
  strokePx?: number;
  /** Equipment group, entity clone or bound-element id that owns this item. */
  owner: string | null;
  /** True for carton clones and their labels: they move, so overlaps are transient. */
  moving: boolean;
}

export interface MeasuredScene {
  scenario: string;
  viewport: Box;
  items: MeasuredItem[];
}

export interface AuditFinding {
  id: string;
  category: "text_overlap" | "text_on_indicator" | "outside_view" | "legibility" | "transient_overlap" | "motion";
  severity: "error" | "warning";
  scenarios: string[];
  elements: string[];
  detail: string;
}

export interface AuditReport {
  schemaVersion: typeof AUDIT_VERSION;
  packageId: string;
  passed: boolean;
  counts: { error: number; warning: number };
  findings: AuditFinding[];
  motion: MotionSummary;
  scenarios: string[];
}

const area = (b: Box) => Math.max(0, b.width) * Math.max(0, b.height);
export function intersection(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export interface LayoutThresholds { overlapPx2: number; overlapShare: number; minFontPx: number; clearancePx: number }
export const defaultThresholds: LayoutThresholds = { overlapPx2: 4, overlapShare: 0.04, minFontPx: 10, clearancePx: 1 };

const grow = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + 2 * by, height: b.height + 2 * by });

export function auditLayout(scenes: readonly MeasuredScene[], t: LayoutThresholds = defaultThresholds): AuditFinding[] {
  const merged = new Map<string, AuditFinding>();
  const add = (f: Omit<AuditFinding, "scenarios">, scenario: string) => {
    const key = `${f.category}:${f.elements.join("|")}`;
    const existing = merged.get(key);
    if (existing) { if (!existing.scenarios.includes(scenario)) existing.scenarios.push(scenario); }
    else merged.set(key, { ...f, scenarios: [scenario] });
  };
  for (const scene of scenes) {
    const texts = scene.items.filter(i => i.kind === "text" && i.text.trim() !== "" && area(i.box) > 0);
    const indicators = scene.items.filter(i => i.kind === "indicator" && area(i.box) > 0);
    for (let a = 0; a < texts.length; a += 1) for (let b = a + 1; b < texts.length; b += 1) {
      const p = texts[a]!, q = texts[b]!;
      if (p.moving && q.moving && p.owner === q.owner) continue;
      const overlap = intersection(grow(p.box, t.clearancePx), grow(q.box, t.clearancePx));
      const share = overlap / Math.min(area(p.box), area(q.box));
      if (overlap < t.overlapPx2 || share < t.overlapShare) continue;
      const moving = p.moving || q.moving;
      const [first, second] = [p, q].sort((x, y) => x.key.localeCompare(y.key));
      add({
        id: "", category: moving ? "transient_overlap" : "text_overlap", severity: moving ? "warning" : "error",
        elements: [first!.key, second!.key],
        detail: `"${first!.text.slice(0, 40)}" and "${second!.text.slice(0, 40)}" overlap by ${Math.round(share * 100)}% of the smaller label${moving ? " while a carton passes" : ""}`
      }, scene.scenario);
    }
    for (const text of texts) for (const ind of indicators) {
      if (text.moving || ind.moving) continue;
      const overlap = intersection(text.box, ind.box);
      if (overlap < t.overlapPx2 || overlap / Math.min(area(text.box), area(ind.box)) < 0.15) continue;
      add({ id: "", category: "text_on_indicator", severity: "error", elements: [text.key, ind.key], detail: `Label "${text.text.slice(0, 40)}" covers state indicator ${ind.key}` }, scene.scenario);
    }
    for (const item of scene.items) {
      if (item.moving || area(item.box) === 0) continue;
      const v = scene.viewport;
      const inside = intersection(item.box, v) / area(item.box);
      if (inside < 0.98) add({ id: "", category: "outside_view", severity: "error", elements: [item.key], detail: `${item.kind} "${item.text.slice(0, 40)}" is ${Math.round((1 - inside) * 100)}% outside the visible view` }, scene.scenario);
    }
    for (const text of texts) if (text.fontPx && text.strokePx && text.strokePx > Math.max(0.6, text.fontPx * 0.06)) {
      add({ id: "", category: "legibility", severity: "error", elements: [text.key], detail: `"${text.text.slice(0, 32)}" is outlined with a ${text.strokePx.toFixed(1)} px stroke at ${text.fontPx.toFixed(1)} px font, which smears the glyphs` }, scene.scenario);
    }
    for (const text of texts) if (text.fontPx !== null && text.fontPx < t.minFontPx) {
      const key = "legibility";
      const existing = merged.get(key);
      const label = `"${text.text.slice(0, 32)}" ${text.fontPx.toFixed(1)} px`;
      if (existing) {
        if (!existing.elements.includes(text.key)) { existing.elements.push(text.key); existing.detail += `; ${label}`; }
        if (!existing.scenarios.includes(scene.scenario)) existing.scenarios.push(scene.scenario);
      } else merged.set(key, { id: "", category: "legibility", severity: "warning", scenarios: [scene.scenario], elements: [text.key], detail: `Labels below ${t.minFontPx} px at 1280 px width: ${label}` });
    }
  }
  const order = { text_overlap: 0, text_on_indicator: 1, outside_view: 2, transient_overlap: 3, legibility: 4, motion: 5 };
  return [...merged.values()].sort((a, b) => order[a.category] - order[b.category]).map((f, i) => ({ ...f, id: `L${String(i + 1).padStart(2, "0")}` }));
}

// ---------------------------------------------------------------------------------------------
// Motion: is each recorded step small enough to read as continuous motion?

export interface MotionSummary {
  frames: number;
  periodMs: number | null;
  carton: { maxStepPx: number; medianStepPx: number; maxAngleStepDeg: number; jumps: number };
  belt: { maxStepPx: number; periodPx: number | null; aliasRisk: boolean };
  diverts: Record<string, { maxStepDeg: number }>;
}

function opsMotion(ops: readonly FrameOp[]) {
  const attrs = new Map<string, Motion>();
  const entities = new Map<string, Motion>();
  for (const op of ops) {
    if (op.op === "attrs" && op.motion) attrs.set(op.id, op.motion);
    if (op.op === "entities") for (const item of op.items) if (item.motion) entities.set(item.key, item.motion);
  }
  return { attrs, entities };
}

export function auditMotion(pkg: LoadedPackage, runs: Record<string, readonly ViewSnapshot[]>): { summary: MotionSummary; findings: AuditFinding[] } {
  const findings: AuditFinding[] = [];
  const steps: number[] = [];
  let maxAngle = 0, beltMax = 0, beltPeriod: number | null = null, jumps = 0, frames = 0, period: number | null = null;
  const diverts: Record<string, { maxStepDeg: number }> = {};
  const jumpRuns = new Set<string>();
  for (const [name, snapshots] of Object.entries(runs)) {
    let prev: ReturnType<typeof opsMotion> | null = null;
    let prevTime: number | null = null;
    for (const snapshot of snapshots) {
      frames += 1;
      const now = opsMotion(resolveFrame(pkg, snapshot));
      if (prevTime !== null && snapshot.frame.sourceTimeMs !== null && period === null) period = snapshot.frame.sourceTimeMs - prevTime;
      if (prev) {
        for (const [key, m] of now.entities) {
          const p = prev.entities.get(key);
          if (p?.kind === "pose" && m.kind === "pose") {
            const d = Math.hypot(m.x - p.x, m.y - p.y);
            steps.push(d);
            maxAngle = Math.max(maxAngle, Math.abs(m.angle - p.angle));
          }
        }
        for (const [id, m] of now.attrs) {
          const p = prev.attrs.get(id);
          if (p?.kind === "belt" && m.kind === "belt") {
            let d = Math.abs(m.offset - p.offset) % m.period;
            d = Math.min(d, m.period - d);
            beltMax = Math.max(beltMax, d);
            beltPeriod = m.period;
          }
          if (p?.kind === "rotate" && m.kind === "rotate") diverts[id] = { maxStepDeg: Math.max(diverts[id]?.maxStepDeg ?? 0, Math.abs(m.angle - p.angle)) };
        }
      }
      prev = now;
      prevTime = snapshot.frame.sourceTimeMs;
    }
    void name;
  }
  const moving = steps.filter(s => s > 0.5).sort((a, b) => a - b);
  const median = moving.length ? moving[Math.floor(moving.length / 2)]! : 0;
  for (const [name, snapshots] of Object.entries(runs)) {
    let prev: Map<string, Motion> | null = null;
    for (const snapshot of snapshots) {
      const now = opsMotion(resolveFrame(pkg, snapshot)).entities;
      if (prev) for (const [key, m] of now) {
        const p = prev.get(key);
        if (p?.kind === "pose" && m.kind === "pose" && median > 0 && Math.hypot(m.x - p.x, m.y - p.y) > Math.max(3 * median, median + 12)) { jumps += 1; jumpRuns.add(name); }
      }
      prev = now;
    }
  }
  const maxStep = steps.length ? Math.max(...steps) : 0;
  if (jumps > 0) findings.push({ id: "M01", category: "motion", severity: "error", scenarios: [...jumpRuns], elements: ["entities"], detail: `${jumps} carton step(s) exceed 3x the median ${median.toFixed(1)} px step (max ${maxStep.toFixed(1)} px): a path drawing discontinuity makes the carton jump` });
  if (maxAngle > 20) findings.push({ id: "M02", category: "motion", severity: "warning", scenarios: Object.keys(runs), elements: ["entities"], detail: `Carton heading changes by up to ${maxAngle.toFixed(1)} degrees in one frame at a branch; eased, but visibly abrupt` });
  const aliasRisk = beltPeriod !== null && beltMax >= beltPeriod * 0.4;
  if (aliasRisk) findings.push({ id: "M03", category: "motion", severity: "error", scenarios: Object.keys(runs), elements: ["belt"], detail: `Belt marks move ${beltMax.toFixed(1)} px per frame against a ${beltPeriod} px period: marks will appear to stand still or run backwards` });
  return { summary: { frames, periodMs: period, carton: { maxStepPx: round1(maxStep), medianStepPx: round1(median), maxAngleStepDeg: round1(maxAngle), jumps }, belt: { maxStepPx: round1(beltMax), periodPx: beltPeriod, aliasRisk }, diverts }, findings };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

export function buildAuditReport(packageId: string, layout: AuditFinding[], motion: { summary: MotionSummary; findings: AuditFinding[] }, scenarios: string[]): AuditReport {
  const findings = [...layout, ...motion.findings];
  const error = findings.filter(f => f.severity === "error").length;
  const warning = findings.length - error;
  return { schemaVersion: AUDIT_VERSION, packageId, passed: error === 0, counts: { error, warning }, findings, motion: motion.summary, scenarios };
}

/** Compact, model-readable list of findings for a repair request. */
export function describeFindings(report: AuditReport): string {
  return report.findings.map(f => `${f.id} [${f.severity}/${f.category}] ${f.detail}. Elements: ${f.elements.join(", ")}. Seen in: ${f.scenarios.join(", ")}.`).join("\n");
}
