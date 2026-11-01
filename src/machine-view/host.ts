// Isolated host for a validated generated machine view.
//
// The view runs in a sandboxed iframe (`sandbox="allow-scripts"`, opaque origin) whose srcdoc
// carries a CSP that permits only the host runtime script (by nonce), inline styles and no
// network, images, fonts or forms. Model-authored markup contains no script; the trusted
// runtime applies host-resolved frame operations and reports selections. The controller never
// throws into the caller: a broken, slow or invalid view degrades to the contract fallback
// while the campaign keeps running.

import {
  VIEW_PROTOCOL_VERSION, writableAttributes,
  type Channel, type HostFrameMessage, type ValidationReport, type ViewSnapshot
} from "./contracts.ts";
import { buildFallback, resolveFrame, resolveSample, validateSnapshot, type FallbackModel, type LoadedPackage, renderFallbackHtml } from "./frame.ts";
import { parseSvg, serializeSvg, walk } from "./svg.ts";

export const SANDBOX = "allow-scripts";

export function randomToken(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'", `script-src 'nonce-${nonce}'`, "style-src 'unsafe-inline'", "img-src 'none'", "font-src 'none'",
    "connect-src 'none'", "media-src 'none'", "object-src 'none'", "frame-src 'none'", "worker-src 'none'",
    "form-action 'none'", "base-uri 'none'"
  ].join("; ");
}

const TRUSTED_CSS = `
html,body{margin:0;padding:0;height:100%;overflow:hidden;background:#11151a}
#cb-banner{display:block !important;visibility:visible !important;opacity:1 !important;position:fixed !important;left:0 !important;right:0 !important;top:0 !important;z-index:2147483647 !important;margin:0 !important;padding:4px 8px !important;min-height:16px !important;font:600 12px/16px system-ui,sans-serif !important;color:#fff !important;background:#2b3440 !important;white-space:nowrap !important;overflow:hidden !important;text-overflow:ellipsis !important;transform:none !important}
#cb-banner[data-level="warn"]{background:#8a5a00 !important}
#cb-banner[data-level="bad"]{background:#a11d1d !important}
#cb-stage{position:absolute;top:24px;left:0;right:0;bottom:0}
#cb-stage>svg{display:block;width:100%;height:100%}
[data-cb-template]{display:none !important}
[data-cb-health="held"]{opacity:.75 !important}
[data-cb-health="stale"]{opacity:.5 !important;stroke-dasharray:4 3 !important}
[data-cb-health="unknown"],[data-cb-health="bad"]{opacity:.3 !important;stroke-dasharray:2 2 !important}
[data-cb-selected="true"]{filter:drop-shadow(0 0 4px #4cc2ff) drop-shadow(0 0 1px #4cc2ff) !important}
[data-cb-equipment],[data-cb-entity]{cursor:pointer}
[data-cb-equipment]:focus,[data-cb-entity]:focus{outline:2px solid #4cc2ff !important}
`;

