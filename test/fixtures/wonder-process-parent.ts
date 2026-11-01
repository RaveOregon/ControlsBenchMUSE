// Stand-in host process for the parent-loss tests: it opens an offline isolated session, starts
// it, reports the child pid on stdout and then waits to be killed by the test.
// Usage: node test/fixtures/wonder-process-parent.ts <artifact dir> [steady|hang]
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CampaignLedger } from "../../src/campaign/ledger.ts";
import { openOfflineWonderSession } from "../../src/live/wonder-process/index.ts";

const [dir, mode = "steady"] = process.argv.slice(2);
const ledger = new CampaignLedger("parent-loss", { file: join(dir, "campaign.jsonl") });
const session = await openOfflineWonderSession({ ledger, hmi: { async perform() { throw new Error("No HMI"); } }, scope: {}, artifactDirectory: dir },
  { transportModule: fileURLToPath(new URL("./wonder-process-transport.ts", import.meta.url)), ownershipPath: join(dir, "live.lock"), timing: { drainMs: 1500 } });
await session.driver.initialize();
session.driver.start(true);
await new Promise(resolve => setTimeout(resolve, 500));
if (mode === "hang") await session.process.channel.request("fixture", { transport: { action: "hangNextWrite" } }, 5000);
await new Promise(resolve => setTimeout(resolve, mode === "hang" ? 300 : 0));
process.stdout.write(JSON.stringify({ childPid: session.process.identity.pid, ledgerEvents: ledger.state.sequence }) + "\n");
setInterval(() => {}, 1000);
