// Bounded artifact resolver for a saved campaign directory.
//
// Reads a fixed allowlist of files by name: report.json, campaign.jsonl, the optional separate
// audit/engineering-review files and the model exchange log. Images are read only from
// vision-frames/ when the ledger's own HMI receipt names the file, and only when the bytes match
// the SHA-256 the ledger recorded. No path or URL taken from report content is ever followed
// beyond that. Nothing is written into the evidence directory; original bytes stay untouched.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { canonical, readLedger, report as reconstruct } from "../campaign/ledger.ts";
import { buildReportBundle, containsLocalPath, scrubLocalPaths, text, type AttachmentRecord, type CampaignReport, type ExchangeSummary,
  type HmiFrameRecord, type MediaRecord, type Pricing, type ReportBundle, type SourceFileRecord } from "./bundle.ts";

const FRAME_FILE = /^vision-frames\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(jpe?g|png)$/;
const IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EMBEDDED_REPORT_BYTES = 2 * 1024 * 1024;
const ATTACHMENTS: Record<string, AttachmentRecord["kind"]> = {
  "campaign-audit.json": "offline_audit", "s2-audit.json": "offline_audit", "engineering-review.json": "engineering_review"
};
const ORIGIN: Record<AttachmentRecord["kind"], string> = {
  offline_audit: "Separate offline audit of the saved evidence. Not part of the model report; it does not change any recorded conclusion.",
  engineering_review: "Separate engineering review artifact. Not part of the model report; the original Muse findings and assessments remain unreviewed in the campaign record."
};

const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];

/** One display value per known field; arrays of records collapse to a count. */
function fact(label: string, v: unknown): { label: string; value: string } | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (Array.isArray(v)) return { label, value: v.every(x => x === null || typeof x !== "object") ? (v.length ? v.map(String).join(", ") : "none") : `${v.length}` };
  if (typeof v === "object") return undefined;
  return { label, value: typeof v === "boolean" ? (v ? "yes" : "no") : text(v, 1200) };
}

const AUDIT_FACTS: Array<[string, string]> = [
  ["reportReconstructedExactly", "Report reconstructed exactly from ledger"], ["originalEvidenceHashesVerified", "Original evidence hashes verified"],
  ["originalEvidenceHashes", "Original evidence hashes verified"], ["responseHashesVerified", "Model response hashes verified"],
  ["responseToolLineageVerified", "Response-to-tool lineage verified"], ["exactPairedTerminalResults", "Exact paired terminal results"],
  ["pairedResults", "Paired tool results"], ["exactPlcClaims", "Exact PLC finding claims checked"], ["verifiedImages", "Images verified"],
  ["verifiedHmiActions", "HMI actions verified"], ["missingActions", "Expected HMI actions missing"], ["missingAssessments", "Expected assessments missing"],
  ["allAssessmentFrameCitationsViewed", "All assessment frame citations were viewed by Muse"], ["requests", "Model requests"], ["modelRequests", "Model requests"],
  ["completedResponses", "Completed responses"], ["failures", "Recorded failures"], ["serviceRetriesScheduled", "Service retries"],
  ["observedFaultCodes", "Observed PLC fault codes"], ["finalRecordedPlcClean", "Final recorded PLC state clean"], ["inFlightCommands", "In-flight commands at close"]
];
const REVIEW_FACTS: Array<[string, string]> = [
  ["originalChildAndTransportClaimsVerified", "Claims traced to original child/transport records"], ["modelRequests", "Model requests"],
  ["modelServiceRetries", "Model service retries"], ["allModelCitationsValid", "All model citations valid"], ["reviewedFrames", "Frames reviewed"],
  ["priorNormalOperation", "Prior normal operation"], ["firstAttempt", "Earlier attempt"], ["finalPlc", "Final PLC check"]
];