/** In-frame runtime. Plain ES2017; it only applies allow-listed operations and posts events. */
export function runtimeSource(token: string): string {
  return `(function(){"use strict";
var P=${JSON.stringify(VIEW_PROTOCOL_VERSION)},T=${JSON.stringify(token)},W=${JSON.stringify(writableAttributes)};
var parentWin=window.parent,ids={},banner=document.getElementById("cb-banner"),stage=document.getElementById("cb-stage");
function post(m){m.protocol=P;m.token=T;parentWin.postMessage(m,"*");}
Array.prototype.forEach.call(stage.querySelectorAll("[id]"),function(el){ids[el.getAttribute("id")]=el;});
function setAttrs(el,attrs){for(var k in attrs){if(Object.prototype.hasOwnProperty.call(attrs,k)&&W.indexOf(k)>=0)el.setAttribute(k,String(attrs[k]).slice(0,400));}}
function sel(name,value){return "["+name+"=\\""+String(value).replace(/["\\\\]/g,"\\\\$&")+"\\"]";}
function apply(ops){var missing=[];for(var i=0;i<ops.length;i++){var op=ops[i],el;
if(op.op==="attrs"){el=ids[op.id];if(!el){missing.push(op.id);continue;}setAttrs(el,op.attrs||{});}
else if(op.op==="text"){el=ids[op.id];if(!el){missing.push(op.id);continue;}el.textContent=String(op.text).slice(0,200);}
else if(op.op==="entities"){var tpl=ids[op.template],ctn=ids[op.container];if(!tpl||!ctn){missing.push(!tpl?op.template:op.container);continue;}
Array.prototype.forEach.call(ctn.querySelectorAll(":scope > [data-cb-clone]"),function(c){c.remove();});
(op.items||[]).slice(0,64).forEach(function(item){var c=tpl.cloneNode(true);c.removeAttribute("id");Array.prototype.forEach.call(c.querySelectorAll("[id]"),function(n){n.removeAttribute("id");});
c.removeAttribute("data-cb-template");c.setAttribute("data-cb-clone",String(item.key).slice(0,80));c.setAttribute("tabindex","0");c.setAttribute("role","button");setAttrs(c,item.attrs||{});
Array.prototype.forEach.call(c.querySelectorAll("[data-cb-field]"),function(n){var f=n.getAttribute("data-cb-field");if(item.fields&&Object.prototype.hasOwnProperty.call(item.fields,f))n.textContent=String(item.fields[f]).slice(0,80);});
ctn.appendChild(c);});}
else if(op.op==="selected"){Array.prototype.forEach.call(document.querySelectorAll("[data-cb-selected]"),function(n){n.removeAttribute("data-cb-selected");});
if(op.equipmentId!==null)Array.prototype.forEach.call(stage.querySelectorAll(sel("data-cb-equipment",op.equipmentId)),function(n){n.setAttribute("data-cb-selected","true");});
if(op.entityId!==null)Array.prototype.forEach.call(stage.querySelectorAll(sel("data-cb-entity",op.entityId)),function(n){n.setAttribute("data-cb-selected","true");});}
else if(op.op==="banner"){banner.textContent=String(op.text).slice(0,600);banner.setAttribute("data-level",op.level==="bad"||op.level==="warn"?op.level:"info");}}
return missing;}
window.addEventListener("message",function(e){if(e.source!==parentWin)return;var m=e.data;if(!m||m.protocol!==P||m.token!==T||m.type!=="frame"||!Array.isArray(m.ops))return;
var missing;try{missing=apply(m.ops);}catch(err){post({type:"error",message:String(err&&err.message||err).slice(0,300)});return;}
post({type:"applied",sequence:m.sequence,missing:missing.slice(0,50)});});
function pick(t){var el=t&&t.closest?t.closest("[data-cb-entity],[data-cb-equipment]"):null;if(!el)return;
post({type:"select",equipmentId:el.getAttribute("data-cb-entity")?null:el.getAttribute("data-cb-equipment"),entityId:el.getAttribute("data-cb-entity")||null});}
document.addEventListener("click",function(e){pick(e.target);});
document.addEventListener("keydown",function(e){if((e.key==="Enter"||e.key===" ")&&e.target&&e.target.closest&&e.target.closest("[data-cb-entity],[data-cb-equipment]")){e.preventDefault();pick(e.target);}});
window.addEventListener("error",function(e){post({type:"error",message:String(e.message||"error").slice(0,300)});});
post({type:"ready",elementIds:Object.keys(ids)});})();`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Elements the runtime must find for the bindings to work. */
export function requiredElementIds(pkg: LoadedPackage): string[] {
  const ids = new Set<string>();
  for (const b of pkg.bindings.bindings) { ids.add(b.element); if (b.kind === "entities") ids.add(b.container); }
  return [...ids];
}

/** Prepared SVG: every bound element starts visibly unknown; templates hidden; equipment focusable. */
export function prepareSvg(pkg: LoadedPackage): string {
  if (pkg.svg === null) throw new Error("Package has no validated view");
  const root = parseSvg(pkg.svg);
  const valueBound = new Set(pkg.bindings.bindings.filter(b => b.kind !== "anchor" && b.kind !== "entities").map(b => b.element));
  const templates = new Set(pkg.bindings.bindings.filter(b => b.kind === "entities").map(b => b.element));
  const labels = new Map(pkg.equipment.equipment.map(e => [e.id, e.label]));
  for (const { el } of walk(root)) {
    const id = el.attrs.id;
    if (id !== undefined && valueBound.has(id)) { el.attrs["data-cb-health"] = "unknown"; el.attrs["data-cb-value"] = "unknown"; }
    if (id !== undefined && templates.has(id)) el.attrs["data-cb-template"] = "";
    const equipmentId = el.attrs["data-cb-equipment"];
    if (equipmentId !== undefined && labels.has(equipmentId)) {
      el.attrs.tabindex = "0";
      el.attrs.role = "button";
      el.attrs["aria-label"] = `${labels.get(equipmentId)}: inspect evidence`;
    }
  }
  return serializeSvg(root);
}

export function buildSrcdoc(pkg: LoadedPackage, token: string, nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(contentSecurityPolicy(nonce))}"><meta name="referrer" content="no-referrer"><title>${escapeHtml(pkg.manifest.name)}</title></head><body><div id="cb-banner" role="status" aria-live="polite" data-level="warn">Waiting for the first snapshot · all values unknown · simulated physical truth, not the PLC HMI</div><div id="cb-stage">${prepareSvg(pkg)}</div><style>${TRUSTED_CSS}</style><script nonce="${escapeHtml(nonce)}">${runtimeSource(token)}</script></body></html>`;
}

