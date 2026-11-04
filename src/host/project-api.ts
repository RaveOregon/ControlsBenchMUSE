// Same-origin project API for specification-to-project onboarding. Uploads are JSON with bounded
// size; identifiers and paths are server-generated and contained; no client path or command is
// ever used. Preparation runs in the host's job service and its isolated worker, so a browser can
// disconnect and reconnect. Finished campaigns of an uploaded project are archived with their
// report, presentation bundle and ledger under that project version.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { buildReportBundle, type CampaignReport } from "../report/bundle.ts";
import type { PreparationService } from "../projects/preparation.ts";
import { activate, activationBlock, readReview } from "../projects/selection.ts";
import { EXAMPLE_PROJECT_ID, LIMITS, ProjectError, SUPPORTED_FORMATS, type NewInput, type ProjectStore, type VersionRecord } from "../projects/store.ts";
import type { CampaignHost } from "./campaign-host.ts";

const MAX_BODY = 1024 * 1024;
const TERMINAL = ["completed", "stopped", "failed"];
const PACKAGE_FILES = new Set(["world.ts", "world.test.ts", "world.manifest.json", "assumptions.md", "plan.json", "validation.json"]);

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new ProjectError(415, "Expected application/json");
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += (chunk as Buffer).length; if (size > MAX_BODY) throw new ProjectError(413, "Upload exceeds 1 MiB"); chunks.push(chunk as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ProjectError(400, "Malformed JSON"); }
}
/** { name, text } or { name, base64 }: the original bytes are what the store hashes and keeps. */
function input(value: unknown, source: NewInput["source"]): NewInput | undefined {
  if (value === undefined || value === null) return undefined;
  const v = value as { name?: unknown; text?: unknown; base64?: unknown };
  const bytes = typeof v.base64 === "string" ? Buffer.from(v.base64, "base64") : typeof v.text === "string" ? Buffer.from(v.text, "utf8") : undefined;
  if (!bytes) throw new ProjectError(400, "Each upload needs text or base64 content");
  return { name: String(v.name ?? ""), bytes, source: typeof v.base64 === "string" ? "upload" : source };
}

export interface ProjectApiOptions { store: ProjectStore; preparation: PreparationService; host: CampaignHost; author: { id: string; label: string; paid: boolean; fixture: boolean } }

export class ProjectApi {
  readonly options: ProjectApiOptions;
  constructor(options: ProjectApiOptions) {
    this.options = options;
    // Archive each finished campaign of an uploaded project with its report.
    options.host.subscribe(message => { if (message.type === "events" && TERMINAL.includes(message.projection.status) && message.projection.report) this.archive(); });
  }
  campaignRunning(): boolean {
    const p = this.options.host.projection;
    return Boolean(p && !TERMINAL.includes(p.status));
  }

  /** Writes report, bundle and ledger for the host's finished campaign into its project version, once. */
  archive(): string | undefined {
    const host = this.options.host, events = host.events;
    const selected = events.find(e => e.type === "world.evidence" && (e.data.source as { kind?: string })?.kind === "selected_project")?.data.source as { projectId: string; version: string; projectKind: string } | undefined;
    const report = host.report();
    if (!selected || selected.projectKind !== "uploaded" || !report || !TERMINAL.includes(report.status) || !report.finalization) return undefined;
    const dir = join(this.options.store.versionDir(selected.projectId, selected.version), "runs", report.campaignId);
    if (existsSync(join(dir, "report.json"))) return dir;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(join(dir, "campaign.jsonl"), events.map(e => JSON.stringify(e)).join("\n") + "\n");
    writeFileSync(join(dir, "report-bundle.json"), JSON.stringify(buildReportBundle({ report: report as CampaignReport, events, context: { kind: "saved_record", title: `${this.options.store.project(selected.projectId).name} ${selected.version}` },
      reportIntegrity: { source: "host_memory" } }), null, 2) + "\n");
    return dir;
  }

  runs(projectId: string, version: string) {
    if (projectId === EXAMPLE_PROJECT_ID) return [];
    const dir = join(this.options.store.versionDir(projectId, version), "runs");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(f => f.endsWith(".json")).map(f => {
      const run = JSON.parse(readFileSync(join(dir, f), "utf8")) as { campaignId: string; startedAtIso: string };
      const archived = join(dir, run.campaignId, "report.json");
      const status = existsSync(archived) ? (JSON.parse(readFileSync(archived, "utf8")) as { status: string }).status
        : this.options.host.campaignId === run.campaignId ? this.options.host.projection?.status ?? "preparing" : "not archived (host stopped before the campaign finished)";
      return { ...run, status, reportAvailable: existsSync(archived) };
    }).sort((a, b) => b.startedAtIso.localeCompare(a.startedAtIso));
  }

