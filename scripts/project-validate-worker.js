// Isolated validation worker for project preparation. Spawned by src/projects/preparation.ts with
// a scrubbed environment and a deadline; generated world code runs here, never in the host.
//   node scripts/project-validate-worker.js <package-directory> <profile>
import { validatePackage } from "../src/projects/validate.ts";

const [directory, profile = "m8-conveyor"] = process.argv.slice(2);
if (!directory || !["m8-conveyor", "generic"].includes(profile)) { console.error("usage: project-validate-worker.js <package-directory> <m8-conveyor|generic>"); process.exit(2); }
const result = await validatePackage(directory, { profile });
process.stdout.write(`${JSON.stringify(result)}\n`);
process.exit(0);
