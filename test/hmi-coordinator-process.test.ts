import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoordinatorProcess } from "../src/hmi/coordinator-process.ts";

test("H2 coordinator runs in its own process: start, world tool, carton query and stop over IPC (fake connector)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hmi-coord-"));
  const coord = new CoordinatorProcess({ dir, env: { ...process.env }, fake: true });
  try {
    const started = await coord.call<{ status: string; pid: number }>("start", {}, 60_000);
    assert.equal(started.status, "running");
    assert.notEqual(started.pid, process.pid, "the coordinator is a separate process");
    await coord.call("expect-fault", { code: 0 });
    const tool = await coord.call<{ status: string }>("tool", { name: "introduce_carton", args: { itemId: "F-1", requestedRoute: null } });
    assert.equal(tool.status, "applied");
    assert.ok(await coord.call<number>("cartons") >= 1);
    const bad = await coord.call<{ status: string }>("tool", { name: "no_such_tool", args: {} });
    assert.notEqual(bad.status, "applied", "an unknown tool is recorded as not applied");
    assert.equal(coord.failure, undefined);
  } finally {
    await coord.close("test complete");
    assert.equal(coord.exited, true);
    assert.ok(existsSync(join(dir, "campaign.jsonl")));
    assert.match(readFileSync(join(dir, "campaign.jsonl"), "utf8"), /campaign\.state/);
    rmSync(dir, { recursive: true, force: true });
  }
});
