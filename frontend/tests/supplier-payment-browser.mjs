// Real React/Chromium check. Every API request is intercepted; no backend is contacted.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createServer} from 'vite';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
let vite,chrome,ws,origin,seq=0;
const pending=new Map(),calls=[],runtimeErrors=[],unknown=[],supplier={_id:'507f1f77bcf86cd799439031',name:'Asghar test supplier',key:'asghar-test',phoneNo:'03000000001',roles:['SUPPLIER']};
const account={_id:'507f1f77bcf86cd799439032',name:'Counter cash',kind:'CASH',isActive:true,cashCutoverId:'prepared'};
let debt=3250000,funds=5000000,mode='ready',searchMode='ready',postMode='ready',holdPost=null,postedKeys=new Set();
const pagination={currentPage:1,totalPages:1,recordCount:1,limit:8};
function send(method,params={}){
 const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);
 pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){const until=Date.now()+12000;while(Date.now()<until){if(await evaluate(expression))return;await sleep(40);}throw Error('Timeout '+expression+'; '+await evaluate('document.body.innerText')+'; runtime='+runtimeErrors.join(' | '));}
async function key(key){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,...(type==='keyDown'&&key==='Enter'?{text:'\r',unmodifiedText:'\r',nativeVirtualKeyCode:13}:{}),windowsVirtualKeyCode:{Tab:9,Enter:13,Escape:27,ArrowDown:40,ArrowUp:38}[key]||0});}
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
 if(endpoint==='/accounts/financial'){await fulfill(event,200,{entries:[account],pagination});return;}
 if(endpoint==='/accounts/financial/'+account._id){await fulfill(event,200,{account,authoritative:true,balanceMinor:funds});return;}
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
 vite=await createServer({configFile:false,root:process.cwd(),logLevel:'error',plugins:[(await import('@vitejs/plugin-react')).default()],server:{host:'127.0.0.1',port:0},appType:'spa'});
 await vite.listen();origin='http://127.0.0.1:'+vite.httpServer.address().port;const debug=await port();
 fs.mkdirSync(path.join(process.cwd(),'node_modules/.cache'),{recursive:true});const profile=fs.mkdtempSync(path.join(process.cwd(),'node_modules/.cache/supplier-payment-'));
 chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+debug,'--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let pages;const deadline=Date.now()+15000;while(Date.now()<deadline){try{pages=await(await fetch('http://127.0.0.1:'+debug+'/json')).json();if(pages.some(p=>p.type==='page'))break;}catch{/* browser not ready yet; retry */}await sleep(50);}
 assert.ok(pages?.some(p=>p.type==='page'),'Chrome started');
 ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 ws.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}return;}
 if(m.method==='Fetch.requestPaused')mock(m.params).catch(e=>{if(!/Invalid InterceptionId/.test(e.message))runtimeErrors.push(e.message);});
 if(m.method==='Runtime.exceptionThrown')runtimeErrors.push(JSON.stringify(m.params.exceptionDetails));
 });
 await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'*'}]});
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:origin+'/owner/purchases'});await wait('!!document.querySelector(".purchase-nav summary")');
 await open();
 assert.equal(await evaluate('location.pathname'),'/owner/purchases');
 await key('Enter');assert.equal(calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/payments')).length,0,'search Enter cannot pay');
 await value('input[aria-label="Find supplier"]','nobody');await wait('document.querySelector("dialog[open]").innerText.includes("No matching suppliers")');
 await choose();assert.match(await evaluate('document.querySelector("dialog[open]").innerText'),/Supplier credit/);await accountSelect();
 assert.equal(await evaluate('document.querySelector("input[name=amount]").value'),'32500.00');
 await value('input[name=amount]','32500.01');await click('Review supplier payment');assert.equal(await evaluate('document.querySelectorAll("dialog.shop-dialog[open]").length'),1,'overpayment blocked');
 await value('input[name=amount]','500');await review();
 await key('Escape');await wait('document.querySelectorAll("dialog.shop-dialog[open]").length===1');
 await wait('document.activeElement.textContent.trim()==="Review supplier payment"');
 await review();
 debt-=100;await click('Confirm payment');await wait('document.querySelector("dialog[open]").innerText.includes("balance changed")');
 assert.equal(calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/payments')).length,0,'stale review sends no payment');
 await click('Refresh current data');await wait('!document.querySelector("dialog[open]").innerText.includes("balance changed")');await wait('!!document.querySelector("input[name=amount]:not(:disabled)")');
 await value('input[name=amount]','500');await review();postMode='hold';
 await evaluate('[...document.querySelectorAll("dialog[open] button")].find(b=>b.textContent==="Confirm payment").focus()');await key('Enter');await key('Enter');
 await evaluate('[...document.querySelectorAll("dialog[open] button")].find(b=>b.textContent==="Recording...")?.click()');
 await wait('document.querySelector("dialog[open] button:disabled")!==null');
 const holdDeadline=Date.now()+10000;while(!holdPost&&Date.now()<holdDeadline)await sleep(30);assert.ok(holdPost);
 assert.equal(calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/payments')).length,1,'repeated Enter posts once');
 await fulfill(holdPost,200,{settlement:{reference:'SP-1'}});postMode='ready';
 await wait('document.querySelector("dialog[open]").innerText.includes("Supplier payment recorded")');
 await wait('document.querySelector("dialog[open]").innerText.includes("31,999.00")');
 for(let i=0;i<15;i++){await key('Tab');assert.equal(await evaluate('!!document.activeElement.closest("dialog[open]")'),true,'focus stays in modal');}
 await close();
 // Same quick action on another route, failed lookup, guarded unknown balance.
 await send('Page.navigate',{url:origin+'/owner/account'});await wait('!!document.querySelector(".purchase-nav summary")');searchMode='error';await open();
 await wait('document.querySelector("dialog[open]").innerText.includes("Retry supplier search")');searchMode='ready';await click('Retry supplier search');
 await choose();await close();mode='unknown';await open();await value('input[aria-label="Find supplier"]','asghar');await wait('document.querySelectorAll("[role=option]").length===1');await key('ArrowDown');await key('Enter');
 await wait('document.querySelector("dialog[open]").innerText.includes("Confirm previous supplier balance")');
 assert.equal(await evaluate('!!document.querySelector("input[name=amount]")'),false);
 assert.ok(await evaluate('[...document.querySelectorAll("dialog[open] a")].some(a=>a.textContent==="Open supplier setup")'));await close();
 // Lost response: preserve exact request key for retry; closing cannot discard it.
 mode='ready';await open();await choose();await accountSelect();await value('input[name=amount]','100');await review();postMode='network';await click('Confirm payment');
 await wait('document.querySelectorAll("dialog[open]").length===2 && [...document.querySelectorAll("dialog[open]")].at(-1).innerText.includes("result is uncertain")');
 await key('Escape');assert.equal(await evaluate('document.querySelectorAll("dialog.shop-dialog[open]").length'),2,'uncertain request cannot be dismissed');
 const original=calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/payments')).at(-1).body;
 postMode='ready';await click('Retry same request');await wait('document.querySelectorAll("dialog.shop-dialog[open]").length===1');
 assert.deepEqual(calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/payments')).at(-1).body,original,'retry uses the exact saved request');
 assert.equal(postedKeys.size,2);assert.equal(debt,3189900,'lost successful response and replay do not debit twice');
 await close();
 // Mobile drawer focus restoration.
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate("document.querySelector('.mobile-brand-bar button').click()");await wait('document.querySelector("#shop-navigation").matches(":modal")');
 await open();await close();assert.ok(await evaluate('document.querySelector("#shop-navigation").matches(":modal")'));
 assert.deepEqual(unknown,[]);assert.deepEqual(runtimeErrors,[]);
 console.log('PASS: mocked Chromium supplier quick payment, two routes, mobile, keyboard/focus trap, lookups, validation, stale review, repeated Enter, safe retry, guarded setup.');
}finally{
 if(ws?.readyState===1){try{await send('Browser.close');}catch{ws.close();}}
 chrome?.kill();await vite?.close();
 if(oldApi===undefined)delete process.env.VITE_API_BASE_URL;else process.env.VITE_API_BASE_URL=oldApi;
}
