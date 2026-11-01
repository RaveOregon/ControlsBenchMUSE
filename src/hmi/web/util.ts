// DOM helpers, client store and formatting for the operator HMI. Pages build their DOM once and
// update text/attributes in place, so a control is never replaced under a pointer or an agent.

import type { CommandAction, CommandView, HmiStateView, SampleView, Scalar } from "../protocol.ts";

type Child = Node | string | null | undefined | false;
type Props = { class?: string; text?: string; attrs?: Record<string, string>; on?: Record<string, (e: Event) => void> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const [k, f] of Object.entries(props.on ?? {})) el.addEventListener(k, f);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const SVG = "http://www.w3.org/2000/svg";
export function s(tag: string, attrs: Record<string, string | number> = {}, ...children: Array<SVGElement | string>): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

export const setText = (el: Element, value: string) => { if (el.textContent !== value) el.textContent = value; };
export const setAttr = (el: Element, name: string, value: string | null) => {
  if (value === null) { if (el.hasAttribute(name)) el.removeAttribute(name); }
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
};
export const setClass = (el: Element, classes: string) => { if (el.getAttribute("class") !== classes) el.setAttribute("class", classes); };
export const show = (el: HTMLElement, visible: boolean) => { if (el.hidden === visible) el.hidden = !visible; };

// ---------- Store ----------

export interface LocalCommand { requestId: string; action: CommandAction; sentAtMs: number; error?: string }

export class Store {
  state?: HmiStateView;
  clientSessionId = "";
  /** Server clock minus client clock, from each state message. */
  offsetMs = 0;
  serviceConnected = false;
  lastMessageMs = 0;
  local = new Map<string, LocalCommand>();
  #listeners = new Set<() => void>();

  set(state: HmiStateView): void {
    this.state = state; this.offsetMs = Date.parse(state.serverNowIso) - Date.now(); this.lastMessageMs = Date.now(); this.serviceConnected = true;
    for (const c of state.commands) this.local.delete(c.requestId);
    this.emit();
  }
  emit(): void { for (const l of this.#listeners) l(); }
  subscribe(l: () => void): void { this.#listeners.add(l); }
  /** Server-referenced "now" in ms. */
  now(): number { return Date.now() + this.offsetMs; }

  sample(path: string): SampleView | undefined { return this.state?.snapshot?.values[path]; }
  value(path: string): Scalar | undefined { const s = this.sample(path); return s && s.good ? s.value : undefined; }
  bool(path: string): boolean | undefined { const v = this.value(path); return typeof v === "boolean" ? v : undefined; }
  dataAgeMs(): number | undefined { const at = this.state?.link.lastPollOkAtIso; return at ? this.now() - Date.parse(at) : undefined; }
  fresh(): boolean { return this.serviceConnected && this.state?.link.state === "connected"; }
  latestCommand(actions: CommandAction[]): CommandView | undefined { return this.state?.commands.find(c => actions.includes(c.action)); }
}

export const store = new Store();

// ---------- API ----------

export async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json() as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export function newRequestId(action: string): string {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return `hmi-${action}-${Date.now().toString(36)}-${r[0].toString(36)}${r[1].toString(36)}`;
}

// ---------- Formatting ----------

export function fmtTime(iso: string | undefined, ms = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${ms ? `.${p(d.getMilliseconds(), 3)}` : ""}`;
}
export function fmtDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${fmtTime(iso, false)}`;
}
export function fmtAge(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 0) ms = 0;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
export function fmtDuration(fromIso: string, toIso?: string, nowMs = store.now()): string {
  const end = toIso ? Date.parse(toIso) : nowMs;
  return fmtAge(end - Date.parse(fromIso));
}
export function fmtScalar(v: Scalar | undefined): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 10 ? 4 : 2);
  return v === "" ? "''" : v;
}

export const MODE: Record<number, { text: string; cls: string }> = {
  0: { text: "Stopped", cls: "stopped" }, 1: { text: "Auto", cls: "auto" }, 2: { text: "Stopping", cls: "stopping" }, 3: { text: "Faulted", cls: "faulted" }
};
export const ROUTE: Record<number, string> = { 0: "Unknown", 1: "A", 2: "B" };
export const EXIT: Record<number, string> = { 0: "Unknown", 1: "Exit A", 2: "Exit B", 3: "Runout" };
export const DISPOSITION: Record<number, string> = { 0: "None", 1: "Sorted", 2: "Runout (unassigned)", 3: "Misrouted", 4: "Faulted" };
export const OFFER_REASON: Record<number, string> = { 0: "Accepted", 1: "Busy / unavailable", 2: "Malformed", 3: "Conflicting identity or route", 4: "Stale / replayed" };
export const enumOf = (table: Record<number, string>, v: Scalar | undefined) => v === undefined || v === null ? "—" : table[Number(v)] ?? `Code ${v}`;

export const OUTCOME_TEXT: Record<string, string> = {
  sending: "Sending", pending: "Requested", delivered: "Written · awaiting PLC", applied: "Applied by PLC", rejected: "Rejected by PLC",
  timed_out: "No PLC ack", unconfirmed: "Unconfirmed", failed: "Failed", refused: "Not sent"
};
export const ACTION_TEXT: Record<CommandAction, string> = { start: "Start", stop: "Stop", reset: "Reset", auto_on: "Auto on", auto_off: "Auto off" };
export function outcomeLabel(c: CommandView): string {
  const label = c.outcome === "applied" && c.ackKind === "readback" ? "Readback confirmed" : OUTCOME_TEXT[c.outcome] ?? c.outcome;
  // Fixture acknowledgements are emulated; never call them PLC results.
  return store.state?.identity.source.kind === "fixture" ? label.replace(" by PLC", " (fixture ack)").replace("No PLC ack", "No fixture ack") : label;
}

export const BUS = { navigate: (_route: string) => {} };
