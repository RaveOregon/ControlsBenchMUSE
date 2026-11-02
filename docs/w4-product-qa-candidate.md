# W4 product QA — candidate follow-up

Candidate tested: `265242b5c354e00373d51de3dc8d94ca66df5b73`. This is not final signoff. Offline only: no PLC, paid provider, or native connection. The controlled campaign provider intentionally waits until cancelled; it is not a model policy or PLC oracle. `scripts/w4-qa-controlled-factory.ts` wraps the production fixture and category contract, preserving the host, runtime and UI paths. Narrow scope was verified through actual browser POST, but the waiting fixture is not the live Wonder adapter.

## Results

- 19/19 browser checks: select only Normal operation, inspect the actual Start payload, observe applied Start, Stop while still running, verify stopped report, download the export, start a distinct second campaign and stop it, disconnect HMI and retain the last frame under a disconnected overlay. `candidate-265242b/result.json`, screenshots and ledger retain IDs and scope.
- 6/6 HMI-browser checks: a Start rejected by the fixture appears as “Rejected (fixture ack)”; a subsequent command with deliberately uncertain StartAck quality appears “Unconfirmed.” Both terminal outcomes appear in the HMI journal. See `rejected.png`, `unconfirmed.png`, `hmi-commands-result.json` and `hmi-command-journal.json`.
- 4/4 stale checks: the HMI capture source obtained real fixture-page pixels, then a deliberately failed capture caused a stale overlay without advancing the frame; the retained bytes matched the original hash. See `stale.png` and `stale-result.json`.
- Production recorded review browser witness passed 13/13, including preserved PLC events and timestamps labelled recorded, current review activity distinct, and explicit category submission. See `recorded-browser/result.json`. HMI confirmation and scope tests passed 42/42.
- Fixture report export downloaded, but `mode: live` and no hosted evidence class appears in its JSON; the Results badge says “live evidence” for `fake_connector`. This mislabels fixture evidence. Sent to B for production fix. `results.png`, `controlsbench-live-report.json` and `export-summary.json` preserve reproduction.
- Prior candidate's fixture footer and Setup provider fixes should be independently retested at B's final pin. Live-labelled presentation can be checked only with synthetic data or code-level tests here; no present live PLC state or timing is implied.

## Reproduction

Build with `npm --prefix ui run build`. Set `CONTROLSBENCH_HMI_BROWSER` to local Chrome and start `node scripts/run-hmi-portal.js --fixture m10-final-held --hmi-headless --portal-port 5610 --hmi-port 5611 --campaign-module scripts/w4-qa-controlled-factory.ts --artifacts artifacts/w4-product-qa/controlled-runs`. In another process set `W4_QA_OUT` to a new output folder and run `node scripts/w4-controlled-browser.js`; it refuses a non-QA factory. In a separate process start `node scripts/w4-qa-hmi-server.ts` (fixture on 5612), then run `node scripts/w4-hmi-command-browser.js` and `node scripts/w4-stale-browser.js`. They use only loopback and synthetic fixture controls. The recorded test is `node scripts/check-wonder-portal.js --out <new-dir>`; confirmation/scope tests are `node --test --test-concurrency=1 test/hmi-confirmation.test.ts test/wonder-scope.test.ts`. Stop the two owned servers after testing; QA ports 5610–5612 were free afterward. A first attempt omitted the launcher’s Chrome environment and a second had a test-oracle DOM-serialization error; `failure.json` preserves the latter, and neither is counted as a product failure.

The final candidate must be pinned and rechecked, including the fixed export and the fixture/historical/live classification. B retains production-fix ownership.

## Results fix retest

B's committed production source `c77553cc8a455266916153da502ce820ad2ce69f` was merged into the QA branch (QA merge HEAD is recorded in the result JSON). The revised controlled browser regression passed 21/21: fixture Results label, report download and matching `fake_connector` evidence class, campaign ID, stopped status and provider provenance, in addition to scope, Stop, new campaign and disconnect. See `artifacts/w4-product-qa/candidate-c77553c/`. This is a preliminary retest; B's final verified commit and the remaining final requalification are still required.