  #versionView(record: VersionRecord) {
    const store = this.options.store;
    const review = readReview(store, record.projectId, record.version);
    const text = (which: "spec" | "io") => { try { return store.readInput(record, which); } catch (error) { return `Unavailable: ${(error as Error).message}`; } };
    return { record, review, specText: text("spec"), ioText: record.inputs.io ? text("io") : undefined,
      activationBlocked: activationBlock(store, record.projectId, record.version) ?? null, runs: this.runs(record.projectId, record.version) };
  }

  /** Returns true when the request was a project route. */
  async handle(req: IncomingMessage, res: ServerResponse, url: URL, sameOrigin: boolean, json: (res: ServerResponse, status: number, body: unknown) => void): Promise<boolean> {
    if (!url.pathname.startsWith("/api/projects")) return false;
    const store = this.options.store, parts = url.pathname.split("/").slice(3).map(decodeURIComponent);
    try {
      if (req.method === "POST" && !sameOrigin) throw new ProjectError(403, "Cross-origin project change refused");
      if (req.method === "GET" && parts.length === 0) {
        const active = store.readActive();
        const projects = [store.project(EXAMPLE_PROJECT_ID), ...store.list()].map(p => ({ ...p, versions: p.versions.map(v => { const r = store.version(p.id, v); return { version: v, status: r.status, createdAtIso: r.createdAtIso, job: r.job ? { state: r.job.state, provider: r.job.provider.label } : undefined }; }) }));
        json(res, 200, { formats: SUPPORTED_FORMATS, limits: LIMITS, author: this.options.author, factory: this.options.host.factory.id, campaignRunning: this.campaignRunning(),
          active: active ? { ...active, projectName: store.project(active.projectId).name, worldPath: undefined, specPath: undefined, manifestPath: undefined, planPath: undefined } : null, projects });
        return true;
      }
      if (req.method === "POST" && parts.length === 0) {
        const b = await body(req);
        const created = store.create(b.name, input(b.spec, "paste") ?? (() => { throw new ProjectError(400, "Add a specification"); })(), input(b.io, "paste"));
        json(res, 201, { project: created.project, ...this.#versionView(created.version) });
        return true;
      }
      const [projectId, , version, action, extra] = parts;
      if (!projectId) throw new ProjectError(404, "Unknown project route");
      if (req.method === "GET" && parts.length === 1) { const p = store.project(projectId); json(res, 200, { project: p, versions: p.versions.map(v => this.#versionView(store.version(projectId, v))) }); return true; }
      if (parts[1] !== "versions" || !version) throw new ProjectError(404, "Unknown project route");
      if (req.method === "GET" && !action) { json(res, 200, { project: store.project(projectId), ...this.#versionView(store.version(projectId, version)) }); return true; }
      if (req.method === "POST" && action === "prepare") { json(res, 202, this.#versionView(this.options.preparation.start(projectId, version))); return true; }
      if (req.method === "POST" && action === "cancel") { json(res, 200, this.#versionView(this.options.preparation.cancel(projectId, version))); return true; }
      if (req.method === "POST" && action === "revise") {
        const b = await body(req);
        const record = store.revise(projectId, version, { spec: input(b.spec, "revision"), io: b.io === null ? null : input(b.io, "revision"), note: b.note });
        json(res, 201, this.#versionView(record)); return true;
      }
      if (req.method === "POST" && action === "activate") { const s = activate(store, projectId, version, this.campaignRunning()); json(res, 200, { active: { ...s, projectName: store.project(projectId).name } }); return true; }
      if (req.method === "GET" && action === "files" && extra && PACKAGE_FILES.has(extra)) {
        const record = store.version(projectId, version);
        if (!record.package && extra !== "validation.json") throw new ProjectError(404, "No validated package");
        const dir = record.package?.directory ?? "";
        const file = store.path(projectId, version, ...dir.split("/").filter(Boolean), extra);
        if (!existsSync(file)) throw new ProjectError(404, "File not available");
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
        res.end(readFileSync(file)); return true;
      }
      if (req.method === "GET" && action === "runs" && extra && parts[5] === "bundle") {
        if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,150}$/.test(extra)) throw new ProjectError(400, "Invalid campaign ID");
        const file = join(store.versionDir(projectId, version), "runs", extra, "report-bundle.json");
        if (!existsSync(file)) throw new ProjectError(404, "No archived report for this run");
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(readFileSync(file)); return true;
      }
      throw new ProjectError(404, "Unknown project route");
    } catch (error) {
      json(res, error instanceof ProjectError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
  }
}
