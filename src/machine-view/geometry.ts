import type { EntityPathDrawing, EntityTypeDefinition, PathPoint } from "./contracts.ts";

export interface PathPosition { x: number; y: number; angleDeg: number; clamped: boolean }

/** Linear interpolation along a drawn path whose points carry metre stations. */
export function pointAt(points: readonly PathPoint[], m: number): PathPosition {
  if (points.length < 2) throw new Error("Path needs at least two points");
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const clamped = m < first.m || m > last.m;
  const target = Math.min(last.m, Math.max(first.m, m));
  let index = 0;
  while (index < points.length - 2 && points[index + 1]!.m < target) index += 1;
  const a = points[index]!;
  const b = points[index + 1]!;
  const t = b.m === a.m ? 0 : (target - a.m) / (b.m - a.m);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angleDeg: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, clamped };
}

export function pixelLength(points: readonly PathPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

export function pxPerMetre(points: readonly PathPoint[]): number {
  const span = points[points.length - 1]!.m - points[0]!.m;
  return span > 0 ? pixelLength(points) / span : 0;
}

export class PathMap {
  readonly #paths = new Map<string, PathPoint[]>();
  readonly #aliases: Record<string, string>;
  constructor(drawings: readonly EntityPathDrawing[], entityType: EntityTypeDefinition | undefined) {
    for (const drawing of drawings) this.#paths.set(drawing.path, [...drawing.points].sort((a, b) => a.m - b.m));
    this.#aliases = entityType?.pathAliases ?? {};
  }
  resolve(path: string): PathPoint[] | undefined {
    return this.#paths.get(path) ?? this.#paths.get(this.#aliases[path] ?? "");
  }
  position(path: string, m: number): PathPosition | null {
    const points = this.resolve(path);
    return points && points.length >= 2 ? pointAt(points, m) : null;
  }
  scale(path: string): number {
    const points = this.resolve(path);
    return points && points.length >= 2 ? pxPerMetre(points) : 0;
  }
}

export const round = (value: number, digits = 2) => {
  const f = 10 ** digits;
  const r = Math.round(value * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
