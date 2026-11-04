// Persistent machine projects for specification-to-project onboarding.
//
// A project holds an engineer's uploaded specification and optional raw I/O list, byte-exact with
// SHA-256, and numbered versions. A version is immutable input plus its preparation artifacts:
// every model attempt, every validation run, the accepted package and the review. Editing creates a
// new version; nothing is overwritten. Identifiers are server-generated and every path stays
// inside the store root. The prepared conveyor example is synthesized read-only from its
// preserved files and keeps its own historical evidence.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { ActiveSelection, InputFile, JobRecord, ProjectRecord, VersionRecord, VersionStatus } from "./types.ts";
export type { ActiveSelection, InputFile, JobActivity, JobRecord, ProjectRecord, VersionRecord, VersionStatus } from "./types.ts";

export const PROJECT_SCHEMA = "controlsbench.project.v1" as const;
export const EXAMPLE_PROJECT_ID = "example-conveyor";
export const LIMITS = { specBytes: 512 * 1024, ioBytes: 256 * 1024, nameChars: 80, revisionNoteChars: 500 };
const SPEC_TYPES: Record<string, string> = { ".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain" };
const IO_TYPES: Record<string, string> = { ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".json": "application/json", ".txt": "text/plain", ".md": "text/markdown" };
export const SUPPORTED_FORMATS = { specification: Object.keys(SPEC_TYPES), io: Object.keys(IO_TYPES),
  note: "UTF-8 text only. PDF, DOCX and spreadsheets are not supported; paste or export them as text, Markdown or CSV." };

export const ACTIVE_STATUSES: readonly VersionStatus[] = ["queued", "preparing", "validating", "repairing"];


export class ProjectError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const nowIso = () => new Date().toISOString();
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
export const exampleFiles = {
  spec: join(repoRoot, "docs/conveyor-machine-spec.md"),
  world: join(repoRoot, "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"),
  manifest: join(repoRoot, "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json"),
  assumptions: join(repoRoot, "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/assumptions.md"),
  io: join(repoRoot, "codesys/demo/signal-map-v1.json")
};

