// Alarms page. M8 exposes only its latched first fault and a current exception code. Instances,
// timestamps and history here are recorded by the HMI service from observed transitions, and the
// review marker is HMI-local. Acknowledgement, clearing the cause, Reset and Start stay separate.

import type { AlarmView } from "../protocol.ts";
import { preconditionList } from "./operation.ts";
import { fmtDateTime, fmtDuration, fmtTime, h, post, setText, show, store } from "./util.ts";

const BASIS: Record<AlarmView["firstObservedBasis"], string> = {
  transition_observed: "Transition observed by HMI poll",
  active_at_observation_start: "Already active when HMI began observing; onset unknown",
  observed_after_gap: "First seen after an observation gap"
};

function alarmCard(a: AlarmView, focus: boolean): HTMLElement {
  const review = h("button", { class: "btn", text: a.review ? `Reviewed ${fmtTime(a.review.atIso, false)}` : "Mark reviewed",
    attrs: { type: "button", "data-hmi-target": `alarm.review`, "data-alarm-id": a.id, title: "HMI-local review marker. It does not acknowledge, clear or reset anything in the PLC." },
    on: { click: async e => { (e.currentTarget as HTMLButtonElement).disabled = true; await post("/api/alarms/review", { id: a.id, clientSessionId: store.clientSessionId }).catch(() => {}); } } });
  review.disabled = !!a.review;
  const cell = (k: string, v: string, sub?: string) => h("div", {}, h("div", { class: "k", text: k }), h("div", { class: "v", text: v }), sub ? h("div", { class: "faint", text: sub, attrs: { style: "font-size:11px" } }) : null);
  const eng = a.related.engineering.length ? `#/engineering?focus=${encodeURIComponent(a.related.engineering.join(","))}` : "#/engineering";
  return h("article", { class: `alarm-card${a.kind === "exception" ? " exception" : ""}`, attrs: { "data-alarm-id": a.id, "data-hmi-status": "active-alarm", ...(focus ? { "aria-current": "true" } : {}) } },
    h("div", { class: "head" }, h("span", { class: "code", text: `${a.kind === "fault" ? "F" : "X"}${a.code}` }), h("span", { class: "title", text: a.plcText || "(no PLC text)" }),
      h("span", { class: `state-pill ${a.state} state`, text: a.state.toUpperCase() })),
    h("p", { class: "cause" }, h("b", { text: "Cause: " }), a.cause, " ", h("span", { class: "muted", text: `Controller response: ${a.response}` })),
    h("div", { class: "grid" },
      cell("First observed", fmtDateTime(a.firstObservedAtIso), BASIS[a.firstObservedBasis]),
      cell("Onset after", a.onsetAfterIso ? fmtTime(a.onsetAfterIso) : "unknown", "previous good HMI read"),
      cell("Active for", fmtDuration(a.firstObservedAtIso), "since first observation"),
      cell("PLC text source", a.kind === "fault" ? "Status.FaultText" : "Status.ExceptionText", a.kind === "fault" ? "first latched fault only" : "non-stopping exception"),
      cell("PLC boot", a.bootIdentity),
      cell("Review", a.review ? `Reviewed ${fmtTime(a.review.atIso, false)}` : "Not reviewed", "HMI marker, not a PLC ack")),
    h("div", { class: "links" }, h("a", { text: "Operation: command vs feedback →", attrs: { href: "#/operation" } }), h("a", { text: `Engineering: ${a.related.engineering.join(", ") || "signals"} →`, attrs: { href: eng } }), h("span", { class: "review" }, review)));
}

