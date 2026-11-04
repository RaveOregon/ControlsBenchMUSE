// Curate existing submission evidence. Byte-for-byte copies only: no PLC/model/browser contact.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const check=process.argv.includes('--check');
const w4='artifacts/w4-paid/2026-11-03T13-11-03-480Z/live-host/runs/2026-11-03T13-12-52-676Z-live_plc/portal-host/portal-20261103131442735-1';
const s2='artifacts/s2/2026-11-03T23-19-41-497Z-live-retry/host/runs/2026-11-03T23-21-03-238Z-live_plc/portal-host/portal-20261103232137992-1';
const m10='artifacts/m10/2026-11-01T00-58-43-185Z';
const files=[
  ['reports/adaptive-plc-investigation.pdf','artifacts/bench-report/captures/w4-adaptive-plc-investigation.pdf','Saved W4 report; later presentation export'],
  ['reports/adaptive-plc-investigation.html','artifacts/bench-report/saved-exports/w4-adaptive-plc-investigation/report.html','Saved W4 standalone report'],
  ['reports/muse-hmi-operation.pdf','artifacts/bench-report/captures/s2-hmi-operator-trial.pdf','Saved S2 report; later presentation export'],
  ['reports/muse-hmi-operation.html','artifacts/bench-report/saved-exports/s2-hmi-operator-trial/report.html','Saved S2 standalone report'],
  ['reports/partial-hmi-attempt.pdf','artifacts/bench-report/captures/s2-first-attempt-partial.pdf','Partial first HMI attempt; not a success'],
  ['records/w4-report.json',`${w4}/report.json`,'Original model-authored W4 report'],
  ['records/w4-audit.json',`${w4}/campaign-audit.json`,'Original W4 audit'],
  ['records/w4-engineering-review.json',`${w4}/engineering-review.json`,'Scoped source-to-wire review'],
  ['records/s2-report.json',`${s2}/report.json`,'Original S2 report including citation defect'],
  ['records/s2-audit.json',`${s2}/s2-audit.json`,'Original S2 audit: reference_review_required'],
  ['records/s2-engineering-review.json',`${s2}/engineering-review.json`,'Scoped S2 review: pass_with_limitations'],
  ['records/normal-operation-result.json',`${m10}/result.json`,'Separate zero-model live integration result'],
  ['records/normal-operation-audit.json',`${m10}/audit.json`,'Normal-operation saved-evidence audit'],
  ['images/architecture.png','docs/submission-diagrams/controlsbench-architecture.png','Agnostic architecture with demonstrated bindings'],
  ['images/adaptive-investigation.png','artifacts/bench-report/captures/w4-adaptive-plc-investigation-findings.png','Later capture of saved report, not live video'],
  ['images/muse-received-overload.jpg',`${s2}/vision-frames/3-current.jpg`,'Exact received image from S2'],
  ['images/hmi-evidence-report.png','artifacts/bench-report/captures/s2-hmi-operator-trial-hmi-ui03.png','Later capture of saved HMI evidence report']
];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest={schema:'controlsbench.submission-evidence.v1',description:'Byte-exact curated copies of existing artifacts. Separate saved campaigns; no new execution.',files:[]};
for(const [target,source,role] of files){
  const bytes=readFileSync(join(root,source)),dest=join(root,'evidence',target);
  if(check){if(!existsSync(dest)||sha(readFileSync(dest))!==sha(bytes))throw Error(`Copy differs or is missing: ${target}`);}
  else{mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,bytes);}
  manifest.files.push({file:target,source,role,sha256:sha(bytes),byteLength:bytes.length});
}
const path=join(root,'evidence/manifest.json'),serialized=JSON.stringify(manifest,null,2)+'\n';
if(check){if(readFileSync(path,'utf8')!==serialized)throw Error('Evidence manifest differs from current sources');}
else writeFileSync(path,serialized);
console.log(JSON.stringify({status:'pass',mode:check?'check':'build',files:manifest.files.length,plcContacted:false,modelCalls:0}));
