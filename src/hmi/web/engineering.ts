// Maintenance / Engineering page: read-only diagnostics. Every row shows the observed value with
// its OPC UA quality, HMI receipt age and source timestamp. No tag writes or forcing exist here.

import { fmtAge, fmtScalar, fmtTime, h, setClass, setText, store } from "./util.ts";

const A = (n: string) => `GVL_BenchRead.Active_${n}`;
const BR = (n: string) => `GVL_BenchRead.${n}`;
const BW = (n: string) => `GVL_BenchWrite.${n}`;
const ST = (n: string) => `GVL_DemoRead.Status.${n}`;
const DW = (n: string) => `GVL_DemoWrite.${n}`;

type Row = { tr: HTMLTableRowElement; update: () => void; leaf: string };

let withSourceTime = false;
function sigRow(path: string, label = path.split(".").at(-1)!, note?: string): Row {
  const val = h("td", { class: "val", text: "—" }), q = h("td", { class: "q", text: "—" }), age = h("td", { class: "age", text: "—" });
  const src = withSourceTime ? h("td", { class: "age", text: "—" }) : undefined;
  const name = h("td", { class: "name" }, label, h("span", { class: "src", text: note ? `${path} · ${note}` : path }));
  const tr = h("tr", { attrs: { "data-signal": path } }, name, val, q, age, src);
  return { tr, leaf: path.split(".").at(-1)!, update: () => {
    const s = store.sample(path);
    if (!s) { setText(val, "—"); setText(q, "unread"); setText(age, "—"); return; }
    setText(val, fmtScalar(s.value));
    const fixture = /\[fixture: ([^\]]+)\]/.exec(s.status)?.[1];
    const quality = s.status.replace(/\s*\(0x[0-9A-Fa-f]+\)/, "").replace(/\s*\[fixture:[^\]]*\]/, "");
    setText(q, fixture ? `${quality} · fx ${fixture === "recorded" ? "rec" : fixture === "write-group" ? "req" : "def"}` : quality);
    setClass(q, `q${s.good ? "" : " bad"}`);
    q.title = fixture ? `Fixture value origin: ${fixture}` : s.status;
    if (src) setText(src, fmtTime(s.sourceTimestamp));
    const a = store.now() - Date.parse(s.receivedAtIso);
    setText(age, fmtAge(a)); setClass(age, `age${a > (store.state?.link.staleAfterMs ?? 1500) ? " stale" : ""}`);
    tr.title = `source ${s.sourceTimestamp || "—"} · server ${s.serverTimestamp || "—"} · received ${s.receivedAtIso}`;
  } };
}

function derivedRow(label: string, compute: () => string, warn: () => boolean = () => false): Row {
  const val = h("td", { class: "val", text: "—" });
  const tr = h("tr", {}, h("td", { class: "name" }, label, h("span", { class: "src", text: "derived by HMI" })), val, h("td", { class: "q", text: "derived" }), h("td", { class: "age", text: "" }));
  return { tr, leaf: label, update: () => { setText(val, compute()); setClass(val, `val${warn() ? " mismatch" : ""}`); } };
}

function infoRow(label: string, compute: () => string, warn: () => boolean = () => false): Row {
  const val = h("td", { class: "val", text: "—", attrs: { colspan: "3", style: "text-align:left;font-family:var(--sans);font-weight:600;white-space:normal" } });
  const tr = h("tr", {}, h("td", { class: "name", text: label, attrs: { style: "font-family:var(--sans);font-size:12px" } }), val);
  return { tr, leaf: label, update: () => { setText(val, compute()); setClass(val, `val${warn() ? " mismatch" : ""}`); } };
}

