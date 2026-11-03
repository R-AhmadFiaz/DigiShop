// Mocked end-to-end regression check for the real React invoice review. The
// intercepted API never reaches the backend or any database.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {createServer} from 'vite';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function unusedPort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const accountOptions=[{_id:'507f1f77bcf86cd799439021',name:'HBL',kind:'BANK'},{_id:'507f1f77bcf86cd799439022',name:'Counter cash',kind:'CASH'}];
const product={_id:'507f1f77bcf86cd799439011',name:'Black Coil',brand:'Adam Cables',category:{_id:'category-wire',name:'Wire'},unit:'coil',retailPrice:4000,wholesalePrice:3500,stockQuantity:20};
const invoiceId='507f1f77bcf86cd799439012';
let accountMode='ready',scenario='walkin',pendingAccountRequest=null,previewRequests=0,heldPreview=null;
const calls=[];
const apiData=(data,message='OK')=>({data,messege:message});
async function fulfillMock(event,origin,status,data,message){const headers=[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Credentials',value:'true'},{name:'Access-Control-Allow-Headers',value:'Content-Type'},{name:'Access-Control-Allow-Methods',value:'GET,POST,PATCH,DELETE,OPTIONS'}];await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:headers,body:status===204?'':Buffer.from(JSON.stringify(status>=400?{message}:{data,messege:message})).toString('base64')});}
function makeOrder(){
  const customer=scenario.startsWith('linked')||scenario==='out-of-order'||scenario==='settlement-example'?{_id:'507f1f77bcf86cd799439023',name:'Linked customer',phoneNo:'03000000000',remainingMoney:0,storeCreditBalanceMinor:0}:null;
  const example=scenario==='settlement-example';
  return {_id:invoiceId,type:'INVOICE',invoiceNo:'INV-3',status:'PENDING',saleType:'RETAIL',revision:0,
    discountType:example?'PERCENTAGE':'NONE',discountValue:example?5:0,subtotal:example?12000:1600,discountAmount:example?600:0,totalPrice:example?11400:1600,paidAmount:example?6800:1600,amountDue:example?4600:0,
    ...(customer?{customerId:customer}:{}),items:[{lineId:'line-1',productId:product,name:product.name,brand:product.brand,unit:product.unit,quantity:example?3:1,unitPrice:example?4000:1600,sellingPrice:example?4000:1600,itemDiscount:0}]};
}
function previewFor(body){
  const receiptMinor=Math.round(Number(body.cashReceivedAmount||0)*100),refundCashMinor=Math.round(Number(body.cashRefundAmount||0)*100),creditIssueMinor=Math.round(Number(body.creditIssueAmount||0)*100);
  if(scenario==='settlement-example'){
    const due=Math.max(0,840000-receiptMinor);
    return {revision:0,before:{totalMinor:1140000,subtotalMinor:1200000,discountMinor:60000,settledMinor:680000,dueMinor:460000,discountType:'PERCENTAGE',discountValue:5},proposed:{totalMinor:1520000,subtotalMinor:1600000,discountMinor:80000,settledMinor:680000+receiptMinor,dueMinor:due,discountType:'PERCENTAGE',discountValue:5,items:[]},movements:[{kind:'ADD',productId:product._id,quantity:1,unitPriceMinor:400000,stockDelta:-1}],requirements:{dueMinor:840000,refundMinor:0,creditRestoreMinor:0,cashRefundMaximumMinor:0},funding:{cashNetMinor:680000,creditNetMinor:0,availableCreditMinor:0},settlement:{cashReceivedMinor:receiptMinor,cashRefundMinor:0,creditRedeemedMinor:0,creditIssuedMinor:0,creditRestoredMinor:0,dueMinor:due},canSubmit:true,confirmationToken:'b'.repeat(64),validationMessage:null};
  }
  if(scenario==='zero')return {revision:0,before:{totalMinor:160000,subtotalMinor:160000,discountMinor:0,settledMinor:160000,dueMinor:0},proposed:{totalMinor:160000,subtotalMinor:160000,discountMinor:0,settledMinor:160000,dueMinor:0,items:[]},movements:[],requirements:{dueMinor:0,refundMinor:0,creditRestoreMinor:0,cashRefundMaximumMinor:0},funding:{cashNetMinor:160000,creditNetMinor:0,availableCreditMinor:0},settlement:{cashReceivedMinor:0,cashRefundMinor:0,creditRedeemedMinor:0,creditIssuedMinor:0,creditRestoredMinor:0,dueMinor:0},canSubmit:true,confirmationToken:'c'.repeat(64),validationMessage:null};
  if(scenario.includes('refund')&&previewRequests===1)return {revision:0,before:{totalMinor:160000,subtotalMinor:160000,discountMinor:0,settledMinor:160000,dueMinor:0},proposed:{totalMinor:0,subtotalMinor:0,discountMinor:0,settledMinor:160000,dueMinor:0,items:[]},movements:[{kind:'RETURN',lineId:'line-1',productId:product._id,quantity:1,unitPriceMinor:160000,stockDelta:scenario.includes('damaged')?0:1,disposition:scenario.includes('damaged')?'DAMAGED':'RESTOCK'}],requirements:{dueMinor:0,refundMinor:160000,creditRestoreMinor:0,cashRefundMaximumMinor:160000},funding:{cashNetMinor:160000,creditNetMinor:0,availableCreditMinor:0},settlement:null,canSubmit:false,confirmationToken:null,validationMessage:null};
  if(refundCashMinor>0||creditIssueMinor>0)return {revision:0,before:{totalMinor:160000,subtotalMinor:160000,discountMinor:0,settledMinor:160000,dueMinor:0},proposed:{totalMinor:0,subtotalMinor:0,discountMinor:0,settledMinor:160000,dueMinor:0,items:[]},movements:[],requirements:{dueMinor:0,refundMinor:160000,creditRestoreMinor:0,cashRefundMaximumMinor:160000},funding:{cashNetMinor:160000,creditNetMinor:0,availableCreditMinor:0},settlement:{cashReceivedMinor:0,cashRefundMinor:refundCashMinor,creditRedeemedMinor:0,creditIssuedMinor:creditIssueMinor,creditRestoredMinor:0,dueMinor:0},canSubmit:true,confirmationToken:'a'.repeat(64),validationMessage:null};
  if(receiptMinor>0)return {revision:0,before:{totalMinor:160000,subtotalMinor:160000,discountMinor:0,settledMinor:160000,dueMinor:0},proposed:{totalMinor:960000,subtotalMinor:960000,discountMinor:0,settledMinor:160000+receiptMinor,dueMinor:Math.max(0,800000-receiptMinor),items:[]},movements:[{kind:'ADD',productId:product._id,quantity:2,unitPriceMinor:400000,stockDelta:-2}],requirements:{dueMinor:0,refundMinor:0,creditRestoreMinor:0,cashRefundMaximumMinor:0},funding:{cashNetMinor:160000,creditNetMinor:0,availableCreditMinor:0},settlement:{cashReceivedMinor:receiptMinor,cashRefundMinor:0,creditRedeemedMinor:0,creditIssuedMinor:0,creditRestoredMinor:0,dueMinor:Math.max(0,800000-receiptMinor)},canSubmit:true,confirmationToken:'a'.repeat(64),validationMessage:null};
  if(previewRequests>1)return {revision:0,before:{totalMinor:160000,subtotalMinor:160000,discountMinor:0,settledMinor:160000,dueMinor:0},proposed:{totalMinor:960000,subtotalMinor:960000,discountMinor:0,settledMinor:160000,dueMinor:800000,items:[]},movements:[],requirements:{dueMinor:800000,refundMinor:0,creditRestoreMinor:0,cashRefundMaximumMinor:0},funding:{cashNetMinor:160000,creditNetMinor:0,availableCreditMinor:0},settlement:{cashReceivedMinor:0,cashRefundMinor:0,creditRedeemedMinor:0,creditIssuedMinor:0,creditRestoredMinor:0,dueMinor:800000},canSubmit:true,confirmationToken:'a'.repeat(64),validationMessage:null};
  return {revision:0,before:{totalMinor:160000,subtotalMinor:160000,discountMinor:0,settledMinor:160000,dueMinor:0},proposed:{totalMinor:960000,subtotalMinor:960000,discountMinor:0,settledMinor:160000,dueMinor:800000,items:[]},movements:[{kind:'ADD',productId:product._id,quantity:2,unitPriceMinor:400000,stockDelta:-2}],requirements:{dueMinor:800000,refundMinor:0,creditRestoreMinor:0,cashRefundMaximumMinor:0},funding:{cashNetMinor:160000,creditNetMinor:0,availableCreditMinor:0},settlement:null,canSubmit:false,confirmationToken:null,validationMessage:scenario==='walkin'?'Anonymous invoice must remain fully settled':null};
}

let vite,chrome,socket,debugPort;
const pending=new Map(),errors=[];
let sequence=0;
function send(method,params={}){const id=++sequence;socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});});}
async function evaluate(expression){const response=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(response.exceptionDetails)throw Error(response.exceptionDetails.text);return response.result.value;}
async function waitFor(expression){for(let i=0;i<100;i++){if(await evaluate(expression))return;await sleep(80);}throw Error('Timed out: '+expression+'; page='+await evaluate('document.body.innerText')+'; errors='+errors.join(' | '));}
async function key(key){const code=key===' '?'Space':key,vk={Tab:9,Enter:13,Escape:27,ArrowDown:40,ArrowUp:38,Space:32,' ':32};await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk[key]||0});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk[key]||0});}
async function mockRequest(event,origin){
  const request=event.request,url=new URL(request.url),endpoint=url.pathname.replace('/api/v2','');
  if(url.pathname.endsWith('/src/api/client.js')){
    const source=await (await fetch(request.url)).text();
    await send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source.replace(/"VITE_API_BASE_URL":\s*"[^"]*"/,'"VITE_API_BASE_URL":"http://localhost:3000/api/v2"')).toString('base64')});return;
  }
  const body=request.postData?.startsWith('{')?JSON.parse(request.postData):{};
  calls.push({method:request.method,endpoint,body});
  let data={},status=200,message='OK';
  if(endpoint==='/users/current-user')data={shopActive:true,shopName:'Test shop',shopAddress:'Local',shopContactNo:'',subscriptionExpiry:'2099-01-01T00:00:00.000Z',user:{_id:'507f1f77bcf86cd799439024',username:'Owner',email:'owner@example.test',role:'OWNER'}};
  else if(endpoint==='/orders/'+invoiceId)data={order:makeOrder(),originalSnapshot:{source:'LEGACY_BASELINE',items:makeOrder().items,totalPrice:16,subtotal:16,discountAmount:0,paidAmount:16,amountDue:0},eligibility:{revision:0,adjustmentEligible:true,paymentEligible:false,cancellationEligible:true}};
  else if(endpoint==='/orders/'+invoiceId+'/history')data={history:[],revision:0,pagination:{currentPage:1,totalPages:1,recordCount:0}};
  else if(endpoint==='/orders/payment-accounts'){
    if(accountMode==='loading'){pendingAccountRequest=event.requestId;return;}
    if(accountMode==='error'){status=503;message='Mock account service unavailable';}
    else if(accountMode==='empty')data={accountingEnabled:true,accounts:[]};
    else if(accountMode==='off')data={accountingEnabled:false,accounts:[]};
    else data={accountingEnabled:true,accounts:accountOptions};
  } else if(endpoint==='/products/search-product')data={product:[product]};
  else if(endpoint==='/categories/')data={categories:[product.category]};
  else if(endpoint.startsWith('/customers/'))data={customers:[makeOrder().customerId].filter(Boolean),pagination:{currentPage:1,totalPages:1}};
  else if(endpoint==='/orders/'+invoiceId+'/adjustments/preview'){previewRequests++;data=previewFor(body);if(scenario==='out-of-order'&&body.cashReceivedAmount===2000){heldPreview={event,origin,status,data,message};return;}}
  else if(endpoint==='/orders/'+invoiceId+'/adjustments'&&request.method==='POST')data={event:{_id:'mock-adjustment-event',requestKey:body.requestKey}};
  else if(request.method==='OPTIONS')status=204;
  else {status=404;message='Unexpected mocked API request: '+request.method+' '+endpoint;}
  await fulfillMock(event,origin,status,data,message);
}
async function enterEditor(){await waitFor('!!document.querySelector("button")&&[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Edit Invoice")');await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Edit Invoice").click()');await waitFor('!!document.querySelector(".invoice-editor")');}
async function openWalkinReview(){
  await openReview('walkin','ready');
}
async function openReview(nextScenario,nextAccountMode){
  scenario=nextScenario;accountMode=nextAccountMode;previewRequests=0;pendingAccountRequest=null;heldPreview=null;
  await send('Page.navigate',{url:`http://127.0.0.1:${vite.httpServer.address().port}/owner/sales/${invoiceId}`});await enterEditor();
  if(scenario.includes('refund')){
    await setValue('[aria-label="Proposed quantity for Black Coil"]','0');
    await setValue('[aria-label="Condition of 1 returned Black Coil"]',scenario.includes('damaged')?'DAMAGED':'RESTOCK');
  }else if(scenario!=='zero') await setValue('[aria-label="Proposed quantity for Black Coil"]',scenario==='settlement-example'?'4':'3');
  else {await setValue('.invoice-edit-discount select','FIXED');await setValue('.invoice-edit-discount input','0.01');}
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review changes").click()');await waitFor('!!document.querySelector(".invoice-smart-review[open]")');
}
async function setValue(selector,value){await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));})()`);}

const originalApi=process.env.VITE_API_BASE_URL;process.env.VITE_API_BASE_URL='http://localhost:3000/api/v2';
try{
  vite=await createServer({configFile:false,root:process.cwd(),logLevel:'error',plugins:[(await import('@vitejs/plugin-react')).default()],server:{host:'127.0.0.1',port:0,strictPort:false},appType:'spa'});
  await vite.listen();const port=vite.httpServer.address().port,origin=`http://127.0.0.1:${port}`;debugPort=await unusedPort();
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'digishop-review-browser-'));
  chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-sandbox','--disable-gpu','--disable-gpu-sandbox','--disable-software-rasterizer','--in-process-gpu','--disable-gpu-compositing','--disable-features=VizDisplayCompositor','--no-first-run','--no-default-browser-check','--remote-debugging-port='+debugPort,'--user-data-dir='+profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let pages;for(let i=0;i<100;i++){try{pages=await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json();if(pages.some(p=>p.type==='page'))break;}catch{await sleep(100);continue;}await sleep(100);}
  socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('message',async event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);if(p){pending.delete(message.id);message.error?p.reject(Error(message.error.message)):p.resolve(message.result);}}else if(message.method==='Fetch.requestPaused'){try{await mockRequest(message.params,origin);}catch(error){errors.push(error.message);try{await send('Fetch.failRequest',{requestId:message.params.requestId,errorReason:'Failed'});}catch(failError){errors.push(failError.message);}}}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);});
  await send('Page.enable');await send('Runtime.enable');await send('Fetch.enable',{patterns:[{urlPattern:'http://localhost:3000/api/v2/*'},{urlPattern:origin+'/src/api/client.js*'}]});
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:`${origin}/owner/sales/${invoiceId}`});await openWalkinReview();

  const geometry=[];for(const [width,height] of [[1366,768],[1440,900],[1600,900]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(80);const metrics=await evaluate('(()=>{const d=document.querySelector(".invoice-smart-review[open]"),s=d.querySelector(".smart-review-summary"),p=d.querySelector(".smart-review-settlement"),a=d.querySelector("#invoice-receipt-account"),f=d.querySelector(".invoice-smart-review-footer"),r=e=>{const x=e.getBoundingClientRect();return {top:Math.round(x.top),bottom:Math.round(x.bottom),left:Math.round(x.left),right:Math.round(x.right)}};return {viewport:[innerWidth,innerHeight],dialog:r(d),dialogHeight:[d.scrollHeight,d.clientHeight],summary:r(s),settlement:r(p),account:r(a),footer:r(f)}})()');geometry.push(metrics);assert.ok(metrics.dialog.bottom<=height,`review fits ${width}x${height}`);assert.ok(metrics.dialogHeight[0]<=metrics.dialogHeight[1]+1,`no modal scrolling ${width}x${height}`);assert.ok(metrics.account.top>=metrics.settlement.top&&metrics.account.bottom<=metrics.settlement.bottom,`account is inside settlement ${width}x${height}`);assert.ok(metrics.footer.bottom<=metrics.dialog.bottom,`footer visible ${width}x${height}`);}
  assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Amount to settle\s*8,000\.00/);assert.ok(await evaluate('!!document.querySelector("#invoice-receipt-account")'));assert.ok(await evaluate('[...document.querySelectorAll("#invoice-receipt-account option")].some(o=>o.textContent==="HBL")'));
  assert.equal(await evaluate('[...document.querySelectorAll(".invoice-smart-review[open] button")].some(b=>b.textContent.trim()==="Review settlement")'),false,'there is no redundant settlement review action');
  const selectIndex=await evaluate('(()=>{const d=document.querySelector(".invoice-smart-review[open]"),a=d.querySelector("#invoice-receipt-account"),f=[...d.querySelectorAll("button,select,input:not([type=hidden]),a[href]")].filter(e=>!e.disabled);return f.indexOf(a)})()');assert.ok(selectIndex>=0);
  for(let i=0;i<10&&!await evaluate('document.activeElement===document.querySelector("#invoice-receipt-account")');i++)await key('Tab');assert.ok(await evaluate('document.activeElement===document.querySelector("#invoice-receipt-account")'),'Tab reaches cash/bank selector');
  const previewCount=()=>calls.filter(c=>c.method==='POST'&&c.endpoint.endsWith('/adjustments/preview')).length;const beforeSettlementPreview=previewCount();await key('ArrowDown');await waitFor('document.querySelector("#invoice-receipt-account").value==="507f1f77bcf86cd799439021"');
  for(let i=0;i<100&&previewCount()===beforeSettlementPreview;i++)await sleep(80);assert.equal(previewCount(),beforeSettlementPreview+1);assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.receiptAccountId,'507f1f77bcf86cd799439021');
  assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Receive now\s*8,000\.00[\s\S]*Remaining\s*0\.00/);
  assert.equal(await evaluate('!!document.querySelector(".invoice-smart-review .smart-review-acknowledgment")'),false,'Smart Review has no separate money acknowledgment checkbox');assert.equal(await evaluate('[...document.querySelectorAll(".invoice-smart-review[open] button")].find(b=>b.textContent.trim()==="Confirm & receive 8,000.00").disabled'),false,'valid preview and account enable explicit receive confirmation');assert.equal(await evaluate('document.querySelector("#invoice-receipt-account").selectedOptions[0].textContent'),'HBL','selected receiving account remains visible');
  const beforeAccountSwitch=previewCount();await key('ArrowDown');await waitFor('document.querySelector("#invoice-receipt-account").value==="507f1f77bcf86cd799439022"');assert.equal(await evaluate('!!document.querySelector(".invoice-smart-review .smart-review-acknowledgment")'),false);for(let i=0;i<100&&previewCount()===beforeAccountSwitch;i++)await sleep(80);assert.equal(previewCount(),beforeAccountSwitch+1,'changing account requests a fresh server preview');assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.receiptAccountId,'507f1f77bcf86cd799439022');
  const finalGeometry=[];for(const [width,height] of [[1366,768],[1440,900],[1600,900]]){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await sleep(80);const m=await evaluate('(()=>{const d=document.querySelector(".invoice-smart-review[open]"),s=d.querySelector(".smart-review-summary"),p=d.querySelector(".smart-review-settlement"),a=d.querySelector("#invoice-receipt-account"),f=d.querySelector(".invoice-smart-review-footer"),r=e=>{const x=e.getBoundingClientRect();return {top:Math.round(x.top),bottom:Math.round(x.bottom)}};return {dialog:[d.scrollHeight,d.clientHeight,d.getBoundingClientRect().bottom],summary:r(s),settlement:r(p),account:r(a),footer:r(f)}})()');finalGeometry.push({viewport:[width,height],...m});assert.ok(m.dialog[0]<=m.dialog[1]+1,`settled review has no vertical scroll at ${width}x${height}`);assert.ok(m.dialog[2]<=height,`settled review fits ${width}x${height}`);assert.ok(m.account.top>=m.settlement.top&&m.account.bottom<=m.settlement.bottom,`account is in settlement at ${width}x${height}`);assert.ok(m.footer.bottom<=m.dialog[2],`actions fit at ${width}x${height}`);}
  assert.equal(calls.some(c=>c.method==='POST'&&c.endpoint==='/orders/'+invoiceId+'/adjustments'),false,'preview does not submit the financial adjustment');
  assert.equal(await evaluate('[...document.querySelectorAll(".invoice-smart-review[open] button")].some(b=>b.textContent.trim()==="Confirm & receive 8,000.00")'),true);
  await evaluate('document.querySelector("#invoice-receipt-account").focus()');await key('Tab');await key('Tab');assert.ok(await evaluate('document.activeElement===[...document.querySelectorAll(".invoice-smart-review[open] button")].find(b=>b.textContent.trim()==="Confirm & receive 8,000.00")'),'Tab reaches final receive confirmation');assert.equal(calls.some(c=>c.method==='POST'&&c.endpoint==='/orders/'+invoiceId+'/adjustments'),false,'no financial mutation occurs before final activation');await key(' ');for(let i=0;i<100&&!calls.some(c=>c.method==='POST'&&c.endpoint==='/orders/'+invoiceId+'/adjustments');i++)await sleep(80);
  assert.equal(calls.filter(c=>c.method==='POST'&&c.endpoint==='/orders/'+invoiceId+'/adjustments').length,1,'only the deliberate keyboard confirmation submits');
  console.log('browser case: loading accounts');await openReview('walkin','loading');
  assert.ok(await evaluate('!!document.querySelector("#invoice-receipt-account:disabled")'));
  assert.ok(await evaluate('document.querySelector("#invoice-receipt-account").options[0].textContent.includes("Loading")'));
  assert.match(await evaluate('document.querySelector(".invoice-smart-review").innerText'),/Loading|loading/);
  assert.ok(pendingAccountRequest,'the mocked account request is deliberately held');
  await send('Fetch.fulfillRequest',{requestId:pendingAccountRequest,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:origin},{name:'Access-Control-Allow-Credentials',value:'true'}],body:Buffer.from(JSON.stringify(apiData({accountingEnabled:true,accounts:accountOptions}))).toString('base64')});pendingAccountRequest=null;
  await waitFor('[...document.querySelectorAll("#invoice-receipt-account option")].some(o=>o.textContent==="Counter cash")');

  console.log('browser case: account error and retry');await openReview('walkin','error');
  assert.ok(await evaluate('!!document.querySelector("#invoice-receipt-account:disabled")'));
  assert.ok(await evaluate('document.querySelector(".invoice-smart-review").innerText.includes("Could not load accounts")'));
  accountMode='ready';await evaluate('[...document.querySelectorAll(".invoice-smart-review button")].find(b=>b.textContent.trim()==="Retry account list").click()');
  await waitFor('[...document.querySelectorAll("#invoice-receipt-account option")].some(o=>o.textContent==="Counter cash")');

  console.log('browser case: empty account list');await openReview('walkin','empty');
  assert.ok(await evaluate('!!document.querySelector("#invoice-receipt-account:disabled")'));
  assert.ok(await evaluate('document.querySelector(".invoice-smart-review").innerText.includes("Set one up in Cash & Bank")'));
  assert.equal(await evaluate('[...document.querySelectorAll(".invoice-smart-review button")].some(b=>b.textContent.trim()==="Review settlement")'),false);

  console.log('browser case: accounting disabled');await openReview('walkin','off');
  assert.equal(await evaluate('!!document.querySelector("#invoice-receipt-account")'),false);
  assert.ok(await evaluate('document.querySelector(".invoice-smart-review").innerText.includes("accounting is off; no account selection is needed")'));
  await waitFor('document.querySelector(".invoice-smart-review[open]").innerText.includes("Confirm changes")');
  assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.receiptAccountId,undefined,'accounting-disabled backend contract receives no invented account id');

  console.log('browser case: linked customer partial receipt');await openReview('linked','ready');
  assert.ok(await evaluate('!!document.querySelector("#invoice-receipt-account")'));const linkedPreviewStart=previewRequests;
  await evaluate('[...document.querySelectorAll("input[name=settlement-mode]")].find(e=>e.value==="FULL").focus()');await key('ArrowDown');await waitFor('document.querySelector("input[name=settlement-mode]:checked").value==="PARTIAL"');assert.ok(await evaluate('document.activeElement===document.querySelector(".invoice-smart-review input[aria-label=\\"Receive now\\"]")'),'arrow selection moves to the amount field');await setValue('.invoice-smart-review input[aria-label="Receive now"]','2000');await setValue('#invoice-receipt-account','507f1f77bcf86cd799439021');
  for(let i=0;i<100&&previewRequests===linkedPreviewStart;i++)await sleep(80);await waitFor('document.querySelector(".invoice-smart-review[open]").innerText.includes("Remaining")');
  const linkedBody=calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body;assert.equal(linkedBody.cashReceivedAmount,2000);assert.equal(linkedBody.receiptAccountId,'507f1f77bcf86cd799439021');
  assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Receive now\s*2,000\.00[\s\S]*Remaining\s*6,000\.00/);

  console.log('browser case: linked pay later');await openReview('linked','ready');await evaluate('[...document.querySelectorAll("input[name=settlement-mode]")].find(e=>e.value==="LATER").click()');
  assert.equal(await evaluate('!!document.querySelector("#invoice-receipt-account")'),false,'pay later has no cash account selector');await waitFor('document.querySelector(".invoice-smart-review[open]").innerText.includes("Confirm changes")');
  assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.cashReceivedAmount,0);assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Remaining customer balance:\s*8,000\.00/);

  console.log('browser case: partial amount equal to full due');await openReview('linked','ready');const equalDueStart=previewRequests;await evaluate('[...document.querySelectorAll("input[name=settlement-mode]")].find(e=>e.value==="PARTIAL").click()');await setValue('.invoice-smart-review input[aria-label="Receive now"]','8000');await setValue('#invoice-receipt-account','507f1f77bcf86cd799439021');for(let i=0;i<100&&previewRequests===equalDueStart;i++)await sleep(80);assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.cashReceivedAmount,8000);assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Receive now\s*8,000\.00[\s\S]*Remaining\s*0\.00/);

  console.log('browser case: no additional payment required');await openReview('zero','error');assert.equal(await evaluate('!!document.querySelector("#invoice-receipt-account")'),false);await waitFor('(()=>{const b=[...document.querySelectorAll(".invoice-smart-review[open] button")].find(b=>b.textContent.trim()==="Confirm changes");return b&&!b.disabled})()');assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/No additional payment required/);assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.receiptAccountId,undefined);assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.cashReceivedAmount,0);

  console.log('browser case: authoritative 3,800 increase, existing percentage discount, partial settlement');await openReview('settlement-example','ready');
  assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Previous total\s*11,400\.00[\s\S]*Updated total\s*15,200\.00[\s\S]*Already paid\s*6,800\.00[\s\S]*Amount to settle\s*8,400\.00[\s\S]*Discount[\s\S]*600\.00\s*→\s*800\.00/);
  const examplePreviewStart=previewRequests;await evaluate('[...document.querySelectorAll("input[name=settlement-mode]")].find(e=>e.value==="PARTIAL").click()');assert.ok(await evaluate('document.activeElement===document.querySelector(".invoice-smart-review input[aria-label=\\"Receive now\\"]")'),'partial selection focuses the amount');assert.equal(await evaluate('document.querySelector(".invoice-smart-review input[aria-label=\\"Receive now\\"]").value'),'','partial amount does not default to full due');await setValue('.invoice-smart-review input[aria-label="Receive now"]','3000');await setValue('#invoice-receipt-account','507f1f77bcf86cd799439021');for(let i=0;i<100&&previewRequests===examplePreviewStart;i++)await sleep(80);await waitFor('document.querySelector(".smart-review-settlement").innerText.includes("5,400.00")');
  assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Amount to settle\s*8,400\.00[\s\S]*Receive now\s*3,000\.00[\s\S]*Remaining\s*5,400\.00/);
  let beforeAmountChange=previewCount();await setValue('.invoice-smart-review input[aria-label="Receive now"]','2500');assert.equal(await evaluate('!!document.querySelector(".smart-review-acknowledgment input")'),false,'changing payment amount invalidates confirmation');for(let i=0;i<100&&previewCount()===beforeAmountChange;i++)await sleep(80);assert.equal(previewCount(),beforeAmountChange+1);assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.cashReceivedAmount,2500);assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Remaining\s*5,900\.00/);
  beforeAmountChange=previewCount();await setValue('.invoice-smart-review input[aria-label="Receive now"]','3000');for(let i=0;i<100&&previewCount()===beforeAmountChange;i++)await sleep(80);assert.equal(previewCount(),beforeAmountChange+1);assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.cashReceivedAmount,3000);assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Receive now\s*3,000\.00[\s\S]*Remaining\s*5,400\.00/);

  console.log('browser case: cash refund');await openReview('refund','ready');
  assert.ok(await evaluate('!!document.querySelector("#invoice-refund-account")'),'cash refund requires a visible refund-source account; review='+await evaluate('document.querySelector(".invoice-smart-review[open]")?.innerText'));
  const refundPreviewStart=previewRequests;await setValue('#invoice-refund-account','507f1f77bcf86cd799439022');for(let i=0;i<100&&previewRequests===refundPreviewStart;i++)await sleep(80);
  assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.refundAccountId,'507f1f77bcf86cd799439022');
  assert.equal(await evaluate('[...document.querySelectorAll(".invoice-smart-review[open] button")].some(b=>b.textContent.trim()==="Confirm & refund 1,600.00")'),true,'cash refund amount is named in the final action');assert.equal(await evaluate('document.querySelector("#invoice-refund-account").selectedOptions[0].textContent'),'Counter cash','selected refund account remains visible');

  console.log('browser case: store credit refund');await openReview('linked-refund','ready');
  const creditRefundPreviewStart=previewRequests;
  await evaluate('[...document.querySelectorAll(".invoice-smart-review label")].find(l=>l.textContent.includes("Issue store credit")).querySelector("input").click()');
  assert.equal(await evaluate('!!document.querySelector("#invoice-refund-account")'),false,'store-credit-only refund needs no cash account');
  for(let i=0;i<100&&previewRequests===creditRefundPreviewStart;i++)await sleep(80);
  const creditRefundBody=calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body;assert.equal(creditRefundBody.creditIssueAmount,1600);assert.equal(creditRefundBody.refundAccountId,undefined);

  console.log('browser case: stale preview response cannot suppress the latest amount');await openReview('out-of-order','ready');
  await evaluate('[...document.querySelectorAll("input[name=settlement-mode]")].find(e=>e.value==="PARTIAL").click()');await setValue('.invoice-smart-review input[aria-label="Receive now"]','2000');await setValue('#invoice-receipt-account','507f1f77bcf86cd799439021');for(let i=0;i<100&&!heldPreview;i++)await sleep(80);assert.ok(heldPreview,'first partial preview is held by the mock');
  await setValue('.invoice-smart-review input[aria-label="Receive now"]','3000');await sleep(350);const beforeStaleRelease=previewRequests;await fulfillMock(heldPreview.event,heldPreview.origin,heldPreview.status,heldPreview.data,heldPreview.message);heldPreview=null;for(let i=0;i<100&&previewRequests===beforeStaleRelease;i++)await sleep(80);assert.equal(previewRequests,beforeStaleRelease+1,'latest preview runs after stale in-flight response finishes');assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.cashReceivedAmount,3000);await waitFor('document.querySelector(".smart-review-settlement").innerText.includes("5,000.00")');

  console.log('browser case: damaged return');await openReview('damaged-refund','ready');assert.match(await evaluate('document.querySelector(".invoice-smart-review[open]").innerText'),/Damaged/);assert.equal(calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body.returns[0].disposition,'DAMAGED');

  console.log('browser case: leave balance due without cash');await openReview('linked','ready');
  await evaluate('[...document.querySelectorAll("input[name=settlement-mode]")].find(e=>e.value==="LATER").click()');
  assert.equal(await evaluate('!!document.querySelector("#invoice-receipt-account")'),false,'zero-cash balance settlement does not show an account selector');
  await waitFor('document.querySelector(".invoice-smart-review[open]").innerText.includes("Confirm changes")');
  const leaveBody=calls.filter(c=>c.endpoint.endsWith('/adjustments/preview')).at(-1).body;assert.equal(leaveBody.cashReceivedAmount,0);assert.equal(leaveBody.receiptAccountId,undefined);await waitFor('(()=>{const b=[...document.querySelectorAll(".invoice-smart-review[open] button")].find(b=>b.textContent.trim()==="Confirm changes");return b&&!b.disabled})()');
  await key('Escape');assert.equal(await evaluate('!!document.querySelector(".invoice-smart-review[open]")'),false,'Escape closes review');assert.equal(await evaluate('document.activeElement.textContent.trim()==="Review changes"'),true,'Escape restores focus to the review trigger');
  assert.equal(calls.filter(c=>c.method==='POST'&&c.endpoint==='/orders/'+invoiceId+'/adjustments').length,1,'the only adjustment POST was the explicitly confirmed keyboard test');
  console.log('Smart Review mocked React browser tests passed. Geometry: '+JSON.stringify({initial:geometry,confirmed:finalGeometry}));
}finally{
  if(socket?.readyState===1){try{await send('Browser.close');}catch{socket.close();}}
  chrome?.kill();await vite?.close();if(originalApi===undefined)delete process.env.VITE_API_BASE_URL;else process.env.VITE_API_BASE_URL=originalApi;
}


