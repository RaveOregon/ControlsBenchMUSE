// Offline audit of every promoted library build and of the current tree's
// version metadata. Needs Git and Node only: no CODESYS, no PLC.
//
//   node codesys/library/scripts/audit-build.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMap, validateMap, canonical } from './cb-map.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = execFileSync('git', ['-C', LIB, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const shaFile = (file) => sha(fs.readFileSync(file));
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const gitBlob = (commit, repoPath) => execFileSync('git', ['-C', REPO, 'show', `${commit}:${repoPath}`], { maxBuffer: 1 << 26 });
const failures = [];
const notes = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const STATUS = ['implemented', 'compiled-only', 'runtime-validated', 'planned', 'unsupported'];
const SCHEMA2_STEPS = ['core-pool-check', 'core-compiled-library', 'fbs-core-pool-check', 'fbs-core-compiled-library',
  'fbs-clean-subset-pool-check', 'binary:consumer-library-pool-check', 'binary:consumer-library-compiled',
  'binary:consumer-application-build', 'fbs:consumer-library-pool-check', 'fbs:consumer-library-compiled',
  'fbs:consumer-application-build'];

function stripFbs(text, name, ext) {
  let t = text.replace(/\r\n/g, '\n').replace(/^\(\* METADATA[\s\S]*?\*\)\n/, '');
  if (ext === 'gvl') t = t.replace(new RegExp(`^NAMESPACE ${name}\\n`, 'm'), '').replace(/^END_NAMESPACE\n?/m, '');
  return t.trimEnd();
}

function auditLegacy(entry, dir, report) {
  check(report.status === 'pass', `${entry.label}: build did not pass`);
  check(report.plcContacted === false && report.deployed === false, `${entry.label}: offline scope missing`);
  check(report.runtimeChecks === 'compiled only; test harness not deployed or executed', `${entry.label}: runtime scope changed`);
  check(report.frozenDemoBefore === report.frozenDemoAfter, `${entry.label}: template changed during build`);
  check(report.steps.length === 5 && report.steps.every((s) => s.errors.length === 0), `${entry.label}: compiler checkpoint failed`);
  check(Object.keys(report.sources).length === 12, `${entry.label}: incomplete source set`);
  for (const [name, expected] of Object.entries(report.sources)) {
    check(sha(gitBlob(entry.sourceCommit, `codesys/library/source/${name}.st`)) === expected, `${entry.label}: source differs from ${entry.sourceCommit.slice(0, 7)}: ${name}`);
  }
  check(sha(gitBlob(entry.sourceCommit, 'codesys/library/examples/FB_CB_ConsumerChecks.st')) === report.consumerSource, `${entry.label}: consumer source differs`);
  for (const [name, expected] of Object.entries(report.artifacts)) check(shaFile(path.join(dir, name)) === expected, `${entry.label}: artifact differs: ${name}`);
  return { sources: Object.keys(report.sources).length + 1, artifacts: Object.keys(report.artifacts).length, fbsFiles: 0 };
}

