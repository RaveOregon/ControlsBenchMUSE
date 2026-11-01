import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'builds', 'prototype-0.1.0.0', 'result.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const failures = [];
function check(ok, message) { if (!ok) failures.push(message); }
check(report.status === 'pass', 'build did not pass');
check(report.plcContacted === false && report.deployed === false, 'offline build scope missing');
check(report.runtimeChecks === 'compiled only; test harness not deployed or executed', 'runtime scope changed');
check(report.frozenDemoBefore === report.frozenDemoAfter, 'demo changed during build');
check(report.steps.length === 5 && report.steps.every(s => s.errors.length === 0), 'compiler checkpoint failed');
check(Boolean(report.sourceReadback), 'saved source readback was not recorded');
check(Object.keys(report.sources).length === 12, 'incomplete source set');
for (const [name, expected] of Object.entries(report.sources)) {
  check(path.basename(name) === name, 'invalid source name');
  check(sha(path.join(root, 'source', `${name}.st`)) === expected, `source differs: ${name}`);
}
check(sha(path.join(root, 'examples', 'FB_CB_ConsumerChecks.st')) === report.consumerSource, 'consumer source differs');
check(Object.keys(report.artifacts).length === 5, 'missing distributable artifact hashes');
for (const [name, expected] of Object.entries(report.artifacts)) {
  check(path.basename(name) === name, 'invalid artifact name');
  check(sha(path.join(path.dirname(reportPath), name)) === expected, `artifact differs: ${name}`);
}
const profile = JSON.parse(fs.readFileSync(path.join(root, 'adapter-profile.json'), 'utf8'));
check(profile.library.version === report.libraryVersion && profile.library.namespace === report.namespace, 'profile identity differs');
console.log(JSON.stringify({
  status: failures.length ? 'fail' : 'pass',
  sourceFiles: Object.keys(report.sources).length,
  artifactFiles: Object.keys(report.artifacts).length,
  evidenceClass: 'offline_compilation_and_source_provenance',
  runtimeChecksExecuted: false,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
