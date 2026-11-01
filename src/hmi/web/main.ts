// Operator HMI entry: registers this browser session, follows the service state stream, routes
// between the three pages and publishes semantic target rectangles for controlled-browser agents.

import type { HmiStreamMessage } from "../protocol.ts";
import { mountAlarms } from "./alarms-page.ts";
import { mountEngineering } from "./engineering.ts";
import { mountFooter, mountHeader } from "./header.ts";
import { mountOperation } from "./operation.ts";
import { BUS, h, post, show, store } from "./util.ts";

const ROUTES = ["operation", "alarms", "engineering"] as const;
type Route = typeof ROUTES[number];

async function boot(): Promise<void> {
  const app = document.getElementById("app")!;
  app.replaceChildren();
  const header = mountHeader(app);
  const main = h("main", { attrs: { id: "main" } });
  const pages = Object.fromEntries(ROUTES.map(r => [r, h("div", { class: "page", attrs: { "data-page": r, hidden: "" } })])) as Record<Route, HTMLDivElement>;
  main.append(...ROUTES.map(r => pages[r]));
  app.append(main);
  const footer = mountFooter(app);
  const op = mountOperation(pages.operation), alarms = mountAlarms(pages.alarms), eng = mountEngineering(pages.engineering);

  let route: Route = "operation";
  const applyRoute = () => {
    const [path, query] = location.hash.replace(/^#\/?/, "").split("?");
    route = (ROUTES as readonly string[]).includes(path) ? path as Route : "operation";
    const params = new URLSearchParams(query ?? "");
    for (const r of ROUTES) show(pages[r], r === route);
    header.setRoute(route);
    if (route === "alarms") alarms.onRoute(params);
    if (route === "engineering") eng.onRoute(params);
    document.title = `CV-1 ${route[0].toUpperCase()}${route.slice(1)} · Operator HMI`;
    render(); scheduleTargets();
  };
  BUS.navigate = (r: string) => { location.hash = `#/${r}`; };
  window.addEventListener("hashchange", applyRoute);

  // setTimeout rather than requestAnimationFrame: a captured or occluded browser window may not paint
  // frames, and the DOM must still reflect the latest PLC state when a screenshot is taken.
  let frame = 0;
  function render(): void {
    if (frame) return;
    frame = window.setTimeout(() => {
      frame = 0;
      header.update(); footer();
      if (route === "operation") op(); else if (route === "alarms") alarms.update(); else eng.update();
      app.setAttribute("aria-busy", "false");
      app.dataset.route = route;
    }, 0);
  }
  store.subscribe(() => { render(); scheduleTargets(); });

  // Register this browser session with the service; the label distinguishes e.g. the portal's capture session.
  const label = new URLSearchParams(location.search).get("capture") ?? "browser";
  for (;;) {
    try {
      const c = await post<{ clientSessionId: string }>("/api/clients", { label, userAgent: navigator.userAgent, pageUrl: location.href, viewport: { width: innerWidth, height: innerHeight } });
      store.clientSessionId = c.clientSessionId; app.dataset.clientSession = c.clientSessionId; break;
    } catch { await new Promise(r => setTimeout(r, 1000)); }
  }

  const connect = () => {
    const es = new EventSource(`/api/stream?client=${encodeURIComponent(store.clientSessionId)}`);
    es.addEventListener("state", e => store.set((JSON.parse((e as MessageEvent).data) as Extract<HmiStreamMessage, { type: "state" }>).state));
    es.addEventListener("heartbeat", () => { store.lastMessageMs = Date.now(); });
    es.addEventListener("targets-request", e => {
      const m = JSON.parse((e as MessageEvent).data) as Extract<HmiStreamMessage, { type: "targets-request" }>;
      if (m.clientSessionId === store.clientSessionId) publishTargets(m.requestId);
    });
    es.onerror = () => { if (store.serviceConnected) { store.serviceConnected = false; store.emit(); } };
  };
  connect();
  setInterval(() => {
    if (store.serviceConnected && Date.now() - store.lastMessageMs > 8000) { store.serviceConnected = false; store.emit(); }
    render(); // advance ages and the clock
  }, 500);

  // Semantic target registry for controlled-browser operation (Muse readiness seam).
  let targetTimer = 0, lastTargets = "";
  function scheduleTargets(): void {
    if (targetTimer || !store.clientSessionId) return;
    targetTimer = window.setTimeout(() => { targetTimer = 0; publishTargets(); }, 150);
  }
  /** Publishes the visible targets as laid out now. A requestId answers a service request and is never deduplicated. */
  function publishTargets(requestId?: string): void {
      const targets = [...document.querySelectorAll<HTMLElement>("[data-hmi-target]")].filter(el => el.offsetParent !== null).map(el => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.hmiTarget!, label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 80) ?? "", x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height),
          enabled: !(el as HTMLButtonElement).disabled };
      });
      const body = JSON.stringify({ route, targets, w: innerWidth, h: innerHeight });
      if (!requestId && body === lastTargets) return;
      lastTargets = body;
      void post("/api/targets", { clientSessionId: store.clientSessionId, route, viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }, targets, requestId }).catch(() => { lastTargets = ""; });
  }
  window.addEventListener("resize", scheduleTargets);

  // Report non-command control inputs too, so agent-delivered clicks on navigation are correlated.
  document.addEventListener("pointerdown", e => {
    const el = (e.target as Element | null)?.closest<HTMLElement>("[data-hmi-target]");
    if (!el || el.dataset.action || !store.clientSessionId) return;
    void post("/api/ui-actions", { clientSessionId: store.clientSessionId, target: el.dataset.hmiTarget, isTrusted: e.isTrusted, x: Math.round(e.clientX), y: Math.round(e.clientY), atIso: new Date().toISOString(), route }).catch(() => {});
  }, true);

  applyRoute();
}

void boot();