function auditSchema2(entry, dir, report) {
  const L = entry.label;
  const request = report.provenance?.request ?? {};
  check(report.status === 'pass', `${L}: build did not pass`);
  check(report.plcContacted === false && report.deployed === false, `${L}: offline scope missing`);
  check(report.runtimeChecks === 'compiled only; conformance harness not executed', `${L}: runtime scope changed`);
  check(report.frozenDemoBefore === report.frozenDemoAfter, `${L}: template changed during build`);
  check(request.gitCommit === entry.sourceCommit, `${L}: index and result disagree on the source commit`);
  check(Array.isArray(request.dirtyPaths) && request.dirtyPaths.length === 0, `${L}: built from a dirty tree`);
  const steps = new Map(report.steps.map((s) => [s.step, s]));
  for (const name of SCHEMA2_STEPS) check(steps.has(name), `${L}: missing step ${name}`);
  for (const s of report.steps) {
    check(s.errors.length === 0 && s.compilerErrors === 0 && s.compilerWarnings === 0, `${L}: ${s.step} reported errors or warnings`);
  }
  let sources = 0;
  for (const group of Object.values(report.sources)) {
    for (const [repoPath, expected] of Object.entries(group)) {
      sources += 1;
      check(sha(gitBlob(entry.sourceCommit, repoPath)) === expected, `${L}: ${repoPath} differs from ${entry.sourceCommit.slice(0, 7)}`);
    }
  }
  for (const [name, expected] of Object.entries(report.artifacts)) check(shaFile(path.join(dir, name)) === expected, `${L}: artifact differs: ${name}`);
  const fbsDir = path.join(dir, 'ControlsBenchCore.fbslib');
  for (const [file, expected] of Object.entries(report.fbs.files)) check(shaFile(path.join(fbsDir, file)) === expected, `${L}: FBS file differs: ${file}`);
  check(report.fbs.converted === true && report.fbs.conversionEvents.length === 0, `${L}: FBS conversion incomplete`);
  check(report.fbs.cleanSubsetChangedOnReopen.length === 0, `${L}: FBS files changed when reopened`);
  // Native object files must carry exactly the reviewed Git source text.
  const objects = Object.keys(report.fbs.files).filter((f) => /^[^/]+\.(fb\.st|fn\.st|struct|union|gvl)$/.test(f));
  check(objects.length === Object.keys(report.sources.core).length, `${L}: FBS object count differs from core sources`);
  for (const file of objects) {
    const [name, ...rest] = file.split('.');
    const ext = rest.join('.') === 'gvl' ? 'gvl' : rest.join('.');
    const src = gitBlob(entry.sourceCommit, `codesys/library/source/${name}.st`).toString('utf8').replace(/\r\n/g, '\n').trimEnd();
    check(stripFbs(fs.readFileSync(path.join(fbsDir, file), 'utf8'), name, ext) === src, `${L}: FBS text differs from source for ${name}`);
  }
  check(report.consumers.binary && report.consumers.fbs, `${L}: both consumer passes are required`);
  check(Boolean(report.readback?.core && report.readback?.fbs), `${L}: readback not recorded`);
  return { sources, artifacts: Object.keys(report.artifacts).length, fbsFiles: Object.keys(report.fbs.files).length };
}

// --- Builds -----------------------------------------------------------------
const index = readJson(path.join(LIB, 'builds', 'index.json'));
const audited = [];
for (const entry of index.builds) {
  const dir = path.join(LIB, 'builds', entry.label);
  const report = readJson(path.join(dir, 'result.json'));
  const counts = entry.resultSchema === 'legacy-1' ? auditLegacy(entry, dir, report) : auditSchema2(entry, dir, report);
  check(report.libraryVersion === entry.libraryVersion || report.library?.version === entry.libraryVersion, `${entry.label}: version differs from index`);
  check(entry.runtimeValidated === false, `${entry.label}: no library build is runtime-validated yet`);
  audited.push({ label: entry.label, sourceCommit: entry.sourceCommit.slice(0, 12), ...counts });
}

// --- Current tree -----------------------------------------------------------
const manifest = readJson(path.join(LIB, 'library.json'));
const profile = readJson(path.join(LIB, 'adapter-profile.json'));
const latest = index.builds.find((b) => b.libraryVersion === manifest.package.version);
if (latest) {
  const report = readJson(path.join(LIB, 'builds', latest.label, 'result.json'));
  for (const group of Object.values(report.sources ?? {})) {
    for (const [repoPath, expected] of Object.entries(group)) {
      check(shaFile(path.join(REPO, repoPath)) === expected, `working tree ${repoPath} changed after ${latest.label} was promoted; bump the version`);
    }
  }
} else {
  notes.push(`library.json version ${manifest.package.version} has no promoted build yet`);
}
check(profile.library.version === manifest.package.version && profile.library.namespace === manifest.package.namespace, 'adapter-profile library identity differs from library.json');
check(canonical(profile.versioning.current) === canonical(manifest.versions), 'adapter-profile versioning.current differs from library.json versions');

