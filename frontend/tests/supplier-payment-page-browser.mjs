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
const otherSupplier={...supplier,_id:'507f1f77bcf86cd799439034',name:'Second test supplier',key:'second'};
const nonSupplier={...supplier,_id:'507f1f77bcf86cd799439035',roles:['CUSTOMER']};
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
 if(endpoint.startsWith('/accounts/entities/')){const id=endpoint.split('/').at(-1),entity=[supplier,otherSupplier,nonSupplier].find(s=>s._id===id);await fulfill(event,entity?200:404,entity,'Supplier not found');return;}
 if(endpoint==='/orders/payment-accounts'){await fulfill(event,200,{accountingEnabled:true,accounts:[account]});return;}
 if(endpoint==='/accounts/financial/payable/history'){await fulfill(event,200,{transactions:[],pagination,balanceMinor:debt,currency:'PKR'});return;}
 if(endpoint.endsWith('/settlements')){await fulfill(event,200,{entries:[],pagination});return;}
 if(endpoint==='/accounts/entities'){
   if(searchMode==='error'){await fulfill(event,503,null,'Supplier search unavailable. Try again.');return;}
   const q=(url.searchParams.get('q')||'').toLowerCase();const entries=[supplier,otherSupplier].filter(s=>[s.name,s.phoneNo,s.key].some(x=>x.toLowerCase().includes(q)));
   await fulfill(event,200,{entries,pagination:{...pagination,recordCount:entries.length}});return;
 }
 if(endpoint.endsWith('/reconciliation')){
   if(mode==='error'){await fulfill(event,503,null,'Balance unavailable');return;}
   await fulfill(event,200,mode==='unknown'?{authoritative:false,cutover:null,issues:[{problem:'Supplier payable cutover requires explicit owner review'}]}:{authoritative:true,cutover:{_id:'opening'},issues:[],balanceMinor:endpoint.includes(otherSupplier._id)?200000:debt,creditMinor:10000,accountId:'payable'});return;
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
 await send('Page.navigate',{url:origin+'/owner/accounts/suppliers/'+supplier._id});await wait('!!document.querySelector(".purchase-nav summary")');
 // Supplier Details keeps records, credit, setup and returns; payment moved out.
 await wait('document.querySelector("main")?.innerText?.includes("Asghar test supplier")');
 await wait('document.querySelector("main")?.innerText?.includes("Outstanding:")');
 assert.equal(await evaluate('!!document.querySelector("main [data-supplier-payment]")'),false);
 assert.equal(await evaluate('[...document.querySelectorAll("main a")].some(a=>a.getAttribute("href")==="#supplier-payment")'),false);
 const paymentLink='.supplier-nav a[href*="/suppliers/pay"]';
 const href=await evaluate('document.querySelector('+JSON.stringify(paymentLink)+').getAttribute("href")');
 assert.ok(href.endsWith('?supplierId='+supplier._id),'Supplier menu retains the current supplier');
 await evaluate('(()=>{let e=document.querySelector(".supplier-nav");while(e){if(e.tagName==="DETAILS")e.open=true;e=e.parentElement;}[...document.querySelector(".supplier-nav").querySelectorAll("a")].find(a=>a.href.includes("/suppliers/pay")).click();})()');
 await wait('location.pathname==="/owner/accounts/suppliers/pay"');
 await wait('document.querySelector("main")?.innerText?.includes("PKR 32,500.00")');
 assert.ok(await evaluate('document.querySelector("main")?.innerText?.includes("Asghar test supplier")'));
 assert.equal(await evaluate('document.querySelectorAll("dialog.shop-dialog[open]").length'),0,'payment is a separate page, not a quick-action overlay');
 // Exercise the unchanged shared form and endpoint using intercepted requests.
 await evaluate('document.querySelector("main [data-supplier-payment] details summary").click()');
 await wait('[...document.querySelectorAll("main [data-supplier-payment] button")].some(b=>b.textContent==="Counter cash (CASH)")');
 await evaluate('[...document.querySelectorAll("main [data-supplier-payment] button")].find(b=>b.textContent==="Counter cash (CASH)").click()');
 await wait('!!document.querySelector("input[name=amount]:not(:disabled)")');
 assert.equal(await evaluate('document.querySelector("input[name=amount]").value'),'32500.00');
 await value('input[name=amount]','100');
 await evaluate('[...document.querySelectorAll("main button")].find(b=>b.textContent==="Review supplier payment").click()');
 await wait('!!document.querySelector("dialog.shop-dialog[open]")');
 await evaluate('(()=>{const b=[...document.querySelectorAll("dialog[open] button")].find(b=>b.textContent==="Confirm payment");b.click();b.click();})()');
 await wait('document.querySelector("main")?.innerText?.includes("Supplier payment recorded")');
 await wait('document.querySelector("main")?.innerText?.includes("PKR 32,400.00")');
 const posts=calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/payments'));
 assert.equal(posts.length,1);assert.equal(posts[0].endpoint,'/accounts/suppliers/'+supplier._id+'/payments');assert.equal(posts[0].body.amountMinor,10000);assert.equal(posts[0].body.accountId,account._id);
 const selectedUrl=await evaluate('location.href');
 await send('Page.navigate',{url:selectedUrl});await wait('document.querySelector("main")?.innerText?.includes("PKR 32,400.00")');
 assert.ok(await evaluate('document.querySelector("main")?.innerText?.includes("Asghar test supplier")'),'reload preserves supplier selection');
 await evaluate('[...document.querySelectorAll("main button")].find(b=>b.textContent==="Choose another supplier").click()');
 await wait('!!document.querySelector("main input[role=combobox]")');
 await value('input[aria-label="Find supplier"]','Second');await wait('document.querySelectorAll("[role=option]").length===1');await key('ArrowDown');await key('Enter');
 await wait('location.search.includes('+JSON.stringify(otherSupplier._id)+')');
 await wait('document.querySelector("main")?.innerText?.includes("Second test supplier")&&document.querySelector("main")?.innerText?.includes("PKR 2,000.00")');
 await send('Page.navigate',{url:origin+'/owner/accounts/suppliers/pay?supplierId=invalid'});await wait('document.querySelector("main")?.innerText?.includes("Choose a valid supplier")');
 assert.equal(await evaluate('!!document.querySelector("main [data-supplier-payment]")'),false);
 await send('Page.navigate',{url:origin+'/owner/accounts/suppliers/pay?supplierId='+nonSupplier._id});await wait('document.querySelector("main")?.innerText?.includes("This business is not a supplier")');
 assert.equal(await evaluate('!!document.querySelector("main [data-supplier-payment]")'),false);
 mode='unknown';await send('Page.navigate',{url:origin+'/owner/accounts/suppliers/pay?supplierId='+supplier._id});await wait('document.querySelector("main")?.innerText?.includes("Confirm previous supplier balance")');
 assert.equal(await evaluate('!!document.querySelector("main [data-supplier-payment]")'),false);
 assert.equal(calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/payments')).length,1);
 await send('Page.navigate',{url:origin+'/owner/account'});await wait('!!document.querySelector(".supplier-nav")');
 const unselectedHref=await evaluate('document.querySelector('+JSON.stringify(paymentLink)+').getAttribute("href")');assert.equal(unselectedHref,'/owner/accounts/suppliers/pay');
 assert.deepEqual(runtimeErrors,[]);assert.deepEqual(unknown,[]);
 console.log('PASS: Supplier menu ? payment page; supplier context/reload/search preserved; Supplier Details payment removed; shared payment confirms once and refreshes balance; invalid/non-supplier/incomplete setup blocked. APIs mocked.');

}finally{
 if(ws?.readyState===1){try{await send('Browser.close');}catch{ws.close();}}
 chrome?.kill();await vite?.close();
 if(oldApi===undefined)delete process.env.VITE_API_BASE_URL;else process.env.VITE_API_BASE_URL=oldApi;
}
