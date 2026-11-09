// Real React/Chromium check. Every API request is intercepted; no backend is contacted.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
let vite,chrome,ws,origin,seq=0;
const sequenceLog=[];
const pending=new Map(),calls=[],runtimeErrors=[],unknown=[],supplier={_id:'507f1f77bcf86cd799439031',name:'Asghar test supplier',key:'asghar-test',phoneNo:'03000000001',roles:['SUPPLIER']};
const account={_id:'507f1f77bcf86cd799439032',name:'main cash',kind:'CASH',isActive:true,cashCutoverId:'prepared'};
const bank={...account,_id:'507f1f77bcf86cd799439033',name:'HBL',kind:'BANK'};
let debt=3250000,funds=5000000,mode='ready',searchMode='ready',postMode='ready',holdPost=null,postedKeys=new Set();
const pagination={currentPage:1,totalPages:1,recordCount:1,limit:8};
function send(method,params={}){
 const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);
 pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){const until=Date.now()+12000;while(Date.now()<until){if(await evaluate(expression))return;await sleep(40);}throw Error('Timeout '+expression+'; '+await evaluate('document.body.innerText')+'; runtime='+runtimeErrors.join(' | '));}
async function key(key,shift=false){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key===' '?'Space':key,modifiers:shift?8:0,...(type==='keyDown'&&key==='Enter'?{text:'\r',unmodifiedText:'\r',nativeVirtualKeyCode:13}:{}),windowsVirtualKeyCode:{' ':32,Tab:9,Enter:13,Escape:27,ArrowDown:40,ArrowUp:38}[key]||0});}
async function value(selector,text){await wait('!!document.querySelector('+JSON.stringify(selector)+')');await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.focus();e.dispatchEvent(new Event("input",{bubbles:true}));})()');}
async function click(text){await evaluate('(()=>{const b=[...document.querySelectorAll("dialog[open] button")].reverse().find(b=>b.textContent.trim()==='+JSON.stringify(text)+'&&!b.disabled);if(!b)throw Error("Button missing: "+'+JSON.stringify(text)+');b.focus();b.click();})()');}
async function fulfill(event,status,data,message='OK'){
 await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Credentials',value:'true'},{name:'Access-Control-Allow-Headers',value:'Content-Type'},{name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],body:Buffer.from(JSON.stringify(status>=400?{message}:{data,messege:message})).toString('base64')});
}
async function mock(event){
 const req=event.request,url=new URL(req.url);
 if(!url.pathname.startsWith('/api/v2')){
   if(url.origin===origin){await send('Fetch.continueRequest',{requestId:event.requestId});return;}
   await send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'});return;
 }
 const endpoint=url.pathname.slice(7),body=req.postData?.startsWith('{')?JSON.parse(req.postData):{};calls.push({endpoint,method:req.method,body});
 if(req.method==='OPTIONS'){await fulfill(event,200,{});return;}
 if(endpoint==='/users/current-user'){await fulfill(event,200,{shopActive:true,subscriptionExpiry:'2099-01-01T00:00:00Z',shopName:'Isolated test shop',user:{_id:'507f1f77bcf86cd799439030',username:'Owner',email:'owner@example.test',role:'OWNER'}});return;}
 if(endpoint==='/accounts/entities'){
   if(searchMode==='error'){await fulfill(event,503,null,'Supplier search unavailable. Try again.');return;}
   const q=(url.searchParams.get('q')||'').toLowerCase();const entries=[supplier].filter(s=>[s.name,s.phoneNo,s.key].some(x=>x.toLowerCase().includes(q)));
   await fulfill(event,200,{entries,pagination:{...pagination,recordCount:entries.length}});return;
 }
 if(endpoint.endsWith('/reconciliation')){
   if(mode==='error'){await fulfill(event,503,null,'Balance unavailable');return;}
   await fulfill(event,200,mode==='unknown'?{authoritative:false,cutover:null,issues:[{problem:'Supplier payable cutover requires explicit owner review'}]}:{authoritative:true,cutover:{_id:'opening'},issues:[],balanceMinor:debt,creditMinor:10000,accountId:'payable'});return;
 }
 if(endpoint==='/accounts/financial'){await fulfill(event,200,{entries:[bank,account],pagination});return;}
 if((endpoint==='/accounts/financial/'+account._id||endpoint==='/accounts/financial/'+bank._id)){await fulfill(event,200,{account,authoritative:true,balanceMinor:funds});return;}
 if(endpoint==='/accounts/suppliers/'+supplier._id+'/payments'){
   if(postMode==='network'){if(!postedKeys.has(body.requestKey)){postedKeys.add(body.requestKey);debt-=body.amountMinor;funds-=body.amountMinor;}await send('Fetch.failRequest',{requestId:event.requestId,errorReason:'ConnectionReset'});return;}
   if(!postedKeys.has(body.requestKey)){postedKeys.add(body.requestKey);debt-=body.amountMinor;funds-=body.amountMinor;}
   if(postMode==='hold'){holdPost=event;return;}
   await fulfill(event,200,{settlement:{reference:'SP-1'}});return;
 }
 if(endpoint.startsWith('/purchases')){await fulfill(event,200,{entries:[],pagination:{...pagination,recordCount:0}});return;}
 unknown.push(endpoint);await fulfill(event,404,null,'Unexpected mocked endpoint');
}
async function open(){
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 await evaluate('document.querySelector(".purchase-nav summary").focus()');await key('ArrowDown');
 await wait('document.activeElement.textContent.trim()==="Purchase orders"');await key('ArrowDown');await wait('document.activeElement.textContent.trim()==="Pay supplier"');await key('Enter');
 await wait('document.activeElement.getAttribute("aria-label")==="Find supplier"');
}
async function choose(){
 await value('input[aria-label="Find supplier"]','03000000001');await wait('document.querySelectorAll("[role=option]").length===1');
 await key('ArrowDown');await key('Enter');await wait('document.querySelector("dialog[open]").innerText.includes("Outstanding")');
}
async function accountSelect(){
 assert.equal(await evaluate('!!document.querySelector("input[name=amount]")'),false,'no default account');
 await evaluate('document.querySelector("[data-supplier-payment] details summary").focus()');await key('Enter');
 await wait('[...document.querySelectorAll("[data-supplier-payment] button")].some(b=>b.textContent.includes("Counter cash"))');
 await click('Counter cash (CASH)');await wait('!!document.querySelector("input[name=amount]:not(:disabled)")');
}
async function review(){
 await click('Review supplier payment');await wait('[...document.querySelectorAll("dialog[open]")].some(d=>d.innerText.includes("Expected outstanding after payment"))');
}
async function close(){
 await key('Escape');await wait('!document.querySelector("dialog.shop-dialog[open]")');
 await wait('document.activeElement===document.querySelector(".purchase-nav summary")');
}
const oldApi=process.env.VITE_API_BASE_URL;
process.env.VITE_API_BASE_URL='http://localhost:3000/api/v2';
try{
 origin='http://localhost:5173';const debug=await port();
 fs.mkdirSync(path.join(process.cwd(),'node_modules/.cache'),{recursive:true});const profile=fs.mkdtempSync(path.join(process.cwd(),'node_modules/.cache/supplier-payment-'));
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+debug,'--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let pages;const deadline=Date.now()+15000;while(Date.now()<deadline){try{pages=await(await fetch('http://127.0.0.1:'+debug+'/json')).json();if(pages.some(p=>p.type==='page'))break;}catch{}await sleep(50);}
 assert.ok(pages?.some(p=>p.type==='page'),'Chrome started');
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
 if(m.method==='Fetch.requestPaused')mock(m.params).catch(e=>{if(!/Invalid InterceptionId/.test(e.message))runtimeErrors.push(e.message);});
 if(m.method==='Runtime.exceptionThrown')runtimeErrors.push(JSON.stringify(m.params.exceptionDetails));
 });
 await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/owner/account'});await wait('!!document.querySelector(".purchase-nav summary")');
 async function label(){return evaluate('document.activeElement.getAttribute("aria-label")||document.activeElement.textContent.trim()');}
 async function expect(text){await wait('(document.activeElement.getAttribute("aria-label")||document.activeElement.textContent.trim())==='+JSON.stringify(text));}
 async function style(selector){return evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+'),s=getComputedStyle(e),r=e.getBoundingClientRect(),p=e.closest(".navigation-overflow").getBoundingClientRect();return {focusVisible:e.matches(":focus-visible"),outlineStyle:s.outlineStyle,outlineColor:s.outlineColor,outlineWidth:s.outlineWidth,outlineOffset:s.outlineOffset,borderRadius:s.borderRadius,background:s.backgroundColor,inside:r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom}})()');}
 for(let i=0;i<25&&await label()!=='Purchases menu';i++)await key('Tab');
 await expect('Purchases menu');await key('Enter');await key('Tab');await expect('Purchase orders');
 const order=await style('.purchase-nav a');
 await key('Tab');await expect('Pay supplier');const pay=await style('.purchase-nav button');
 assert.deepEqual(pay,order,'link and button have identical visible keyboard focus styling');
 assert.equal(pay.focusVisible,true);assert.equal(pay.outlineStyle,'solid');assert.equal(pay.outlineColor,'rgb(15, 118, 110)');
 assert.equal(pay.outlineWidth,'2px');assert.equal(pay.outlineOffset,'-2px');assert.equal(pay.borderRadius,'4px');assert.equal(pay.inside,true);
 function luminance(rgb){return rgb.map(x=>{x/=255;return x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;}).reduce((sum,x,i)=>sum+x*[0.2126,0.7152,0.0722][i],0);}
 const contrast=(luminance([230,245,241])+0.05)/(luminance([15,118,110])+0.05);
 assert.ok(contrast>=3,'focus outline has at least 3:1 contrast against its highlighted background');
 await key('Tab',true);await expect('Purchase orders');await key('Tab');await expect('Pay supplier');await key('Tab');await expect('Customers menu');
 await key('Enter');await key('Tab');await expect('Customer accounts');
 const customer=await style('.customer-nav a');assert.equal(customer.outlineColor,pay.outlineColor);assert.equal(customer.outlineWidth,pay.outlineWidth);await key('Escape');
 // Use real pointer events and check focus before click activation.
 async function mouseDown(selector){
   const point=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
   await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
   await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...point});return point;
 }
 async function mouseUp(point){await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...point});}
 await mouseUp(await mouseDown('.purchase-nav summary'));await wait('document.querySelector(".purchase-nav").open');
 let point=await mouseDown('.purchase-nav a');let pointer=await style('.purchase-nav a');assert.equal(pointer.focusVisible,false);await mouseUp(point);
 await wait('location.pathname==="/owner/purchases"');
 await mouseUp(await mouseDown('.purchase-nav summary'));await wait('document.querySelector(".purchase-nav").open');
 point=await mouseDown('.purchase-nav button');pointer=await style('.purchase-nav button');assert.equal(pointer.focusVisible,false);assert.equal(pointer.outlineStyle,'none');
 await mouseUp(point);await expect('Find supplier');await key('Escape');await expect('Purchases menu');
 assert.deepEqual(runtimeErrors,[]);assert.deepEqual(unknown,[]);
 assert.equal(calls.some(c=>c.method==='POST'&&c.endpoint.endsWith('/payments')),false);
 console.log('PASS: matching teal 2px inset focus indicators; no clipping; contrast '+contrast.toFixed(2)+':1; native Tab/Shift+Tab; shared dropdown styling; normal mouse link/button activation without keyboard outlines.');

}finally{
 if(ws?.readyState===1){try{await send('Browser.close');}catch{ws.close();}}
 chrome?.kill();await vite?.close();
 if(oldApi===undefined)delete process.env.VITE_API_BASE_URL;else process.env.VITE_API_BASE_URL=oldApi;
}
