// Real built frontend and disposable local MongoDB; no production environment files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const backend=path.resolve('../backend');
const require=createRequire(path.join(backend,'package.json'));
let source=await fs.readFile(path.join(backend,'tests/supplier-browser.integration.mjs'),'utf8');
const start=source.indexOf('  await login(owner.username);');
const end=source.indexOf("}catch(error){console.error('SUPPLIER INTEGRATION FAILED:'");
if(start<0||end<start)throw Error('Disposable browser harness changed; inspect before running');
const checks=String.raw`
  await login(owner.username);await navigation('/owner/sales');await wait('!!document.querySelector(".pos-search-panel")');
  const measurements=[];
  for(const [width,height,dpr,mode] of [[1920,1080,1,'browser'],[1366,768,1,'browser'],[1280,720,1,'browser'],[1366,650,1,'browser'],[1280,620,1,'browser'],[1280,600,1,'browser'],[1280,550,1,'browser'],[1280,540,1,'browser'],[390,844,3,'browser'],[1280,720,1,'standalone'],[1280,620,1,'standalone'],[1280,620,1.25,'browser']]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:dpr,mobile:width<500});
    await send('Emulation.setEmulatedMedia',{features:[{name:'display-mode',value:mode}]});await sleep(200);
    const measured=await evaluate('(()=>{const f=document.querySelector("#sale-form > fieldset"),p=document.querySelector(".pos-lines"),s=document.querySelector(".pos-search-panel");const visible=e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight};return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,standalone:matchMedia("(display-mode: standalone)").matches,desktop:matchMedia("(min-width:1100px) and (min-height:600px)").matches,columns:getComputedStyle(f).gridTemplateColumns,display:getComputedStyle(f).display,searchAbove:s.getBoundingClientRect().bottom<=p.getBoundingClientRect().top,horizontal:document.documentElement.scrollWidth>innerWidth,vertical:document.scrollingElement.scrollHeight>innerHeight+2,invoice:visible(p),search:visible(s),payments:visible(document.querySelector(".pos-payments")),checkout:visible(document.querySelector("button[form=sale-form]")),origin:location.origin,script:document.querySelector("script[type=module]").getAttribute("src")};})()');
    measured.requestedMode=mode;measurements.push(measured);
    assert.equal(measured.horizontal,false);
    if(width>=1100&&height>=600){assert.equal(measured.display,'grid');assert.equal(measured.searchAbove,false);assert.equal(measured.vertical,false);for(const key of ['invoice','search','payments','checkout'])assert.equal(measured[key],true,key);}
    else {assert.equal(measured.display,'flex');assert.equal(measured.searchAbove,true);}
  }
  console.log(JSON.stringify({measurements,standaloneVerified:measurements.some(m=>m.standalone),note:'An unsupported standalone emulation is not counted as an installed-PWA test.'},null,2));
`;
source=source.slice(0,start)+checks+source.slice(end);
source=source.replace(/(from\s*|import\()(['"])([^'"\n]+)\2/g,(all,prefix,quote,spec)=>{
 if(spec.startsWith('node:'))return all;
 const resolved=spec.startsWith('.')?path.resolve(backend,'tests',spec):require.resolve(spec);
 return prefix+quote+pathToFileURL(resolved).href+quote;
});
process.chdir(backend);
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
