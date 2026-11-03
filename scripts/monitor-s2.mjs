import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
const packet=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8')),after=Number(process.argv[3]??0);
const lastDir=p=>existsSync(p)?readdirSync(p,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>x.name).sort().at(-1):undefined;
const run=lastDir(join(packet.artifactRoot,'runs'));if(!run){console.log(JSON.stringify({phase:'no-run'}));process.exit(0);}
const host=join(packet.artifactRoot,'runs',run,'portal-host'),id=lastDir(host);if(!id){console.log(JSON.stringify({phase:'no-campaign'}));process.exit(0);}
const directory=join(host,id),lines=p=>{if(!existsSync(p))return[];const s=readFileSync(p,'utf8');return s.slice(0,s.lastIndexOf('\n')).split('\n').filter(Boolean).map(JSON.parse);};
const events=lines(join(directory,'campaign.jsonl')),output=events.filter(e=>e.type==='plc.output').at(-1),exchanges=lines(join(directory,'wonder-exchanges.jsonl'));
console.log(JSON.stringify({directory,sequence:events.at(-1)?.sequence,atIso:events.at(-1)?.atIso,
  events:events.filter(e=>e.sequence>after&&(/^(hmi\.action|hmi\.assessment|agent\.request|campaign\.state|experiment\.|finding\.|action\.(applied|rejected|inconclusive|timed_out))/.test(e.type))).map(e=>({sequence:e.sequence,type:e.type,data:e.data})),
  lastPlc:output&&Object.fromEntries(Object.entries(output.data.values).filter(([k])=>['Motor_RunCmd','controller.ModeText','controller.FaultCode','controller.ItemActive','controller.CompletionPending'].includes(k))),
  visionInputs:exchanges.filter(e=>e.phase==='vision.input').map(e=>({turn:e.turn,evidenceId:e.evidenceId,reference:e.reference,sha256:e.sha256,recorded:e.recorded})),
  latestResponse:exchanges.filter(e=>e.phase==='response'&&e.endpoint==='responses').slice(-1).map(e=>{const r=JSON.parse(e.responseText);return{turn:e.turn,httpStatus:e.httpStatus,status:r.status,error:r.error,usage:r.usage,decisions:r.output?.filter(x=>x.type==='function_call').map(x=>JSON.parse(x.arguments))};}),
  postRunRecorded:existsSync(join(directory,'result.json'))},null,2));
