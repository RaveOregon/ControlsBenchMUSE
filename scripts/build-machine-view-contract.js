// Freezes the machine-view equipment graph and binding contract from the accepted spec, the
// preserved Wonder world package and the M8 signal map. No model call. `--check` fails if the
// committed artifacts differ from a fresh derivation.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deriveContract } from "../src/machine-view/contract-source.ts";
import { assemblePackage } from "../src/machine-view/generation.ts";
import { jsonText, validatePackage } from "../src/machine-view/package.ts";

const check = process.argv.includes("--check");
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const latestWorld = JSON.parse(await readFile(resolve("artifacts/generated-world/latest.json"), "utf8")).relativeDirectory;
const doc = async (path) => { const text = await readFile(resolve(path), "utf8"); return { path, text, sha256: sha256(text) }; };
const sources = {
  specification: await doc("docs/conveyor-machine-spec.md"),
  worldManifest: await doc(`${latestWorld}/world.manifest.json`),
  worldSource: await doc(`${latestWorld}/world.ts`),
  worldAssumptions: await doc(`${latestWorld}/assumptions.md`),
  signalMap: await doc("codesys/demo/signal-map-v1.json")
};
const { equipment, contract: partial } = deriveContract(sources);
const equipmentText = jsonText(equipment);
const contract = { ...partial, equipmentSha256: sha256(equipmentText) };
const contractText = jsonText(contract);

// Contract-only package: proves the fallback path before any model call.
const fallbackPackage = await assemblePackage({ equipmentText, contract, generated: null, provenance: { model: null, responseId: null, generatedAt: null } });
const { report } = await validatePackage({ files: fallbackPackage.files, contract, worldManifestText: sources.worldManifest.text });
if (!report.contractValid) throw new Error(`Derived contract failed validation: ${report.errors.join("; ")}`);

const outputs = {
  "artifacts/machine-view/contract/equipment.json": equipmentText,
  "artifacts/machine-view/contract/binding-contract.json": contractText,
  "artifacts/machine-view/contract/sources.json": jsonText({
    derivedBy: "scripts/build-machine-view-contract.js",
    modelCalls: 0,
    sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, { path: v.path, sha256: v.sha256 }])),
    equipmentSha256: sha256(equipmentText),
    contractSha256: sha256(contractText)
  }),
  "artifacts/machine-view/contract/fallback-package/view.manifest.json": fallbackPackage.files["view.manifest.json"],
  "artifacts/machine-view/contract/fallback-package/equipment.json": fallbackPackage.files["equipment.json"],
  "artifacts/machine-view/contract/fallback-package/view-bindings.json": fallbackPackage.files["view-bindings.json"],
  "artifacts/machine-view/contract/fallback-package/validation.json": jsonText(report)
};

if (check) {
  const stale = [];
  for (const [path, text] of Object.entries(outputs)) {
    const existing = await readFile(resolve(path), "utf8").catch(() => null);
    if (existing !== text) stale.push(path);
  }
  if (stale.length) { console.error(`Machine-view contract is stale: ${stale.join(", ")}`); process.exit(1); }
  console.log(`[machine-view] contract up to date: ${equipment.equipment.length} equipment, ${contract.channels.length} channels`);
} else {
  for (const [path, text] of Object.entries(outputs)) {
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(resolve(path), text);
  }
  console.log(JSON.stringify({
    equipment: equipment.equipment.length,
    channels: contract.channels.length,
    anchored: contract.anchoredEquipment.length,
    equipmentSha256: sha256(equipmentText),
    contractSha256: sha256(contractText),
    fallbackPackage: { packageId: report.packageId, contractValid: report.contractValid, viewValid: report.viewValid, errors: report.errors }
  }, null, 2));
}