// ---------------------------------------------------------------------------------------------
// Controller: protocol, timeouts, snapshot validation and fallback. DOM-free for testing.

export type ViewHostStatus =
  | { state: "invalid_package"; reason: string }
  | { state: "fallback"; reason: string }
  | { state: "loading"; reason: null }
  | { state: "ready"; reason: null }
  | { state: "disposed"; reason: string };

export interface EvidenceSelection {
  kind: "equipment" | "entity";
  equipmentId: string | null;
  entityId: string | null;
  label: string;
  values: Array<{ channel: string; signal: string; truthClass: Channel["truthClass"]; display: string; health: string; evidenceRef: string | null }>;
  evidenceRefs: string[];
  snapshotSequence: number | null;
}

export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ControllerOptions {
  pkg: LoadedPackage | null;
  report: ValidationReport;
  post?: (message: HostFrameMessage) => void;
  timers?: Timers;
  readyTimeoutMs?: number;
  ackTimeoutMs?: number;
  onStatus?: (status: ViewHostStatus) => void;
  onSelect?: (selection: EvidenceSelection) => void;
  token?: string;
  nonce?: string;
}

const defaultTimers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

export class MachineViewController {
  readonly token: string;
  readonly nonce: string;
  readonly srcdoc: string | null;
  #pkg: LoadedPackage | null;
  #status: ViewHostStatus;
  #opts: ControllerOptions;
  #timers: Timers;
  #lastGood: ViewSnapshot | null = null;
  #lastErrors: string[] = [];
  #frameSequence = 0;
  #pending: { sequence: number; handle: unknown } | null = null;
  #readyHandle: unknown = null;
  #lastSelectAt = -Infinity;
  #counters = { framesSent: 0, framesApplied: 0, snapshotsRejected: 0, selections: 0 };

  constructor(options: ControllerOptions) {
    this.#opts = options;
    this.#timers = options.timers ?? defaultTimers;
    this.token = options.token ?? randomToken();
    this.nonce = options.nonce ?? randomToken();
    this.#pkg = options.pkg;
    if (!options.report.contractValid || !options.pkg) {
      this.srcdoc = null;
      this.#status = { state: "invalid_package", reason: `Machine view package contract is invalid: ${options.report.errors.slice(0, 3).join("; ") || "not loaded"}` };
    } else if (!options.report.viewValid || options.pkg.svg === null) {
      this.srcdoc = null;
      this.#status = { state: "fallback", reason: `Generated view not mounted: ${options.report.errors.slice(0, 3).join("; ") || "no generated view"}` };
    } else {
      let srcdoc: string | null = null;
      let failure = "";
      try { srcdoc = buildSrcdoc(options.pkg, this.token, this.nonce); } catch (error) { failure = (error as Error).message; }
      this.srcdoc = srcdoc;
      this.#status = srcdoc ? { state: "loading", reason: null } : { state: "fallback", reason: `View could not be prepared: ${failure}` };
      if (srcdoc) this.#readyHandle = this.#timers.setTimeout(() => this.#fail(`View did not report ready within ${this.#opts.readyTimeoutMs ?? 5000} ms`), options.readyTimeoutMs ?? 5000);
    }
  }

