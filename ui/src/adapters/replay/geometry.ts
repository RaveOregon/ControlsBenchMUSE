// Machine geometry for the diagnostic schematic, read from the generated world's own
// declared CONFIG so the drawing follows Muse's assumptions instead of a second copy.

export interface MachineGeometry {
  cartonLengthM: number;
  beltSpeedMps: number;
  encoderCountsPerM: number;
  peEntryM: number;
  peD1ApproachM: number;
  divert1M: number;
  peExitAM: number;
  exitAEndM: number;
  peD2ApproachM: number;
  divert2M: number;
  peExitBM: number;
  exitBEndM: number;
  peRunoutM: number;
  runoutEndM: number;
}

const REQUIRED: readonly (keyof MachineGeometry)[] = [
  "cartonLengthM",
  "beltSpeedMps",
  "encoderCountsPerM",
  "peEntryM",
  "peD1ApproachM",
  "divert1M",
  "peExitAM",
  "exitAEndM",
  "peD2ApproachM",
  "divert2M",
  "peExitBM",
  "exitBEndM",
  "peRunoutM",
  "runoutEndM"
];

/** Returns null when the world source does not declare a parseable CONFIG with every field. */
export function parseWorldGeometry(source: string): MachineGeometry | null {
  const block = /const\s+CONFIG\s*=\s*\{([\s\S]*?)\}\s*as\s+const/.exec(source);
  if (!block) return null;
  const values: Record<string, number> = {};
  for (const match of block[1]!.matchAll(/(\w+)\s*:\s*(-?\d+(?:\.\d+)?)/g)) values[match[1]!] = Number(match[2]);
  for (const key of REQUIRED) if (!Number.isFinite(values[key])) return null;
  return Object.fromEntries(REQUIRED.map((key) => [key, values[key]!])) as unknown as MachineGeometry;
}
