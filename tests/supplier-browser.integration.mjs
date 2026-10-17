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
const {Order} = await import('../dist/models/order.model.js');
const {CustomerLedger} = await import('../dist/models/customerLedger.model.js');
const {StockLog} = await import('../dist/models/stockLog.model.js');
const children = [], passed = [], errors = [];
let httpServer,upstreamServer,socket,sequence=0,dropPaymentResponse=false,dropSaleResponse=false;
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
      if(req.method==='POST'&&upstream.statusCode>=200&&upstream.statusCode<300&&((dropPaymentResponse&&req.url.endsWith('/payments'))||(dropSaleResponse&&req.url.endsWith('/create-order')))){
        if(req.url.endsWith('/payments'))dropPaymentResponse=false;else dropSaleResponse=false;
        upstream.resume();upstream.on('end',()=>{
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
  const paidReturn=ok(await browserHttp('POST',supplierPath+'/returns',{requestKey:crypto.randomUUID(),reference:'RET-PAID-GOODS',reason:'Supplier accepts paid goods back',occurredAt:new Date().toISOString(),receiptId:postedReceipt._id,items:[{productId:product._id,quantity:1}]})).settlement;
  assert.equal(ok(await get(supplierPath+'/balance')).creditMinor,2000);
  ok(await browserHttp('POST',supplierPath+'/settlements/'+paidReturn._id+'/reverse',{requestKey:crypto.randomUUID(),reference:'REV-PAID-RETURN',reason:'Goods actually restored',occurredAt:new Date().toISOString(),confirmation:'CONFIRM SUPPLIER REVERSAL'}));
  await verifyMain({stock:13,payable:0,cash:7000,bank:39000});
  ok(await browserHttp('POST',supplierPath+`/settlements/${fullyPaid._id}/reverse`,{requestKey:crypto.randomUUID(),reference:'REV-LOCAL-FULL',reason:'Actual original funds restored in this isolated correction',occurredAt:new Date().toISOString(),confirmation:'CONFIRM SUPPLIER REVERSAL'}));await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});pass('overpayment, insufficient funds, over-return, bank payment, fully paid return credit and traceable reversals');

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
  const finalSnapshot=await snapshot();assert.equal(finalSnapshot.receipts,3);assert.equal(finalSnapshot.events,7);assert.equal(finalSnapshot.logs,6);

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

  // Locked Step 1: partner equity is tested separately from supplier/expense cash.
  const {CapitalEvent}=await import('../dist/models/capitalEvent.model.js');
  delete process.env.BUSINESS_ACCOUNTING_ENABLED;
  await navigation('/owner/partners');await wait(`document.body.innerText.includes('Capital balances and posting unavailable')`);
  await click('Add partner');await fill('[name=name]','Local Shop Owner');await click('Save partner');
  await wait(`!document.querySelector('dialog[open]')&&document.body.innerText.includes('Local Shop Owner')`);
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='Investment').disabled`),true);
  process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  await navigation('/owner/partners');await wait(`document.body.innerText.includes('Total business capital: PKR 0.00')`);
  const capitalPartner=ok(await get('/accounts/partners')).entries.find(e=>e.name==='Local Shop Owner');
  async function capitalEntry(button,amount,reference){
    await click(button);await fill('[name=amount]',amount);await fill('[name=accountId]',String(cash._id));await fill('[name=description]','Actual local partner '+button.toLowerCase());await fill('[name=reference]',reference);await click('Review capital movement');await record();
  }
  await capitalEntry('Investment','20.00','CAP-LOCAL-IN');
  assert.equal(ok(await get('/accounts/financial/'+cash._id)).balanceMinor,9000);
  assert.equal(ok(await get('/accounts/partners')).total.balanceMinor,2000);
  await capitalEntry('Withdrawal','5.00','CAP-LOCAL-OUT');
  assert.equal(ok(await get('/accounts/financial/'+cash._id)).balanceMinor,8500);
  assert.equal(ok(await get('/accounts/partners')).total.balanceMinor,1500);
  pass('partner creation while disabled, real investment/withdrawal confirmations and exact persisted equity/cash');
  await click('Manage');await fill('[name=name]','Updated Local Owner');await click('Save partner');await wait(`!document.querySelector('dialog[open]')`);
  assert.equal((await CapitalEvent.findOne({reference:'CAP-LOCAL-IN'})).partnerName,'Local Shop Owner');
  async function capitalDetails(reference){await wait(`[...document.querySelectorAll('tbody tr')].some(e=>e.textContent.includes(${JSON.stringify(reference)}))`);await evaluate(`(()=>{const row=[...document.querySelectorAll('tbody tr')].find(e=>e.textContent.includes(${JSON.stringify(reference)}));row.querySelector('button').click();})()`);await wait(`document.querySelector('[name=reason]')!==null`);}
  await capitalDetails('CAP-LOCAL-OUT');await fill('[name=reason]','Withdrawn money actually restored');await click('Review capital reversal');await click('Confirm and record');await wait(`document.body.innerText.includes('Reversed on')`);await click('Close');
  await capitalDetails('CAP-LOCAL-IN');await fill('[name=reason]','Investment actually returned to partner');await click('Review capital reversal');await click('Confirm and record');await wait(`document.body.innerText.includes('Reversed on')`);await click('Close');
  assert.equal(ok(await get('/accounts/financial/'+cash._id)).balanceMinor,7000);
  const partnerResult=ok(await get('/accounts/partners'));assert.equal(partnerResult.total.balanceMinor,0);assert.equal(partnerResult.total.contributionsMinor,0);assert.equal(partnerResult.total.withdrawalsMinor,0);
  assert.equal(await CapitalEvent.countDocuments(),4);
  const capitalRegister=ok(await get('/accounts/transactions?type=CAPITAL_CONTRIBUTION&q=CAP-LOCAL-IN'));assert.equal(capitalRegister.entries.length,1);assert.ok(capitalRegister.entries[0].reversedBy.length);
  await click('Manage');await fill('[name=partnerActive]','false');await click('Save partner');await wait(`document.body.innerText.includes('Archived')&&!document.querySelector('dialog[open]')`);
  assert.equal(ok(await get('/accounts/partners')).entries.find(e=>e._id===capitalPartner._id).partnerActive,false);
  assert.equal((await api(cashier,'POST','/accounts/capital',{partnerId:capitalPartner._id})).status,403);
  pass('partner edits preserve snapshots, both reversal directions restore balances, history/register links and zero-capital archive');
  await login(cashier.username);assert.equal(await evaluate(`[...document.querySelectorAll('nav a')].some(e=>e.textContent==='Partners & Capital')`),false);
  await send('Page.navigate',{url:origin+'/owner/partners'});await wait(`location.pathname==='/cashier/pos'`);
  await login(owner.username);await navigation('/owner/partners');
  await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});assert.equal(await CustomerLedger.countDocuments(),0);
  pass('capital role protection and unchanged supplier, expense, stock and customer balances');

  // Locked Step 2: existing openings are separate from live business activity.
  await navigation('/owner/existing-setup');await wait(`document.body.innerText.includes('Posted business activity already exists')`);
  assert.equal(await evaluate(`document.body.innerText.includes('Opening setup confirmed by')`),false);
  const setupFixture=await fixture('existingowner','03555555555');
  await login(setupFixture.user.username);
  const setupProduct=await Product.create({shopId:setupFixture.shop._id,name:'Opening switches',slug:'opening-switches',brand:'Switch',category:new mongoose.Types.ObjectId(),unit:'pcs',stockQuantity:6,costPrice:10,retailPrice:20});
  const setupSupplier=ok(await browserHttp('POST','/accounts/entities',{key:'setup-existing-eagle',name:'Existing Eagle',roles:['SUPPLIER']}));
  const setupCash=ok(await browserHttp('POST','/accounts/financial',{code:'SETUP-CASH',name:'Existing Till',kind:'CASH'}));
  const setupBank=ok(await browserHttp('POST','/accounts/financial',{code:'SETUP-BANK',name:'Existing Empty Bank',kind:'BANK'}));
  await navigation('/owner/existing-setup');await wait(`document.querySelector('[name="cash-${setupCash._id}"]')!==null`);
  await fill('[name=reason]','Owner checked the existing shop before opening');
  await fill('[name="cash-'+setupCash._id+'"]','100.00');await fill('[name="cash-'+setupBank._id+'"]','0');
  await fill('[name="other-'+setupSupplier._id+'"]','10.00');
  await label('Expected net business value','150.00');
  await evaluate(`(()=>{document.querySelector('[name=customers]').click();document.querySelector('[name=equity]').click();})()`);
  await click('Save setup draft');await wait(`document.body.innerText.includes('Review for confirmation')`);
  await navigation('/owner/existing-setup');await wait(`document.querySelector('[name="cash-${setupBank._id}"]')?.value==='0'`);
  await click('Review for confirmation');await wait(`document.body.innerText.includes('Preview expires after 5 minutes')`);
  await evaluate(`document.querySelector('[name=inventoryReviewed]').click()`);
  await label('Type CONFIRM EXISTING BUSINESS SETUP','CONFIRM EXISTING BUSINESS SETUP');
  await click('Confirm reviewed setup');await record();await wait(`document.body.innerText.includes('Opening setup confirmed by existingowner')`);
  const setupResult=ok(await get('/accounts/existing-setup'));assert.equal(setupResult.setup.state,'CONFIRMED');assert.equal(setupResult.evidence.totals.netAssetsMinor,15000);
  assert.equal((await Product.findById(setupProduct._id)).stockQuantity,6);assert.equal(await StockLog.countDocuments({shopId:setupFixture.shop._id}),0);
  assert.equal(ok(await get('/accounts/financial/'+setupCash._id)).balanceMinor,10000);assert.equal(ok(await get('/accounts/financial/'+setupBank._id)).balanceMinor,0);
  assert.equal(ok(await get('/accounts/suppliers/'+setupSupplier._id+'/balance')).balanceMinor,1000);
  assert.equal(await CapitalEvent.countDocuments({shopId:setupFixture.shop._id}),0);
  const setupJournals=await BusinessTransaction.countDocuments({shopId:setupFixture.shop._id});assert.equal(setupJournals,3);
  const confirmationRequest=requests.filter(r=>r.path==='/api/v2/accounts/existing-setup/confirm'&&r.method==='POST').at(-1);
  assert.equal(ok(await browserHttp('POST','/accounts/existing-setup/confirm',JSON.parse(confirmationRequest.body))).replayed,true);
  assert.equal(await BusinessTransaction.countDocuments({shopId:setupFixture.shop._id}),setupJournals);
  await navigation('/owner/existing-setup');await wait(`document.body.innerText.includes('preserved opening values, not current balances')`);
  pass('existing setup real draft, zero-balance reload, explicit preview/typed confirmation, supplier/cash/inventory openings and identical replay');
  const zeroFixture=await fixture('zerobrowserowner','03777777777');
  await login(zeroFixture.user.username);
  ok(await browserHttp('POST','/accounts/activation/prepare',{expectedRevision:0,requestKey:'zero-browser-prepare',strategy:'CLEAN_START',reason:'Brand-new empty shop',confirmation:'PREPARE ACCOUNTING'}));
  const zeroCash=ok(await browserHttp('POST','/accounts/financial',{code:'MAIN-CASH',name:'main cash',kind:'CASH'}));
  await navigation('/owner/existing-setup');await wait(`document.querySelector('[name="cash-${zeroCash._id}"]')!==null`);
  await click('Save setup draft');
  await wait(`document.querySelector('[name=reason]').getAttribute('aria-invalid')==='true'`);
  assert.ok(await evaluate(`document.querySelector('[name=reason]').closest('label').querySelector('[role=alert]').textContent.includes('setup note')`));
  assert.ok(await evaluate(`document.querySelector('[name="cash-${zeroCash._id}"]').closest('label').querySelector('[role=alert]')!==null`));
  await label('Setup note','New shop with no opening stock or money');await fill('[name="cash-'+zeroCash._id+'"]','-1');await label('Expected net business value','0');
  await evaluate(`(()=>{document.querySelector('[name=customers]').click();document.querySelector('[name=equity]').click();})()`);
  await click('Save setup draft');await wait(`document.querySelector('[name="cash-${zeroCash._id}"]').getAttribute('aria-invalid')==='true'`);
  await fill('[name="cash-'+zeroCash._id+'"]','0');
  await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Save setup draft').scrollIntoView({block:'center'})`);
  const zeroSaveScroll=await evaluate('window.scrollY');
  await click('Save setup draft');await wait(`document.body.innerText.includes('Draft saved. Next: click Review for confirmation below.')`);
  assert.ok(await evaluate('window.scrollY')>=zeroSaveScroll/2,'Successful save must not collapse the page to the top');
  await wait(`document.body.innerText.includes('Saved — awaiting confirmation')`);
  const zeroSaved=ok(await get('/accounts/existing-setup'));assert.equal(zeroSaved.setup.state,'DRAFT');assert.equal(zeroSaved.setup.input.cash[0].amountMinor,0);assert.equal(zeroSaved.evidence.inventory.length,0);
  assert.equal(await BusinessTransaction.countDocuments({shopId:zeroFixture.shop._id}),0);
  // Real stale-revision response, not a mocked financial error. The form must
  // retain entered values and display the failure beside Save.
  ok(await browserHttp('PUT','/accounts/existing-setup',{expectedRevision:zeroSaved.setup.revision,input:{...zeroSaved.setup.input,reason:'Draft updated from another session'}}));
  await label('Setup note','My zero opening review');await click('Save setup draft');
  await wait(`document.querySelector('[aria-label="Opening setup draft"]').innerText.includes('Draft not saved: Setup draft changed')`);
  assert.equal(await evaluate(`document.querySelector('[name="cash-${zeroCash._id}"]').value`),'0');
  await navigation('/owner/existing-setup');await wait(`document.querySelector('[name="cash-${zeroCash._id}"]')?.value==='0'`);
  assert.ok(await evaluate(`document.body.innerText.includes('A draft is saved, but setup is not confirmed.')`));
  await click('Review for confirmation');await wait(`document.querySelector('[name=inventoryReviewed]')!==null`);
  assert.ok(await evaluate(`document.body.innerText.includes('no products, quantity 0 and value PKR 0')`));
  await label('Type CONFIRM EXISTING BUSINESS SETUP','CONFIRM EXISTING BUSINESS SETUP');
  assert.equal(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirm reviewed setup').disabled`),true);
  await evaluate(`document.querySelector('[name=inventoryReviewed]').click()`);
  await click('Confirm reviewed setup');await record();await wait(`document.body.innerText.includes('Opening setup confirmed by zerobrowserowner')`);
  assert.equal(ok(await get('/accounts/existing-setup')).evidence.inventoryStatus,'COMPLETE');
  assert.equal(ok(await get('/accounts/financial/'+zeroCash._id)).balanceMinor,0);
  for(const model of [Product,Customer,Order,StockLog,BusinessTransaction])assert.equal(await model.countDocuments({shopId:zeroFixture.shop._id}),0);
  assert.equal((await Shop.findById(zeroFixture.shop._id)).accounting.state,'PREPARING');
  pass('brand-new zero setup: inline validation, no save jump, visible success, persisted zero reload, stale-error retention, explicit empty-stock review and no automatic activation');
  await login(cashier.username);assert.equal(await evaluate(`[...document.querySelectorAll('nav a')].some(e=>e.textContent==='Existing Business Setup')`),false);
  await send('Page.navigate',{url:origin+'/owner/existing-setup'});await wait(`location.pathname==='/cashier/pos'`);
  await login(owner.username);
  await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});
  pass('setup prevents resetting active books, preserves original shop records and remains OWNER-only');
  await navigation('/owner/reports');await wait(`document.body.innerText.includes('Net revenue')`);
  assert.ok(await evaluate(`document.body.innerText.includes('Profit & Loss') && document.body.innerText.includes('cost at sale')`));
  assert.ok(await evaluate(`document.body.innerText.includes('Reference estimate') && document.body.innerText.includes('not revenue or profit')`));
  const reportDay=new Date().toISOString().slice(0,10);
  await label('From (UTC)',reportDay);await label('Through (UTC)',reportDay);await click('Show reports');await wait(`document.body.innerText.includes('Net revenue')`);
  const report=ok(await get('/accounts/reports?from='+reportDay+'T00:00:00.000Z&to='+new Date(Date.parse(reportDay+'T00:00:00.000Z')+86400000).toISOString()));
  assert.equal(report.profit.status,'UNAVAILABLE');assert.equal(report.inventory.entries.find(p=>p.id===String(product._id)).quantity,13);
  assert.equal(report.cashBank.entries.find(a=>a.id===String(cash._id)).currentBalanceMinor,7000);
  assert.equal(report.cashBank.entries.find(a=>a.id===String(bank._id)).currentBalanceMinor,49000);
  assert.equal(report.capital.balanceMinor,0);assert.equal(report.expenses.netMinor,0);
  await navigation('/owner/reports');await wait(`document.body.innerText.includes('Net revenue')`);
  pass('financial reports real OWNER UI, UTC filters, refresh, persisted cash/bank/stock, capital/expense reversal totals and unavailable profit');
  delete process.env.BUSINESS_ACCOUNTING_ENABLED;await navigation('/owner/reports');await wait(`document.body.innerText.includes('financial balances are unavailable')`);
  assert.ok(await evaluate(`document.body.innerText.includes('Net revenue') && document.body.innerText.includes('Unavailable:')`));
  process.env.BUSINESS_ACCOUNTING_ENABLED='true';
  await login(cashier.username);assert.equal(await evaluate(`[...document.querySelectorAll('nav a')].some(e=>e.textContent==='Financial Reports')`),false);
  await send('Page.navigate',{url:origin+'/owner/reports'});await wait(`location.pathname==='/cashier/pos'`);assert.equal((await get('/accounts/reports?from='+reportDay+'T00:00:00.000Z&to='+new Date().toISOString())).status,403);
  await login(owner.username);await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});
  pass('financial reports disabled accounting is unavailable not zero; CASHIER navigation/API protection and unchanged operational balances');
  // Separate supplier/product, real posted receipts, no production data or mocked balances.
  const creditSupplier=ok(await browserHttp('POST','/accounts/entities',{key:'browser-credit-supplier',name:'Refund Supplier',roles:['SUPPLIER']}));
  const creditAp=await createAccount('SUPPLIER_PAYABLE','Refund Supplier AP',creditSupplier._id),creditPath='/accounts/suppliers/'+creditSupplier._id;
  const cp=ok(await get(creditPath+'/cutover-preview'));
  ok(await browserHttp('POST',creditPath+'/cutover',{requestKey:crypto.randomUUID(),confirmation:'CONFIRM SUPPLIER OPENING',reason:'Explicit verified zero opening',cutoffAt:new Date().toISOString(),payableAccountId:creditAp._id,offsetAccountId:offset._id,equityAccountId:equity._id,openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:cp.evidenceDigest}));
  const creditProduct=ok(await browserHttp('POST','/products/create-product',{name:'Refund Test Cable',brand:'Refund',category:category._id,unit:'pcs',costPrice:1,retailPrice:2,stockQuantity:0,minStockThreshold:0})).product;
  async function creditDelivery(reference,quantity){let po=ok(await browserHttp('POST','/purchases/',{reference,requestKey:crypto.randomUUID(),supplierId:creditSupplier._id,items:[{productId:creditProduct._id,quantity,unitCostMinor:100}]})).purchaseOrder;po=ok(await browserHttp('POST','/purchases/'+po._id+'/confirm',{requestKey:crypto.randomUUID(),expectedRevision:po.revision})).purchaseOrder;const receipt=ok(await browserHttp('POST','/purchases/'+po._id+'/receipts',{requestKey:crypto.randomUUID(),reference:'GR-'+reference,expectedRevision:po.revision,items:[{productId:creditProduct._id,quantity}]})).receipt;return {po,receipt};}
  const delivery=await creditDelivery('CREDIT-PO-1',10);
  const creditPayment=ok(await browserHttp('POST',creditPath+'/payments',pay(1000,bank._id,'CREDIT-PAID'))).settlement;
  await navigation('/owner/purchases/'+delivery.po._id);await click('Return details');await label('Return Refund Test Cable',5);await label('Return reference','CREDIT-RETURN');await label('Return reason','Supplier accepted paid stock back');await click('Review return');await record();
  assert.equal(ok(await get(creditPath+'/balance')).creditMinor,500);assert.equal((await Product.findById(creditProduct._id)).stockQuantity,5);
  await navigation('/owner/accounts/suppliers/'+creditSupplier._id);await wait(`document.body.innerText.includes('Available credit / refund due: PKR 5.00')`);
  await wait("[...document.querySelector('[aria-label=\"Refund account\"]').options].some(o=>o.value==="+JSON.stringify(String(cash._id))+")");await fill('[aria-label="Refund account"]',cash._id);await label('Credit amount (PKR)','2');await label('Credit transaction reference','CREDIT-REFUND');await label('Credit transaction note','Actual refund received into till');await click('Review supplier credit');await click('Confirm money received');await wait(`!document.querySelector('dialog[open]')`);
  const refundState=ok(await get(creditPath+'/balance'));assert.equal(refundState.creditMinor,300);assert.equal(refundState.refundsReceivedMinor,200);assert.equal(ok(await get('/accounts/financial/'+cash._id)).balanceMinor,7200);
  const refundRequest=requests.filter(r=>r.path===('/api/v2'+creditPath+'/refunds')&&r.method==='POST').at(-1);assert.equal(ok(await browserHttp('POST',creditPath+'/refunds',JSON.parse(refundRequest.body))).replayed,true);
  await creditDelivery('CREDIT-PO-2',3);await navigation('/owner/accounts/suppliers/'+creditSupplier._id);await wait(`document.body.innerText.includes('Outstanding: PKR 3.00')`);
  await fill('[aria-label="Credit action"]','CREDIT_APPLICATION');await label('Credit amount (PKR)','2');await label('Credit transaction reference','CREDIT-APPLY');await label('Credit transaction note','Use supplier credit against new delivery');await click('Review supplier credit');await click('Confirm credit applied');await wait(`!document.querySelector('dialog[open]')`);
  const appliedState=ok(await get(creditPath+'/balance'));assert.equal(appliedState.balanceMinor,100);assert.equal(appliedState.creditMinor,100);assert.equal(appliedState.creditAppliedMinor,200);assert.equal(ok(await get('/accounts/financial/'+cash._id)).balanceMinor,7200);
  await navigation('/owner/accounts/suppliers/'+creditSupplier._id);await wait(`document.body.innerText.includes('Credit applied (net of corrections): PKR 2.00')`);
  pass('supplier credits real paid-goods return UI, partial cash refund, identical replay, future payable and partial credit application without cash');
  async function correctCredit(reference,nextReference){await navigation('/owner/accounts/suppliers/'+creditSupplier._id);await wait(`[...document.querySelectorAll('tr')].some(r=>r.innerText.includes(${JSON.stringify(reference)}))`);await evaluate(`(()=>{const row=[...document.querySelectorAll('tr')].find(r=>r.innerText.includes(${JSON.stringify(reference)}));row.querySelector('button').click();})()`);await label('Correction reference',nextReference);await label('Correction reason','Actual money or goods restored');await click('Review reversal');await click('Confirm actual reversal');await wait(`!document.querySelector('dialog[open]')`);}
  await correctCredit('CREDIT-APPLY','REV-CREDIT-APPLY');assert.equal(ok(await get(creditPath+'/balance')).creditMinor,300);
  await correctCredit('CREDIT-REFUND','REV-CREDIT-REFUND');assert.equal(ok(await get(creditPath+'/balance')).creditMinor,500);
  await correctCredit('CREDIT-RETURN','REV-CREDIT-RETURN');assert.equal(ok(await get(creditPath+'/balance')).creditMinor,0);assert.equal((await Product.findById(creditProduct._id)).stockQuantity,13);
  ok(await browserHttp('POST',creditPath+'/settlements/'+creditPayment._id+'/reverse',{requestKey:crypto.randomUUID(),reference:'REV-CREDIT-PAID',reason:'Actual payment returned in isolated test',occurredAt:new Date().toISOString(),confirmation:'CONFIRM SUPPLIER REVERSAL'}));
  await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});assert.equal(ok(await get(creditPath+'/balance')).balanceMinor,1300);
  await navigation('/owner/accounts/transactions?account='+refundState.creditAccountId);await wait(`document.body.innerText.includes('Period closing: PKR 0.00')`);
  pass('supplier credit UI corrections preserve history, reverse applications/refunds before return, exact inventory and cash restoration, credit statement');
  const correctionCompany=ok(await browserHttp('POST','/accounts/entities',{key:'correction-company',name:'Correction Company',roles:['COMPANY']}));
  await navigation('/owner/accounts/companies');await fill('[aria-label="Search businesses"]','Correction Company');await wait("document.querySelectorAll('tbody tr').length===1&&document.querySelector('tbody tr').innerText.includes('Correction Company')");await click('Business setup');await wait("document.body.innerText.includes('Business roles')");
  await evaluate("document.querySelector('[aria-label=\"Role Supplier\"]').click()");await click('Save roles');await wait("document.body.innerText.includes('Purchases, payments & supplier history')");
  assert.equal(ok(await get('/accounts/entities/'+correctionCompany._id)).roles.includes('SUPPLIER'),true);assert.equal(await BusinessEntity.countDocuments({shopId:shop._id,name:'Correction Company'}),1);
  await label('New brand name','Correction Brand');await click('Add brand association');await wait("document.body.innerText.includes('Brand linked.')");
  const {BusinessBrand}=await import('../dist/models/businessBrand.model.js'),correctionBrand=await BusinessBrand.findOne({shopId:shop._id,name:'Correction Brand'}).lean();
  const correctionProduct=ok(await browserHttp('POST','/products/create-product',{name:'Correction Product',brand:'Correction Brand',category:category._id,unit:'pcs',costPrice:1,retailPrice:2,stockQuantity:2,minStockThreshold:0})).product;
  assert.equal(ok(await get('/accounts/entities/'+correctionCompany._id+'/products')).entries.length,0);
  await label('Find product to link','Correction Product');await click('Correction Product');await wait("document.querySelector('dialog select')?.options.length>1");await fill('dialog select',String(correctionBrand._id));await click('Confirm product brand link');await wait("document.body.innerText.includes('Registered brand: Correction Brand')");
  const linked=ok(await get('/accounts/entities/'+correctionCompany._id+'/products'));assert.equal(linked.entries[0].stockQuantity,2);assert.equal(linked.sales.status,'UNAVAILABLE');
  await click('Close');pass('corrections: Company gains Supplier on same identity; explicit registered-brand product link and actual stock, no invented company sales');
  await navigation('/owner/purchases');await click('Create purchase order');await label('Supplier invoice / challan','DOC-CORRECTION');await label('Purchase notes','Owner confirmed purchase note');await label('Find supplier','Correction Company');await click('Correction Company');await label('Find purchase products','Correction Product');await click('Add Correction Product');await fill('[aria-label="Quantity for Correction Product"]','2');await fill('[aria-label="Unit cost for Correction Product"]','1');await click('Review purchase order');await record();
  let correctionPo=await PurchaseOrder.findOne({shopId:shop._id,supplierId:correctionCompany._id}).lean();assert.match(correctionPo.reference,/^PO-AUTO-\d+$/);assert.equal(correctionPo.notes,'Owner confirmed purchase note');assert.equal(correctionPo.supplierDocumentNo,'DOC-CORRECTION');
  await navigation('/owner/purchases/'+correctionPo._id);await click('Confirm order');await record();
  delete process.env.BUSINESS_ACCOUNTING_ENABLED;await label('Delivery invoice / challan','CHALLAN-CORRECTION');await label('Delivery notes','Physically checked old delivery');await fill('[aria-label="Delivered Correction Product"]','1');await click('Review delivered quantities');await record();
  const oldCorrection=await GoodsReceipt.findOne({purchaseOrderId:correctionPo._id}).lean();assert.match(oldCorrection.reference,/^GR-AUTO-\d+$/);assert.equal(oldCorrection.accountingStatus,'DEFERRED');assert.equal(oldCorrection.notes,'Physically checked old delivery');assert.equal(oldCorrection.supplierDocumentNo,'CHALLAN-CORRECTION');
  const automaticRequest=requests.filter(r=>r.method==='POST'&&r.path==='/api/v2/purchases/').at(-1);assert.equal(ok(await browserHttp('POST','/purchases/',JSON.parse(automaticRequest.body))).replayed,true);
  pass('corrections: real purchase and partial-delivery UI generate references, preserve notes/challan and identical-key replay');
  process.env.BUSINESS_ACCOUNTING_ENABLED='true';await navigation('/owner/accounts/suppliers/'+correctionCompany._id);await wait("document.body.innerText.includes('Prepare supplier account / review opening')");await evaluate("[...document.querySelectorAll('summary')].find(e=>e.textContent==='Prepare supplier account / review opening').click()");
  await click('Create supplier payable account');await wait("[...document.querySelector('[name=SUPPLIER_PAYABLE]').options].length>1");const correctionAp=await FinancialAccount.findOne({shopId:shop._id,entityId:correctionCompany._id,kind:'SUPPLIER_PAYABLE'}).lean();assert.ok(correctionAp);
  await fill('[name=SUPPLIER_PAYABLE]',String(correctionAp._id));await fill('[name=PURCHASES_CLEARING]',String(offset._id));await fill('[name=OPENING_EQUITY]',String(equity._id));
  await label('Unpaid amount for '+oldCorrection.reference,'0.75');await label('Review / external payment evidence for '+oldCorrection.reference,'25 paisa paid outside DigiShop before opening');await label('Historical opening review note','Owner checked original challan and payment evidence');await evaluate("[...document.querySelectorAll('label')].find(e=>e.textContent.includes('I verified every old delivery')).querySelector('input').click()");await click('Review supplier opening');await record();
  const openingState=ok(await get('/accounts/suppliers/'+correctionCompany._id+'/balance'));assert.equal(openingState.balanceMinor,75);assert.equal(openingState.cutover.reviews[0].unpaidMinor,75);assert.equal((await GoodsReceipt.findById(oldCorrection._id)).accountingStatus,'DEFERRED');
  const openingRequest=requests.filter(r=>r.method==='POST'&&r.path===('/api/v2/accounts/suppliers/'+correctionCompany._id+'/cutover')).at(-1);assert.equal(ok(await browserHttp('POST','/accounts/suppliers/'+correctionCompany._id+'/cutover',JSON.parse(openingRequest.body))).replayed,true);
  await navigation('/owner/purchases/'+correctionPo._id);await fill('[aria-label="Delivered Correction Product"]','1');await click('Review delivered quantities');await record();assert.equal(ok(await get('/accounts/suppliers/'+correctionCompany._id+'/balance')).balanceMinor,175);assert.equal((await Product.findById(correctionProduct._id)).stockQuantity,4);
  assert.equal(await BusinessTransaction.countDocuments({shopId:shop._id,'source.kind':'PURCHASE_RECEIPT','source.referenceId':oldCorrection._id}),0);
  await navigation('/owner/reports');await wait("document.body.innerText.includes('Why cost and profit need reconciliation')");const costReport=ok(await get('/accounts/reports?from='+reportDay+'T00:00:00.000Z&to='+new Date(Date.parse(reportDay+'T00:00:00.000Z')+86400000).toISOString()));assert.equal(costReport.profit.status,'UNAVAILABLE');assert.equal(costReport.profit.evidence.costAtSaleSnapshots,false);
  await verifyMain({stock:13,payable:10000,cash:7000,bank:49000});pass('corrections: owner-reviewed deferred opening, external-payment evidence, immutable replay, later receipt posting, blocked profit and unchanged existing balances');
  const newSupplier=ok(await browserHttp('POST','/accounts/entities',{key:'new-zero-supplier',name:'New zero supplier',roles:['COMPANY','SUPPLIER']}));
  const coil=ok(await browserHttp('POST','/products/create-product',{name:'3/29 Black Coil',brand:'New Coil',category:category._id,unit:'coil',costPrice:3000,retailPrice:3500,stockQuantity:0,minStockThreshold:0})).product;
  let newPo=ok(await browserHttp('POST','/purchases/',{requestKey:crypto.randomUUID(),supplierId:newSupplier._id,items:[{productId:coil._id,quantity:10,unitCostMinor:300000}]})).purchaseOrder;
  newPo=ok(await browserHttp('POST','/purchases/'+newPo._id+'/confirm',{requestKey:crypto.randomUUID(),expectedRevision:newPo.revision})).purchaseOrder;
  const blockedReceipt={requestKey:crypto.randomUUID(),expectedRevision:newPo.revision,items:[{productId:coil._id,quantity:5}]};
  assert.equal((await browserHttp('POST','/purchases/'+newPo._id+'/receipts',blockedReceipt)).status,409);
  assert.equal((await Product.findById(coil._id)).stockQuantity,0);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:newPo._id}),0);
  await navigation('/owner/accounts/suppliers/'+newSupplier._id);
  await wait("document.body.innerText.includes('Prepare supplier account / review opening')");
  await evaluate("[...document.querySelectorAll('summary')].find(e=>e.textContent==='Prepare supplier account / review opening').click()");
  await wait("document.body.innerText.includes('This is a new supplier')");
  assert.equal(await evaluate("[...document.querySelectorAll('input[type=checkbox]')].find(e=>e.closest('label').textContent.includes('This is a new supplier')).checked"),false);
  const selectedAccounts={};
  for(const kind of ['SUPPLIER_PAYABLE','PURCHASES_CLEARING','OPENING_EQUITY']){
    await click('Create '+kind.replaceAll('_',' ').toLowerCase()+' account');
    await wait(`!!document.querySelector('[name=${kind}]')?.value&&!document.querySelector('[name=${kind}]').disabled`);
    selectedAccounts[kind]=await evaluate(`document.querySelector('[name=${kind}]').value`);
    for(const [previous,id] of Object.entries(selectedAccounts))assert.equal(await evaluate(`document.querySelector('[name=${previous}]').value`),id,'Account creation/reload must retain previous selections');
  }
  await fill('[name=SUPPLIER_PAYABLE]','');assert.equal(await evaluate("document.querySelector('[name=SUPPLIER_PAYABLE]').value"),'');
  await fill('[name=SUPPLIER_PAYABLE]',selectedAccounts.SUPPLIER_PAYABLE);
  await label('Historical opening review note','New supplier; owner verified zero earlier debt and no deliveries');
  await evaluate("[...document.querySelectorAll('label')].find(e=>e.textContent.includes('I verified every old delivery')).querySelector('input').click()");
  await click('Review supplier opening');await record();
  await wait("document.body.innerText.includes('Outstanding:')");
  assert.equal(ok(await get('/accounts/suppliers/'+newSupplier._id+'/balance')).balanceMinor,0);
  for(const expected of [5,10]){
    await navigation('/owner/purchases/'+newPo._id);await fill('[aria-label="Delivered 3/29 Black Coil"]','5');await click('Review delivered quantities');await record();
    await wait(`document.body.innerText.includes(${JSON.stringify(expected===5?'Partially received':'Received')})`);
    assert.equal((await Product.findById(coil._id)).stockQuantity,expected);
    assert.equal(ok(await get('/accounts/suppliers/'+newSupplier._id+'/balance')).balanceMinor,expected*300000);
    if(expected===5){const updated=await PurchaseOrder.findById(newPo._id);assert.equal(updated.status,'PARTIALLY_RECEIVED');assert.equal(updated.items[0].quantity-updated.items[0].receivedQuantity,5);}
  }
  assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:newPo._id}),2);
  const sent=requests.filter(r=>r.method==='POST'&&r.path===('/api/v2/purchases/'+newPo._id+'/receipts')).at(-1);
  assert.equal(ok(await browserHttp('POST','/purchases/'+newPo._id+'/receipts',JSON.parse(sent.body))).replayed,true);
  assert.equal((await Product.findById(coil._id)).stockQuantity,10);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:newPo._id}),2);
  pass('manual supplier account creation auto-selects and retains all dropdowns; confirmed zero opening unblocks existing PO, 5+5 receipt and duplicate replay');
  await login(zeroFixture.user.username);
  process.env.NODE_ENV='production';process.env.BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED='true';
  const activationPreview=ok(await browserHttp('POST','/accounts/activation/preview',{}));assert.equal(activationPreview.ready,true);
  ok(await browserHttp('POST','/accounts/activation/confirm',{expectedRevision:activationPreview.expectedRevision,requestKey:crypto.randomUUID(),reason:'Disposable production-mode POS verification',confirmation:'ACTIVATE ACCOUNTING',previewToken:activationPreview.previewToken,expiresAt:activationPreview.expiresAt}));
  const posCategory=ok(await browserHttp('POST','/categories/create-category',{name:'Coils'})).category;
  const posCoil=ok(await browserHttp('POST','/products/create-product',{name:'3/29 Black Coil',brand:'Eagle',category:posCategory._id,unit:'coil',costPrice:3000,retailPrice:4000,stockQuantity:10,minStockThreshold:0})).product;
  const posBuyer=ok(await browserHttp('POST','/customers/create-customer',{name:'First credit buyer',phoneNo:'03001112223'})).customer;
  const noKey={items:[{productId:posCoil._id,quantity:2}],saleType:'RETAIL',paidAmount:5000,customerId:posBuyer._id,receiptAccountId:zeroCash._id};
  assert.equal((await browserHttp('POST','/orders/create-order',noKey)).status,400);
  assert.equal((await Product.findById(posCoil._id)).stockQuantity,10);assert.equal((await Customer.findById(posBuyer._id)).remainingMoney,0);
  assert.equal(await Order.countDocuments({shopId:zeroFixture.shop._id}),0);assert.equal(await CustomerLedger.countDocuments({shopId:zeroFixture.shop._id}),0);
  await navigation('/owner/sales');await fill('[aria-label="Search products by name or brand"]','3/29 Black Coil');await wait("!!document.querySelector('.product-result:not(:disabled)')");await evaluate("document.querySelector('.product-result:not(:disabled)').click()");
  await fill('.cart-table .quantity','2');await label('Amount paid','5000');await wait("!!document.querySelector('.customer-result')");await evaluate("document.querySelector('.customer-result').click()");
  await click('Complete sale');await wait("document.body.innerText.includes('Select the cash or bank account receiving this payment.')");
  assert.equal(await Order.countDocuments({shopId:zeroFixture.shop._id}),0);
  await fill('[aria-label="Payment account"]',zeroCash._id);
  dropSaleResponse=true;
  await evaluate("(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent==='Complete sale');b.click();b.click();})()");
  await wait("document.body.innerText.includes('Retry same sale')");
  const posInvoice=await Order.findOne({shopId:zeroFixture.shop._id});assert.equal(posInvoice.totalPrice,8000);assert.equal(posInvoice.paidAmount,5000);assert.equal(posInvoice.amountDue,3000);assert.equal(posInvoice.accountingMode,'LIVE');
  assert.equal((await Product.findById(posCoil._id)).stockQuantity,8);assert.equal((await Customer.findById(posBuyer._id)).remainingMoney,3000);
  assert.equal(ok(await get('/accounts/financial/'+zeroCash._id)).balanceMinor,500000);
  const salePath='/api/v2/orders/create-order',creditRequest=requests.filter(r=>r.path===salePath&&r.method==='POST'&&JSON.parse(r.body).requestKey).at(-1);
  assert.match(JSON.parse(creditRequest.body).requestKey,/^[\w-]{8,100}$/);assert.equal(JSON.parse(creditRequest.body).receiptAccountId,zeroCash._id);
  await send('Page.reload');await wait("document.body.innerText.includes('Retry same sale')");await click('Retry same sale');await wait("document.body.innerText.includes('Sale completed.')");
  const creditRetry=requests.filter(r=>r.path===salePath&&r.method==='POST'&&JSON.parse(r.body).requestKey===JSON.parse(creditRequest.body).requestKey);
  assert.equal(creditRetry.length,2);assert.equal(creditRetry[0].body,creditRetry[1].body);
  assert.equal(await Order.countDocuments({shopId:zeroFixture.shop._id}),1);assert.equal(await StockLog.countDocuments({referenceId:posInvoice._id}),1);assert.equal(await CustomerLedger.countDocuments({shopId:zeroFixture.shop._id}),1);
  assert.equal((await Product.findById(posCoil._id)).stockQuantity,8);assert.equal(ok(await get('/accounts/financial/'+zeroCash._id)).balanceMinor,500000);
  await click('Next sale');await wait("!!document.querySelector('.product-result:not(:disabled)')");await evaluate("document.querySelector('.product-result:not(:disabled)').click()");await fill('[aria-label="Payment account"]',zeroCash._id);await click('Complete sale');await wait("document.body.innerText.includes('Sale completed.')");
  assert.equal(await Order.countDocuments({shopId:zeroFixture.shop._id}),2);assert.equal((await Product.findById(posCoil._id)).stockQuantity,7);assert.equal((await Customer.findById(posBuyer._id)).remainingMoney,3000);
  assert.equal(ok(await get('/accounts/financial/'+zeroCash._id)).balanceMinor,900000);
  pass('production ACTIVE first POS credit sale: automatic key, explicit account, 8000 total / 5000 cash / 3000 debt, duplicate clicks and lost-response reload retry; next cash sale');
  process.env.NODE_ENV='test';delete process.env.BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED;await login(owner.username);
  const evidence={passed:passed.length,scenarios:passed,verified:{mainProductStock:finalSnapshot.stock,supplierPayableMinor:reconciliation.balanceMinor,cashMinor:ok(await get('/accounts/financial/'+cash._id)).balanceMinor,bankMinor:ok(await get('/accounts/financial/'+bank._id)).balanceMinor,mainSupplierReceipts:finalSnapshot.receipts,mainSupplierSettlements:finalSnapshot.events,mainSupplierStatementEvents:all.pagination.recordCount,customerLedgerEntries:await CustomerLedger.countDocuments()},environment:{database:uri,mongoVersion,node:process.version,frontend:origin,backend:base}};
  await fs.mkdir('tests/artifacts',{recursive:true});await fs.writeFile('tests/artifacts/supplier-phase5a-evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(error){console.error('SUPPLIER INTEGRATION FAILED:',error.stack);if(socket?.readyState===1)try{console.error('ACTUAL UI:',await evaluate('document.body.innerText'));}catch{}console.error('Passed:',passed);process.exitCode=1;}
finally{
  if(socket?.readyState===1){try{await send('Browser.close');}catch{}socket.close();}
  if(httpServer){httpServer.closeAllConnections();await new Promise(r=>httpServer.close(r));}if(upstreamServer){upstreamServer.closeAllConnections();await new Promise(r=>upstreamServer.close(r));}
  await mongoose.disconnect();for(const p of children.reverse())if(p.exitCode===null){p.kill();await new Promise(r=>p.exitCode!==null?r():p.once('exit',r));}
  for(const p of waiting.values())clearTimeout(p.timer);assert.equal(path.dirname(temp),os.tmpdir());assert.ok(path.basename(temp).startsWith('digishop-supplier-integration-'));await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
