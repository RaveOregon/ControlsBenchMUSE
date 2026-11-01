// Operation page: overview from observed I/O, Start/Stop/Reset/Auto as sequenced PLC requests,
// command versus feedback, item/route/disposition, readiness, counts and WCS/completion state.

import type { CommandAction, CommandView, PreconditionView } from "../protocol.ts";
import { HMI_TARGETS } from "../protocol.ts";
import { mountSchematic } from "./schematic.ts";
import { ACTION_TEXT, DISPOSITION, EXIT, MODE, OFFER_REASON, ROUTE, enumOf, fmtTime, h, newRequestId, outcomeLabel, post, setAttr, setClass, setText, show, store } from "./util.ts";

const A = (n: string) => `GVL_BenchRead.Active_${n}`;
const OUT = (n: string) => `GVL_BenchRead.${n}`;
const ST = (n: string) => `GVL_DemoRead.Status.${n}`;
const W = (n: string) => `GVL_DemoWrite.${n}`;

const rendered = new Set<string>();

export async function sendCommand(action: CommandAction, target: string, e: MouseEvent, route: string): Promise<void> {
  const requestId = newRequestId(action.replace("_", ""));
  store.local.set(requestId, { requestId, action, sentAtMs: Date.now() });
  store.emit();
  try {
    await post("/api/commands", { requestId, action, clientSessionId: store.clientSessionId, target,
      input: { target, isTrusted: e.isTrusted, x: Math.round(e.clientX), y: Math.round(e.clientY), atIso: new Date().toISOString(), route } });
  } catch (error) {
    const local = store.local.get(requestId);
    if (local) { local.error = error instanceof Error ? error.message : String(error); store.emit(); }
  }
}

function indicator(): HTMLSpanElement { return h("span", { class: "ind unknown", text: "—" }); }
function setInd(el: HTMLElement, value: boolean | undefined, on: string, off: string, kind: "on" | "warn" | "bad" = "on"): void {
  setText(el, value === undefined ? "?" : value ? on : off);
  setClass(el, `ind ${value === undefined ? "unknown" : value ? kind : ""}`);
}
function kv(rows: Array<[string, HTMLElement]>): HTMLDListElement {
  return h("dl", { class: "kv" }, ...rows.flatMap(([k, v]) => k === "—" ? [h("div", { class: "sep" })] : [h("dt", { text: k }), v]));
}
const dd = (status?: string) => h("dd", { text: "—", attrs: status ? { "data-hmi-status": status } : {} });

export function preconditionList(list: HTMLUListElement, items: PreconditionView[], onlyUnmet = false): void {
  const shown = onlyUnmet ? items.filter(i => i.met !== true) : items;
  const rows = shown.map(i => h("li", { class: i.met === true ? "met" : i.met === false ? "unmet" : "unknown" },
    h("span", { class: "mk", text: i.met === true ? "✓" : i.met === false ? "✕" : "?" }), h("span", { text: i.label }), h("span", { class: "obs", text: i.observed })));
  list.replaceChildren(...rows);
}

