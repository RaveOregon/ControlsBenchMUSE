// Machine overview drawn only from observed PLC I/O: the PLC's active (selected) input image and
// its output commands. It is not the physical simulation and never moves a carton by itself.

import { ROUTE, enumOf, s, setClass, setText, store } from "./util.ts";

const A = (n: string) => `GVL_BenchRead.Active_${n}`;
const OUT = (n: string) => `GVL_BenchRead.${n}`;
const ST = (n: string) => `GVL_DemoRead.Status.${n}`;

// Belt band and chute geometry (viewBox units).
const BT = 100, BB = 140, CHUTE_END = 206;

type Updater = () => void;

function eyeVertical(x: number, label: string, signal: string, updaters: Updater[]): SVGElement {
  const beam = s("line", { x1: x, y1: BT - 4, x2: x, y2: BB + 4, class: "sv-beam" });
  const tx = s("rect", { x: x - 6, y: BT - 12, width: 12, height: 8, rx: 2, class: "sv-eye" });
  const rx = s("rect", { x: x - 6, y: BB + 4, width: 12, height: 8, rx: 2, class: "sv-eye" });
  const text = s("text", { x, y: BT - 18, "text-anchor": "middle", class: "sv-label" }, label);
  const g = s("g", { "data-hmi-status": `io.${signal}` }, beam, tx, rx, text);
  updaters.push(() => {
    const v = store.bool(A(signal));
    setClass(beam, `sv-beam${v ? " blocked" : ""}`); setClass(rx, `sv-eye${v ? " blocked" : ""}`);
    g.setAttribute("data-value", v === undefined ? "unknown" : String(v));
  });
  return g;
}

function eyeHorizontal(cx: number, y: number, label: string, signal: string, updaters: Updater[]): SVGElement {
  const beam = s("line", { x1: cx - 38, y1: y, x2: cx + 38, y2: y, class: "sv-beam" });
  const tx = s("rect", { x: cx - 46, y: y - 6, width: 8, height: 12, rx: 2, class: "sv-eye" });
  const rx = s("rect", { x: cx + 38, y: y - 6, width: 8, height: 12, rx: 2, class: "sv-eye" });
  const text = s("text", { x: cx + 52, y: y + 4, class: "sv-small" }, label);
  const g = s("g", { "data-hmi-status": `io.${signal}` }, beam, tx, rx, text);
  updaters.push(() => { const v = store.bool(A(signal)); setClass(beam, `sv-beam${v ? " blocked" : ""}`); setClass(rx, `sv-eye${v ? " blocked" : ""}`); g.setAttribute("data-value", v === undefined ? "unknown" : String(v)); });
  return g;
}

function tag(x: number, y: number, w: number, label: string, isOn: () => boolean | undefined, mismatch: () => boolean, updaters: Updater[]): SVGElement {
  const r = s("rect", { x, y, width: w, height: 18, rx: 3, class: "sv-tag" });
  const t = s("text", { x: x + w / 2, y: y + 12.5, "text-anchor": "middle", class: "sv-tag-text" }, label);
  updaters.push(() => { const on = isOn(); setClass(r, `sv-tag${on ? " on" : ""}${mismatch() ? " mismatch" : ""}`); setClass(t, `sv-tag-text${on ? " on" : ""}`); });
  return s("g", {}, r, t);
}

function divert(id: "D1" | "D2", px: number, exit: "A" | "B", updaters: Updater[]): SVGElement {
  const cmd = () => store.bool(OUT(`${id}_ExtendCmd`));
  const home = () => store.bool(A(`${id}_HomeFB`));
  const ext = () => store.bool(A(`${id}_ExtendedFB`));
  const chute = s("path", { d: `M ${px + 10} ${BB} L ${px + 82} ${BB} L ${px + 82} ${CHUTE_END} L ${px + 10} ${CHUTE_END} Z`, class: "sv-chute" });
  const paddle = s("line", { x1: px, y1: BT + 2, x2: px + 70, y2: BT + 2, class: "sv-paddle" });
  const pivot = s("circle", { cx: px, cy: BT + 2, r: 5, class: "sv-pivot" });
  const ready = s("text", { x: px + 46, y: CHUTE_END - 7, "text-anchor": "middle", class: "sv-ready" }, "");
  const exitLabel = s("text", { x: px + 46, y: CHUTE_END + 17, "text-anchor": "middle", class: "sv-label strong" }, `EXIT ${exit}`);
  const title = s("text", { x: px, y: 22, class: "sv-label strong" }, `${id} · divert to ${exit}`);
  const tags = s("g", {},
    tag(px, 30, 54, "CMD EXT", cmd, () => cmd() !== undefined && ext() !== undefined && cmd() !== ext(), updaters),
    tag(px + 58, 30, 46, "HOME", home, () => false, updaters),
    tag(px + 108, 30, 40, "EXT", ext, () => false, updaters));
  const g = s("g", { "data-hmi-status": `divert.${id}` }, chute, title, tags, eyeHorizontal(px + 46, BB + 32, `PE EXIT ${exit}`, `PE_Exit${exit}`, updaters), paddle, pivot, ready, exitLabel);
  updaters.push(() => {
    const h = home(), e = ext();
    const state = h === undefined || e === undefined ? "unknown" : h && e ? "fault" : e ? "extended" : h ? "home" : "transit";
    const end = state === "extended" ? [px + 58, BB - 2] : state === "transit" || state === "unknown" ? [px + 66, (BT + BB) / 2] : [px + 70, BT + 2];
    paddle.setAttribute("x2", String(end[0])); paddle.setAttribute("y2", String(end[1]));
    setClass(paddle, `sv-paddle ${state === "extended" ? "extended" : state === "transit" ? "transit" : state === "fault" ? "fault" : ""}`);
    g.setAttribute("data-value", state);
    const r = store.bool(A(`Exit${exit}_Ready`));
    setText(ready, r === undefined ? "READY ?" : r ? "READY" : "NOT READY"); setClass(ready, `sv-ready ${r === false ? "no" : "yes"}`);
  });
  return g;
}

