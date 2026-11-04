// Browser client for the host's same-origin project API (/api/projects). The browser never picks
// a model provider or sees a key: preparation is a server-side job the page polls.

import type { ActiveSelection, ProjectRecord, Review, VersionRecord } from "../../../src/projects/types.ts";

export type { Review, VersionRecord, ProjectRecord, ActiveSelection };
export interface ProjectsIndex {
  formats: { specification: string[]; io: string[]; note: string };
  limits: { specBytes: number; ioBytes: number; nameChars: number };
  author: { id: string; label: string; paid: boolean; fixture: boolean };
  factory: string; campaignRunning: boolean;
  active: (Omit<ActiveSelection, "worldPath" | "specPath" | "manifestPath" | "planPath"> & { projectName: string }) | null;
  projects: Array<Omit<ProjectRecord, "versions"> & { versions: Array<{ version: string; status: VersionRecord["status"]; createdAtIso: string; job?: { state: string; provider: string } }> }>;
}
export interface RunSummary { campaignId: string; startedAtIso: string; status: string; reportAvailable: boolean; worldSha256: string; specSha256: string; plannedChecks: string[] }
export interface VersionView { record: VersionRecord; review?: Review; specText?: string; ioText?: string; activationBlocked: string | null; runs: RunSummary[] }
export interface Upload { name: string; text?: string; base64?: string }

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, { method: init?.method ?? "GET", cache: "no-store",
    ...(init?.body !== undefined ? { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) } : {}) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `Host returned ${response.status}`);
  return body as T;
}
const v = (projectId: string, version: string) => `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(version)}`;

export const projectsApi = {
  /** Resolves undefined when the host does not serve onboarding. */
  async index(): Promise<ProjectsIndex | undefined> {
    const response = await fetch("/api/projects", { cache: "no-store" }).catch(() => undefined);
    return response?.ok ? response.json() as Promise<ProjectsIndex> : undefined;
  },
  create: (name: string, spec: Upload, io?: Upload) => call<{ project: ProjectRecord } & VersionView>("/api/projects", { method: "POST", body: { name, spec, ...(io ? { io } : {}) } }),
  version: (projectId: string, version: string) => call<VersionView & { project: ProjectRecord }>(v(projectId, version)),
  prepare: (projectId: string, version: string) => call<VersionView>(`${v(projectId, version)}/prepare`, { method: "POST", body: {} }),
  cancel: (projectId: string, version: string) => call<VersionView>(`${v(projectId, version)}/cancel`, { method: "POST", body: {} }),
  revise: (projectId: string, version: string, change: { spec?: Upload; io?: Upload | null; note?: string }) => call<VersionView>(`${v(projectId, version)}/revise`, { method: "POST", body: change }),
  activate: (projectId: string, version: string) => call<{ active: ProjectsIndex["active"] }>(`${v(projectId, version)}/activate`, { method: "POST", body: {} }),
  fileUrl: (projectId: string, version: string, name: string) => `${v(projectId, version)}/files/${encodeURIComponent(name)}`,
  runBundleUrl: (projectId: string, version: string, campaignId: string) => `${v(projectId, version)}/runs/${encodeURIComponent(campaignId)}/bundle`
};

/** Reads a chosen file as its exact bytes (base64), so the host stores and hashes the original. */
export function readUpload(file: File): Promise<Upload> {
  return file.arrayBuffer().then(buffer => {
    let s = ""; const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: file.name, base64: btoa(s) };
  });
}