function attachment(file: string, kind: AttachmentRecord["kind"], bytes: Buffer): AttachmentRecord {
  const a = obj(JSON.parse(bytes.toString("utf8")));
  const review = obj(a.engineeringReview);
  const facts = (kind === "offline_audit" ? AUDIT_FACTS : REVIEW_FACTS).map(([key, label]) => fact(label, a[key])).filter(x => !!x);
  if (kind === "engineering_review") {
    for (const [key, label] of [["novelty", "Follow-up novelty"], ["execution", "Execution"]] as const) { const f = fact(label, review[key]); if (f) facts.push(f); }
    const own = obj(a.ownership);
    if (Object.keys(own).length) facts.push({ label: "Runtime ownership released", value: own.lockReleased === true && own.childClosed === true ? "yes" : "not confirmed" });
  }
  const defects = [...list(a.unseenAssessmentFrames), ...list(a.citationDefects)].map(obj)
    .map(d => ({ assessmentId: text(d.assessmentId, 200), frameId: text(d.frameId, 200) })).filter(d => d.assessmentId && d.frameId);
  const unique = [...new Map(defects.map(d => [`${d.assessmentId}|${d.frameId}`, d])).values()];
  const cost = a.estimatedUncachedTokenCostUsd;
  return {
    file, sha256: sha(bytes), byteLength: bytes.length, kind, origin: ORIGIN[kind], status: text(a.status, 120) || "not stated",
    scope: a.scope ? text(a.scope, 400) : undefined, atIso: text(a.reviewedAtIso ?? a.verifiedAtIso, 40) || undefined,
    claimBoundary: [a.claimBoundary, a.billingBoundary].filter(Boolean).map(x => text(x, 1200)).join(" ") || undefined,
    facts, citationDefects: unique,
    requirementNotes: Object.entries(obj(a.screenReview)).map(([requirementId, note]) => ({ requirementId: text(requirementId, 40), note: text(note, 1200) })),
    limitations: list(review.limitations).map(x => text(x, 1200)),
    estimatedUncachedTokenCostUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : undefined
  };
}

function exchanges(file: string, bytes: Buffer): ExchangeSummary {
  const summary: ExchangeSummary = { file, visionInputs: [], pricing: {}, responses: {} };
  for (const line of bytes.toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = obj(JSON.parse(line)), requestId = text(r.requestId, 120);
    if (r.phase === "vision.input" && typeof r.evidenceId === "string")
      summary.visionInputs.push({ evidenceId: r.evidenceId, requestId, sha256: text(r.sha256, 64), byteLength: typeof r.byteLength === "number" ? r.byteLength : undefined });
    if (r.phase === "admission") {
      const p = obj(r.pricing);
      if (typeof p.inputUsdPerMillion === "number" && typeof p.outputUsdPerMillion === "number")
        summary.pricing[requestId] = { inputUsdPerMillion: p.inputUsdPerMillion, outputUsdPerMillion: p.outputUsdPerMillion,
          checkedOn: p.checkedOn ? text(p.checkedOn, 40) : undefined, source: p.source ? text(p.source, 200) : undefined } satisfies Pricing;
    }
    if (r.phase === "response") summary.responses[requestId] = { httpStatus: typeof r.httpStatus === "number" ? r.httpStatus : undefined };
  }
  return summary;
}

/**
 * Resolves one HMI frame's pixels inside a campaign directory. Only a ledger-recorded name under
 * vision-frames/ is read, never a path that escapes the directory, and only bytes whose SHA-256
 * matches the ledger receipt are returned.
 */
export function resolveFrameMedia(root: string, frame: Pick<HmiFrameRecord, "sha256" | "file">, options: { embed: boolean; onVerified?: (file: string, byteLength: number) => void }): MediaRecord {
  root = resolve(root);
  const sha256 = frame.sha256 ?? "";
  if (!frame.file) return { sha256, status: "missing", note: "Captured in the HMI session; image bytes are not preserved in this evidence package" };
  if (!FRAME_FILE.test(frame.file)) return { sha256, status: "missing", note: "Recorded image name is outside the allowed evidence folder; not read" };
  const path = resolve(root, frame.file);
  if (!path.startsWith(root + sep) || !existsSync(path) || statSync(path).size > MAX_IMAGE_BYTES) return { sha256, status: "missing", note: `${frame.file} is not available in this evidence package` };
  const bytes = readFileSync(path);
  const contentType = IMAGE_TYPES[frame.file.split(".").pop()!.toLowerCase()]!;
  if (sha(bytes) !== sha256) return { sha256, status: "hash_mismatch", note: `${frame.file} does not match the SHA-256 recorded in the ledger; not shown`, byteLength: bytes.length };
  options.onVerified?.(frame.file, bytes.length);
  return options.embed
    ? { sha256, status: "embedded", contentType, byteLength: bytes.length, note: `Embedded from ${frame.file}; SHA-256 verified`, dataUri: `data:${contentType};base64,${bytes.toString("base64")}` }
    : { sha256, status: "missing", contentType, byteLength: bytes.length, note: "Verified but not embedded in this export" };
}