export function mountOperation(page: HTMLElement): () => void {
  // ----- Fault strip -----
  const fCode = h("span", { class: "code" }), fText = h("span", { class: "text" }), fCause = h("span", { class: "cause" }), fWhen = h("div", { class: "when" });
  const fLink = h("a", { text: "View alarm details →", attrs: { href: "#/alarms", "data-hmi-target": HMI_TARGETS.activeFaultLink } });
  // Always present at a fixed height, so controls never move when a fault appears or clears.
  const strip = h("div", { class: "fault-strip none", attrs: { role: "alert", "data-hmi-status": "active-fault" } }, fCode, h("div", { class: "fs-main" }, h("div", { class: "fs-line" }, fText, fCause), fWhen), fLink);

  // ----- Counts (PLC cumulative counters) -----
  const countEl = (label: string, status: string) => { const n = h("span", { class: "n", text: "—" }); return { n, el: h("div", { class: "count", attrs: { "data-hmi-status": status } }, n, h("span", { class: "l", text: label })) }; };
  const counts = { a: countEl("Exit A", "count.a"), b: countEl("Exit B", "count.b"), r: countEl("Runout", "count.runout"), m: countEl("Misroute", "count.misroute"), f: countEl("Faulted", "count.faulted") };

  // ----- Overview -----
  const schematic = mountSchematic();
  const overview = h("section", { class: "panel overview", attrs: { "aria-labelledby": "ov-h" } },
    h("header", {}, h("h2", { text: "Machine overview", attrs: { id: "ov-h" } }),
      h("span", { class: "aside", text: "Observed PLC I/O, not the physical simulation · filled = on / blocked · amber = command and feedback disagree" })),
    schematic.el,
    h("div", { class: "counts-bar" }, h("span", { class: "counts-title", text: "Counts", attrs: { title: "PLC cumulative counters since application start. M8 does not distinguish a counter reset from rollover." } }),
      counts.a.el, counts.b.el, counts.r.el, counts.m.el, counts.f.el, h("span", { class: "counts-note", text: "PLC cumulative since application start" })));

  // ----- Devices -----
  const dev = { mCmd: indicator(), mFb: indicator(), mOvl: indicator(), mNote: h("div", { class: "state-note" }),
    d: (["D1", "D2"] as const).map(() => ({ cmd: indicator(), home: indicator(), ext: indicator(), note: h("div", { class: "state-note" }) })) };
  const devices = h("section", { class: "panel" }, h("header", {}, h("h2", { text: "Command vs feedback" })),
    h("div", { class: "body" }, h("table", { class: "devtable", attrs: { "data-hmi-status": "devices" } },
      h("thead", {}, h("tr", {}, h("th", { text: "" }), h("th", { text: "Command" }), h("th", { text: "Feedback (observed)" }))),
      h("tbody", {},
        h("tr", {}, h("td", { text: "M1" }), h("td", {}, dev.mCmd), h("td", {}, h("span", { class: "pair" }, dev.mFb, dev.mOvl), dev.mNote)),
        ...dev.d.map((d, i) => h("tr", {}, h("td", { text: `D${i + 1}` }), h("td", {}, d.cmd), h("td", {}, h("span", { class: "pair" }, d.home, d.ext), d.note)))))));

  // ----- Item -----
  const item = { active: dd("item.active"), id: dd("item.id"), req: dd("item.requested-route"), eff: dd("item.effective-route"), exit: dd("item.actual-exit"), disp: dd("item.disposition"), exc: dd("item.exception") };
  const itemPanel = h("section", { class: "panel" }, h("header", {}, h("h2", { text: "Current item & route" })),
    h("div", { class: "body" }, kv([["Tracked carton", item.active], ["Item ID", item.id], ["Requested route", item.req], ["Effective route", item.eff], ["—", h("span")],
      ["Actual exit (last)", item.exit], ["Disposition (last)", item.disp], ["Exception", item.exc]])));

  // ----- Controls -----
  const modeText = h("div", { class: "mode", text: "—", attrs: { "data-hmi-status": "mode-readout" } });
  const modeMeta = h("div", { class: "meta" });
  const cmdButton = (action: CommandAction, target: string, label: string, hint: string, cls: string) =>
    h("button", { class: `cmd ${cls}`, attrs: { type: "button", "data-hmi-target": target, "aria-label": `${label}: ${hint}`, "data-action": action },
      on: { click: e => void sendCommand(action, target, e as MouseEvent, "operation") } }, label, h("small", { text: hint }));
  const bStart = cmdButton("start", HMI_TARGETS.start, "START", "Requires Auto on", "start");
  const bStop = cmdButton("stop", HMI_TARGETS.stop, "STOP", "Removes run command", "stop");
  const bReset = cmdButton("reset", HMI_TARGETS.reset, "RESET", "Clears latch · no restart", "reset");
  const resetHint = h("div", { class: "muted", attrs: { style: "font-size:11.5px;align-self:center;line-height:1.35" }, text: "Reset never starts the machine. Start is a separate request." });
  const segOn = h("button", { class: "seg", text: "ON", attrs: { type: "button", "data-hmi-target": HMI_TARGETS.autoOn, "aria-label": "Auto request on", "aria-pressed": "false", "data-action": "auto_on" },
    on: { click: e => void sendCommand("auto_on", HMI_TARGETS.autoOn, e as MouseEvent, "operation") } });
  const segOff = h("button", { class: "seg", text: "OFF", attrs: { type: "button", "data-hmi-target": HMI_TARGETS.autoOff, "aria-label": "Auto request off", "aria-pressed": "false", "data-action": "auto_off" },
    on: { click: e => void sendCommand("auto_off", HMI_TARGETS.autoOff, e as MouseEvent, "operation") } });
  const autoRow = h("div", { class: "auto-switch", attrs: { role: "group", "aria-label": "Auto request" } },
    h("div", { class: "lbl" }, "AUTO", h("small", { text: "Retained request bit" })), segOn, segOff);
  const reason = h("p", { class: "cmd-disabled-reason", attrs: { hidden: "", role: "status" } });
  const blockers = h("ul", { class: "preconds" });
  const blockersWrap = h("div", { attrs: { hidden: "" } }, h("div", { class: "faint", text: "Start not possible now (HMI reading of the M8 rule; the PLC decides):", attrs: { style: "font-size:11.5px;margin-top:8px" } }), blockers);
  const log = h("ul", { class: "cmd-log", attrs: { "aria-label": "Recent commands", "data-hmi-status": "command-log" } });
  const controls = h("section", { class: "panel", attrs: { "aria-labelledby": "ctl-h" } },
    h("header", {}, h("h2", { text: "Controls", attrs: { id: "ctl-h" } }), h("span", { class: "aside", text: "Sequenced M8 operator requests" })),
    h("div", { class: "body" }, h("div", { class: "mode-readout" }, modeText, modeMeta), h("div", { class: "cmd-grid" }, bStart, bStop, bReset, resetHint, autoRow), reason, blockersWrap, log));

  // ----- Release / WCS / completion -----
  const w = { dest: h("span", { text: "—" }), release: dd("release.ready"), offerPending: dd("wcs.offer-pending"), offer: dd("wcs.last-offer"), offerResult: dd("wcs.offer-result"),
    completion: dd("completion.state"), completionDetail: dd("completion.detail"), ack: dd("completion.ack") };
  const wcs = h("section", { class: "panel" }, h("header", {}, h("h2", { text: "Release · WCS" }), h("span", { class: "aside", text: "read-only here", attrs: { title: "WCS messages come from the WCS peer. This HMI never writes WCS fields." } })),
    h("div", { class: "body" }, kv([["Release ready", w.release], ["Offer pending", w.offerPending], ["Last offer", w.offer], ["Offer result", w.offerResult], ["—", h("span")],
      ["Completion", w.completion], ["Record", w.completionDetail], ["WCS ack (readback)", w.ack]])));

  page.append(strip, h("div", { class: "op-grid" },
    h("div", { class: "op-left" }, overview, h("div", { class: "op-row" }, devices, itemPanel, wcs)),
    h("div", { class: "op-right" }, controls)));

  const commandButtons: Array<[HTMLButtonElement, CommandAction]> = [[bStart, "start"], [bStop, "stop"], [bReset, "reset"], [segOn, "auto_on"], [segOff, "auto_off"]];

  return function update(): void {
    const st = store.state; if (!st) return;
    // Fault strip
    const fault = st.alarms.active.find(a => a.kind === "fault") ?? st.alarms.active.find(a => a.kind === "exception");
    if (!fault) {
      setClass(strip, "fault-strip none");
      setText(fCode, "NO FAULT"); setText(fText, "No active machine fault"); setText(fCause, ""); fCause.title = "";
      setText(fWhen, st.snapshot ? `Latest PLC observation ${fmtTime(st.snapshot.receivedAtIso)}${store.fresh() ? "" : " (not fresh)"}` : "No PLC observation yet");
      setText(fLink, "Alarm history →"); setAttr(fLink, "href", "#/alarms");
    } else {
      setText(fLink, "View alarm details →");
      setClass(strip, `fault-strip${fault.kind === "exception" ? " exception" : ""}`);
      setText(fCode, `${fault.kind === "fault" ? "FAULT" : "EXCEPTION"} ${fault.code}`);
      setText(fText, fault.plcText || "(no PLC text)");
      setText(fCause, fault.cause); fCause.title = fault.response;
      setText(fWhen, fault.firstObservedBasis === "active_at_observation_start" ? `${fault.response} Already active when this HMI began observing at ${fmtTime(fault.firstObservedAtIso, false)}; onset unknown.` : `${fault.response} First observed ${fmtTime(fault.firstObservedAtIso)} (HMI receipt time).`);
      setAttr(fLink, "href", `#/alarms?id=${encodeURIComponent(fault.id)}`);
    }
    schematic.update();

    // Devices
    const mCmd = store.bool(OUT("Motor_RunCmd")), mFb = store.bool(A("Drive_RunningFB")), ovl = store.bool(A("Drive_Overload"));
    setInd(dev.mCmd, mCmd, "RUN", "OFF"); setInd(dev.mFb, mFb, "RUNNING", "STOPPED"); setInd(dev.mOvl, ovl, "OVERLOAD", "NO OVERLOAD", "bad");
    const mDis = mCmd !== undefined && mFb !== undefined && mCmd !== mFb;
    setText(dev.mNote, mCmd === undefined ? "" : mDis ? (mCmd ? "Commanded; no running feedback yet" : "Not commanded; feedback still running (coast/stop)") : "Command and feedback agree");
    setClass(dev.mNote, `state-note${mDis ? " warn" : ""}`);
    dev.d.forEach((d, i) => {
      const id = `D${i + 1}`, cmd = store.bool(OUT(`${id}_ExtendCmd`)), home = store.bool(A(`${id}_HomeFB`)), ext = store.bool(A(`${id}_ExtendedFB`));
      setInd(d.cmd, cmd, "EXTEND", "RETRACT"); setInd(d.home, home, "HOME", "HOME", "on"); setInd(d.ext, ext, "EXTENDED", "EXTENDED", "on");
      if (home === false) setClass(d.home, "ind"); if (ext === false) setClass(d.ext, "ind");
      const state = home === undefined || ext === undefined ? "" : home && ext ? "Both limits on — contradictory" : ext ? "At extended limit" : home ? "At home limit" : "Between limits (no limit made)";
      const mismatch = cmd !== undefined && ext !== undefined && home !== undefined && (cmd ? !ext : !home);
      setText(d.note, state + (mismatch ? (cmd ? " · extend commanded, not extended" : " · retract commanded, not home") : ""));
      setClass(d.note, `state-note${home && ext ? " bad" : mismatch ? " warn" : ""}`);
    });

    // Item
    const active = store.bool(ST("ItemActive"));
    setText(item.active, active === undefined ? "—" : active ? "Yes" : "No");
    const id = store.value(ST("ActiveItemId"));
    setText(item.id, id === undefined ? "—" : id === 0 ? "0 (unassigned)" : String(id));
    setText(item.req, enumOf(ROUTE, store.value(ST("RequestedRoute")))); setText(item.eff, enumOf(ROUTE, store.value(ST("EffectiveRoute"))));
    setText(item.exit, enumOf(EXIT, store.value(ST("ActualExit")))); setText(item.disp, enumOf(DISPOSITION, store.value(ST("Disposition"))));
    const exc = store.value(ST("ExceptionCode")), excText = store.value(ST("ExceptionText"));
    setText(item.exc, exc === undefined ? "—" : exc === 0 ? "None" : `${exc} · ${excText}`);

    // Counts
    const setCount = (c: { n: HTMLElement; el: HTMLElement }, path: string, cls = "") => { const v = store.value(ST(path)); setText(c.n, v === undefined ? "—" : String(v)); setClass(c.el, `count ${cls && Number(v) > 0 ? cls : ""}`); };
    setCount(counts.a, "CountExitA"); setCount(counts.b, "CountExitB"); setCount(counts.r, "CountRunout"); setCount(counts.m, "CountMisroute", "attention"); setCount(counts.f, "CountFaulted", "bad");

    // Controls
    const mode = store.value(ST("Mode")), m = typeof mode === "number" ? MODE[mode] : undefined;
    setText(modeText, m ? m.text.toUpperCase() : "—"); setClass(modeText, `mode ${m?.cls ?? ""}`);
    setText(modeMeta, `Start ack ${store.value(ST("StartAck")) ?? "—"} · Stop ack ${store.value(ST("StopAck")) ?? "—"} · Reset ack ${store.value(ST("ResetAck")) ?? "—"}`);
    const auto = store.bool(W("AutoRequest"));
    setAttr(segOn, "aria-pressed", String(auto === true)); setAttr(segOff, "aria-pressed", String(auto === false));
    const busyServer = st.commands.find(c => c.outcome === "pending" || c.outcome === "delivered");
    const busyLocal = [...store.local.values()].find(l => !l.error);
    const why = !store.serviceConnected ? "HMI service connection lost." : !st.ownership.commandsEnabled ? `Commands disabled: ${st.ownership.reasons.join("; ")}.`
      : !store.fresh() ? `PLC data not fresh (${st.link.state}).` : st.link.plcScanning === false ? "PLC is not scanning." : busyServer || busyLocal ? `Waiting for the PLC to acknowledge ${ACTION_TEXT[(busyServer ?? busyLocal)!.action]}.` : "";
    for (const [b, action] of commandButtons) {
      b.disabled = !!why;
      b.classList.toggle("busy", (busyServer?.action ?? busyLocal?.action) === action);
      setAttr(b, "data-enabled", String(!why));
    }
    setText(reason, why); show(reason, !!why);
    const startBlocked = st.preconditions.start.filter(p => p.met === false);
    show(blockersWrap, startBlocked.length > 0 && mode !== 1);
    if (startBlocked.length) preconditionList(blockers, st.preconditions.start, true);

    // Command log (local sends first, then service records)
    const rows: HTMLElement[] = [];
    for (const l of store.local.values()) rows.push(h("li", {}, h("span", { class: "act", text: ACTION_TEXT[l.action] }), h("span", { class: `outcome ${l.error ? "failed" : "sending"}`, text: l.error ? "Send failed" : "Sending" }),
      h("span", { class: "when", text: fmtTime(new Date(l.sentAtMs + store.offsetMs).toISOString()) }), h("span", { class: "detail", text: l.error ?? "Sent from this browser; the HMI service has not yet recorded it." })));
    for (const c of st.commands.slice(0, 3)) rows.push(commandRow(c));
    if (!rows.length) rows.push(h("li", { class: "empty", text: "No operator commands in this HMI session." }));
    log.replaceChildren(...rows);

    // Report the outcome this page actually rendered (DOM-level screen evidence).
    for (const c of st.commands.slice(0, 4)) {
      const key = `${c.requestId}:${c.outcome}`;
      if (c.clientSessionId === store.clientSessionId && !rendered.has(key) && !["pending", "delivered"].includes(c.outcome)) {
        rendered.add(key);
        void post("/api/ui-rendered", { clientSessionId: store.clientSessionId, requestId: c.requestId, outcome: c.outcome, text: `${ACTION_TEXT[c.action]} · ${outcomeLabel(c)}`, atIso: new Date().toISOString() }).catch(() => {});
      }
    }

    // WCS / completion
    const rel = store.bool(ST("ReleaseReady"));
    setText(w.release, rel === undefined ? "—" : rel ? "Yes" : "No");
    const ready = (n: string) => { const v = store.bool(A(n)); return v === undefined ? "?" : v ? "ready" : "NOT READY"; };
    setText(w.dest, `Destinations: A ${ready("ExitA_Ready")} · B ${ready("ExitB_Ready")} · Runout ${ready("Runout_Ready")}`);
    setText(w.offerPending, store.bool(ST("OfferPending")) ? "Yes" : store.bool(ST("OfferPending")) === false ? "No" : "—");
    setText(w.offer, `#${store.value(ST("OfferAckSequence")) ?? "—"} · item ${store.value(ST("OfferAckItemId")) ?? "—"} · route ${enumOf(ROUTE, store.value(W("OfferRoute")))}`);
    const acc = store.bool(ST("OfferAccepted"));
    const offerSeq = store.value(ST("OfferAckSequence")), offerReason = store.value(ST("OfferReason"));
    setText(w.offerResult, acc === undefined ? "—" : offerSeq === 0 ? "No offer yet" : acc ? "Accepted" : offerReason === 0 ? "Not accepted" : `Rejected · ${enumOf(OFFER_REASON, offerReason)}`);
    const pending = store.bool(ST("CompletionPending"));
    const completionSeq = store.value(ST("CompletionSequence"));
    setText(w.completion, pending === undefined ? "—" : completionSeq === 0 ? "None yet" : `${pending ? "Awaiting WCS ack" : "Acknowledged"} · #${completionSeq ?? "—"}`);
    setText(w.completionDetail, `item ${store.value(ST("CompletionItemId")) ?? "—"} · ${enumOf(ROUTE, store.value(ST("CompletionRoute")))} → ${enumOf(EXIT, store.value(ST("CompletionExit")))} · ${enumOf(DISPOSITION, store.value(ST("CompletionDisposition")))}`);
    setText(w.ack, String(store.value(W("CompletionAck")) ?? "—"));
  };
}

export function commandRow(c: CommandView): HTMLLIElement {
  const resulting = c.resulting ? ` Resulting: ${c.resulting.modeText ?? "?"}, motor cmd ${c.resulting.motorRunCmd ? "on" : "off"}, run feedback ${c.resulting.driveRunningFb ? "on" : "off"}${c.resulting.settled ? "" : " (still changing at window end)"}.` : "";
  return h("li", { attrs: { "data-request-id": c.requestId, "data-outcome": c.outcome } },
    h("span", { class: "act", text: ACTION_TEXT[c.action] }), h("span", { class: `outcome ${c.outcome}`, text: outcomeLabel(c) }),
    h("span", { class: "when", text: fmtTime(c.acknowledgedAtIso ?? c.deliveredAtIso ?? c.requestedAtIso) }),
    h("span", { class: "detail", text: `${c.detail}${resulting}` }));
}

