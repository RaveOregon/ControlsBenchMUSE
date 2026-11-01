import latest from "../../../artifacts/machine-view/latest.json";
import contractText from "../../../artifacts/machine-view/contract/binding-contract.json?raw";
import worldManifestText from "../../../artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.manifest.json?raw";
import { PACKAGE_FILES, validatePackage } from "../../../src/machine-view/package.ts";
import type { PackageInput } from "../../../src/machine-view/package.ts";

// Only immutable view files become lazy chunks; no credentials, raw model responses or
// historical screenshots are bundled. The promoted pointer chooses the package at build time.
const files = import.meta.glob<string>("../../../artifacts/machine-view/*/{view.manifest.json,equipment.json,view-bindings.json,view.svg}", { query: "?raw", import: "default" });
export async function loadPromotedMachineView() {
  const selected: PackageInput["files"] = {};
  for (const name of PACKAGE_FILES) {
    const load = files[`../../../${latest.relativeDirectory}/${name}`];
    if (load) selected[name] = await load();
  }
  const result = await validatePackage({ files: selected, contract: JSON.parse(contractText), worldManifestText });
  if (result.pkg && result.pkg.manifest.packageId !== latest.packageId) throw new Error("Promoted view pointer/package identity mismatch");
  return result;
}
