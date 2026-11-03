// Offline preparation only. One campaign, current account history, exact tested sources.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),json=p=>JSON.parse(readFileSync(p,'utf8'));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const git=(...a)=>execFileSync('git',['-c','core.longpaths=true','-C',root,...a],{encoding:'utf8',windowsHide:true}).trim();
const proofPath=resolve(process.argv[2]),proof=json(proofPath);assert.equal(proof.status,'pass');
for(const[p,h]of Object.entries(proof.sources))assert.equal(hash(join(root,p)),h,'Source changed after qualification: '+p);
const ownerConfiguration=join(root,'artifacts/w4-readiness/proof-503abd3/launch.json'),owner=json(ownerConfiguration);
assert.equal(owner.sourceCommit,'503abd3b895cb2fc03853a9ec2d75166544e2a59');
const mainRoot=resolve(root,'../..'),account=join(mainRoot,'artifacts/wonder/session.jsonl'),charges=readFileSync(account,'utf8').trim().split('\n').map(JSON.parse);
let total=0;for(const c of charges){assert(Number.isInteger(c.costUsd)&&c.costUsd>=1&&c.costUsd<=5);total+=c.costUsd;assert.equal(c.totalUsd,total);}
assert(total>=105&&total<=140);const maximumRequests=Math.min(8,Math.floor((145-total)/5));assert(maximumRequests>=1);
const directory=join(root,'artifacts/s2',new Date().toISOString().replace(/[:.]/g,'-')+'-live');mkdirSync(directory);
const files=git('ls-files','--','src','scripts','docs/contracts','package.json','docs/conveyor-machine-spec.md').split('\n');
for(const p of ['scripts/prepare-s2.mjs','scripts/launch-s2.ps1','src/host/wonder-hmi-factory.ts'])assert(files.includes(p),'Commit the S2 implementation before preparation: '+p);
assert.equal(git('diff','--name-only','HEAD','--','src','scripts','docs/contracts','package.json'),'','Commit all deployment sources before preparation');
const packet={contract:'controlsbench.s2-hmi-proof.v1',preparedAtIso:new Date().toISOString(),sourceCommit:git('rev-parse','HEAD'),sourceRoot:root,repositoryRoot:mainRoot,
  authorizedCreditPoolUsd:150,authorization:'User approved Muse HMI proof with “ok do it”; existing instruction authorizes available $150 credits for proof work.',
  maximumRequests,requestAdmissionUsd:5,maximumNewConservativeUsd:maximumRequests*5,accountBaseline:{totalUsd:total,sha256:hash(account)},
  ownerConfiguration:{file:ownerConfiguration,sha256:hash(ownerConfiguration)},engineCommit:owner.sourceCommit,
  sourceHashes:Object.fromEntries(files.map(p=>[p,hash(join(root,p))])),offlineProof:{file:proofPath,sha256:hash(proofPath)},
  previousHost:{pid:58600,pinDirectoryName:'w4-rejection-runtime-pin',campaignId:'portal-20261103131442735-1'},bootIdentity:'1751589051509',
  objective:{goal:'Prove actual HMI operation on the same controlled browser shown in the ControlsBench portal. Choose your own plan and operate Start, Stop and Reset via request_hmi_action, not operator_action. Verify actual rendered pixels alongside independent PLC observations. Induce and clear a declared world fault as needed to test meaningful Reset and visible alarm/mode behavior. Finish Stopped, fault-free, without an active item or pending completion.',
    scope:'UI checkpoint; no carton introduction or sorting is needed. Test UI-01 through UI-04 using the accepted spec, attach an explicit pass/fail/inconclusive record_hmi_assessment for each, and a grounded record_finding. Do not claim stale/WCS-disconnect handling or transient command/feedback congruence from a healthy stationary screenshot.',
    discretion:`You choose labels, fault, order, observations and conclusions. At most ${maximumRequests} model turns including bounded pure-model retries; batch compatible calls and assessments when sensible. Do not click Start merely to use the allowance. Return useful findings even if one UI behavior is untestable.`,
    evidence:'Every turn includes actual fresh HMI pixels and, if available, the latest recorded action-result frame. Cite hmi.evidence event IDs for frameEvidenceRefs, hmi.action event IDs for actionEvidenceRefs, and plc.output event IDs for plcEvidenceRefs. Existing experiments are immutable. completeExperiment runs before calls; finish only after all experiments have evidence and assessments are recorded.',
    boundary:'No PLC code, source, physics or scan-rate change. No unrestricted browser navigation. Model-selected target labels are resolved immediately before real trusted CDP clicks. A click alone is not PLC acceptance. Interpret pixels yourself, keep injected fault truth separate, and do not retry uncertain physical actions.'},
  dataTransfer:'Conveyor spec, logical capabilities, live PLC observations/results, and actual controlled HMI frames are sent to Meta. Credentials stay in the local service environment; no credentials appear in HMI frames or the model context.',
  artifactRoot:join(directory,'host')};
writeFileSync(join(directory,'packet.json'),JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
writeFileSync(join(root,'artifacts/s2/latest-live.json'),JSON.stringify({directory,packetSha256:hash(join(directory,'packet.json'))},null,2)+'\n');
console.log(JSON.stringify({directory,packetSha256:hash(join(directory,'packet.json')),maximumRequests,conservativeNew:maximumRequests*5,priorConservative:total,realModelCalls:0,plcConnections:0}));
