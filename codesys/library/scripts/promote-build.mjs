// Promote one passing, clean-tree library build into builds/<label>/ and append it
// to builds/index.json. Promoted directories are immutable: this refuses to
// overwrite, and refuses dirty-tree or failed builds.
//
//   node promote-build.mjs [artifactDirectory]   (default: artifacts/latest.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', ['-C', LIB, ...args], { encoding: 'utf8' }).trim();
const fail = (message) => { console.error(`promotion refused: ${message}`); process.exit(1); };

const source = process.argv[2]
  ? path.resolve(process.argv[2])
  : JSON.parse(fs.readFileSync(path.join(LIB, 'artifacts', 'latest.json'), 'utf8')).directory;
const result = JSON.parse(fs.readFileSync(path.join(source, 'result.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8'));
if (result.status !== 'pass') fail('build did not pass');
if (result.schema !== 'controlsbench.library-build/2') fail('unexpected result schema');
if (result.plcContacted !== false || result.deployed !== false) fail('offline scope not recorded');
if (result.label !== manifest.package.label || result.library.version !== manifest.package.version) fail('build does not match library.json');
const request = result.provenance?.request ?? {};
if (!request.gitCommit || (request.dirtyPaths ?? []).length) fail('build was not made from a clean committed tree');
const head = git('rev-parse', 'HEAD');
if (head !== request.gitCommit) console.warn(`note: HEAD ${head} differs from built commit ${request.gitCommit}`);

const target = path.join(LIB, 'builds', result.label);
if (fs.existsSync(target)) fail(`builds/${result.label} already exists and is immutable`);
fs.mkdirSync(target, { recursive: true });
const copy = (from, to = from) => {
  const dst = path.join(target, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(source, from), dst);
};
copy('result.json');
for (const name of Object.keys(result.artifacts)) copy(name);
for (const file of Object.keys(result.fbs.files)) copy(path.join('fbs-pristine', 'ControlsBenchCore.fbslib', file), path.join('ControlsBenchCore.fbslib', file));

for (const [name, hash] of Object.entries(result.artifacts)) if (sha(path.join(target, name)) !== hash) fail(`copied artifact differs: ${name}`);
for (const [file, hash] of Object.entries(result.fbs.files)) if (sha(path.join(target, 'ControlsBenchCore.fbslib', file)) !== hash) fail(`copied FBS file differs: ${file}`);

const indexPath = path.join(LIB, 'builds', 'index.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
if (index.builds.some((b) => b.label === result.label)) fail('index already lists this label');
index.builds.push({
  label: result.label,
  libraryVersion: result.library.version,
  resultSchema: result.schema,
  sourceCommit: request.gitCommit,
  versions: result.versions,
  toolchain: { codesys: manifest.toolchain.codesys, profile: request.profile, fileBasedStorage: result.fbs.plugin },
  consumers: Object.keys(result.consumers),
  evidenceClass: 'offline_compilation_fbs_roundtrip_and_source_provenance',
  runtimeValidated: false,
  promotedUtc: new Date().toISOString(),
});
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ status: 'promoted', label: result.label, directory: path.relative(LIB, target), sourceCommit: request.gitCommit,
  artifacts: Object.keys(result.artifacts).length, fbsFiles: Object.keys(result.fbs.files).length }, null, 2));
