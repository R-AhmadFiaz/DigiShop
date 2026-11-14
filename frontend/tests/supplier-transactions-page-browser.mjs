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
const accountA='507f1f77bcf86cd799439041',accountB='507f1f77bcf86cd799439042';
let debt=3250000,funds=5000000,mode='ready',searchMode='ready',postMode='ready',holdPost=null,postedKeys=new Set();
const pagination={currentPage:1,totalPages:1,recordCount:1,limit:8};
function send(method,params={}){
 const id=++seq;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout '+method));},15000);
 pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id,method,params}));});
}
async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
async function wait(expression){const until=Date.now()+12000;while(Date.now()<until){if(await evaluate(expression))return;await sleep(40);}throw Error('Timeout '+expression+'; '+await evaluate('document.body.innerText')+'; runtime='+runtimeErrors.join(' | '));}
async function key(key){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code:key,...(type==='keyDown'&&key==='Enter'?{text:'\r',unmodifiedText:'\r',nativeVirtualKeyCode:13}:{}),windowsVirtualKeyCode:{Tab:9,Enter:13,Escape:27,ArrowDown:40,ArrowUp:38}[key]||0});}
async function value(selector,text){await wait('!!document.querySelector('+JSON.stringify(selector)+')');await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,'+JSON.stringify(text)+');e.focus();e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()');}
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
 const endpoint=url.pathname.slice(7),body=req.postData?.startsWith('{')?JSON.parse(req.postData):{};calls.push({endpoint,search:url.search,method:req.method,body});
 if(req.method==='OPTIONS'){await fulfill(event,200,{});return;}
 if(endpoint==='/users/current-user'){await fulfill(event,200,{shopActive:true,subscriptionExpiry:'2099-01-01T00:00:00Z',shopName:'Isolated test shop',user:{_id:'507f1f77bcf86cd799439030',username:'Owner',email:'owner@example.test',role:'OWNER'}});return;}
 if(endpoint.startsWith('/accounts/entities/')){const id=endpoint.split('/').at(-1),entity=[supplier,otherSupplier,nonSupplier].find(s=>s._id===id);await fulfill(event,entity?200:404,entity,'Supplier not found');return;}
 if(endpoint==='/orders/payment-accounts'){await fulfill(event,200,{accountingEnabled:true,accounts:[account]});return;}
 if(endpoint==='/accounts/financial/payable/history'){await fulfill(event,200,{transactions:[],pagination,balanceMinor:debt,currency:'PKR'});return;}
 if(endpoint.endsWith('/settlements')){await fulfill(event,200,{entries:[],pagination});return;}

 if(endpoint.startsWith('/accounts/financial/')&&endpoint.includes('/history')){
   const accountId=endpoint.split('/')[3],isA=accountId===accountA,isB=accountId===accountB;
   if(!isA&&!isB){unknown.push(endpoint);await fulfill(event,404,null,'Wrong supplier account');return;}
   const page=Number(url.searchParams.get('page')||1),suffix=isA?'A':'B';
   const transaction={eventId:(isA?'event-a':'event-b')+(page===2?'-2':''),eventType:'SUPPLIER_PAYMENT',occurredAt:'2026-01-02T10:00:00Z',recordedAt:'2026-01-02T10:00:00Z',amountMinor:10000,
     accountPosting:{balanceDeltaMinor:-10000},runningBalanceMinor:isA?3240000:190000,actor:{name:'Test owner'},
     sourceDocument:{purchaseOrderId:'507f1f77bcf86cd799439061',reference:'PO-'+suffix+(page===2?'-2':'')},
     reason:'Read-only supplier '+suffix,postings:[{accountId,account:{name:'Supplier '+suffix},debitMinor:10000,creditMinor:0,moneyInMinor:0,moneyOutMinor:0}]};
   const data=endpoint.split('/history')[1]?{transaction}:{transactions:[transaction],pagination:{currentPage:page,totalPages:2,recordCount:21,limit:20},currency:'PKR',balanceMinor:isA?debt:200000,rangeOpeningBalanceMinor:3250000,rangeClosingBalanceMinor:3240000};
   await fulfill(event,200,data);return;
 }

 if(endpoint==='/accounts/entities'){
   if(searchMode==='error'){await fulfill(event,503,null,'Supplier search unavailable. Try again.');return;}
   const q=(url.searchParams.get('q')||'').toLowerCase();const entries=[supplier,otherSupplier].filter(s=>[s.name,s.phoneNo,s.key].some(x=>x.toLowerCase().includes(q)));
   await fulfill(event,200,{entries,pagination:{...pagination,recordCount:entries.length}});return;
 }
 if(endpoint.endsWith('/reconciliation')){
   if(mode==='error'){await fulfill(event,503,null,'Balance unavailable');return;}
   await fulfill(event,200,mode==='unknown'?{authoritative:false,cutover:null,issues:[{problem:'Supplier payable cutover requires explicit owner review'}]}:{authoritative:true,cutover:{_id:'opening'},issues:[],balanceMinor:endpoint.includes(otherSupplier._id)?200000:debt,creditMinor:10000,accountId:endpoint.includes(otherSupplier._id)?accountB:accountA});return;
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
 await wait('document.querySelector("main")?.innerText?.includes("Outstanding:")');
 assert.equal(await evaluate('document.querySelector("main").innerText.includes("Supplier transactions")'),false,'Supplier Details no longer renders the relocated table');
 assert.ok(await evaluate('document.querySelector("main").innerText.includes("Purchases")'),'other supplier sections remain');
 const link='.supplier-nav a[href*="/suppliers/transactions"]';
 assert.ok((await evaluate('document.querySelector('+JSON.stringify(link)+').getAttribute("href")')).endsWith('?supplierId='+supplier._id));
 await evaluate('(()=>{let e=document.querySelector(".supplier-nav");while(e){if(e.tagName==="DETAILS")e.open=true;e=e.parentElement;}[...document.querySelector(".supplier-nav").querySelectorAll("a")].find(a=>a.href.includes("/suppliers/transactions")).click();})()');
 await wait('location.pathname==="/owner/accounts/suppliers/transactions"');
 await wait('document.querySelector("main")?.innerText?.includes("PO-A")');
 assert.equal(await evaluate('document.querySelector("main").innerText.includes("PO-B")'),false);
 assert.ok(await evaluate('[...document.querySelectorAll("main th")].some(e=>e.textContent==="Running balance")'));
 assert.ok(await evaluate('[...document.querySelectorAll("main a")].some(e=>e.textContent==="PO-A"&&e.getAttribute("href")==="/owner/purchases/507f1f77bcf86cd799439061")'));
 await evaluate('[...document.querySelectorAll("main button")].find(b=>b.textContent==="Details").click()');
 await wait('document.querySelector("dialog[open]")?.innerText?.includes("Read-only supplier A")');
 assert.ok(calls.some(c=>c.endpoint==='/accounts/financial/'+accountA+'/history/event-a'));
 await key('Escape');await wait('!document.querySelector("dialog.shop-dialog[open]")');
 await evaluate('[...document.querySelectorAll("main summary")].find(s=>s.textContent==="Search and date filters").click()');
 await value('main input[placeholder="Reference, activity or actor"]','Owner');
 await wait('location.search.includes("stSearch=Owner")');
 await wait('!!document.querySelector("main .record-register")');
 await value('main input[type=date]','2026-01-01');
 await evaluate('(()=>{const e=document.querySelectorAll("main input[type=date]")[1];Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"2026-01-03");e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));const type=document.querySelector("main select");type.value="SUPPLIER_PAYMENT";type.dispatchEvent(new Event("change",{bubbles:true}));})()');
 await wait('location.search.includes("stType=SUPPLIER_PAYMENT")&&location.search.includes("stFrom=2026-01-01")&&location.search.includes("stTo=2026-01-03")');
 const filterDeadline=Date.now()+12000;while(Date.now()<filterDeadline&&!calls.some(c=>c.endpoint==='/accounts/financial/'+accountA+'/history'&&new URLSearchParams(c.search).get('q')==='Owner'&&new URLSearchParams(c.search).get('type')==='SUPPLIER_PAYMENT'))await sleep(40);
 await wait('!!document.querySelector("main .record-register")&&![...document.querySelectorAll("main p")].some(p=>p.textContent==="Loading...")');
 await evaluate('[...document.querySelectorAll("main .list-pagination button")].find(b=>b.textContent.trim()==="Next").click()');
 await wait('document.querySelector("main")?.innerText?.includes("PO-A-2")');
 const request=calls.filter(c=>c.endpoint==='/accounts/financial/'+accountA+'/history'&&c.search.includes('page=2')).at(-1);
 assert.ok(request);const filters=new URLSearchParams(request.search);
 assert.equal(filters.get('q'),'Owner');assert.equal(filters.get('from'),'2026-01-01T00:00:00.000Z');assert.equal(filters.get('to'),'2026-01-03T00:00:00.000Z');assert.equal(filters.get('type'),'SUPPLIER_PAYMENT');
 const url=await evaluate('location.href');await send('Page.navigate',{url});await wait('document.querySelector("main")?.innerText?.includes("PO-A-2")');
 await evaluate('[...document.querySelectorAll("main button")].find(b=>b.textContent==="Choose another supplier").click()');
 await wait('!!document.querySelector("main input[role=combobox]")');
 await value('main input[role=combobox]','Second');await wait('document.querySelectorAll("[role=option]").length===1');await key('ArrowDown');await key('Enter');
 await wait('document.querySelector("main")?.innerText?.includes("PO-B")');
 assert.equal(await evaluate('document.querySelector("main").innerText.includes("PO-A")'),false,'changing supplier removes previous rows');
 assert.ok(calls.some(c=>c.endpoint==='/accounts/financial/'+accountB+'/history'));
 assert.equal(await evaluate('new URLSearchParams(location.search).has("stSearch")'),false,'changing supplier resets prior filters and page');
 await evaluate('[...document.querySelectorAll("main button")].find(b=>b.textContent==="Details").click()');await wait('document.querySelector("dialog[open]")?.innerText?.includes("Read-only supplier B")');
 assert.ok(calls.some(c=>c.endpoint==='/accounts/financial/'+accountB+'/history/event-b'));await key('Escape');
 mode='unknown';await send('Page.navigate',{url:origin+'/owner/accounts/suppliers/transactions?supplierId='+supplier._id});
 await wait('document.querySelector("main")?.innerText?.includes("Confirm previous supplier balance")');
 assert.equal(await evaluate('!!document.querySelector("main .record-register")'),false);
 await send('Page.navigate',{url:origin+'/owner/accounts/suppliers/transactions?supplierId='+nonSupplier._id});await wait('document.querySelector("main")?.innerText?.includes("This business is not a supplier")');assert.equal(await evaluate('!!document.querySelector("main .record-register")'),false);
 assert.equal(calls.some(c=>c.endpoint==='/accounts/transactions'),false,'never falls back to all-shop history');
 assert.equal(calls.some(c=>c.method!=='GET'&&c.method!=='OPTIONS'&&c.endpoint!=='/users/current-user'),false,'no financial mutations');
 assert.deepEqual(runtimeErrors,[]);assert.deepEqual(unknown,[]);
 console.log('PASS: supplier-specific navigation, A/B isolation, original table/Details/source links, search/date/type filters, pagination/reload and incomplete setup guards. All APIs mocked; no financial mutations.');

}finally{
 if(ws?.readyState===1){try{await send('Browser.close');}catch{ws.close();}}
 chrome?.kill();await vite?.close();
 if(oldApi===undefined)delete process.env.VITE_API_BASE_URL;else process.env.VITE_API_BASE_URL=oldApi;
}
