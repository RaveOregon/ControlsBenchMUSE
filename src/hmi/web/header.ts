// Persistent header: machine identity, actual PLC mode, data freshness, simulation state,
// active-alarm summary and navigation. Bench diagnostics appear as banners, never as alarms.

import { HMI_TARGETS } from "../protocol.ts";
import { BUS, MODE, fmtAge, fmtTime, h, setAttr, setClass, setText, show, store } from "./util.ts";

const P = {
  mode: "GVL_DemoRead.Status.Mode", buildId: "GVL_DemoRead.BuildId", iface: "GVL_DemoRead.InterfaceVersion",
  simApplied: "GVL_BenchRead.SimApplied", simRequest: "GVL_BenchWrite.SimRequest", stale: "GVL_BenchRead.ConnectorStale"
};

export function mountHeader(root: HTMLElement): { update: () => void; setRoute: (r: string) => void } {
  const nameText = h("span", { text: "Sort conveyor" });
  const name = h("div", { class: "name" }, h("b", { text: "CV-1" }), nameText);
  const sub = h("div", { class: "sub", text: "Controller identity not yet read" });
  const modeV = h("span", { class: "v", text: "—", attrs: { "data-hmi-status": "mode" } });
  const modeChip = h("span", { class: "chip", attrs: { role: "status", "aria-label": "PLC mode" } }, h("span", { class: "k", text: "PLC mode" }), modeV);
  const linkDot = h("span", { class: "dot" });
  const linkV = h("span", { class: "v", text: "Connecting", attrs: { "data-hmi-status": "link" } });
  const linkChip = h("span", { class: "chip", attrs: { role: "status", "aria-label": "PLC data freshness" } }, linkDot, h("span", { class: "k", text: "PLC data" }), linkV);
  const simV = h("span", { class: "v", text: "—", attrs: { "data-hmi-status": "simulation" } });
  const simChip = h("span", { class: "chip optional", attrs: { role: "status", "aria-label": "Simulation state" } }, h("span", { class: "k", text: "Input source" }), simV);
  const alarmV = h("span", { class: "v", text: "—" });
  const alarmChip = h("button", { class: "chip alarm-none", attrs: { type: "button", "data-hmi-target": HMI_TARGETS.alarmSummary, "aria-label": "Active alarm summary; open Alarms" },
    on: { click: () => BUS.navigate("alarms") } }, h("span", { class: "k", text: "Alarms" }), alarmV);
  const badge = h("span", { class: "source-badge", text: "—", attrs: { "data-hmi-status": "source" } });
  root.append(h("div", { class: "topbar", attrs: { role: "banner" } }, h("div", { class: "identity" }, name, sub), h("div", { class: "status-cluster" }, modeChip, linkChip, simChip, alarmChip), badge));

  const tab = (id: string, label: string, target: string) => {
    const count = h("span", { class: "count", attrs: { hidden: "" } });
    const b = h("button", { class: "tab", attrs: { type: "button", "data-hmi-target": target, "data-route": id }, on: { click: () => BUS.navigate(id) } }, label, count);
    return { b, count };
  };
  const tabs = [tab("operation", "Operation", HMI_TARGETS.navOperation), tab("alarms", "Alarms", HMI_TARGETS.navAlarms), tab("engineering", "Engineering", HMI_TARGETS.navEngineering)];
  const clock = h("span", { class: "clock", text: "--:--:--" });
  const cmdState = h("span", { text: "" });
  root.append(h("nav", { class: "navbar", attrs: { "aria-label": "HMI pages" } }, h("div", { class: "tabs" }, ...tabs.map(t => t.b)), h("div", { class: "nav-meta" }, cmdState, clock)));
  const banners = h("div", { class: "banners", attrs: { "aria-live": "polite" } });
  root.append(banners);
  const bannerEls = new Map<string, HTMLElement>();
  const banner = (key: string, kind: "warn" | "bad" | "info", tag: string | null, html: string | null, title?: string) => {
    let el = bannerEls.get(key);
    if (html === null) { if (el) { el.remove(); bannerEls.delete(key); } return; }
    if (!el) {
      el = h("div", { attrs: { "data-hmi-banner": key, role: kind === "bad" ? "alert" : "status" } }, h("span", { class: "tag" }), h("span", { class: "msg" }));
      bannerEls.set(key, el); banners.append(el);
    }
    setClass(el, `banner ${kind}`);
    const t = el.querySelector(".tag") as HTMLElement; setText(t, tag ?? ""); show(t, !!tag);
    setText(el.querySelector(".msg")!, html);
    setAttr(el, "title", title ?? null);
  };

  function update(): void {
    const st = store.state;
    if (!st) return;
    const app = document.getElementById("app")!;
    const link = st.link, age = store.dataAgeMs();
    const fresh = store.fresh();
    app.classList.toggle("data-stale", !fresh);
    app.classList.toggle("service-lost", !store.serviceConnected);

    setText(nameText, st.identity.machine.name);
    const build = store.value(P.buildId), iface = store.value(P.iface);
    setText(sub, build === undefined ? `${st.identity.machine.description} · controller identity unread` : `M8 build ${build} · interface ${iface} · map ${st.identity.mapVersion}${build !== st.identity.expectedBuildId || iface !== st.identity.expectedInterfaceVersion ? " · UNEXPECTED CONTROLLER" : ""}`);

    const mode = store.value(P.mode);
    const m = typeof mode === "number" ? MODE[mode] : undefined;
    setText(modeV, m ? (fresh ? m.text : `${m.text} (held)`) : "—");
    setClass(modeChip, `chip ${m ? `mode-${m.cls}` : ""}`);

    const stateText = !store.serviceConnected ? "HMI service lost" : link.state === "connected" ? (link.plcScanning === false ? "Not scanning" : `Fresh · ${fmtAge(age)}`)
      : link.state === "stale" ? `Stale · ${fmtAge(age)}` : link.state === "reconnecting" ? "Reconnecting" : link.state === "disconnected" ? "Disconnected" : link.state === "stopped" ? "Stopped" : "Connecting";
    setText(linkV, stateText);
    const linkBad = !store.serviceConnected || link.state === "disconnected" || link.state === "reconnecting" || link.state === "stopped";
    const linkWarn = link.state === "stale" || link.state === "connecting" || link.plcScanning === false;
    setClass(linkChip, `chip ${linkBad ? "bad" : linkWarn ? "warn" : ""}`);
    setClass(linkDot, `dot ${linkBad ? "bad" : linkWarn ? "warn" : "ok"}`);

    const simA = store.bool(P.simApplied), simR = store.bool(P.simRequest);
    setText(simV, simA === undefined ? "—" : simA ? (simR === false ? "Simulation applied · request OFF" : "Simulation") : simR ? "Hardware · sim requested" : "Hardware");
    setClass(simChip, `chip optional ${simA !== undefined && simR !== undefined && simA !== simR ? "warn" : ""}`);

    const active = st.alarms.active;
    const fault = active.find(a => a.kind === "fault") ?? active[0];
    setText(alarmV, fault ? `${active.length} active · ${fault.kind === "fault" ? "F" : "X"}${fault.code} ${fault.plcText || fault.cause}` : "None active");
    setClass(alarmChip, `chip ${fault ? "alarm-active" : "alarm-none"}`);
    tabs[1].count.textContent = String(active.length); show(tabs[1].count, active.length > 0);

    setText(badge, st.identity.source.kind === "fixture" ? "Fixture · not a PLC" : "Live PLC");
    setClass(badge, `source-badge ${st.identity.source.kind === "fixture" ? "fixture" : "live"}`);
    setText(clock, fmtTime(new Date(store.now()).toISOString(), false));
    setText(cmdState, st.ownership.commandsEnabled ? "Commands enabled" : "Commands disabled");

    banner("fixture", "warn", "Fixture", st.identity.source.kind === "fixture" ? `${st.identity.source.label.replace(/^FIXTURE · /, "")} — recorded M10 sample replayed without a PLC. Command acknowledgements are emulated. Not live PLC evidence.` : null, st.identity.source.fixtureBasis);
    banner("service", "bad", "HMI service", store.serviceConnected ? null : `Connection to the HMI service lost at ${fmtTime(new Date(store.lastMessageMs + store.offsetMs).toISOString(), false)}. Display frozen; commands unavailable. Reconnecting…`);
    banner("link", link.state === "stale" ? "warn" : "bad", "PLC link",
      !store.serviceConnected || link.state === "connected" ? (link.plcScanning === false ? "Reads succeed but PlcCycle is not advancing: the PLC application may not be running. Commands disabled." : null)
        : `${link.state === "stale" ? "Stale" : link.state === "connecting" ? "Connecting" : link.state === "reconnecting" ? "Lost — reconnecting" : link.state === "stopped" ? "Stopped" : "Disconnected"}. ${link.lastPollOkAtIso ? `Values held from ${fmtTime(link.lastPollOkAtIso, false)} (${fmtAge(age)} old).` : "No PLC values observed yet."} ${link.detail} Commands disabled.`);
    const stale = store.bool(P.stale);
    banner("connector", "warn", "Bench diagnostic", stale ? "Simulation connector stale: no workstation heartbeat for more than 25 PLC scans. The PLC holds its inputs at the last applied image and its timers keep running. This is a connection diagnostic, not a machine alarm." : null);
    banner("ownership", "info", "Read-only", st.ownership.commandsEnabled ? null : `HMI commands disabled: ${st.ownership.reasons.join("; ")}. Polling every ${link.pollIntervalMs} ms.`);
  }

  function setRoute(route: string): void { for (const t of tabs) setAttr(t.b, "aria-current", t.b.dataset.route === route ? "page" : null); }
  return { update, setRoute };
}

export function mountFooter(root: HTMLElement): () => void {
  const left = h("span", { class: "mono" }), mid = h("span", { class: "mono" }), right = h("span", { class: "right" });
  root.append(h("footer", { class: "hmi-footer" }, left, mid, right));
  return () => {
    const st = store.state; if (!st) return;
    setText(left, `client ${store.clientSessionId || "unregistered"}`);
    setAttr(left, "data-hmi-client-session", store.clientSessionId);
    setText(mid, `service ${st.identity.serviceSessionId}`);
    setText(right, `Every value is an observed PLC sample. A click is not a PLC acknowledgement. Journal: ${st.identity.journal ?? "memory only"}`);
  };
}
