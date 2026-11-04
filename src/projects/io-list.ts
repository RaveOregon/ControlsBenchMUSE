// Raw I/O list parsing for project onboarding. Accepts a separate CSV/TSV/JSON/text list or the
// I/O tables embedded in a Markdown specification. It only reads what the engineer supplied:
// names, direction, native type, units and normal values when present. Nothing is inferred here.

import type { IoDirection, IoRow } from "./types.ts";
export type { IoDirection, IoRow } from "./types.ts";

const IEC = /^(BOOL|SINT|USINT|INT|UINT|DINT|UDINT|LINT|ULINT|REAL|LREAL|WORD|DWORD|BYTE|STRING(\(\d+\))?|TIME)$/i;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,79}$/;

function direction(text: string, idPrefix = ""): IoDirection {
  const t = `${idPrefix} ${text}`.toLowerCase();
  if (/\b(di|ai)-?\d|\binput\b|world\s*(→|->|to)\s*plc|field\s*(→|->)\s*plc|sensor|feedback/.test(t)) return "world_to_plc";
  if (/\b(do|ao)-?\d|\boutput\b|plc\s*(→|->|to)\s*(world|field|observers?)|command/.test(t)) return "plc_to_world";
  return "unknown";
}
function cells(line: string, separator: RegExp): string[] { return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split(separator).map(c => c.trim().replace(/^`|`$/g, "")); }

/** I/O rows from Markdown tables whose rows name a signal and an IEC type. */
export function embeddedIo(spec: string): IoRow[] {
  const rows: IoRow[] = [];
  let header: string[] | undefined, section = "";
  for (const [index, line] of spec.split(/\r?\n/).entries()) {
    if (/^#{1,6}\s/.test(line)) { section = line.replace(/^#+\s*/, ""); header = undefined; continue; }
    if (!/^\s*\|/.test(line)) { header = undefined; continue; }
    const c = cells(line, /\s*\|\s*/);
    if (c.every(x => /^:?-{2,}:?$/.test(x) || !x)) continue;
    if (!header) { header = c.map(x => x.toLowerCase()); continue; }
    const typeAt = c.findIndex(x => IEC.test(x));
    const nameAt = c.findIndex((x, i) => i !== typeAt && NAME.test(x) && /[a-z]/.test(x) && /[A-Z_]/.test(x));
    if (typeAt < 0 || nameAt < 0) continue;
    const dirAt = header.findIndex(h => h.includes("direction"));
    const id = c[0] ?? "";
    rows.push({ name: c[nameAt]!, direction: direction(dirAt >= 0 ? c[dirAt]! : section, id), nativeType: c[typeAt]!.toUpperCase(),
      description: c.filter((_, i) => i !== nameAt && i !== typeAt && i !== 0 && i !== dirAt).join(" · ").slice(0, 400), source: `specification line ${index + 1}` });
  }
  return dedupe(rows);
}

/** A separately supplied I/O list. JSON (array or {signals}) or delimited text with a header row. */
export function parseIoList(text: string, fileName = "io.txt"): IoRow[] {
  const trimmed = text.trim();
  if (fileName.toLowerCase().endsWith(".json") || /^[[{]/.test(trimmed)) {
    let data: unknown;
    try { data = JSON.parse(trimmed); } catch { throw new Error("The I/O JSON could not be parsed"); }
    const list = Array.isArray(data) ? data : Array.isArray((data as { signals?: unknown }).signals) ? (data as { signals: unknown[] }).signals : [];
    return dedupe(list.map((x, i) => {
      const o = x as Record<string, unknown>;
      const name = String(o.name ?? o.id ?? o.logical ?? o.signal ?? "");
      return { name, direction: direction(String(o.direction ?? o.access ?? "")), nativeType: o.dataType ?? o.type ?? o.iecType ? String(o.dataType ?? o.type ?? o.iecType).toUpperCase() : undefined,
        unit: o.unit !== undefined ? String(o.unit) : undefined, normal: o.normal ?? o.normalValue ?? o.default !== undefined ? String(o.normal ?? o.normalValue ?? o.default) : undefined,
        description: o.description !== undefined ? String(o.description).slice(0, 400) : undefined, source: `${fileName} entry ${i + 1}` };
    }).filter(r => NAME.test(r.name)));
  }
  const lines = trimmed.split(/\r?\n/).filter(l => l.trim() && !/^\s*#/.test(l));
  if (lines.some(l => /^\s*\|/.test(l))) return embeddedIo(trimmed);
  const sep = lines[0]!.includes("\t") ? /\t/ : lines[0]!.includes(";") ? /;/ : /,/;
  const head = cells(lines[0]!, sep).map(h => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex(h => names.some(n => h.includes(n)));
  const [n, d, t, u, v, desc] = [col("name", "signal", "tag", "id"), col("direction", "dir", "access"), col("type"), col("unit"), col("normal", "default"), col("description", "meaning", "comment")];
  if (n < 0) throw new Error("The I/O list needs a header row with a name/signal column");
  return dedupe(lines.slice(1).map((line, i) => {
    const c = cells(line, sep);
    return { name: c[n] ?? "", direction: direction(d >= 0 ? c[d] ?? "" : ""), nativeType: t >= 0 && c[t] ? c[t]!.toUpperCase() : undefined, unit: u >= 0 ? c[u] || undefined : undefined,
      normal: v >= 0 ? c[v] || undefined : undefined, description: desc >= 0 ? c[desc]?.slice(0, 400) : undefined, source: `${fileName} line ${i + 2}` };
  }).filter(r => NAME.test(r.name)));
}

function dedupe(rows: IoRow[]): IoRow[] {
  const seen = new Map<string, IoRow>();
  for (const r of rows) if (!seen.has(r.name)) seen.set(r.name, r);
  return [...seen.values()];
}