  get status(): ViewHostStatus { return this.#status; }
  get lastSnapshot(): ViewSnapshot | null { return this.#lastGood; }
  get lastSnapshotErrors(): readonly string[] { return this.#lastErrors; }
  get counters() { return { ...this.#counters }; }

  /** Supply the next snapshot. Never throws; returns validation problems for the host log. */
  push(snapshot: unknown): { accepted: boolean; errors: string[] } {
    if (this.#status.state === "disposed" || !this.#pkg) return { accepted: false, errors: [this.#status.reason ?? "no package"] };
    const errors = validateSnapshot(this.#pkg, snapshot);
    let effective: ViewSnapshot | null;
    if (errors.length) {
      this.#counters.snapshotsRejected += 1;
      this.#lastErrors = errors;
      effective = this.#lastGood ? { ...this.#lastGood, link: { state: "held", ageMs: this.#lastGood.link.ageMs, reason: "host supplied an invalid snapshot; last valid frame held" } } : null;
    } else {
      this.#lastErrors = [];
      this.#lastGood = structuredClone(snapshot as ViewSnapshot);
      effective = this.#lastGood;
    }
    if (effective && this.#status.state === "ready") this.#send(effective);
    return { accepted: errors.length === 0, errors };
  }

  /** Inbound message from the iframe. Callers must already have checked `event.source`. */
  receive(data: unknown): void {
    if (this.#status.state !== "loading" && this.#status.state !== "ready") return;
    if (typeof data !== "object" || data === null) return;
    const m = data as Record<string, unknown>;
    if (m.protocol !== VIEW_PROTOCOL_VERSION || m.token !== this.token) return;
    const pkg = this.#pkg!;
    switch (m.type) {
      case "ready": {
        if (this.#status.state !== "loading" || !Array.isArray(m.elementIds)) return;
        const present = new Set(m.elementIds.filter((id): id is string => typeof id === "string"));
        const missing = requiredElementIds(pkg).filter(id => !present.has(id));
        this.#timers.clearTimeout(this.#readyHandle);
        if (missing.length) { this.#fail(`Rendered view lacks bound elements: ${missing.slice(0, 10).join(", ")}`); return; }
        this.#setStatus({ state: "ready", reason: null });
        if (this.#lastGood) this.#send(this.#lastGood);
        return;
      }
      case "applied": {
        if (!Number.isInteger(m.sequence)) return;
        this.#counters.framesApplied += 1;
        const missing = Array.isArray(m.missing) ? m.missing.filter((id): id is string => typeof id === "string") : [];
        if (missing.length) { this.#fail(`View could not apply frame elements: ${missing.slice(0, 10).join(", ")}`); return; }
        if (this.#pending && (m.sequence as number) >= this.#pending.sequence) { this.#timers.clearTimeout(this.#pending.handle); this.#pending = null; }
        return;
      }
      case "select": {
        const now = this.#timers.now();
        if (now - this.#lastSelectAt < 50) return;
        this.#lastSelectAt = now;
        const selection = this.describeSelection(typeof m.equipmentId === "string" ? m.equipmentId : null, typeof m.entityId === "string" ? m.entityId : null);
        if (selection) { this.#counters.selections += 1; this.#opts.onSelect?.(selection); }
        return;
      }
      case "error":
        this.#fail(`View runtime error: ${String(m.message ?? "unknown").slice(0, 200)}`);
        return;
    }
  }

  /** Evidence lookup for an equipment or entity selection, from the latest valid snapshot. */
  describeSelection(equipmentId: string | null, entityId: string | null): EvidenceSelection | null {
    const pkg = this.#pkg;
    if (!pkg) return null;
    const snapshot = this.#lastGood;
    if (entityId !== null) {
      const entity = snapshot?.entities.items.find(e => e.id === entityId);
      if (!entity) return null;
      return { kind: "entity", equipmentId: null, entityId, label: String(entity.state.itemId ?? entity.id), values: [], evidenceRefs: entity.evidenceRef ? [entity.evidenceRef] : [], snapshotSequence: snapshot?.frame.sequence ?? null };
    }
    const equipment = pkg.equipment.equipment.find(e => e.id === equipmentId);
    if (!equipment) return null;
    const channels = new Map(pkg.bindings.channels.map(c => [c.id, c]));
    const values = equipment.channels.map(id => channels.get(id)).filter((c): c is Channel => Boolean(c)).map(c => {
      const r = snapshot ? resolveSample(c, snapshot) : { display: "unknown", health: "unknown", evidenceRef: null };
      return { channel: c.id, signal: c.signal, truthClass: c.truthClass, display: r.display, health: r.health, evidenceRef: r.evidenceRef };
    });
    return { kind: "equipment", equipmentId: equipment.id, entityId: null, label: equipment.label, values, evidenceRefs: values.map(v => v.evidenceRef).filter((r): r is string => Boolean(r)), snapshotSequence: snapshot?.frame.sequence ?? null };
  }

  /** Fallback content for any non-ready state; `null` only while a valid view is mounted. */
  fallback(): FallbackModel | null {
    if (this.#status.state === "ready" || this.#status.state === "loading") return null;
    if (!this.#pkg) return null;
    return buildFallback(this.#pkg, this.#lastGood, this.#status.reason);
  }

  fallbackHtml(): string {
    const model = this.fallback();
    if (model) return renderFallbackHtml(model);
    if (this.#status.state === "invalid_package" || this.#status.state === "disposed") return `<section class="cb-fallback" role="status"><h3>Machine view unavailable</h3><p>${escapeHtml(this.#status.reason)}</p></section>`;
    return "";
  }

  dispose(reason = "host disposed the view"): void {
    this.#clearTimers();
    this.#setStatus({ state: "disposed", reason });
  }

  #send(snapshot: ViewSnapshot): void {
    if (!this.#opts.post || !this.#pkg) return;
    this.#frameSequence += 1;
    const message: HostFrameMessage = { protocol: VIEW_PROTOCOL_VERSION, token: this.token, type: "frame", sequence: this.#frameSequence, ops: resolveFrame(this.#pkg, snapshot) };
    try { this.#opts.post(message); } catch (error) { this.#fail(`Posting to the view failed: ${(error as Error).message}`); return; }
    this.#counters.framesSent += 1;
    if (!this.#pending) {
      const sequence = this.#frameSequence;
      const ackTimeoutMs = this.#opts.ackTimeoutMs ?? 2000;
      this.#pending = { sequence, handle: this.#timers.setTimeout(() => this.#fail(`View did not acknowledge frame ${sequence} within ${ackTimeoutMs} ms`), ackTimeoutMs) };
    }
  }

  #fail(reason: string): void {
    if (this.#status.state === "fallback" || this.#status.state === "disposed" || this.#status.state === "invalid_package") return;
    this.#clearTimers();
    this.#setStatus({ state: "fallback", reason });
  }

  #clearTimers(): void {
    if (this.#readyHandle !== null) this.#timers.clearTimeout(this.#readyHandle);
    if (this.#pending) this.#timers.clearTimeout(this.#pending.handle);
    this.#readyHandle = null;
    this.#pending = null;
  }

  #setStatus(status: ViewHostStatus): void {
    this.#status = status;
    try { this.#opts.onStatus?.(status); } catch { /* host callback errors must not affect the view state */ }
  }
}

// ---------------------------------------------------------------------------------------------
// Minimal DOM mounting helper. Structural types keep this module free of a DOM lib dependency;
// the portal may instead drive MachineViewController from its own component.

interface MountElement {
  setAttribute(name: string, value: string): void;
  appendChild(child: MountElement): unknown;
  remove(): void;
  innerHTML: string;
  srcdoc?: string;
  contentWindow?: { postMessage(message: unknown, targetOrigin: string): void } | null;
}
interface MountMessageEvent { source: unknown; data: unknown }
export interface MountEnvironment {
  document: { createElement(tag: string): MountElement };
  window: {
    addEventListener(type: "message", listener: (event: MountMessageEvent) => void): void;
    removeEventListener(type: "message", listener: (event: MountMessageEvent) => void): void;
  };
}

export interface MountedView {
  controller: MachineViewController;
  push(snapshot: unknown): { accepted: boolean; errors: string[] };
  dispose(): void;
}

export function mountMachineView(container: MountElement, env: MountEnvironment, options: Omit<ControllerOptions, "post">): MountedView {
  let iframe: MountElement | null = null;
  const fallbackEl = env.document.createElement("div");
  fallbackEl.setAttribute("class", "cb-machine-view-fallback");
  const renderFallback = () => { fallbackEl.innerHTML = controller.fallbackHtml(); };
  const controller: MachineViewController = new MachineViewController({
    ...options,
    post: message => iframe?.contentWindow?.postMessage(message, "*"),
    onStatus: status => {
      if (status.state !== "ready" && status.state !== "loading") {
        iframe?.remove();
        iframe = null;
        renderFallback();
      }
      options.onStatus?.(status);
    }
  });
  const listener = (event: MountMessageEvent) => { if (iframe && event.source === iframe.contentWindow) controller.receive(event.data); };
  env.window.addEventListener("message", listener);
  container.appendChild(fallbackEl);
  if (controller.srcdoc) {
    iframe = env.document.createElement("iframe");
    iframe.setAttribute("sandbox", SANDBOX);
    iframe.setAttribute("referrerpolicy", "no-referrer");
    iframe.setAttribute("allow", "");
    iframe.setAttribute("title", "Muse-generated machine view: simulated world truth, not the PLC HMI");
    iframe.setAttribute("srcdoc", controller.srcdoc);
    container.appendChild(iframe);
  } else renderFallback();
  return {
    controller,
    push(snapshot) {
      const result = controller.push(snapshot);
      if (controller.status.state !== "ready" && controller.status.state !== "loading") renderFallback();
      return result;
    },
    dispose() {
      env.window.removeEventListener("message", listener);
      controller.dispose();
      iframe?.remove();
      iframe = null;
      renderFallback();
    }
  };
}
