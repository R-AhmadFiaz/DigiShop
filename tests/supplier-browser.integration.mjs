// Explicit opt-in integration runner: node tests/supplier-browser.integration.mjs
// Real Express, production-built React, Chrome, HTTP cookies and MongoDB.
// No mocked responses or provider calls. A loopback proxy can drop one committed response for recovery testing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import mongoose from 'mongoose';
import http from 'node:http';

const binary = 'C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const chromeBinary = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert.ok(existsSync(binary) && existsSync(chromeBinary), 'Local MongoDB and Chrome are required; no remote fallback');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'digishop-supplier-integration-'));
const frontend = path.resolve('../store-frontend');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
const mongoPort = await port(), apiPort = await port(), webPort = await port(), debugPort = await port();
const dbName = 'digishop_supplier_browser_test';
const upstreamPort=await port();
const upstreamBase=`http://127.0.0.1:${upstreamPort}`;
const uri = `mongodb://127.0.0.1:${mongoPort}/${dbName}?directConnection=true`;
const origin = `http://127.0.0.1:${webPort}`, base = `http://127.0.0.1:${apiPort}/api/v2`;
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: path.join(temp, 'does-not-exist.env'), NODE_ENV: 'test',
  MONGO_DB_URI: uri, CORS_ORIGIN: origin, OPENAI_API_KEY: 'isolated-no-provider-calls',
  ACCESS_TOKEN_SECRET: 'disposable-live-browser-access', REFRESH_TOKEN_SECRET: 'disposable-live-browser-refresh',
  ACCESS_TOKEN_EXPIRY: '15m', REFRESH_TOKEN_EXPIRY: '7d',
});
const {app} = await import('../dist/app.js');
const {User} = await import('../dist/models/user.model.js');
const {Shop} = await import('../dist/models/shop.model.js');
const {Product} = await import('../dist/models/product.model.js');
const {Customer} = await import('../dist/models/customer.model.js');
const {CustomerLedger} = await import('../dist/models/customerLedger.model.js');
const {StockLog} = await import('../dist/models/stockLog.model.js');
const children = [], passed = [], errors = [];
let httpServer,upstreamServer,socket,sequence=0,dropPaymentResponse=false;
const requests=[];const accounts=await import('../dist/utils/businessAccounts.js');
const {BusinessEntity}=await import('../dist/models/businessEntity.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const {BusinessTransaction}=await import('../dist/models/businessTransaction.model.js');
const {PurchaseOrder}=await import('../dist/models/purchaseOrder.model.js');
const {GoodsReceipt}=await import('../dist/models/goodsReceipt.model.js');
const {SupplierSettlement}=await import('../dist/models/supplierSettlement.model.js');
const jwt=(await import('jsonwebtoken')).default;
delete process.env.BUSINESS_ACCOUNTING_ENABLED;
const waiting = new Map();
function child(command, args, options = {}) { const process = spawn(command, args, {windowsHide: true, stdio: 'ignore', ...options}); children.push(process); return process; }
async function done(process) { const code = await new Promise(resolve => process.once('exit', resolve)); assert.equal(code, 0, 'Child command failed'); }
function send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => {waiting.delete(id); reject(new Error('CDP timeout: ' + method));}, 20000); waiting.set(id, {resolve, reject, timer}); socket.send(JSON.stringify({id, method, params})); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', {expression: `(async()=>(${expression}))()`, awaitPromise: true, returnByValue: true}); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
async function wait(expression) { for (let n = 0; n < 160; n++) { if (await evaluate(expression)) return; await sleep(75); } throw new Error('UI timeout: ' + expression + '\n' + await evaluate('document.body.innerText')); }
async function click(text) { await wait(`(()=>{const e=[...document.querySelectorAll('button,a')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getClientRects().length&&!e.disabled);if(!e)return false;e.click();return true;})()`); }
async function fill(selector, value) { await wait(`!!document.querySelector(${JSON.stringify(selector)})`); await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
async function label(name, value) { await wait(`[...document.querySelectorAll('label')].some(e=>e.textContent.trim().startsWith(${JSON.stringify(name)}))`); const selector = await evaluate(`(()=>{const e=[...document.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(name)})).querySelector('input');e.id='integration-field';return '#integration-field';})()`); await fill(selector, value); await evaluate(`document.querySelector('#integration-field').removeAttribute('id')`); }
async function browserHttp(method, route, body) { return evaluate(`fetch(${JSON.stringify(base + route)},{method:${JSON.stringify(method)},credentials:'include',headers:{'Content-Type':'application/json'},${body ? `body:JSON.stringify(${JSON.stringify(body)}),` : ''}}).then(async r=>({status:r.status,body:await r.json()}))`); }
async function navigation(route) { await send('Page.navigate', {url: origin + route}); await wait(`!!document.querySelector('.sidebar')`); }
async function login(username) { await send('Network.clearBrowserCookies'); await send('Page.navigate', {url: origin + '/login'}); await fill('[name=identity]', username); await fill('[name=password]', 'local-test-password'); await click('Sign in'); await wait(`!!document.querySelector('.sidebar')`); }
function pass(name){passed.push(name);console.log('PASS '+name);}
function safeDb(){assert.equal(mongoose.connection.host,'127.0.0.1');assert.equal(mongoose.connection.port,mongoPort);assert.equal(mongoose.connection.name,dbName);assert.ok(uri.startsWith('mongodb://127.0.0.1:'));}
function ok(result){assert.ok(result.status>=200&&result.status<300,JSON.stringify(result));return result.body.data;}
async function api(user,method,route,body){return fetch(base+route,{method,headers:{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})}).then(async r=>({status:r.status,body:await r.json()}));}
const get=route=>browserHttp('GET',route);
async function record(){await click('Confirm and record');await wait(`!document.querySelector('dialog[open]')`);}
async function selectPaymentAccount(id){await wait(`document.querySelector('select.form-select')&&[...document.querySelector('select.form-select').options].some(o=>o.value===${JSON.stringify(id)})`);await fill('select.form-select',id);await wait(`document.body.innerText.includes('Available in')`);}
let owner,other,cashier,shop,foreignShop,product,supplier,ap,cash,bank,offset,equity,control,mainPo,postedPo,postedReceipt;
async function snapshot(){safeDb();return {stock:(await Product.findById(product._id)).stockQuantity,receipts:await GoodsReceipt.countDocuments({shopId:shop._id,supplierId:supplier._id}),events:await SupplierSettlement.countDocuments({supplierId:supplier._id}),journals:await BusinessTransaction.countDocuments({shopId:shop._id}),logs:await StockLog.countDocuments({productId:product._id})};}
async function verifyMain(expected){
  safeDb();const actor={_id:owner._id,shopId:shop._id,role:'OWNER'};
  const balances=await accounts.businessTransaction(actor,async session=>({payable:await accounts.requireSupplierPayable(actor,String(supplier._id),session),cash:await accounts.getAccountBalance(actor,String(cash._id),session),bank:await accounts.getAccountBalance(actor,String(bank._id),session)}));
  assert.equal(balances.payable.balanceMinor,expected.payable);assert.equal(balances.cash.balanceMinor,expected.cash);assert.equal(balances.bank.balanceMinor,expected.bank);
  const stock=(await Product.findById(product._id)).stockQuantity,logs=await StockLog.find({shopId:shop._id,productId:product._id}).lean();assert.equal(stock,expected.stock);assert.equal(stock,logs.reduce((sum,l)=>sum+l.quantityDelta,0));
  for(const j of await BusinessTransaction.find({shopId:shop._id}).lean())assert.equal(j.postings.reduce((n,p)=>n+BigInt(p.debitMinor)-BigInt(p.creditMinor),0n),0n,'Every persisted journal balances');
}
try{
  const mongod=child(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(mongoPort),'--replSet','supplierIntegration','--logpath',path.join(temp,'mongo.log')]);
  for(let n=0;;n++){try{await mongoose.connect(uri,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch{assert.ok(n<40&&mongod.exitCode===null,'Disposable replica unavailable; no remote fallback');await sleep(100);}}
  await mongoose.connection.db.admin().command({replSetInitiate:{_id:'supplierIntegration',members:[{_id:0,host:`127.0.0.1:${mongoPort}`}]}});
  for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){assert.ok(n<200);await sleep(100);}
  safeDb();assert.equal((await mongoose.connection.db.admin().command({hello:1})).setName,'supplierIntegration');
  const mongoVersion=(await mongoose.connection.db.admin().command({buildInfo:1})).version;
  console.log('VERIFIED disposable database: '+uri+'; MongoDB '+mongoVersion+'; production environment files bypassed');
  for(const M of Object.values(mongoose.models)){await M.createCollection();await M.createIndexes();}
  async function fixture(username,contactNo){safeDb();const id=new mongoose.Types.ObjectId(),s=await Shop.create({ownerId:id,name:username+' Hardware',address:'Disposable local test',contactNo,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000),isActive:true});return {shop:s,user:await User.create({_id:id,shopId:s._id,username,email:username+'@local.invalid',password:'local-test-password',role:'OWNER'})};}
  ({shop,user:owner}=await fixture('supplierowner','03111111111'));({shop:foreignShop,user:other}=await fixture('othersupplierowner','03222222222'));
  cashier=await User.create({shopId:shop._id,username:'suppliercashier',email:'suppliercashier@local.invalid',password:'local-test-password',role:'CASHIER'});
  const customer=await Customer.create({shopId:shop._id,name:'Unchanged customer',phoneNo:'03333333333',address:'Local',remainingMoney:0,storeCreditBalanceMinor:0}),customerBefore=JSON.stringify(await Customer.findById(customer._id).lean()),foreignBefore=JSON.stringify(await Shop.findById(foreignShop._id).lean());
  upstreamServer=app.listen(upstreamPort,'127.0.0.1');await new Promise(r=>upstreamServer.once('listening',r));
  httpServer=http.createServer((req,res)=>{
    const entry={method:req.method,path:req.url,body:''};requests.push(entry);req.on('data',chunk=>entry.body+=chunk);
    const forward=http.request(upstreamBase+req.url,{method:req.method,headers:req.headers},upstream=>{
      if(dropPaymentResponse&&req.method==='POST'&&req.url.endsWith('/payments')&&upstream.statusCode===200){
        dropPaymentResponse=false;upstream.resume();upstream.on('end',()=>{
          // Deliver headers first so Chrome cannot silently retry a closed,
          // apparently unused connection. Then interrupt the real response body.
          res.writeHead(upstream.statusCode,upstream.headers);res.flushHeaders();res.write('{');setTimeout(()=>res.destroy(),50);
        });
      }
      else{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res);}
    });forward.on('error',()=>{res.writeHead(502);res.end();});req.pipe(forward);
  });httpServer.listen(apiPort,'127.0.0.1');await new Promise(r=>httpServer.once('listening',r));
  const out=path.join(temp,'frontend-dist');
  await done(child(process.execPath,[path.join(frontend,'node_modules/vite/bin/vite.js'),'build','--outDir',out],{cwd:frontend,env:{...process.env,NODE_ENV:'production',VITE_API_BASE_URL:base}}));
  child(process.execPath,[path.join(frontend,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port',String(webPort),'--strictPort','--outDir',out],{cwd:frontend});
  for(let n=0;;n++){try{if((await fetch(origin)).ok)break;}catch{}assert.ok(n<100);await sleep(100);}
  child(chromeBinary,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port='+debugPort,'--user-data-dir='+path.join(temp,'chrome'),'about:blank']);
  let page;for(let n=0;!page;n++){try{page=(await(await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(p=>p.type==='page');}catch{}assert.ok(n<100);await sleep(100);}
  socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  socket.addEventListener('message',async event=>{const m=JSON.parse(event.data);if(m.id){const item=waiting.get(m.id);if(item){clearTimeout(item.timer);waiting.delete(m.id);m.error?item.reject(Error(m.error.message)):item.resolve(m.result);}}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);else if(m.method==='Page.javascriptDialogOpening')await send('Page.handleJavaScriptDialog',{accept:true});});
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await login(owner.username);
  await navigation('/owner/accounts/companies');await click('Add business');await fill('[name=name]','Integration Supplier');await fill('[name=phoneNo]','03001234567');await fill('[name=address]','Local integration market');await click('Save business');await wait(`!document.querySelector('dialog[open]')&&document.body.innerText.includes('Integration Supplier')`);
  supplier=await BusinessEntity.findOne({shopId:shop._id,name:'Integration Supplier'}).lean();assert.ok(supplier.roles.includes('SUPPLIER'));
  const category=ok(await browserHttp('POST','/categories/create-category',{name:'Integration Electrical'})).category;
  product=ok(await browserHttp('POST','/products/create-product',{name:'Integration Cable',brand:'Integration Wire',category:category._id,unit:'pcs',costPrice:8,retailPrice:25,wholesalePrice:20,stockQuantity:0,minStockThreshold:2})).product;
  pass('real cookie login, supplier creation UI and category/product creation APIs');

  async function createPo(reference,quantity,cost){
    await navigation('/owner/purchases');await click('Create purchase order');await label('Purchase reference',reference);await label('Find supplier','Integration Supplier');await sleep(300);await click('Integration Supplier');await label('Find purchase products','Integration Cable');await sleep(300);await click('Add Integration Cable');await fill('[aria-label="Quantity for Integration Cable"]',quantity);await fill('[aria-label="Unit cost for Integration Cable"]',cost);await click('Review purchase order');await record();
    const po=await PurchaseOrder.findOne({shopId:shop._id,reference}).lean();await wait(`document.body.innerText.includes(${JSON.stringify(reference)})`);await navigation('/owner/purchases/'+po._id);await click('Confirm order');await record();await wait(`document.body.innerText.includes('Receive delivery')`);return await PurchaseOrder.findById(po._id).lean();
  }
  async function receive(reference,quantity){await label('Delivery reference',reference);await fill('[aria-label="Delivered Integration Cable"]',quantity);await click('Review delivered quantities');await record();await wait(`document.body.innerText.includes(${JSON.stringify(reference)})`);return GoodsReceipt.findOne({shopId:shop._id,reference}).lean();}
  mainPo=await createPo('PO-BEFORE-CUTOFF',10,10);assert.equal((await Product.findById(product._id)).stockQuantity,0);assert.equal(await BusinessTransaction.countDocuments(),0);
  const partial=await receive('GR-OLD-PARTIAL',4);assert.equal((await Product.findById(product._id)).stockQuantity,4);assert.equal(partial.accountingStatus,'DEFERRED');assert.equal((await PurchaseOrder.findById(mainPo._id)).status,'PARTIALLY_RECEIVED');
  const firstRequest=requests.find(r=>r.method==='POST'&&r.path===`/api/v2/purchases/${mainPo._id}/receipts`),replay=ok(await browserHttp('POST',`/purchases/${mainPo._id}/receipts`,JSON.parse(firstRequest.body)));assert.equal(replay.replayed,true);assert.equal((await Product.findById(product._id)).stockQuantity,4);
  const complete=await receive('GR-OLD-COMPLETE',6);assert.equal((await Product.findById(product._id)).stockQuantity,10);assert.equal((await PurchaseOrder.findById(mainPo._id)).status,'RECEIVED');assert.equal(await StockLog.countDocuments({productId:product._id}),2);assert.equal(await BusinessTransaction.countDocuments(),0);
  const closed=await PurchaseOrder.findById(mainPo._id);assert.equal((await browserHttp('POST',`/purchases/${mainPo._id}/receipts`,{requestKey:crypto.randomUUID(),reference:'GR-OVER-RECEIVE',expectedRevision:closed.revision,items:[{productId:product._id,quantity:1}]})).status,409);assert.equal((await Product.findById(product._id)).stockQuantity,10);
  assert.equal(ok(await get(`/purchases/${mainPo._id}/receipts?limit=1`)).pagination.totalPages,2);
  await navigation('/owner/accounts/suppliers/'+supplier._id);await wait(`document.body.innerText.includes('Payable unavailable')`);assert.equal(await evaluate(`document.body.innerText.includes('Outstanding: PKR 0.00')`),false);
  pass('purchase creation/confirmation, partial/full receiving, exact replay, delivery pagination and disabled balances');

  // Explicit test setup via the actual OWNER endpoints; no fabricated historical payment events.
  process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  const createAccount=async(kind,code,entityId)=>ok(await browserHttp('POST','/accounts/financial',{kind,code:code.replaceAll(' ','_').toUpperCase(),name:code,...(entityId?{entityId}: {})}));
  cash=await createAccount('CASH','Counter Cash');
  bank=await createAccount('BANK','Bank');equity=await createAccount('OPENING_EQUITY','Opening Equity');offset=await createAccount('PURCHASES_CLEARING','Purchases Clearing');control=await createAccount('SETTLEMENT_CLEARING','Cash Control');ap=await createAccount('SUPPLIER_PAYABLE','Supplier Payable',supplier._id);
  const cashCutoff=new Date().toISOString();
  for(const [account,amountMinor] of [[cash,10000],[bank,50000]])ok(await browserHttp('POST',`/accounts/financial/${account._id}/opening`,{requestKey:'opening-'+account._id,reason:'Owner-confirmed actual test funds',occurredAt:cashCutoff,amountMinor,equityAccountId:equity._id,confirmation:'CONFIRM OPENING BALANCE'}));
  ok(await browserHttp('POST','/accounts/cutover/prepare',{clearingAccountId:control._id,cutoffAt:cashCutoff,accounts:[{accountId:cash._id,confirmedBalanceMinor:10000},{accountId:bank._id,confirmedBalanceMinor:50000}],confirmation:'PREPARE CASH BANK CUTOVER'}));
  const preview=ok(await get(`/accounts/suppliers/${supplier._id}/cutover-preview`)),cutoff=new Date().toISOString();
  ok(await browserHttp('POST',`/accounts/suppliers/${supplier._id}/cutover`,{requestKey:'supplier-approved-opening',confirmation:'CONFIRM SUPPLIER OPENING',reason:'Reviewed two historical receipts and external settlement; no overlapping debt',cutoffAt:cutoff,payableAccountId:ap._id,offsetAccountId:offset._id,equityAccountId:equity._id,openingBalanceMinor:8000,otherOpeningMinor:0,evidenceDigest:preview.evidenceDigest,reviews:[{receiptId:partial._id,unpaidMinor:3000,reason:'1000 paisa settled externally before opening'},{receiptId:complete._id,unpaidMinor:5000,reason:'1000 paisa settled externally before opening'}]}));
  assert.equal(await SupplierSettlement.countDocuments(),0);await verifyMain({stock:10,payable:8000,cash:10000,bank:50000});
  pass('owner-confirmed cash/bank openings and supplier cutoff review retain old deferred evidence without backfill');
  postedPo=await createPo('PO-AFTER-CUTOFF',5,20);postedReceipt=await receive('GR-POSTED',5);assert.equal(postedReceipt.accountingStatus,'POSTED');await verifyMain({stock:15,payable:18000,cash:10000,bank:50000});
  assert.equal(await BusinessTransaction.countDocuments({'source.kind':'PURCHASE_RECEIPT','source.referenceId':postedReceipt._id}),1);const receiptJournal=await BusinessTransaction.findOne({'source.kind':'PURCHASE_RECEIPT','source.referenceId':postedReceipt._id});assert.equal(+receiptJournal.occurredAt,+postedReceipt.occurredAt);assert.equal(String(receiptJournal.createdBy),String(owner._id));assert.equal(receiptJournal.createdByRole,'OWNER');assert.equal(receiptJournal.currency,'PKR');assert.equal((await GoodsReceipt.findById(partial._id)).accountingStatus,'DEFERRED');pass('post-cutoff real UI delivery atomically increases stock and supplier payable');

  await navigation('/owner/accounts/suppliers/'+supplier._id);await wait(`document.body.innerText.includes('Outstanding: PKR 180.00')`);await selectPaymentAccount(cash._id);await label('Payment amount (PKR)','30');await label('Payment reference','PAY-LOCAL-CASH');await label('Payment note','Actual local cash payment');await click('Review supplier payment');
  dropPaymentResponse=true;await evaluate(`(()=>{const b=[...document.querySelectorAll('dialog button')].find(b=>b.textContent==='Confirm payment sent');b.click();b.click();})()`);await wait(`document.body.innerText.includes('result is uncertain')`);
  const paymentRequest=requests.find(r=>r.path.endsWith(`/suppliers/${supplier._id}/payments`)&&r.method==='POST');assert.ok(paymentRequest);assert.equal(await SupplierSettlement.countDocuments({reference:'PAY-LOCAL-CASH'}),1);await verifyMain({stock:15,payable:15000,cash:7000,bank:50000});
  await send('Page.reload');await wait(`document.body.innerText.includes('retained for an identical retry')`);await click('Retry same request');await wait(`!document.querySelector('dialog[open]')&&document.body.innerText.includes('Outstanding: PKR 150.00')`);
  assert.equal(requests.filter(r=>r.path===paymentRequest.path&&r.method==='POST').length,2);assert.equal(requests.filter(r=>r.path===paymentRequest.path&&r.method==='POST')[1].body,paymentRequest.body);await verifyMain({stock:15,payable:15000,cash:7000,bank:50000});pass('real committed payment response loss, duplicate-click protection, page reload and identical-key recovery');

  ok(await browserHttp('PATCH','/products/'+product._id,{costPrice:99}));
  await navigation('/owner/purchases/'+postedPo._id);await click('Return details');await wait(`document.body.innerText.includes('Already returned (net)')`);await label('Return Integration Cable',2);await label('Return reference','RET-LOCAL');await label('Return reason','Supplier accepted actual returned cables');await click('Review return');await record();await wait(`!document.querySelector('section[aria-label="Purchase return"]')`);
  const returned=await SupplierSettlement.findOne({reference:'RET-LOCAL'}).lean();assert.equal(returned.amountMinor,4000);assert.equal(returned.items[0].unitCostMinor,2000);await verifyMain({stock:13,payable:11000,cash:7000,bank:50000});
  await click('Return details');await wait(`document.body.innerText.includes('RET-LOCAL')`);assert.equal(await evaluate(`document.querySelector('section[aria-label="Purchase return"] tbody tr').cells[2].textContent`),'2');await click('Close return details');pass('original-cost partial return, stock audit, payable credit and refreshed eligible quantities');

  const supplierPath=`/accounts/suppliers/${supplier._id}`;
  const pay=(amountMinor,accountId,reference)=>({amountMinor,accountId,reference,requestKey:crypto.randomUUID(),reason:'Actual isolated supplier payment',occurredAt:new Date().toISOString()});
  const beforeRejections=await snapshot();assert.equal((await browserHttp('POST',supplierPath+'/payments',pay(11001,cash._id,'PAY-OVER'))).status,409);assert.equal((await browserHttp('POST',supplierPath+'/payments',pay(8000,cash._id,'PAY-NO-FUNDS'))).status,409);
  assert.equal((await browserHttp('POST',supplierPath+'/returns',{requestKey:crypto.randomUUID(),reference:'RET-TOO-MANY',reason:'Reject over-return',occurredAt:new Date().toISOString(),receiptId:postedReceipt._id,items:[{productId:product._id,quantity:4}]})).status,409);assert.deepEqual(await snapshot(),beforeRejections);
  ok(await browserHttp('POST',supplierPath+'/payments',pay(1000,bank._id,'PAY-LOCAL-BANK')));await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});
  const fullyPaid=ok(await browserHttp('POST',supplierPath+'/payments',pay(10000,bank._id,'PAY-LOCAL-FULL'))).settlement;
  assert.equal((await browserHttp('POST',supplierPath+'/returns',{requestKey:crypto.randomUUID(),reference:'RET-PAID-GOODS',reason:'No unsupported refund due',occurredAt:new Date().toISOString(),receiptId:postedReceipt._id,items:[{productId:product._id,quantity:1}]})).status,409);await verifyMain({stock:13,payable:0,cash:7000,bank:39000});
  ok(await browserHttp('POST',supplierPath+`/settlements/${fullyPaid._id}/reverse`,{requestKey:crypto.randomUUID(),reference:'REV-LOCAL-FULL',reason:'Actual original funds restored in this isolated correction',occurredAt:new Date().toISOString(),confirmation:'CONFIRM SUPPLIER REVERSAL'}));await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});pass('overpayment, insufficient funds, over-return, bank payment, fully paid return rejection and traceable reversal');

  const statement=ok(await get(`/accounts/financial/${ap._id}/history?limit=2`));assert.equal(statement.rangeOpeningBalanceMinor,0);assert.equal(statement.rangeClosingBalanceMinor,10000);assert.equal(statement.pagination.recordCount,7);assert.equal(statement.pagination.totalPages,4);
  const all=ok(await get(`/accounts/financial/${ap._id}/history?limit=100`));assert.equal(all.transactions.at(-1).runningBalanceMinor,10000);assert.ok(all.transactions.every(e=>e.actor.name===owner.username&&e.actor.role==='OWNER'));
  const paymentRow=all.transactions.find(e=>e.eventType==='SUPPLIER_PAYMENT'&&e.sourceDocument.reference==='PAY-LOCAL-CASH');assert.equal(paymentRow.postings.find(p=>p.account.kind==='CASH').moneyOutMinor,3000);assert.equal(all.transactions.find(e=>e.eventType==='SUPPLIER_RETURN').postings.some(p=>p.moneyInMinor>0),false);
  const register=ok(await get('/accounts/transactions?limit=100'));assert.equal(register.pagination.recordCount,await BusinessTransaction.countDocuments({shopId:shop._id}));assert.equal(ok(await get('/accounts/transactions/'+paymentRow.eventId)).transaction.actor.name,owner.username);
  await navigation('/owner/accounts/transactions');await label('Search transactions','PAY-LOCAL-CASH');await wait(`document.querySelectorAll('tbody tr').length===1&&document.querySelector('tbody tr').innerText.includes('PAY-LOCAL-CASH')`);await click('View transaction');await wait(`document.querySelector('dialog').innerText.includes('Money out PKR 30.00')`);assert.ok(await evaluate(`document.querySelector('dialog').innerText.includes('Pakistan')`));await click('Close');
  await navigation('/owner/accounts/transactions?account='+ap._id);await wait(`document.body.innerText.includes('Period closing: PKR 100.00')`);await label('From (UTC)',new Date().toISOString().slice(0,10));await wait(`document.body.innerText.includes('Period closing: PKR 100.00')`);
  await navigation('/owner/accounts/suppliers/'+supplier._id);await wait(`document.body.innerText.includes('Outstanding: PKR 100.00')&&document.body.innerText.includes('REV-LOCAL-FULL')`);pass('real register, statement pagination, Pakistan dates, UTC filter, source details, actors and supplier UI agree');

  // Additional isolated supplier/product for concurrent receiving and rollback.
  const concurrent=ok(await browserHttp('POST','/accounts/entities',{key:'concurrent-supplier',name:'Concurrent Supplier',roles:['SUPPLIER']}));
  const concurrentAp=await createAccount('SUPPLIER_PAYABLE','Concurrent Payable',concurrent._id),concurrentPreview=ok(await get(`/accounts/suppliers/${concurrent._id}/cutover-preview`));
  ok(await browserHttp('POST',`/accounts/suppliers/${concurrent._id}/cutover`,{requestKey:crypto.randomUUID(),confirmation:'CONFIRM SUPPLIER OPENING',reason:'Confirmed zero historical debt',cutoffAt:new Date().toISOString(),payableAccountId:concurrentAp._id,offsetAccountId:offset._id,equityAccountId:equity._id,openingBalanceMinor:0,otherOpeningMinor:0,evidenceDigest:concurrentPreview.evidenceDigest,reviews:[]}));
  const concurrentProduct=ok(await browserHttp('POST','/products/create-product',{name:'Concurrent Cable',brand:'Local',category:category._id,unit:'pcs',costPrice:1,retailPrice:2,stockQuantity:0,minStockThreshold:0})).product;
  let cpo=ok(await browserHttp('POST','/purchases/',{reference:'PO-CONCURRENT',requestKey:crypto.randomUUID(),supplierId:concurrent._id,items:[{productId:concurrentProduct._id,quantity:2,unitCostMinor:100}]})).purchaseOrder;
  cpo=ok(await browserHttp('POST',`/purchases/${cpo._id}/confirm`,{requestKey:crypto.randomUUID(),expectedRevision:cpo.revision})).purchaseOrder;
  const receiveBody={requestKey:crypto.randomUUID(),reference:'GR-CONCURRENT',expectedRevision:cpo.revision,items:[{productId:concurrentProduct._id,quantity:1}]};
  const competing=await Promise.all([api(owner,'POST',`/purchases/${cpo._id}/receipts`,receiveBody),api(owner,'POST',`/purchases/${cpo._id}/receipts`,receiveBody)]);assert.ok(competing.some(r=>r.status===200));assert.ok(competing.every(r=>[200,409].includes(r.status)));assert.equal((await Product.findById(concurrentProduct._id)).stockQuantity,1);assert.equal(await GoodsReceipt.countDocuments({requestKey:receiveBody.requestKey}),1);
  cpo=await PurchaseOrder.findById(cpo._id).lean();const rollbackBody={...receiveBody,requestKey:crypto.randomUUID(),reference:'GR-ROLLBACK',expectedRevision:cpo.revision},before=await snapshot(),originalCreate=BusinessTransaction.create;
  BusinessTransaction.create=async()=>{throw Error('Intentional isolated journal failure');};try{assert.equal((await api(owner,'POST',`/purchases/${cpo._id}/receipts`,rollbackBody)).status,500);}finally{BusinessTransaction.create=originalCreate;}
  assert.deepEqual(await snapshot(),before);assert.equal((await Product.findById(concurrentProduct._id)).stockQuantity,1);assert.equal(await GoodsReceipt.countDocuments({requestKey:rollbackBody.requestKey}),0);assert.equal((await PurchaseOrder.findById(cpo._id)).revision,cpo.revision);ok(await api(owner,'POST',`/purchases/${cpo._id}/receipts`,rollbackBody));assert.equal((await Product.findById(concurrentProduct._id)).stockQuantity,2);pass('real concurrent HTTP receiving and injected late journal failure prove single increments and rollback');

  const paths=['/purchases/',`/purchases/${mainPo._id}`,supplierPath+'/balance',supplierPath+'/settlements','/accounts/transactions'];
  for(const route of paths)assert.equal((await api(cashier,'GET',route)).status,403);
  for(const route of paths.filter(r=>r!=='/purchases/'&&r!=='/accounts/transactions'))assert.equal((await api(other,'GET',route)).status,404);
  const countBefore=await SupplierSettlement.countDocuments();assert.equal((await api(cashier,'POST',supplierPath+'/payments',pay(1,cash._id,'BAD-CASHIER'))).status,403);assert.equal((await api(other,'POST',supplierPath+'/payments',pay(1,cash._id,'BAD-SHOP'))).status,404);assert.equal(await SupplierSettlement.countDocuments(),countBefore);
  await login(cashier.username);await navigation('/owner/purchases');await wait(`location.pathname==='/cashier/pos'`);assert.equal(await evaluate(`[...document.querySelectorAll('.sidebar a')].some(a=>a.textContent==='Purchases')`),false);
  await login(owner.username);pass('real OWNER/CASHIER API and browser permissions, direct route guards and cross-shop isolation');

  const uninitialized=ok(await browserHttp('POST','/accounts/entities',{key:'missing-cutover',name:'Missing Opening Supplier',roles:['SUPPLIER']}));
  await navigation('/owner/accounts/suppliers/'+uninitialized._id);await wait(`document.body.innerText.includes('Payable unavailable')`);assert.equal(await evaluate(`document.body.innerText.includes('Outstanding: PKR 0.00')`),false);
  let missingPo=ok(await browserHttp('POST','/purchases/',{reference:'PO-NO-OPENING',requestKey:crypto.randomUUID(),supplierId:uninitialized._id,items:[{productId:concurrentProduct._id,quantity:1,unitCostMinor:100}]})).purchaseOrder;missingPo=ok(await browserHttp('POST',`/purchases/${missingPo._id}/confirm`,{requestKey:crypto.randomUUID(),expectedRevision:0})).purchaseOrder;
  assert.equal((await browserHttp('POST',`/purchases/${missingPo._id}/receipts`,{requestKey:crypto.randomUUID(),reference:'GR-NO-OPENING',expectedRevision:missingPo.revision,items:[{productId:concurrentProduct._id,quantity:1}]})).status,409);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:missingPo._id}),0);assert.equal((await Product.findById(concurrentProduct._id)).stockQuantity,2);
  const gap=ok(await browserHttp('POST','/accounts/entities',{key:'gap-supplier',name:'Gap Supplier',roles:['SUPPLIER']})),gapAp=await createAccount('SUPPLIER_PAYABLE','Gap Payable',gap._id),gapPreview=ok(await get(`/accounts/suppliers/${gap._id}/cutover-preview`));
  ok(await browserHttp('POST',`/accounts/suppliers/${gap._id}/cutover`,{requestKey:crypto.randomUUID(),confirmation:'CONFIRM SUPPLIER OPENING',reason:'Verified zero before new test gap',cutoffAt:new Date().toISOString(),payableAccountId:gapAp._id,offsetAccountId:offset._id,equityAccountId:equity._id,openingBalanceMinor:0,otherOpeningMinor:0,evidenceDigest:gapPreview.evidenceDigest,reviews:[]}));
  let gapPo=ok(await browserHttp('POST','/purchases/',{reference:'PO-GAP',requestKey:crypto.randomUUID(),supplierId:gap._id,items:[{productId:concurrentProduct._id,quantity:2,unitCostMinor:100}]})).purchaseOrder;gapPo=ok(await browserHttp('POST',`/purchases/${gapPo._id}/confirm`,{requestKey:crypto.randomUUID(),expectedRevision:0})).purchaseOrder;
  process.env.BUSINESS_ACCOUNTING_ENABLED='false';ok(await browserHttp('POST',`/purchases/${gapPo._id}/receipts`,{requestKey:crypto.randomUUID(),reference:'GR-DEFERRED-GAP',expectedRevision:gapPo.revision,items:[{productId:concurrentProduct._id,quantity:1}]}));process.env.BUSINESS_ACCOUNTING_ENABLED='true';assert.equal((await get(`/accounts/suppliers/${gap._id}/balance`)).status,409);const gapReport=ok(await get(`/accounts/suppliers/${gap._id}/reconciliation`));assert.equal(gapReport.authoritative,false);assert.ok(gapReport.issues.some(i=>/Unreviewed deferred/.test(i.problem)));
  gapPo=await PurchaseOrder.findById(gapPo._id);assert.equal((await browserHttp('POST',`/purchases/${gapPo._id}/receipts`,{requestKey:crypto.randomUUID(),reference:'GR-BLOCKED-GAP',expectedRevision:gapPo.revision,items:[{productId:concurrentProduct._id,quantity:1}]})).status,409);assert.equal((await Product.findById(concurrentProduct._id)).stockQuantity,3);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:gapPo._id}),1);
  pass('missing opening and unresolved post-cutoff deferred evidence fail closed without zero-balance UI');

  await navigation('/owner/purchases');await click('Create purchase order');await label('Purchase reference','UNSUBMITTED-DRAFT');const poCount=await PurchaseOrder.countDocuments();await send('Page.reload');await wait(`document.body.innerText.includes('Purchases')&&!!document.querySelector('.sidebar')`);assert.equal(await PurchaseOrder.countDocuments(),poCount);
  await label('Search purchases','PO-AFTER-CUTOFF');await sleep(300);await wait(`document.querySelector('tbody')?.innerText.includes('PO-AFTER-CUTOFF')`);assert.equal(await evaluate(`document.querySelector('tbody').innerText.includes('PO-BEFORE-CUTOFF')`),false);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth+1`),true);
  const reconciliation=ok(await get(supplierPath+'/reconciliation')),cashReconciliation=ok(await get('/accounts/reconciliation?clearingAccountId='+control._id));assert.equal(reconciliation.authoritative,true);assert.deepEqual(reconciliation.issues,[]);assert.equal(cashReconciliation.supplierReconciliation.find(s=>s.supplierId===String(supplier._id)).authoritative,true);assert.deepEqual(cashReconciliation.orphanedSupplierCashJournals,[]);
  await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});assert.equal(JSON.stringify(await Customer.findById(customer._id).lean()),customerBefore);assert.equal(await CustomerLedger.countDocuments(),0);assert.equal(JSON.stringify(await Shop.findById(foreignShop._id).lean()),foreignBefore);assert.deepEqual(errors,[]);
  pass('unsent-form refresh, purchase search, mobile overflow, final reconciliation and unchanged customer/other-shop records');
  for(const p of await Product.find({shopId:shop._id}).lean()){const logs=await StockLog.find({shopId:shop._id,productId:p._id}).lean();assert.equal(p.stockQuantity,logs.reduce((sum,l)=>sum+l.quantityDelta,0));}
  const finalSnapshot=await snapshot();assert.equal(finalSnapshot.receipts,3);assert.equal(finalSnapshot.events,5);assert.equal(finalSnapshot.logs,4);

  // Expense integration uses the SAME verified disposable database and real UI.
  const {Expense}=await import('../dist/models/expense.model.js');
  delete process.env.BUSINESS_ACCOUNTING_ENABLED;
  await navigation('/owner/expenses');await wait(`document.body.innerText.includes('Expense posting unavailable')`);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Record expense').disabled`),true);
  assert.equal(await Expense.countDocuments(),0);
  process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  await navigation('/owner/expenses');await wait(`!document.body.innerText.includes('Loading...')`);
  await fill('[aria-label="New expense category"]','Electricity');await click('Add category');
  await wait(`document.body.innerText.includes('Category saved.')`);
  await click('Record expense');await wait(`document.querySelector('[name=categoryId]')?.options.length>1`);
  const expenseCategory=await evaluate(`document.querySelector('[name=categoryId]').options[1].value`);
  await fill('[name=categoryId]',expenseCategory);await fill('[name=amount]','12.50');await fill('[name=accountId]',String(cash._id));
  await fill('[name=description]','Real browser electricity payment');await fill('[name=reference]','EXP-LOCAL');
  await click('Review payment');await wait(`document.body.innerText.includes('Confirm expense payment')`);
  await record();await wait(`document.querySelector('tbody')?.innerText.includes('Real browser electricity payment')`);
  assert.equal(await Expense.countDocuments({kind:'EXPENSE'}),1);assert.equal(ok(await get('/accounts/financial/'+cash._id)).balanceMinor,5750);
  const expense=await Expense.findOne({shopId:shop._id,kind:'EXPENSE'}).lean();assert.equal(expense.amountMinor,1250);assert.equal(String(expense.createdBy),String(owner._id));
  pass('real expense unavailable state, category creation, confirmed expense payment and persisted cash decrease');
  await label('Search expenses','EXP-LOCAL');await sleep(350);await wait(`document.querySelector('tbody')?.rows.length===1`);
  await click('Details');await wait(`document.body.innerText.includes('Recorded by: supplierowner')`);
  await fill('[name=reason]','Original cash actually restored');await click('Review reversal');await click('Confirm and record');await wait(`document.body.innerText.includes('Reversed on')`);
  assert.equal(ok(await get('/accounts/financial/'+cash._id)).balanceMinor,7000);
  const expenseReport=ok(await get('/accounts/expenses/reconciliation'));assert.equal(expenseReport.orphanedJournalCount,0);assert.ok(expenseReport.entries.every(e=>!e.issues.length));
  assert.equal(ok(await get('/accounts/expenses')).totalMinor,0);assert.equal(await Expense.countDocuments(),2);
  const expenseRegister=ok(await get('/accounts/transactions?type=EXPENSE&q=EXP-LOCAL'));assert.equal(expenseRegister.entries.length,1);assert.equal(expenseRegister.entries[0].sourceDocument.reference,'EXP-LOCAL');
  await navigation('/owner/expenses');await wait(`document.body.innerText.includes('Net expenses: PKR 0.00')`);
  pass('real expense details, search, immutable reversal, net totals and source-linked transaction register');
  await login(cashier.username);assert.equal(await evaluate(`[...document.querySelectorAll('nav a')].some(e=>e.textContent==='Expenses')`),false);
  await send('Page.navigate',{url:origin+'/owner/expenses'});await wait(`location.pathname==='/cashier/pos'`);
  await login(owner.username);await navigation('/owner/expenses');
  pass('expense owner-only sidebar and browser route protection preserve cashier POS');
  const evidence={passed:passed.length,scenarios:passed,verified:{mainProductStock:finalSnapshot.stock,supplierPayableMinor:reconciliation.balanceMinor,cashMinor:ok(await get('/accounts/financial/'+cash._id)).balanceMinor,bankMinor:ok(await get('/accounts/financial/'+bank._id)).balanceMinor,mainSupplierReceipts:finalSnapshot.receipts,mainSupplierSettlements:finalSnapshot.events,mainSupplierStatementEvents:all.pagination.recordCount,customerLedgerEntries:await CustomerLedger.countDocuments()},environment:{database:uri,mongoVersion,node:process.version,frontend:origin,backend:base}};
  await fs.mkdir('tests/artifacts',{recursive:true});await fs.writeFile('tests/artifacts/supplier-phase5a-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(error){console.error('SUPPLIER INTEGRATION FAILED:',error.stack);if(socket?.readyState===1)try{console.error('ACTUAL UI:',await evaluate('document.body.innerText'));}catch{}console.error('Passed:',passed);process.exitCode=1;}
finally{
  if(socket?.readyState===1){try{await send('Browser.close');}catch{}socket.close();}
  if(httpServer){httpServer.closeAllConnections();await new Promise(r=>httpServer.close(r));}if(upstreamServer){upstreamServer.closeAllConnections();await new Promise(r=>upstreamServer.close(r));}
  await mongoose.disconnect();for(const p of children.reverse())if(p.exitCode===null){p.kill();await new Promise(r=>p.exitCode!==null?r():p.once('exit',r));}
  for(const p of waiting.values())clearTimeout(p.timer);assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('digishop-supplier-integration-'));await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
