import {writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {launch} from './lib/chrome.js';
const directory=resolve(process.argv[2]??'docs/submission-diagrams');
const browser=await launch({width:1920,height:1080}),files=[];
try{
  for(const name of ['controlsbench-architecture','controlsbench-live-loop','controlsbench-plc-integration']){
    await browser.navigate(join(directory,name+'.svg'));
    if(!await browser.waitFor('Boolean(document.querySelector("svg"))'))throw Error('SVG did not load');
    await browser.evaluate('document.fonts.ready.then(()=>true)');
    writeFileSync(join(directory,name+'.png'),await browser.screenshot());
    for(const ext of ['svg','png'])files.push({file:name+'.'+ext,sha256:createHash('sha256').update(readFileSync(join(directory,name+'.'+ext))).digest('hex')});
  }
  writeFileSync(join(directory,'render-manifest.json'),JSON.stringify({renderedAtIso:new Date().toISOString(),width:1920,height:1080,files},null,2)+'\n');
}finally{browser.close();}
