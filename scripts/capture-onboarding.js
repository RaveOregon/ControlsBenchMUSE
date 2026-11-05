// Browser witness for specification-to-project onboarding.
//
//   node scripts/capture-onboarding.js --fixture http://127.0.0.1:5194 [--muse http://127.0.0.1:5196] [--out artifacts/spec-onboarding/witness]
//
// --fixture must be a host started with --project-author fixture --campaign project. The script
// drives the real production portal there: uploads the slow-belt specification through the file
// input (original bytes), prepares it, reviews, selects, starts a campaign, waits for completion,
// opens Results, reloads and reopens the project and its archived report. Every step is a UI action.
// --muse is read-only: it screenshots the preserved genuine Muse project and its last report and
// never presses Prepare or Start there.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { launch } from "./lib/chrome.js";

const { values } = parseArgs({ options: { fixture: { type: "string" }, muse: { type: "string" }, out: { type: "string", default: "artifacts/spec-onboarding/witness" } } });
assert.ok(values.fixture, "--fixture <host url> is required");
mkdirSync(values.out, { recursive: true });
const checks = [], shots = [];
const check = (name, ok, detail = "") => { assert.ok(ok, `${name} ${detail}`); checks.push(name); };
const specBytes = readFileSync(new URL("../docs/examples/conveyor-slow-belt-spec.md", import.meta.url));
const rel = p => relative(process.cwd(), p).split("\\").join("/");

const host = await (await fetch(`${values.fixture}/api/projects`)).json();
check("fixture host serves onboarding with the fixture author only", host.author.fixture === true && host.author.paid === false && host.factory === "project-offline");

