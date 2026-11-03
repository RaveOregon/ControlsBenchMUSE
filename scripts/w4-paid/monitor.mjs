// Read-only compact monitor. Never query/serialize the live host's full report.
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const packetPath=resolve(process.argv[2]),packet=JSON.parse(readFileSync(packetPath,'utf8'));
const lastDir=p=>readdirSync(p,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort().at(-1);
const runs=join(packet.campaignArtifactRoot,'runs'),run=lastDir(runs),campaignRoot=join(runs,run,'portal-host');
if(!existsSync(campaignRoot)||!lastDir(campaignRoot)){console.log(JSON.stringify({phase:'initializing'}));process.exit(0);}
const directory=join(campaignRoot,lastDir(campaignRoot));
const lines=p=>{if(!existsSync(p))return [];const s=readFileSync(p,'utf8');return s.slice(0,s.lastIndexOf('\n')).split('\n').filter(Boolean).map(JSON.parse);};
const events=lines(join(directory,'campaign.jsonl')),after=Number(process.argv[3]??0);
const output=events.filter(x=>x.type==='plc.output').at(-1);
const exchanges=lines(join(directory,'wonder-exchanges.jsonl'));
console.log(JSON.stringify({directory,lastSequence:events.at(-1)?.sequence,lastAtIso:events.at(-1)?.atIso,
  events:events.filter(x=>x.sequence>after&&(x.type==='agent.request'||x.type==='campaign.state'||x.type==='agent.activity'&&x.data.phase==='decision_rejected'||/^(experiment\.|followup\.|finding\.|action\.(applied|rejected|timed_out|stale|inconclusive))/.test(x.type)))
    .map(x=>({sequence:x.sequence,type:x.type,...(x.type==='agent.request'?{requestId:x.data.requestId,phase:x.data.phase,elapsedMs:x.data.elapsedMs}:x.type==='action.applied'?{actionId:x.data.actionId,status:x.data.status,message:x.data.message}: {data:x.data})})),
  lastPlc:output&&Object.fromEntries(Object.entries(output.data.values).filter(([k])=>['Motor_RunCmd','controller.ModeText','controller.FaultCode','controller.ItemActive','controller.ActiveItemId','controller.OfferPending','controller.CompletionPending','controller.CompletionSequence','controller.CountExitA','controller.CountFaulted'].includes(k))),
  modelResponses:exchanges.filter(x=>x.phase==='response'&&x.endpoint==='responses').map(x=>{const r=JSON.parse(x.responseText);return{turn:x.turn,httpStatus:x.httpStatus,status:r.status,error:r.error,usage:r.usage,decisions:r.output?.filter(y=>y.type==='function_call').map(y=>{try{const d=JSON.parse(y.arguments);return{summary:d.summary,calls:d.calls.map(c=>({id:c.id,name:c.name})),completeExperiment:d.completeExperiment};}catch{return{invalidJson:true};}})};}),
  postRunRecorded:existsSync(join(directory,'held-state.json'))},null,2));