// Result codes and versions in the profile must equal the PLC constants.
const gvl = fs.readFileSync(path.join(LIB, 'source', 'GVL_CB.st'), 'utf8');
const constant = (name) => { const m = gvl.match(new RegExp(`\\b${name}\\s*:\\s*\\w+\\s*:=\\s*(\\d+)\\s*;`)); return m ? Number(m[1]) : undefined; };
for (const [name, value] of Object.entries(profile.resultCodes)) check(constant(`RESULT_${name}`) === value, `resultCodes.${name} differs from GVL_CB`);
check(constant('PROTOCOL_VERSION') === manifest.versions.adapterProtocol, 'PROTOCOL_VERSION differs from library.json');
check(constant('FRAME_FORMAT_VERSION') === manifest.versions.observationFrameFormat, 'FRAME_FORMAT_VERSION differs from library.json');
check(`${constant('API_VERSION_MAJOR')}.${constant('API_VERSION_MINOR')}` === manifest.versions.api, 'API_VERSION differs from library.json');

// Generated maps must be fresh.
let maps = 0;
for (const file of fs.readdirSync(path.join(LIB, 'mappings')).filter((f) => f.endsWith('.map.json'))) {
  const text = fs.readFileSync(path.join(LIB, 'mappings', file), 'utf8');
  const map = JSON.parse(text);
  const errors = validateMap(map, file);
  failures.push(...errors);
  if (errors.length) continue;
  const out = buildMap(map, text);
  for (const [name, body] of Object.entries(out.files)) {
    const p = path.join(LIB, 'examples', 'mappings', map.mapId, name);
    check(fs.existsSync(p) && fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n') === body, `${map.mapId}: ${name} is stale`);
  }
  const manifestFile = path.join(LIB, 'mappings', 'generated', `${map.mapId}.manifest.json`);
  check(fs.existsSync(manifestFile) && fs.readFileSync(manifestFile, 'utf8').replace(/\r\n/g, '\n') === `${JSON.stringify(out.manifest, null, 2)}\n`, `${map.mapId}: manifest is stale`);
  maps += 1;
}

// Capability matrix: allowed statuses, evidence for anything claimed, a gate for anything deferred.
check(canonical(Object.keys(profile.capabilityStatuses).sort()) === canonical([...STATUS].sort()), 'capabilityStatuses must define exactly the five statuses');
const compiledEvidence = path.join(REPO, profile.compiledEvidence);
if (fs.existsSync(compiledEvidence)) {
  const built = readJson(compiledEvidence);
  check(built.status === 'pass' && built.library?.version === manifest.package.version, 'compiledEvidence is not a passing build of the current version');
} else {
  check(!profile.capabilities.some((c) => c.status === 'compiled-only'), `compiled-only capabilities need ${profile.compiledEvidence}`);
}
for (const cap of profile.capabilities) {
  check(STATUS.includes(cap.status), `capability ${cap.id}: invalid status ${cap.status}`);
  if (['implemented', 'compiled-only', 'runtime-validated'].includes(cap.status)) {
    check(Array.isArray(cap.evidence) && cap.evidence.length > 0, `capability ${cap.id}: claimed without evidence`);
    for (const ref of cap.evidence ?? []) check(fs.existsSync(path.join(REPO, ref.split('#')[0])), `capability ${cap.id}: evidence path missing: ${ref}`);
  }
  if (cap.status !== 'runtime-validated' && cap.status !== 'unsupported') check(typeof cap.gate === 'string' && cap.gate.length > 0, `capability ${cap.id}: needs an acceptance gate`);
  if (cap.status === 'runtime-validated') check(false, `capability ${cap.id}: no library runtime evidence exists yet`);
}

console.log(JSON.stringify({
  status: failures.length ? 'fail' : 'pass',
  builds: audited,
  currentVersion: manifest.package.version,
  mapsChecked: maps,
  capabilities: profile.capabilities.length,
  evidenceClass: 'offline_compilation_fbs_roundtrip_and_source_provenance',
  runtimeChecksExecuted: false,
  notes,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
