// Screenshots and print (PDF) renderings of exported bench reports, plus the in-app Results page.
//
//   node scripts/capture-bench-report.js [--exports artifacts/bench-report/saved-exports] [--out artifacts/bench-report/captures]
//        [--app http://127.0.0.1:5195]
//
// Standalone reports are opened from disk with no server. --app captures Results from a running
// fixture host (fake connector only; refuses any other factory) whose campaign already finished,
// then opens the saved S2 bundle through "Open saved report". It never starts a campaign.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { launch } from "./lib/chrome.js";

const { values } = parseArgs({ options: {
  exports: { type: "string", default: "artifacts/bench-report/saved-exports" }, out: { type: "string", default: "artifacts/bench-report/captures" }, app: { type: "string" }
} });
mkdirSync(values.out, { recursive: true });
const results = [];
const rel = p => relative(process.cwd(), p).split("\\").join("/");

// Lazy images never decode off-screen; load them all, and never wait more than a few seconds.
const IMAGES_READY = "(document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; }), Promise.race([Promise.all([...document.images].map(i => i.decode().catch(() => null))), new Promise(r => setTimeout(r, 5000))]).then(() => true))";

async function shoot(browser, file, selector) {
  if (selector) await browser.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.scrollIntoView({ block: "start" }); window.scrollBy(0, -8); return true; })()`);
  else await browser.evaluate("window.scrollTo(0, 0), true");
  await browser.evaluate("new Promise(r => requestAnimationFrame(() => setTimeout(r, 250)))");
  writeFileSync(file, await browser.screenshot());
  return rel(file);
}

const browser = await launch({ width: 1440, height: 900 });
try {
  for (const name of readdirSync(values.exports)) {
    const html = join(values.exports, name, "report.html");
    await browser.navigate(html);
    assert.ok(await browser.waitFor("document.querySelector('.bench-report') && document.readyState === 'complete'"), `${name} renders`);
    await browser.evaluate(IMAGES_READY);
    const facts = await browser.evaluate(`({ title: document.title, attention: document.querySelectorAll('.br-attention li').length,
      images: [...document.images].filter(i => i.naturalWidth > 0).length, placeholders: document.querySelectorAll('.br-frame-missing').length,
      externalRequests: performance.getEntriesByType('resource').filter(r => !r.name.startsWith('data:') && !r.name.startsWith('file:')).length,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1 })`);
    const shots = [await shoot(browser, join(values.out, `${name}-summary.png`))];
    const hmi = await browser.evaluate("document.querySelectorAll('section[aria-label=\"HMI assessments\"] article').length");
    if (hmi >= 3) shots.push(await shoot(browser, join(values.out, `${name}-hmi-ui03.png`), "section[aria-label=\"HMI assessments\"] article:nth-of-type(3)"));
    shots.push(await shoot(browser, join(values.out, `${name}-results.png`), "section[aria-label=\"Test scope and results\"]"));
    if (await browser.evaluate("document.querySelectorAll('section[aria-label=\"Findings\"] article').length > 0")) shots.push(await shoot(browser, join(values.out, `${name}-findings.png`), "section[aria-label=\"Findings\"]"));
    // Same path as the browser's Print / Save as PDF: the report's beforeprint handler opens the key sections.
    const closedBefore = await browser.evaluate("document.querySelectorAll('details[data-print-open]:not([open])').length");
    await browser.evaluate("window.dispatchEvent(new Event('beforeprint')), true");
    const closedAfter = await browser.evaluate("document.querySelectorAll('details[data-print-open]:not([open])').length");
    const pdf = await browser.cdp("Page.printToPDF", { printBackground: true, preferCSSPageSize: true });
    await browser.evaluate("window.dispatchEvent(new Event('afterprint')), true");
    const restored = await browser.evaluate("document.querySelectorAll('details[data-print-open]:not([open])').length");
    const pdfFile = join(values.out, `${name}.pdf`);
    writeFileSync(pdfFile, Buffer.from(pdf.data, "base64"));
    assert.equal(facts.externalRequests, 0, `${name} loads nothing from the network`);
    assert.equal(closedAfter, 0, `${name} print expansion`);
    results.push({ report: name, ...facts, printExpansion: { closedBefore, closedAfter, restoredAfterPrint: restored === closedBefore }, screenshots: shots, pdf: rel(pdfFile) });
  }

  if (values.app) {
    const host = await (await fetch(`${values.app}/api/host`)).json();
    assert.equal(host.factory.evidenceClass, "fake_connector", "capture only from a fixture host");
    const report = await (await fetch(`${values.app}/api/campaign/report`)).json();
    assert.ok(["completed", "stopped", "failed"].includes(report.status), "fixture campaign must already be finalized; this script never starts one");
    await browser.cdp("Page.navigate", { url: values.app });
    assert.ok(await browser.waitFor("window.controlsBenchPortal?.hosted === true"));
    await browser.evaluate("[...document.querySelectorAll('nav.destinations button')].find(b => b.textContent === 'Results').click(), true");
    assert.ok(await browser.waitFor(`document.querySelector('.bench-report')?.dataset.campaign === ${JSON.stringify(report.campaignId)}`), "hosted report renders");
    const app = [await shoot(browser, join(values.out, "app-results-fixture-host.png"), ".bench-report")];
    const bundle = readFileSync(join(values.exports, "s2-hmi-operator-trial", "report-bundle.json"), "utf8");
    await browser.evaluate(`(() => { const input = document.querySelector('.bench-report input[type=file]'); const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(bundle)}], 'report-bundle.json', { type: 'application/json' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    assert.ok(await browser.waitFor("document.querySelector('.bench-report')?.dataset.campaign === 'portal-20261103232137992-1'"), "saved S2 bundle opens in Results");
    app.push(await shoot(browser, join(values.out, "app-results-saved-s2.png"), ".source-notice"));
    await browser.evaluate("document.querySelectorAll('section[aria-label=\"HMI assessments\"] article')[2].scrollIntoView(), true");
    await browser.evaluate(IMAGES_READY);
    app.push(await shoot(browser, join(values.out, "app-results-saved-s2-hmi.png"), "section[aria-label=\"HMI assessments\"] article:nth-of-type(3)"));
    await browser.evaluate("window.dispatchEvent(new Event('beforeprint')), true");
    const appPdf = join(values.out, "app-results-saved-s2.pdf");
    writeFileSync(appPdf, Buffer.from((await browser.cdp("Page.printToPDF", { printBackground: true })).data, "base64"));
    results.push({ app: "Results", host: host.factory.label, campaign: report.campaignId, screenshots: app, pdf: rel(appPdf) });
  }
} finally { browser.close(); }
writeFileSync(join(values.out, "captures.json"), JSON.stringify({ capturedAtIso: new Date().toISOString(), viewport: "1440x900", browser: "headless Chrome/Edge via scripts/lib/chrome.js", results }, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
