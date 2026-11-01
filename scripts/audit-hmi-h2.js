// Independent audit of a saved H2 live run. Needs no PLC; it re-reads only preserved evidence.
//
//   node scripts/audit-hmi-h2.js [artifacts/hmi/h2/<run>]      (default: latest.json)
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { verifyJournal } from "../src/hmi/journal.ts";
import { HMI_WRITE_ALLOWLIST } from "../src/hmi/signals.ts";
import { frozenProjectHash, shaFile } from "../src/campaign/m10-rehearsal.ts";

export function auditHmiH2(dir) {
  const checks = [];
  const check = (id, fn) => { try { const detail = fn(); checks.push({ id, pass: true, detail }); } catch (e) { checks.push({ id, pass: false, detail: e.message }); } };
  const sha = buf => createHash("sha256").update(buf).digest("hex");
  const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
  const runs = readdirSync(join(dir, "hmi/runs"));
  const journalFile = join(dir, "hmi/runs", runs[0], "journal.jsonl");
  const journal = readFileSync(journalFile, "utf8").trim().split("\n").map(l => JSON.parse(l));
  const of = type => journal.filter(r => r.type === type);
  const world = gunzipSync(readFileSync(join(dir, "world-transport.jsonl.gz"))).toString("utf8").trim().split("\n").map(l => JSON.parse(l));
  const hub = readFileSync(join(dir, "portal-hmi/hmi-session.jsonl"), "utf8").trim().split("\n").map(l => JSON.parse(l));
  const frames = new Map(hub.filter(r => r.type === "frame").map(r => [r.reference, r]));

  check("run-status-and-provenance", () => {
    assert.equal(result.status, "pass");
    assert.equal(result.projectSha256, frozenProjectHash);
    assert.equal(result.mapSha256, shaFile("codesys/demo/signal-map-v1.json"));
    assert.equal(result.worldSha256, shaFile("artifacts/generated-world/2026-10-29T21-15-44-647Z-muse-wonder-1.0/world.ts"));
    assert.equal(result.modelCalls, 0);
    return `pass; frozen M8 project ${frozenProjectHash.slice(0, 12)}…; 0 model calls`;
  });
  check("journal-hash-chain", () => { assert.equal(runs.length, 1); return verifyJournal(journalFile); });
  check("hmi-writes-only-operator-requests", () => {
    const writes = of("transport.opc.write").flatMap(r => r.data.items);
    assert.ok(writes.length > 0);
    for (const w of writes) { assert.ok(HMI_WRITE_ALLOWLIST.has(w.path), `HMI wrote ${w.path}`); assert.match(String(w.status), /^Good/); }
    return `${writes.length} HMI writes, all within ${[...HMI_WRITE_ALLOWLIST].map(p => p.split(".").at(-1)).join("/")}, all Good`;
  });
  check("coordinator-never-writes-operator-requests", () => {
    const writes = world.filter(e => e.kind === "opc.write").flatMap(e => e.items);
    for (const w of writes) {
      assert.ok(!HMI_WRITE_ALLOWLIST.has(w.path), `coordinator wrote operator path ${w.path}`);
      assert.ok(/^GVL_BenchWrite\./.test(w.path) || ["GVL_DemoWrite.OfferItemId", "GVL_DemoWrite.OfferRoute", "GVL_DemoWrite.OfferSequence", "GVL_DemoWrite.CompletionAck"].includes(w.path), `unexpected coordinator write ${w.path}`);
    }
    return `${writes.length} coordinator writes: bench image/handshake and WCS offer/acknowledgement only`;
  });

  const terminal = new Map();
  for (const r of journal) if (/^command\.(applied|rejected|timed_out|unconfirmed|failed|refused)$/.test(r.type)) terminal.set(r.data.requestId, r);
  const requested = of("command.requested");
  check("command-sequence-and-plc-outcomes", () => {
    const seq = requested.map(r => `${r.data.action}:${terminal.get(r.data.requestId)?.data.outcome}`);
    assert.deepEqual(seq, ["auto_on:applied", "start:applied", "stop:applied", "start:applied", "auto_off:applied", "start:rejected", "reset:rejected", "reset:applied", "auto_on:applied", "start:applied", "stop:applied"]);
    return seq.join(", ");
  });
  check("acknowledgement-semantics", () => {
    for (const r of requested) {
      const t = terminal.get(r.data.requestId).data, delivered = journal.find(x => x.type === "command.delivered" && x.data.requestId === r.data.requestId);
      assert.ok(delivered, `${r.data.requestId} has no delivery record`);
      if (r.data.action === "start" || r.data.action === "reset") { assert.equal(t.accepted, t.outcome === "applied"); assert.ok(t.expectedSequence > 0); assert.ok(t.acknowledgedAtIso); }
      if (r.data.action === "stop") { assert.equal(t.outcome, "applied"); assert.match(t.detail, /echoed/); }
      if (r.data.action.startsWith("auto")) assert.match(t.detail, /readback/);
      if (t.outcome === "rejected") assert.ok(t.preconditions?.some(p => p.met === false), "rejection lists an unmet observed precondition");
    }
    return "Start/Reset applied iff accepted flag TRUE after sequence echo; Stop by echo; Auto by labelled readback; every rejection lists unmet observed preconditions";
  });
  check("reset-does-not-start", () => {
    // Judged from raw PLC observations between the applied Reset and the next operator request,
    // so a later, separate Start can never be attributed to Reset.
    const out = [];
    for (const applied of journal.filter(r => r.type === "command.applied" && r.data.action === "reset")) {
      const i = journal.indexOf(applied), next = journal.findIndex((r, k) => k > i && r.type === "command.requested");
      const window = journal.slice(i, next < 0 ? undefined : next);
      let mode = applied.data.atAck.mode, motor = applied.data.atAck.motorRunCmd;
      assert.notEqual(mode, 1); assert.equal(motor, false);
      for (const c of window.filter(r => r.type === "plc.change").map(r => r.data.changes)) {
        if ("GVL_DemoRead.Status.Mode" in c) { mode = c["GVL_DemoRead.Status.Mode"]; assert.notEqual(mode, 1, "Reset led to Auto before any Start"); }
        if ("GVL_DemoRead.Status.Motor_RunCmd" in c) { motor = c["GVL_DemoRead.Status.Motor_RunCmd"]; assert.equal(motor, false, "Reset turned the motor on"); }
      }
      assert.equal(mode, 0);
      out.push(`Reset ${applied.data.requestId}: Stopped, motor off until the next request (${next < 0 ? "end" : journal[next].data.action})`);
    }
    assert.ok(out.length);
    return out.join("; ");
  });
  check("five-records-per-click", () => {
    let n = 0;
    for (const a of of("agent.action.requested").map(r => r.data).filter(a => a.status === "requested")) {
      const ref = a.reference;
      const delivered = journal.find(r => r.type === "agent.action.delivered" && r.data.reference === ref);
      const page = journal.find(r => r.type === "agent.action.page_input" && r.data.reference === ref);
      const screen = journal.find(r => r.type === "agent.action.screen" && r.data.reference === ref);
      assert.ok(delivered && page && screen, `${ref} incomplete`);
      assert.equal(page.data.pageInput.isTrusted, true); assert.equal(page.data.pageInput.hitTarget, a.targetId);
      const frame = frames.get(screen.data.screen.frameRef);
      assert.ok(frame, `frame ${screen.data.screen.frameRef} not in Lane B session log`);
      assert.equal(frame.sha256, screen.data.screen.sha256);
      assert.ok(Date.parse(screen.data.screen.capturedAtIso) > Date.parse(delivered.data.delivered.atIso));
      if (a.targetId.startsWith("cmd.")) {
        const cmd = requested.find(r => r.data.agentActionRef === ref);
        assert.ok(cmd, `${ref} has no command`); assert.equal(cmd.data.origin, "agent_seam"); assert.equal(cmd.data.uiActionRef, page.data.pageInput.reference);
        assert.match(String(screen.data.screen.renderedStatus), /^page rendered:/);
      }
      n++;
    }
    return `${n} clicks each with requested action, CDP delivery, trusted page input on the intended target, linked command (for controls), rendered outcome and a later frame whose SHA-256 matches Lane B's log`;
  });
  check("cited-frames-preserved", () => {
    // Required set comes from what the evidence cites (agent screens and result steps), not from the files present.
    const actionSha = new Map();
    for (const r of of("agent.action.screen")) {
      const { frameRef, sha256 } = r.data.screen ?? {};
      if (!frameRef) continue;
      assert.ok(!actionSha.has(frameRef) || actionSha.get(frameRef) === sha256, `${frameRef} cited with two different SHA-256 values`);
      actionSha.set(frameRef, sha256);
    }
    const cited = new Set([...actionSha.keys(), ...(JSON.stringify(result.steps ?? []).match(/hmi-frame:[^"]+/g) ?? [])]);
    assert.ok(cited.size > 0, "no frames cited");
    const fileOf = ref => { const [, session, seq] = ref.split(":"); return join(dir, "evidence-frames", `${session}-${String(seq).padStart(6, "0")}.jpg`); };
    for (const ref of cited) {
      const frame = frames.get(ref);
      assert.ok(frame, `${ref} not in Lane B session log`);
      assert.ok(existsSync(fileOf(ref)), `${ref} cited but its frame bytes are missing`);
      const bytes = readFileSync(fileOf(ref));
      assert.ok(bytes.length > 0, `${ref} frame file is empty`);
      assert.equal(sha(bytes), frame.sha256, `${ref} bytes differ from Lane B's log`);
      if (actionSha.has(ref)) assert.equal(sha(bytes), actionSha.get(ref), `${ref} bytes differ from the agent action record`);
    }
    // Any extra preserved frame must still be a logged capture with matching bytes.
    const files = readdirSync(join(dir, "evidence-frames"));
    for (const f of files) {
      const [session, seq] = [f.slice(0, f.lastIndexOf("-")), Number(f.slice(f.lastIndexOf("-") + 1, -4))];
      const frame = frames.get(`hmi-frame:${session}:${seq}`);
      assert.ok(frame, `${f} not in session log`);
      assert.equal(sha(readFileSync(join(dir, "evidence-frames", f))), frame.sha256, `${f} bytes differ`);
    }
    return `${cited.size} cited frames (${actionSha.size} from agent action screens) present; bytes match the action records and Lane B's SHA-256`;
  });
  check("alarm-transitions", () => {
    const raised = of("alarm.raised"), cleared = of("alarm.cleared");
    assert.equal(raised.length, 1); assert.equal(cleared.length, 1);
    const a = raised[0].data.alarm;
    assert.equal(a.code, 10); assert.equal(a.firstObservedBasis, "transition_observed"); assert.ok(a.onsetAfterIso);
    assert.equal(cleared[0].data.clearBasis, "transition_observed");
    const resetApplied = journal.find(r => r.type === "command.applied" && r.data.action === "reset");
    assert.ok(cleared[0].sequence > resetApplied.sequence, "alarm cleared only after the PLC accepted Reset");
    return `F10 raised ${a.firstObservedAtIso} (onset after ${a.onsetAfterIso}), cleared ${cleared[0].data.clearedObservedAtIso}; both observed transitions`;
  });
  check("no-command-while-link-not-fresh", () => {
    const lost = journal.findIndex(r => r.type === "link.state" && ["stale", "reconnecting"].includes(r.data.state));
    const back = journal.findIndex((r, i) => i > lost && r.type === "link.state" && r.data.state === "connected");
    assert.ok(lost > 0 && back > lost, "link loss and recovery recorded");
    const during = journal.slice(lost, back).filter(r => r.type === "command.requested" || r.type === "transport.opc.write");
    assert.equal(during.length, 0);
    const blocked = journal.slice(lost, back).find(r => r.type === "agent.action.requested");
    assert.equal(blocked?.data.status, "inconclusive");
    return `link ${journal[lost].data.state} → connected; agent Start was inconclusive (${blocked.data.detail}); no command or write in between`;
  });
  check("connector-stale-is-not-an-alarm", () => {
    const step = journal.find(r => r.type === "h2.step" && r.data.step === "connector-stale");
    assert.equal(step.data.plc.ConnectorStale, true);
    assert.equal(journal.filter(r => r.type === "alarm.raised" && r.sequence > step.sequence).length, 0);
    assert.equal(of("alarm.raised").length, 1);
    return "ConnectorStale TRUE observed by the HMI; no alarm instance created";
  });
  check("item-route-completion", () => {
    // Rebuild observed PLC state: first keyframe values, then every change in order (changes record only differences).
    const base = Object.fromEntries(Object.entries(of("plc.keyframe")[0].data.values).map(([p, v]) => [p, v[0]]));
    const baselineSequence = base["GVL_DemoRead.Status.CompletionSequence"], baselineA = base["GVL_DemoRead.Status.CountExitA"];
    const changes = Object.assign(base, ...of("plc.change").map(r => r.data.changes));
    assert.equal(changes["GVL_DemoRead.Status.CompletionSequence"], baselineSequence + 1, "exactly one new completion");
    assert.equal(changes["GVL_DemoRead.Status.CountExitA"], baselineA + 1, "exit A count advanced by one");
    assert.equal(changes["GVL_DemoRead.Status.CompletionItemId"], 301);
    assert.equal(changes["GVL_DemoRead.Status.CompletionExit"], 1);
    assert.equal(changes["GVL_DemoRead.Status.CompletionDisposition"], 1);
    const wcsAck = world.filter(e => e.kind === "opc.write").flatMap(e => e.items).find(i => i.path === "GVL_DemoWrite.CompletionAck");
    assert.equal(wcsAck?.value, changes["GVL_DemoRead.Status.CompletionSequence"]);
    return `Item 301/A completed Exit A / Sorted (completion #${changes["GVL_DemoRead.Status.CompletionSequence"]}); acknowledged by the WCS peer, not the HMI`;
  });
  const pass = checks.every(c => c.pass);
  return { schemaVersion: 1, directory: dir, auditedAt: new Date().toISOString(), pass, checks };
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/").replace(/^\//, "")}`) {
  const dir = process.argv[2] ?? JSON.parse(readFileSync("artifacts/hmi/h2/latest.json", "utf8")).directory;
  if (!existsSync(join(dir, "result.json"))) throw new Error(`No result.json in ${dir}`);
  const audit = auditHmiH2(dir);
  writeFileSync(join(dir, "audit.json"), JSON.stringify(audit, null, 2) + "\n");
  for (const c of audit.checks) console.log(`${c.pass ? "PASS" : "FAIL"} ${c.id}: ${typeof c.detail === "string" ? c.detail : JSON.stringify(c.detail)}`);
  console.log(audit.pass ? `H2 audit passed (${audit.checks.length} checks)` : "H2 audit FAILED");
  process.exitCode = audit.pass ? 0 : 1;
}