function table(title: string, aside: string, groups: Array<[string, Row[]]>, status: string, sourceTime = false): { el: HTMLElement; rows: Row[] } {
  const rows = groups.flatMap(([, r]) => r);
  const tbody = h("tbody", {}, ...groups.flatMap(([g, r]) => [...(g ? [h("tr", { class: "group" }, h("td", { text: g, attrs: { colspan: sourceTime ? "5" : "4" } }))] : []), ...r.map(x => x.tr)]));
  const el = h("section", { class: "panel", attrs: { "data-hmi-status": status } }, h("header", {}, h("h2", { text: title }), h("span", { class: "aside", text: aside })),
    h("table", { class: `sigtable${sourceTime ? " with-src" : ""}` }, h("thead", {}, h("tr", {}, h("th", { text: "Signal" }), h("th", { text: "Value", attrs: { style: "text-align:right" } }), h("th", { text: "Quality" }), h("th", { text: "Age", attrs: { style: "text-align:right" } }), sourceTime ? h("th", { text: "Source time", attrs: { style: "text-align:right" } }) : null)), tbody));
  return { el, rows };
}

const big = (v: unknown) => { try { return BigInt(String(v)); } catch { return undefined; } };

export function mountEngineering(page: HTMLElement): { update: () => void; onRoute: (p: URLSearchParams) => void } {
  withSourceTime = true;
  const rawIo = table("Raw inputs · PLC active image", "selected intercepted image", [
    ["Photo-eyes", ["PE_Entry", "PE_D1Approach", "PE_D2Approach", "PE_ExitA", "PE_ExitB", "PE_Runout"].map(n => sigRow(A(n), n))],
    ["Divert limit feedback", ["D1_HomeFB", "D1_ExtendedFB", "D2_HomeFB", "D2_ExtendedFB"].map(n => sigRow(A(n), n))],
    ["Drive", ["Drive_RunningFB", "Drive_Overload"].map(n => sigRow(A(n), n))],
    ["Destination readiness", ["ExitA_Ready", "ExitB_Ready", "Runout_Ready"].map(n => sigRow(A(n), n))],
    ["Encoder", [sigRow(A("Encoder_Count"), "Encoder_Count", "raw UDINT counts")]],
    ["Compatibility REAL (not used by controller)", ["Belt_SpeedActual", "Drive_Current", "D1_Position", "D2_Position"].map(n => sigRow(A(n), n))]
  ], "eng.raw-io", true);
  withSourceTime = false;

  const outputs = table("Actuator commands & feedback", "PLC outputs vs limit/drive feedback", [
    ["Outputs (GVL_BenchRead)", ["Motor_RunCmd", "D1_ExtendCmd", "D2_ExtendCmd", "StackLight_Red", "StackLight_Green"].map(n => sigRow(BR(n), n))],
    ["Command vs feedback", [
      derivedRow("M1 run cmd → running FB", () => `${fmtScalar(store.value(BR("Motor_RunCmd")))} → ${fmtScalar(store.value(A("Drive_RunningFB")))}`, () => store.value(BR("Motor_RunCmd")) !== store.value(A("Drive_RunningFB"))),
      derivedRow("D1 extend cmd → home / ext", () => `${fmtScalar(store.value(BR("D1_ExtendCmd")))} → ${fmtScalar(store.value(A("D1_HomeFB")))} / ${fmtScalar(store.value(A("D1_ExtendedFB")))}`,
        () => store.value(BR("D1_ExtendCmd")) === true ? store.value(A("D1_ExtendedFB")) !== true : store.value(A("D1_HomeFB")) !== true),
      derivedRow("D2 extend cmd → home / ext", () => `${fmtScalar(store.value(BR("D2_ExtendCmd")))} → ${fmtScalar(store.value(A("D2_HomeFB")))} / ${fmtScalar(store.value(A("D2_ExtendedFB")))}`,
        () => store.value(BR("D2_ExtendCmd")) === true ? store.value(A("D2_ExtendedFB")) !== true : store.value(A("D2_HomeFB")) !== true)]],
    ["Drive & encoder (PLC-derived)", [sigRow(ST("EncoderDelta"), "EncoderDelta", "counts per PLC window"), sigRow(ST("BeltSpeedMps"), "BeltSpeedMps", "m/s, PLC-derived"),
      sigRow(ST("TravelMetres"), "TravelMetres", "1000 counts/m"), sigRow(ST("ScanTimeUs"), "ScanTimeUs")]],
    ["Operator requests (readback) → PLC acknowledgement", [sigRow(DW("StartSequence")), sigRow(ST("StartAck")), sigRow(ST("StartAccepted")), sigRow(DW("StopSequence")), sigRow(ST("StopAck")),
      sigRow(DW("ResetSequence")), sigRow(ST("ResetAck")), sigRow(ST("ResetAccepted")), sigRow(DW("AutoRequest"))]]
  ], "eng.outputs");

  const wcs = table("WCS offer · completion", "WCS peer writes; read-only here", [
    ["Offer request (readback)", ["OfferSequence", "OfferItemId", "OfferRoute"].map(n => sigRow(DW(n)))],
    ["Offer acknowledgement", ["OfferAckSequence", "OfferAckItemId", "OfferAccepted", "OfferReason", "OfferPending", "ReleaseReady"].map(n => sigRow(ST(n)))],
    ["Completion", [...["CompletionSequence", "CompletionPending", "CompletionItemId", "CompletionRoute", "CompletionExit", "CompletionDisposition"].map(n => sigRow(ST(n))), sigRow(DW("CompletionAck"), "CompletionAck", "WCS ack readback")]]
  ], "eng.wcs");

  const identity = table("Controller identity", "observed", [
    ["", [sigRow("GVL_DemoRead.BuildId"), sigRow("GVL_DemoRead.InterfaceVersion"), infoRow("Signal map", () => store.state?.identity.mapVersion ?? "—"),
      sigRow(BR("PlcBootIdentity")), sigRow(ST("ModeText")), sigRow(ST("FaultCode")), sigRow(ST("FaultText")), sigRow(BR("PlcCycle")), sigRow(BR("PlcHeartbeat")), sigRow(BR("PlcTimeUs"))]]
  ], "eng.identity");

  const lag = () => { const r = big(store.value(BW("RequestedSequence"))), a = big(store.value(BR("AppliedSequence"))); return r !== undefined && a !== undefined ? (r - a).toString() : "—"; };
  const bench = table("Simulation & bench connector", "connection diagnostics, not machine alarms", [
    ["Simulation", [sigRow(BW("SimRequest"), "SimRequest", "requested (readback)"), sigRow(BR("SimApplied"), "SimApplied", "applied"),
      derivedRow("Requested vs applied", () => { const r = store.value(BW("SimRequest")), a = store.value(BR("SimApplied")); return r === a ? `agree (${fmtScalar(a)})` : `DIFFER: requested ${fmtScalar(r)}, applied ${fmtScalar(a)}`; }, () => store.value(BW("SimRequest")) !== store.value(BR("SimApplied"))),
      sigRow(BR("ConnectorStale"), "ConnectorStale", "bench diagnostic")]],
    ["Heartbeat & applied image", [sigRow(BW("WorkstationHeartbeat"), "WorkstationHeartbeat", "readback"), sigRow(BW("RequestedEpoch")), sigRow(BR("AppliedEpoch")),
      sigRow(BW("RequestedSequence")), sigRow(BR("AppliedSequence")), derivedRow("Sequence lag (requested − applied)", lag, () => lag() !== "0" && lag() !== "—"),
      sigRow(BW("RequestedSlot")), sigRow(BR("ActiveSlot")), sigRow(BR("OutputCaptureCycle")),
      derivedRow("Same-scan bracket in HMI read", () => store.state?.snapshot ? (store.state.snapshot.sameScanBracket ? "PlcCycle = OutputCaptureCycle" : "differs within batch") : "—")]],
    ["Commit counters", ["AppliedCommitCount", "DuplicateCommitCount", "StaleCommitCount", "SkippedSequenceCount", "InvalidSlotCount", "InvalidPayloadCount", "SlotMetadataMismatchCount", "EpochRejectedCount", "SessionResetCount"].map(n => sigRow(BR(n), n))]
  ], "eng.bench");

  const L = () => store.state!.link;
  const session = table("OPC UA session · HMI service", "this HMI's own connection", [
    ["", [infoRow("Link state", () => `${L().state} — ${L().detail}`, () => L().state !== "connected"),
      infoRow("Endpoint", () => L().endpoint), infoRow("Security", () => `${L().securityPolicy} · ${L().securityMode} · user ${L().userConfigured ? "configured (server-side)" : "none"}`),
      infoRow("Session opened", () => L().sessionOpenedAtIso ? fmtTime(L().sessionOpenedAtIso) : "—"),
      infoRow("Poll interval / stale after", () => `${L().pollIntervalMs} ms / ${L().staleAfterMs} ms`),
      infoRow("Last good read", () => L().lastPollOkAtIso ? `${fmtTime(L().lastPollOkAtIso)} (${fmtAge(store.dataAgeMs())} ago)` : "—"),
      infoRow("Read latency last / p95", () => `${L().lastPollLatencyMs?.toFixed(1) ?? "—"} ms / ${L().p95PollLatencyMs?.toFixed(1) ?? "—"} ms`),
      infoRow("Polls total / failed / consecutive", () => `${L().totalPolls} / ${L().failedPolls} / ${L().consecutiveFailures}`, () => L().consecutiveFailures > 0),
      infoRow("Reconnects", () => String(L().reconnects)),
      infoRow("Last error", () => L().lastError ?? "none", () => !!L().lastError),
      infoRow("PLC scanning", () => L().plcScanning === null ? "unknown (need two reads)" : L().plcScanning ? "yes (PlcCycle advancing)" : "NO (PlcCycle frozen)", () => L().plcScanning === false),
      infoRow("Boot identity", () => L().previousBootIdentity ? `${L().bootIdentity} (changed from ${L().previousBootIdentity} at ${fmtTime(L().bootChangedAtIso)})` : L().bootIdentity ?? "—", () => !!L().previousBootIdentity),
      infoRow("Runtime ownership", () => store.state!.ownership.commandsEnabled ? `commands enabled (${store.state!.ownership.policy})` : `read-only: ${store.state!.ownership.reasons.join("; ")}`),
      infoRow("Connected HMI clients", () => store.state!.clients.map(c => `${c.label} ${c.clientSessionId}`).join(" · ") || "none"),
      infoRow("HMI service session", () => store.state!.identity.serviceSessionId),
      infoRow("Evidence journal", () => store.state!.identity.journal ?? "memory only (no artifact directory)")]]
  ], "eng.session");

  const note = h("div", { class: "eng-note" }, h("span", { class: "ro", text: "Read-only" }),
    h("span", { text: "Diagnostics only. No tag writes, forcing or simulation-image writes exist on this page; only the simulation coordinator writes field inputs. Hover a row for source, server and receipt timestamps." }));
  page.append(note, h("div", { class: "eng-grid" }, h("div", { class: "eng-col" }, rawIo.el, outputs.el), h("div", { class: "eng-col" }, wcs.el, identity.el), h("div", { class: "eng-col" }, bench.el, session.el)));
  const all = [rawIo, outputs, wcs, identity, bench, session].flatMap(t => t.rows);
  let focus = new Set<string>();
  return {
    onRoute(p) {
      focus = new Set((p.get("focus") ?? "").split(",").filter(Boolean));
      for (const r of all) r.tr.classList.toggle("highlight", focus.has(r.leaf));
      const first = all.find(r => focus.has(r.leaf));
      if (first) requestAnimationFrame(() => first.tr.scrollIntoView({ block: "center" }));
    },
    update() { if (store.state) for (const r of all) r.update(); }
  };
}