export function mountAlarms(page: HTMLElement): { update: () => void; onRoute: (params: URLSearchParams) => void } {
  let focusId = "";
  const capability = h("div", { class: "capability", attrs: { role: "note" } }, h("b", { text: "Controller capability" }),
    h("span", { text: "M8 latches and exposes only its first fault (FaultCode/FaultText) and one current exception. It has no alarm list, alarm timestamps or alarm acknowledgement. Instances and times below are recorded by this HMI service from observed PLC transitions. Bench connection diagnostics such as ConnectorStale are shown in the header banner, not here." }));
  const activeBody = h("div", { class: "body", attrs: { "data-hmi-status": "active-alarms" } });
  const activePanel = h("section", { class: "panel" }, h("header", {}, h("h2", { text: "Active machine alarms" }), h("span", { class: "aside", text: "Observed PLC state" })), activeBody);

  const resetList = h("ul", { class: "preconds", attrs: { "data-hmi-status": "reset-preconditions" } });
  const recovery = h("section", { class: "panel" }, h("header", {}, h("h2", { text: "Recovery path" })),
    h("div", { class: "body" },
      h("ol", { class: "steps" },
        h("li", {}, h("b", { text: "Review" }), h("span", { text: "Optional HMI marker. Changes nothing in the PLC." })),
        h("li", {}, h("b", { text: "Clear the cause" }), h("span", { text: "Physical/field condition and WCS completion acknowledgement. Not done from this HMI." })),
        h("li", {}, h("b", { text: "Reset (PLC request)" }), h("span", { text: "Clears the latch only if the PLC accepts its preconditions. Never starts the machine." })),
        h("li", {}, h("b", { text: "Start (PLC request)" }), h("span", { text: "Separate request; requires Auto on and Start conditions." }))),
      h("div", { class: "faint", text: "Reset conditions now (HMI reading of the M8 rule; the PLC decides):", attrs: { style: "font-size:11.5px;margin:10px 0 2px" } }), resetList,
      h("p", { attrs: { style: "margin:10px 0 0" } }, h("a", { text: "Go to controls →", attrs: { href: "#/operation", "data-hmi-target": "link.controls" } }))));

  // History
  const sel = (name: string, options: Array<[string, string]>) => h("select", { attrs: { name, "data-hmi-target": `alarms.filter.${name}` } }, ...options.map(([v, t]) => h("option", { text: t, attrs: { value: v } })));
  const fState = sel("state", [["all", "All"], ["active", "Active"], ["cleared", "Cleared"], ["unresolved", "Unresolved"]]);
  const fKind = sel("kind", [["all", "All"], ["fault", "Faults"], ["exception", "Exceptions"]]);
  const fSince = sel("since", [["all", "All recorded"], ["1h", "Last hour"], ["today", "Today"]]);
  const fText = h("input", { attrs: { type: "search", name: "text", placeholder: "Code, PLC text or cause", "data-hmi-target": "alarms.filter.text" } });
  const result = h("span", { class: "result" });
  const tbody = h("tbody");
  const persistence = h("div", { class: "persistence" });
  const history = h("section", { class: "panel" }, h("header", {}, h("h2", { text: "Recorded alarm history" }), h("span", { class: "aside", text: "Origin: HMI service observation" })),
    h("div", { class: "filters" }, h("label", {}, "State", fState), h("label", {}, "Type", fKind), h("label", {}, "Period", fSince), h("label", {}, "Search", fText), result),
    h("div", { class: "table-wrap" }, h("table", { class: "grid-table", attrs: { "data-hmi-status": "alarm-history" } },
      h("thead", {}, h("tr", {}, ...["State", "Code", "PLC text · cause", "First observed", "Cleared observed", "Duration", "PLC boot", "Review"].map(t => h("th", { text: t })))), tbody)),
    persistence);

  page.append(capability, h("div", { class: "alarm-grid" }, h("div", { class: "alarm-left" }, activePanel, history), recovery));

  let lastKey = "", inflight = false, queued = false;
  async function refresh(): Promise<void> {
    if (inflight) { queued = true; return; }
    inflight = true;
    try {
      const p = new URLSearchParams({ state: fState.value, kind: fKind.value, limit: "200" });
      if (fText.value.trim()) p.set("text", fText.value.trim());
      if (fSince.value === "1h") p.set("since", new Date(store.now() - 3_600_000).toISOString());
      if (fSince.value === "today") { const d = new Date(store.now()); d.setHours(0, 0, 0, 0); p.set("since", d.toISOString()); }
      const data = await (await fetch(`/api/alarms?${p}`)).json() as { alarms: AlarmView[]; total: number; persistence: string };
      setText(result, `${data.alarms.length} of ${data.total} matching`);
      setText(persistence, data.persistence);
      tbody.replaceChildren(...(data.alarms.length ? data.alarms.map(a => h("tr", { attrs: { "data-alarm-id": a.id, ...(a.id === focusId ? { class: "highlight" } : {}) } },
        h("td", {}, h("span", { class: `state-pill ${a.state}`, text: a.state }), a.unresolvedReason ? h("span", { class: "basis", text: a.unresolvedReason }) : null),
        h("td", { class: "mono", text: `${a.kind === "fault" ? "F" : "X"}${a.code}` }),
        h("td", {}, h("b", { text: a.plcText || "(no text)" }), h("span", { class: "basis", text: a.cause })),
        h("td", {}, fmtDateTime(a.firstObservedAtIso), h("span", { class: "basis", text: BASIS[a.firstObservedBasis] })),
        h("td", {}, a.clearedObservedAtIso ? fmtDateTime(a.clearedObservedAtIso) : "—", a.clearBasis ? h("span", { class: "basis", text: a.clearBasis === "observed_after_gap" ? "Seen cleared after a gap" : "Transition observed" }) : null,
          a.gaps?.length ? h("span", { class: "basis", text: `${a.gaps.length} observation gap(s)` }) : null),
        h("td", { class: "num", text: a.state === "active" ? `${fmtDuration(a.firstObservedAtIso)} (active)` : a.clearedObservedAtIso ? fmtDuration(a.firstObservedAtIso, a.clearedObservedAtIso) : "unknown" }),
        h("td", { class: "mono", text: a.bootIdentity }),
        h("td", { text: a.review ? `HMI marker ${fmtTime(a.review.atIso, false)}` : "—" })))
        : [h("tr", { class: "empty" }, h("td", { text: "No recorded alarms match. Only transitions observed by this HMI service are recorded.", attrs: { colspan: "8" } }))]));
    } catch { setText(result, "History unavailable (HMI service unreachable)"); }
    finally { inflight = false; if (queued) { queued = false; void refresh(); } }
  }
  for (const f of [fState, fKind, fSince]) f.addEventListener("change", () => void refresh());
  fText.addEventListener("input", () => void refresh());

  return {
    onRoute(params) { focusId = params.get("id") ?? ""; lastKey = ""; },
    update() {
      const st = store.state; if (!st) return;
      const key = `${st.alarms.total}|${st.alarms.recent.map(a => `${a.id}:${a.state}:${a.review ? 1 : 0}`).join(",")}|${focusId}`;
      const active = st.alarms.active;
      if (key !== lastKey) {
        lastKey = key;
        activeBody.replaceChildren(...(active.length ? active.map(a => alarmCard(a, a.id === focusId)) : [h("div", { class: "none-active", text: store.fresh() ? "No active machine alarm in the latest PLC observation." : "No active alarm in the last good observation (PLC data not fresh)." })]));
        void refresh();
      } else {
        // Keep durations current without rebuilding cards under the pointer.
        for (const card of activeBody.querySelectorAll<HTMLElement>(".alarm-card")) {
          const a = active.find(x => x.id === card.dataset.alarmId);
          const v = card.querySelectorAll(".grid .v")[2];
          if (a && v) setText(v, fmtDuration(a.firstObservedAtIso));
        }
      }
      preconditionList(resetList, st.preconditions.reset);
      show(recovery, true);
    }
  };
}