export function mountSchematic(): { el: SVGElement; update: Updater } {
  const updaters: Updater[] = [];
  const belt = s("rect", { x: 80, y: BT, width: 720, height: BB - BT, rx: 4, class: "sv-belt" });
  const mid = (BT + BB) / 2;
  const chevrons = Array.from({ length: 11 }, (_, i) => s("path", { d: `M ${118 + i * 62} ${mid - 10} l 10 10 l -10 10`, class: "sv-chev" }));
  const end = s("path", { d: `M 800 ${BT} L 828 ${mid} L 800 ${BB} Z`, class: "sv-chute" });
  const runoutReady = s("text", { x: 796, y: BB + 30, "text-anchor": "end", class: "sv-ready" }, "");
  const motorC = s("circle", { cx: 44, cy: mid, r: 22, class: "sv-motor" });
  const motorT = s("text", { x: 44, y: mid + 4.5, "text-anchor": "middle", class: "sv-motor-text" }, "M1");
  const lampR = s("circle", { cx: 852, cy: 18, r: 9, class: "sv-lamp red" });
  const lampG = s("circle", { cx: 852, cy: 40, r: 9, class: "sv-lamp green" });
  const item = s("rect", { x: 14, y: 8, width: 262, height: 26, rx: 4, class: "sv-item" });
  const itemT = s("text", { x: 26, y: 25.5, class: "sv-item-text" }, "");
  const svg = s("svg", { viewBox: "0 0 880 230", role: "img", "aria-label": "Conveyor overview from observed PLC I/O", "data-hmi-status": "overview" },
    s("title", {}, "Conveyor overview from observed PLC inputs and outputs"),
    item, itemT,
    s("text", { x: 834, y: 22, "text-anchor": "end", class: "sv-small" }, "Fault lamp"),
    s("text", { x: 834, y: 44, "text-anchor": "end", class: "sv-small" }, "Run lamp"),
    lampR, lampG,
    belt, ...chevrons, end,
    s("text", { x: 796, y: BB + 46, "text-anchor": "end", class: "sv-label strong" }, "RUNOUT"),
    runoutReady,
    divert("D1", 322, "A", updaters), divert("D2", 532, "B", updaters),
    eyeVertical(122, "PE ENTRY", "PE_Entry", updaters), eyeVertical(262, "PE D1 APPR", "PE_D1Approach", updaters),
    eyeVertical(472, "PE D2 APPR", "PE_D2Approach", updaters), eyeVertical(764, "PE RUNOUT", "PE_Runout", updaters),
    s("g", { "data-hmi-status": "motor" }, motorC, motorT,
      tag(8, BB + 14, 34, "CMD", () => store.bool(OUT("Motor_RunCmd")), () => false, updaters),
      tag(46, BB + 14, 34, "RUN", () => store.bool(A("Drive_RunningFB")), () => false, updaters),
      tag(8, BB + 36, 72, "OVERLOAD", () => store.bool(A("Drive_Overload")), () => false, updaters),
      s("text", { x: 44, y: BT - 24, "text-anchor": "middle", class: "sv-label strong" }, "DRIVE")));
  updaters.push(() => {
    const running = store.bool(A("Drive_RunningFB")) === true;
    setClass(belt, `sv-belt${running ? " running" : ""}`);
    for (const c of chevrons) setClass(c, `sv-chev${running ? " running" : ""}`);
    setClass(motorC, `sv-motor${store.bool(OUT("Motor_RunCmd")) ? " cmd" : ""}${running ? " running" : ""}`);
    setClass(motorT, `sv-motor-text${running ? " running" : ""}`);
    setClass(lampR, `sv-lamp red${store.bool(OUT("StackLight_Red")) ? " on" : ""}`);
    setClass(lampG, `sv-lamp green${store.bool(OUT("StackLight_Green")) ? " on" : ""}`);
    const r = store.bool(A("Runout_Ready"));
    setText(runoutReady, r === undefined ? "READY ?" : r ? "READY" : "NOT READY"); setClass(runoutReady, `sv-ready ${r === false ? "no" : "yes"}`);
    const active = store.bool(ST("ItemActive"));
    const id = store.value(ST("ActiveItemId"));
    setText(itemT, active === undefined ? "Tracked item: unread" : active
      ? `Tracked item ${id === 0 ? "(unassigned)" : id} · req ${enumOf(ROUTE, store.value(ST("RequestedRoute")))} · eff ${enumOf(ROUTE, store.value(ST("EffectiveRoute")))}`
      : "No tracked item");
  });
  return { el: svg, update: () => { for (const u of updaters) u(); } };
}
