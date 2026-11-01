// TEST FIXTURE ONLY. A minimal hand-written view used to exercise the validator, frame
// resolution and host protocol without a model call. It is not a product fallback and must
// never be mounted in place of a Muse-generated view.

import type { BindingContract, EquipmentFile } from "../../../src/machine-view/contracts.ts";
import type { GeneratedView } from "../../../src/machine-view/generation.ts";

export const SCALE = 200;
export const ORIGIN = { x: 60, y: 200 };
const ANGLE = (30 * Math.PI) / 180;

export function fixturePaths(equipment: EquipmentFile): GeneratedView["entityPaths"] {
  const type = equipment.entityTypes[0]!;
  const main = type.paths.find(p => p.id === "main")!;
  const at = (m: number) => ({ m, x: ORIGIN.x + m * SCALE, y: ORIGIN.y });
  const branch = (from: number, to: number) => [
    { m: from, x: ORIGIN.x + from * SCALE, y: ORIGIN.y },
    { m: to, x: ORIGIN.x + from * SCALE + (to - from) * SCALE * Math.cos(ANGLE), y: ORIGIN.y + (to - from) * SCALE * Math.sin(ANGLE) }
  ];
  return type.paths.map(p => ({ path: p.id, points: p.id === "main" ? [at(main.fromM), at(main.toM)] : branch(p.fromM, p.toM) }));
}

export function fixtureView(equipment: EquipmentFile, contract: BindingContract): GeneratedView {
  const flat = (b: Record<string, unknown>) => ({ channel: null, equipmentId: null, decimals: null, inputMin: null, inputMax: null, angleMin: null, angleMax: null, pivotX: null, pivotY: null, periodPx: null, container: null, entityType: null, rotateWithPath: null, ...b });
  const bindings: Record<string, unknown>[] = [];
  const parts: string[] = [];
  const signal = (channel: string) => channel.split(".")[1]!;
  for (const e of equipment.equipment) {
    const inner: string[] = [];
    if (e.kind === "photoeye") {
      inner.push(`<rect id="${e.id}_beam" x="-2" y="-24" width="4" height="48" class="beam"/>`);
      bindings.push(flat({ id: `b_${e.id}_beam`, kind: "state", element: `${e.id}_beam`, channel: e.channels[0] }));
    } else if (e.kind === "divert") {
      const pos = e.channels.find(c => c.endsWith("_Position"))!;
      inner.push(`<line id="${e.id}_paddle" x1="0" y1="-20" x2="40" y2="-20" class="paddle"/>`);
      bindings.push(flat({ id: `b_${e.id}_paddle`, kind: "rotate", element: `${e.id}_paddle`, channel: pos, inputMin: 0, inputMax: 100, angleMin: 0, angleMax: 30, pivotX: 0, pivotY: -20 }));
      for (const [i, c] of e.channels.filter(c => c !== pos).entries()) {
        inner.push(`<circle id="${e.id}_${signal(c)}" cx="${i * 12}" cy="-36" r="4" class="lamp"/>`);
        bindings.push(flat({ id: `b_${e.id}_${signal(c)}`, kind: "state", element: `${e.id}_${signal(c)}`, channel: c }));
      }
    } else if (e.kind === "destination") {
      inner.push(`<circle id="${e.id}_ready" cx="12" cy="0" r="5" class="lamp"/>`);
      bindings.push(flat({ id: `b_${e.id}_ready`, kind: "state", element: `${e.id}_ready`, channel: e.channels[0] }));
    }
    if (e.geometry?.stationM !== undefined) {
      parts.push(`<g id="${e.id}_anchor" data-cb-equipment="${e.id}">${inner.join("")}</g>`);
      bindings.push(flat({ id: `b_${e.id}_anchor`, kind: "anchor", element: `${e.id}_anchor`, equipmentId: e.id, rotateWithPath: false }));
    } else if (e.kind === "conveyor_lane") {
      parts.push(`<g id="lane" data-cb-equipment="${e.id}"><rect x="${ORIGIN.x}" y="${ORIGIN.y - 16}" width="${4.2 * SCALE}" height="32" class="belt"/><g clip-path="url(#beltclip)"><g id="belt_marks">${Array.from({ length: 46 }, (_, i) => `<path d="M ${ORIGIN.x - 20 + i * 20} ${ORIGIN.y - 8} l 6 8 l -6 8" class="mark"/>`).join("")}</g></g></g>`);
    } else {
      const panel = e.channels.map((c, i) => `<text id="panel_${signal(c)}" x="${i * 90}" y="0" class="val">?</text>`).join("");
      const y = 360 + equipment.equipment.filter(q => !q.geometry).indexOf(e) * 0;
      parts.push(`<g id="panel_${e.id}" data-cb-equipment="${e.id}" transform="translate(${60 + ["drive", "encoder", "stackLight"].indexOf(e.id) * 300} ${y})">${panel}</g>`);
      for (const c of e.channels) bindings.push(flat({ id: `b_panel_${signal(c)}`, kind: c.startsWith("plc.") || c.endsWith("FB") || c.endsWith("Overload") ? "state" : "text", element: `panel_${signal(c)}`, channel: c, decimals: 2 }));
    }
  }
  bindings.push(flat({ id: "b_belt", kind: "belt", element: "belt_marks", channel: contract.beltChannels[0], periodPx: 20 }));
  bindings.push(flat({ id: "b_cartons", kind: "entities", element: "carton_tpl", container: "cartons", entityType: "carton" }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 420"><style>
.belt{fill:#333}.mark{stroke:#555;fill:none}.beam{fill:#444}.lamp{fill:#222;stroke:#888}.paddle{stroke:#ddd;stroke-width:4}
[data-cb-value="true"]{fill:#ffd24a}[data-cb-source="plc"]{stroke:#4cc2ff}.val{fill:#ccc;font-size:12px}
</style><defs><clipPath id="beltclip"><rect x="${ORIGIN.x}" y="${ORIGIN.y - 16}" width="${4.2 * SCALE}" height="32"/></clipPath></defs>
<rect x="0" y="0" width="1000" height="420" fill="#11151a"/><text x="10" y="20" class="val">Simulated world (test fixture) - not the PLC HMI</text>
${parts.join("\n")}
<g id="carton_tpl"><rect x="-30" y="-12" width="60" height="24" fill="#c8a46e"/><text data-cb-field="itemId" x="0" y="4" class="val">id</text></g>
<g id="cartons"/>
</svg>`;
  return { svg, entityPaths: fixturePaths(equipment), bindings, layoutAssumptions: ["Test fixture: 200 px/m, 30 degree branches."], designNotes: "test fixture" };
}