/** Decodes uploaded bytes as text, refusing binary documents rather than guessing. */
export function decodeText(bytes: Buffer, label: string): string {
  if (bytes.includes(0) || bytes.subarray(0, 5).toString("latin1") === "%PDF-" || (bytes[0] === 0x50 && bytes[1] === 0x4b))
    throw new ProjectError(415, `${label} looks like a binary document (PDF/DOCX/ZIP). ${SUPPORTED_FORMATS.note}`);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (text.includes("�")) throw new ProjectError(415, `${label} is not valid UTF-8 text. ${SUPPORTED_FORMATS.note}`);
  return text;
}
function extension(name: string): string { const m = /(\.[A-Za-z0-9]{1,10})$/.exec(name); return m ? m[1]!.toLowerCase() : ""; }
function cleanName(name: unknown, fallback: string): string {
  const s = String(name ?? "").replace(/[\u0000-\u001f<>:"/\\|?*]/g, " ").trim().slice(0, 120);
  return s || fallback;
}

export interface NewInput { name: string; bytes: Buffer; source: InputFile["source"] }

export class ProjectStore {
  readonly root: string;
  constructor(root: string) { this.root = resolve(root); mkdirSync(this.root, { recursive: true }); this.#recoverInterrupted(); }

  /** Every store path is resolved and contained; identifiers are validated before use. */
  path(...parts: string[]): string {
    for (const p of parts) if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}(\/[A-Za-z0-9][A-Za-z0-9._-]{0,120})*$/.test(p) || p.split("/").includes("..")) throw new ProjectError(400, "Invalid project path");
    const full = resolve(this.root, ...parts);
    if (full !== this.root && !full.startsWith(this.root + sep)) throw new ProjectError(400, "Path escapes the project store");
    return full;
  }
  #write(path: string, value: unknown): void { const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n"); renameSync(tmp, path); }
  #read<T>(path: string): T { return JSON.parse(readFileSync(path, "utf8")) as T; }

  list(): ProjectRecord[] {
    const ids = readdirSync(this.root, { withFileTypes: true }).filter(d => d.isDirectory() && /^p-/.test(d.name)).map(d => d.name);
    return ids.map(id => this.project(id)).sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
  }
  project(id: string): ProjectRecord {
    if (id === EXAMPLE_PROJECT_ID) return { schema: PROJECT_SCHEMA, id, name: "Example conveyor (prepared)", createdAtIso: "2026-10-29T21:15:44.647Z", kind: "example", versions: ["example"] };
    const file = this.path(id, "project.json");
    if (!existsSync(file)) throw new ProjectError(404, "Unknown project");
    return this.#read<ProjectRecord>(file);
  }
  version(projectId: string, version: string): VersionRecord {
    if (projectId === EXAMPLE_PROJECT_ID) return this.example();
    const file = this.path(projectId, version, "version.json");
    if (!existsSync(file)) throw new ProjectError(404, "Unknown project version");
    return this.#read<VersionRecord>(file);
  }
  saveVersion(record: VersionRecord): void { this.#write(this.path(record.projectId, record.version, "version.json"), record); }
  versionDir(projectId: string, version: string): string { return this.path(projectId, version); }
  readInput(record: VersionRecord, which: "spec" | "io"): string | undefined {
    const input = record.inputs[which];
    if (!input) return undefined;
    const path = record.projectId === EXAMPLE_PROJECT_ID ? (which === "spec" ? exampleFiles.spec : exampleFiles.io) : this.path(record.projectId, record.version, input.file);
    const bytes = readFileSync(path);
    if (sha256(bytes) !== input.sha256) throw new ProjectError(409, `${which} bytes changed since import; refusing an unidentified input`);
    return bytes.toString("utf8");
  }

  create(nameInput: unknown, spec: NewInput, io?: NewInput): { project: ProjectRecord; version: VersionRecord } {
    const name = cleanName(nameInput, "").slice(0, LIMITS.nameChars);
    if (!name) throw new ProjectError(400, "Give the project a name");
    const id = `p-${nowIso().replace(/[-:T.Z]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
    mkdirSync(this.path(id));
    const project: ProjectRecord = { schema: PROJECT_SCHEMA, id, name, createdAtIso: nowIso(), kind: "uploaded", versions: [] };
    const version = this.#newVersion(project, spec, io);
    return { project: this.project(id), version };
  }
  revise(projectId: string, basedOn: string, change: { spec?: NewInput; io?: NewInput | null; note?: unknown }): VersionRecord {
    const project = this.project(projectId);
    if (project.kind === "example") throw new ProjectError(400, "The prepared example is read-only; create a project from its specification instead");
    const base = this.version(projectId, basedOn);
    const keep = (which: "spec" | "io"): NewInput | undefined => {
      const input = base.inputs[which]; if (!input) return undefined;
      return { name: input.name, bytes: readFileSync(this.path(projectId, basedOn, input.file)), source: "revision" };
    };
    const spec = change.spec ?? keep("spec")!;
    const io = change.io === null ? undefined : change.io ?? keep("io");
    return this.#newVersion(project, spec, io, basedOn, cleanName(change.note, "").slice(0, LIMITS.revisionNoteChars) || undefined);
  }

  #newVersion(project: ProjectRecord, spec: NewInput, io: NewInput | undefined, basedOn?: string, revisionNote?: string): VersionRecord {
    const version = `v${project.versions.length + 1}`;
    const dir = this.path(project.id, version);
    mkdirSync(join(dir, "inputs"), { recursive: true });
    const store = (input: NewInput, kind: "spec" | "io"): InputFile => {
      const limit = kind === "spec" ? LIMITS.specBytes : LIMITS.ioBytes, types = kind === "spec" ? SPEC_TYPES : IO_TYPES;
      if (!input.bytes.length) throw new ProjectError(400, `The ${kind === "spec" ? "specification" : "I/O list"} is empty`);
      if (input.bytes.length > limit) throw new ProjectError(413, `The ${kind === "spec" ? "specification" : "I/O list"} exceeds ${limit / 1024} KiB`);
      const ext = extension(input.name) || (kind === "spec" ? ".md" : ".txt");
      if (!types[ext]) throw new ProjectError(415, `Unsupported ${kind === "spec" ? "specification" : "I/O"} file type ${ext}. Supported: ${Object.keys(types).join(", ")}. ${SUPPORTED_FORMATS.note}`);
      decodeText(input.bytes, kind === "spec" ? "Specification" : "I/O list");
      const file = `inputs/${kind}${ext}`;
      writeFileSync(join(dir, file), input.bytes, { flag: "wx" });
      return { name: cleanName(input.name, `${kind}${ext}`), file, sha256: sha256(input.bytes), byteLength: input.bytes.length, mediaType: types[ext]!, source: input.source };
    };
    const specFile = store(spec, "spec");
    const ioFile = io ? store(io, "io") : undefined;
    const record: VersionRecord = { schema: PROJECT_SCHEMA, projectId: project.id, version, createdAtIso: nowIso(), ...(basedOn ? { basedOn } : {}), ...(revisionNote ? { revisionNote } : {}),
      inputs: { spec: specFile, ...(ioFile ? { io: ioFile } : {}), ioSource: ioFile ? "separate" : "missing" }, target: "m8-conveyor", status: "draft" };
    this.saveVersion(record);
    project.versions.push(version);
    this.#write(this.path(project.id, "project.json"), project);
    return record;
  }

  /** Read-only prepared example: preserved spec, world and map, with their historical evidence. */
  example(): VersionRecord {
    const file = (path: string, name: string, mediaType: string): InputFile => { const bytes = readFileSync(path); return { name, file: path, sha256: sha256(bytes), byteLength: bytes.length, mediaType, source: "example" }; };
    return { schema: PROJECT_SCHEMA, projectId: EXAMPLE_PROJECT_ID, version: "example", createdAtIso: "2026-10-29T21:15:44.647Z", target: "m8-conveyor", status: "ready",
      inputs: { spec: file(exampleFiles.spec, "conveyor-machine-spec.md", "text/markdown"), io: file(exampleFiles.io, "signal-map-v1.json", "application/json"), ioSource: "separate" },
      package: { directory: "artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0", files: {}, worldSha256: sha256(readFileSync(exampleFiles.world)),
        manifestSha256: sha256(readFileSync(exampleFiles.manifest)), attempt: 0 } };
  }

  readActive(): ActiveSelection | undefined {
    const file = join(this.root, "active.json");
    return existsSync(file) ? this.#read<ActiveSelection>(file) : undefined;
  }
  writeActive(selection: ActiveSelection): void { this.#write(join(this.root, "active.json"), selection); }

  /** A host restart cannot resume an in-flight model or worker call; record that honestly. */
  #recoverInterrupted(): void {
    for (const id of readdirSync(this.root, { withFileTypes: true }).filter(d => d.isDirectory() && /^p-/.test(d.name)).map(d => d.name)) {
      const project = this.#read<ProjectRecord>(join(this.root, id, "project.json"));
      for (const v of project.versions) {
        const record = this.version(id, v);
        if (!ACTIVE_STATUSES.includes(record.status) || !record.job) continue;
        record.status = "failed";
        record.job = { ...record.job, state: "failed", endedAtIso: nowIso(), error: "Host stopped during preparation; preserved attempts are kept. Start a new preparation." };
        this.saveVersion(record);
      }
    }
  }
}