export interface SavedCampaignOptions {
  title?: string;
  generatedAtIso?: string;
  /** Embed the selected verified images as data URIs (default true). */
  embedImages?: boolean;
  /** Adds the evidence directory relative to `diagnosticsBase` under internal diagnostics. Off by default. */
  diagnosticsBase?: string;
}

/** Builds a shareable report bundle from a saved campaign directory without modifying it. */
export function loadSavedCampaign(directory: string, options: SavedCampaignOptions = {}): ReportBundle {
  const root = resolve(directory);
  const reportBytes = readFileSync(join(root, "report.json"));
  const ledgerBytes = readFileSync(join(root, "campaign.jsonl"));
  const saved = JSON.parse(reportBytes.toString("utf8")) as CampaignReport;
  const events = readLedger(join(root, "campaign.jsonl"));
  if (saved.campaignId !== events[0]?.campaignId) throw new Error("report.json and campaign.jsonl belong to different campaigns");
  // Compare as serialized JSON: absent optional parts (e.g. no plan) are omitted keys in the file.
  const matchesLedgerReconstruction = canonical(JSON.parse(JSON.stringify(reconstruct(events)))) === canonical(saved);

  const sources: SourceFileRecord[] = [
    { file: "report.json", role: "Original structured campaign report (unchanged)", sha256: sha(reportBytes), byteLength: reportBytes.length,
      ...(reportBytes.length <= MAX_EMBEDDED_REPORT_BYTES && !containsLocalPath(reportBytes.toString("utf8")) ? { embeddedBase64: reportBytes.toString("base64"), contentType: "application/json" } : {}) },
    { file: "campaign.jsonl", role: "Full hash-chained campaign ledger", sha256: sha(ledgerBytes), byteLength: ledgerBytes.length, events: events.length }
  ];
  const attachments: AttachmentRecord[] = [];
  for (const [file, kind] of Object.entries(ATTACHMENTS)) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    attachments.push(attachment(file, kind, bytes));
    sources.push({ file, role: kind === "offline_audit" ? "Separate offline audit" : "Separate engineering review", sha256: sha(bytes), byteLength: bytes.length });
  }
  let exchangeSummary: ExchangeSummary | undefined;
  if (existsSync(join(root, "wonder-exchanges.jsonl"))) {
    const bytes = readFileSync(join(root, "wonder-exchanges.jsonl"));
    exchangeSummary = exchanges("wonder-exchanges.jsonl", bytes);
    sources.push({ file: "wonder-exchanges.jsonl", role: "Model request/response and image-input lineage", sha256: sha(bytes), byteLength: bytes.length });
  }

  const resolveMedia = (frame: HmiFrameRecord): MediaRecord => resolveFrameMedia(root, frame, {
    embed: options.embedImages !== false,
    onVerified: (file, bytes) => { if (!sources.some(s => s.file === file)) sources.push({ file, role: "HMI image (verified against ledger hash)", sha256: frame.sha256!, byteLength: bytes }); }
  });

  const bundle = buildReportBundle({ report: saved, events, context: { kind: "saved_record", ...(options.title ? { title: options.title } : {}) },
    reportIntegrity: { source: "saved_file", sha256: sha(reportBytes), matchesLedgerReconstruction }, generatedAtIso: options.generatedAtIso,
    exchanges: exchangeSummary, attachments, sources, resolveMedia });
  const shareable = scrubLocalPaths(bundle);
  if (options.diagnosticsBase) {
    const rel = relative(resolve(options.diagnosticsBase), root).split(sep).join("/");
    if (!rel.startsWith("..") && !containsLocalPath(rel)) shareable.diagnostics = { evidenceDirectory: rel };
  }
  return shareable;
}
