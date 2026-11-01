// Captures rendered HMI pages (and optionally the portal) through Lane B's controlled-browser source.
//
//   node scripts/capture-hmi-screens.js --out docs/screenshots/hmi --prefix fixture [--hmi http://127.0.0.1:5181/] [--portal http://127.0.0.1:5189/]
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { CdpWebVisuSource } from "../src/host/cdp-webvisu.ts";

const { values } = parseArgs({ options: {
  hmi: { type: "string", default: "http://127.0.0.1:5181/" }, portal: { type: "string" }, out: { type: "string", default: "docs/screenshots/hmi" },
  prefix: { type: "string", default: "hmi" }, width: { type: "string", default: "1280" }, height: { type: "string", default: "800" }, settle: { type: "string", default: "2500" }
} });
mkdirSync(values.out, { recursive: true });
const shots = [
  ...["operation", "alarms", "engineering"].map(route => ({ name: `${values.prefix}-${route}`, url: `${values.hmi}?capture=docs#/${route}` })),
  ...(values.portal ? [{ name: `${values.prefix}-portal`, url: values.portal }] : [])
];
const index = [];
for (const shot of shots) {
  const source = new CdpWebVisuSource(shot.url, { headless: true, width: Number(values.width), height: Number(values.height), format: "png" });
  try {
    await source.open(() => {}, () => {});
    await new Promise(r => setTimeout(r, Number(values.settle)));
    const frame = await source.capture();
    const file = `${values.out}/${shot.name}.png`;
    writeFileSync(file, frame.bytes);
    index.push({ file, url: frame.pageUrl, capturedAtIso: frame.capturedAtIso, sha256: createHash("sha256").update(frame.bytes).digest("hex"), viewport: `${values.width}x${values.height}` });
    console.log(`${file}  ${frame.capturedAtIso}`);
  } finally { await source.close(); }
}
writeFileSync(`${values.out}/${values.prefix}-index.json`, JSON.stringify(index, null, 2) + "\n");
