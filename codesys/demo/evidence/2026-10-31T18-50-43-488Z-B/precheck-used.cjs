'use strict';
// Read-only precheck through the official installed CODESYS MCP bridge.
const {spawn}=require('node:child_process');
const {createInterface}=require('node:readline');
async function precheck(){
  const child=spawn('C:\\Program Files\\CODESYS 3.5.22.30\\CODESYS\\CODESYS MCP Server\\1.1.0.0\\CodesysMCPBridge\\CodesysMCPBridge.exe',
    [],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  const pending=new Map();let id=0;let stderr='';
  const fail=e=>{for(const p of pending.values())p.reject(e);pending.clear();};
  child.on('error',fail);
  child.on('exit',()=>fail(Error('Official MCP bridge exited before reply')));
  child.stderr.on('data',b=>{stderr+=b.toString();});
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    let m;try{m=JSON.parse(line);}catch{return;}
    const p=pending.get(m.id);if(!p)return;pending.delete(m.id);
    if(m.error)p.reject(Error(JSON.stringify(m.error)));else p.resolve(m.result);
  });
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    const n=++id;pending.set(n,{resolve,reject});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:n,method,params})+'\n');
  });
  const timeout=setTimeout(()=>{fail(Error('Official MCP precheck timed out after 25 s'));child.kill();},25000);
  try{
    const init=await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},
      clientInfo:{name:'controlsbench-m8-precheck',version:'1.0.0'}});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
    let ts=[];
    for(let i=0;i<10;i++){
      ts=(await request('tools/list')).tools||[];
      if(ts.length)break;await new Promise(r=>setTimeout(r,250));
    }
    const tool=ts.find(t=>t.name.replace(/_/g,'').toLowerCase().endsWith('checkforerrors'));
    if(!tool)throw Error('Official bridge tools unavailable: '+ts.map(t=>t.name).join(', '));
    const args={};
    for(const k of Object.keys(tool.inputSchema.properties)){
      const normalized=k.replace(/_/g,'').toLowerCase();
      if(normalized==='compile')args[k]=false;
      if(normalized==='path')args[k]='Device.Plc Logic.Application';
      if(normalized==='includewarnings')args[k]=true;
    }
    const response=await request('tools/call',{name:tool.name,arguments:args});
    const diagnostics=(response.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').trim();
    if(response.isError||diagnostics)throw Error('CODESYS precheck diagnostics: '+diagnostics);
    return {serverInfo:init.serverInfo,tool:tool.name,arguments:args,response,stderr:stderr.trim()||null};
  }finally{clearTimeout(timeout);lines.close();child.stdin.end();child.kill();}
}
module.exports={precheck};
if(require.main===module)precheck().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});

