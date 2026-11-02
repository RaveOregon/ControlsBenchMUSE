// Offline evidence capture. Run only against the dedicated fixture launcher; never live modes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {launch} from './lib/chrome.js';
const portal=process.argv[2] ?? 'http://127.0.0.1:5610';
const out=process.argv[3] ?? 'artifacts/w4-product-qa/capture';
assert.equal(new URL(portal).hostname,'127.0.0.1');
const host=await (await fetch(`${portal}/api/host`)).json();
assert.ok(['fixture-adaptive','wonder-recorded-stub'].includes(host.factory.id),'fixture factory required');
const hmi=new URL(host.hmi.url); assert.equal(hmi.hostname,'127.0.0.1');
const identity=await (await fetch(new URL('/api/identity',hmi))).json();
assert.equal(identity.source.kind,'fixture'); mkdirSync(out,{recursive:true});
const checks=[]; const check=(name,ok)=>checks.push({name,pass:!!ok});
const b=await launch({width:1440,height:1000});
try {
  for (const [name,url] of [['portal',portal],...['operation','alarms','engineering'].map(p=>[p,`${hmi.origin}/#/${p}`])]) {
    await b.cdp('Page.navigate',{url}); await b.waitFor('document.body.innerText.length > 100'); await new Promise(r=>setTimeout(r,1200));
    const body=await b.evaluate('document.body.innerText'); writeFileSync(`${out}/${name}.txt`,body); writeFileSync(`${out}/${name}.png`,await b.screenshot());
    if(name==='portal') {check('hosted portal',body.includes('ControlsBench Muse')); if(host.factory.id==='wonder-recorded-stub' && body.includes('COMPLETED')) {check('historical physical evidence label',body.includes('PRESERVED LIVE PLC · HISTORICAL')); check('recorded events marked',body.includes('PLC · RECORDED'));}}
    else {check(`${name}: fixture identity visible`,body.includes('FIXTURE · NOT A PLC')); check(`${name}: footer does not claim every value is an observed PLC sample`,!body.includes('Every value is an observed PLC sample.'));}
  }
  const current=await (await fetch(`${portal}/api/host`)).json(); const frame=current.hmi.lastFrame;
  if(frame) {const bytes=Buffer.from(await (await fetch(new URL(frame.mediaUrl,portal))).arrayBuffer()); check('capture SHA-256 matches frame bytes',createHash('sha256').update(bytes).digest('hex')===frame.sha256); writeFileSync(`${out}/hmi-frame.jpg`,bytes);}
  await b.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false}); await b.cdp('Page.navigate',{url:portal}); await b.waitFor('document.body.innerText.includes("ControlsBench Muse")'); await new Promise(r=>setTimeout(r,1200)); writeFileSync(`${out}/narrow.png`,await b.screenshot());
  const overflow=await b.evaluate('({viewport:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth})'); check('390px viewport has no page-wide overflow',overflow.scrollWidth<=overflow.viewport);
  writeFileSync(`${out}/result.json`,JSON.stringify({factory:host.factory,identity:identity.source,frame,overflow,checks,plcContacted:false,paidCalls:0},null,2)+'\n');
  console.log(JSON.stringify({out,checks:checks.length,failed:checks.filter(c=>!c.pass)}));
  if(checks.some(c=>!c.pass)) process.exitCode=1;
} finally {b.close();}