const b = await launch({ width: 1440, height: 1000 });
const js = expression => b.evaluate(`(async () => { ${expression} })()`);
const shot = async (name, selector) => {
  if (selector) await js(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: "start" }); return true;`);
  await js("await new Promise(r => setTimeout(r, 300)); return true;");
  const file = join(values.out, `${name}.png`); writeFileSync(file, await b.screenshot()); shots.push(rel(file));
};
const nav = name => js(`[...document.querySelectorAll("nav.destinations button")].find(x => x.textContent === ${JSON.stringify(name)}).click(); await new Promise(r => setTimeout(r, 800)); return true;`);
const click = (text, scope = "document") => js(`const el = [...${scope}.querySelectorAll("button")].find(x => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (!el) return false; el.click(); return true;`);
const text = selector => js(`return document.querySelector(${JSON.stringify(selector)})?.innerText ?? "";`);

try {
  await b.cdp("Page.navigate", { url: values.fixture });
  check("portal attached to the host", await b.waitFor("window.controlsBenchPortal?.hosted === true"));
  await nav("Campaign");
  const gated = await js(`return [...document.querySelectorAll("button")].find(x => /Start campaign/.test(x.textContent))?.title ?? "";`);
  check("Start is gated until a project is selected", /Select a project|plan/.test(gated) || gated === "", gated);

  // 1. Create a project by uploading the file's exact bytes through the file input.
  await nav("Setup");
  check("open create form", await click("Create project from specification"));
  const name = `Slow-belt upload ${Date.now().toString(36)}`;
  await js(`const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(document.querySelector('[aria-label="Create project"] input:not([type=file])'), ${JSON.stringify(name)});
    const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(${JSON.stringify(specBytes.toString("base64"))}), c => c.charCodeAt(0))], "conveyor-slow-belt-spec.md", { type: "text/markdown" }));
    const input = document.querySelector('input[aria-label="Specification file"]'); input.files = dt.files; input.dispatchEvent(new Event("change", { bubbles: true })); return true;`);
  await shot("01-create-project-upload", '[aria-label="Create project"]');
  check("create project", await click("Create project"));
  check("project persisted with the uploaded bytes' hash", await b.waitFor(`document.querySelector(".version-panel")?.innerText.includes(${JSON.stringify(createHash("sha256").update(specBytes).digest("hex"))})`, 10_000));

  // 2. Prepare; capture live status while the isolated worker validates.
  check("start preparation", await click("Prepare (fixture author — not Muse)"));
  await b.waitFor(`/validating|preparing|repairing/.test(document.querySelector(".prep-status")?.innerText ?? "")`, 10_000);
  await shot("02-preparation-status", ".prep-status");
  check("preparation reached ready", await b.waitFor(`document.querySelector(".version-panel header .tag")?.textContent === "ready"`, 120_000));
  const review = await text('[aria-label="Preparation review"]');
  check("review shows validation, measured 0.3 m/s and compatible mapping", /Passed \d+ independent checks/.test(review) && /steadySpeedMps\s+0\.3/.test(review) && /Compatible with m8-conveyor/.test(review));
  await shot("03-review", '[aria-label="Preparation review"]');

  // 3. Select the exact version; the Campaign page shows its prepared plan.
  check("use this version", await click("Use this version"));
  check("active project shows the selection", await b.waitFor(`document.querySelector('[aria-label="Active project"]')?.innerText.includes(${JSON.stringify(name)})`, 10_000));
  await shot("04-active-project", '[aria-label="Active project"]');
  await nav("Campaign");
  check("prepared plan replaces the legacy checklist", await b.waitFor(`document.querySelector('[aria-label="Campaign plan"]')?.innerText.includes("planned")`, 10_000));
  await shot("05-campaign-plan-before-start", '[aria-label="Campaign plan"]');

  // 4. Start; checks update; follow-up listed separately.
  check("start campaign", await click("Start campaign", 'document.querySelector(\'[aria-label="Campaign plan"]\')'));
  // The header must name this project: on a reused host the previous campaign's COMPLETED record shows until the new one is announced.
  check("campaign completed", await b.waitFor(`(h => /COMPLETED/i.test(h) && h.toLowerCase().includes(${JSON.stringify(name.toLowerCase())}))(document.querySelector('[aria-label="Campaign record"] header')?.innerText ?? "")`, 120_000));
  const record = await text('[aria-label="Campaign outcome"]');
  check("record leads with the outcome and what review means", /Completed: \d+ of \d+ checks recorded an observation/.test(record) && /needs your review/.test(record) && /it is not a pass/.test(record));
  check("record sets the spec expectation beside the recorded result", /From spec[\s\S]*Observed/.test(await text('[aria-label="Campaign record"] .review-table')));
  check("findings and run details start collapsed", await js(`return [...document.querySelectorAll('[aria-label="Campaign record"] details')].every(d => !d.open);`));
  await shot("06a-campaign-record-after-run", '[aria-label="Campaign record"]');
  check("prepared plan collapses after Start", await js(`const d = document.querySelector('[aria-label="Campaign plan"]')?.closest("details"); if (!d || d.open) return false; d.open = true; return true;`));
  const plan = await text('[aria-label="Campaign plan"]');
  check("checks updated and follow-up shown", /observed/.test(plan) && /Added during the campaign[\s\S]*FOLLOWUP-fixture/.test(plan));
  await shot("06-campaign-plan-after-run", '[aria-label="Campaign plan"]');
  await shot("07-signal-view", '[aria-label="Project signal view"]');

  // 5. Results: project identity and prepared expectations.
  await nav("Results");
  check("report identifies the project and the loaded world", await b.waitFor(`document.querySelector('[aria-label="Campaign result source"]')?.innerText.includes("verified as loaded by the isolated child")`, 20_000));
  await shot("08-report-identity", '[aria-label="Campaign result source"]');
  await js(`const d = document.querySelector('[aria-label="Test scope and results"] details'); d.open = true; d.scrollIntoView({ block: "start" }); return true;`);
  check("report shows the prepared expected behaviour", /Prepared before Start[\s\S]*Expected behaviour[\s\S]*Specified: /.test(await text('[aria-label="Test scope and results"]')));
  await shot("09-report-expected-observed");

  // 6. Reload: the project, its selection and its run history persist; open the archived report.
  await b.cdp("Page.reload"); await b.waitFor("window.controlsBenchPortal?.hosted === true");
  await nav("Setup");
  check("project and run reopen after refresh", await b.waitFor(`document.querySelector(".version-panel")?.innerText.includes("Open report")`, 15_000));
  await shot("10-reopened-project-runs", ".version-panel");
  check("open archived report", await click("Open report"));
  check("archived report opens in Results", await b.waitFor(`document.querySelector(".source-notice")?.innerText.includes("Viewing saved report")`, 15_000));
  await shot("11-archived-report");

  if (values.muse) {
    await b.cdp("Page.navigate", { url: values.muse });
    await b.waitFor("window.controlsBenchPortal?.hosted === true");
    await nav("Setup");
    await js(`[...document.querySelectorAll(".project-setup .chip")].find(c => c.closest("tr")?.innerText.includes("Slow-belt conveyor variant"))?.click(); await new Promise(r => setTimeout(r, 1500)); return true;`);
    const muse = await text(".version-panel");
    check("genuine project prepared by Muse with one repair", /Muse Wonder 1\.0/.test(muse) && /2 of at most 3 · 1 repair request/.test(muse));
    await shot("20-genuine-muse-preparation", ".prep-status");
    await shot("21-genuine-muse-review", '[aria-label="Preparation review"]');
    await nav("Results");
    if (await b.waitFor(`document.querySelector('[aria-label="Campaign result source"]')?.innerText.includes("Slow-belt conveyor variant")`, 15_000)) await shot("22-genuine-world-report-identity", '[aria-label="Campaign result source"]');
  }
} finally { b.close(); }
writeFileSync(join(values.out, "witness.json"), JSON.stringify({ capturedAtIso: new Date().toISOString(), fixtureHost: values.fixture, museHost: values.muse ?? null, checks, screenshots: shots }, null, 2) + "\n");
console.log(JSON.stringify({ checks: checks.length, screenshots: shots }, null, 2));

