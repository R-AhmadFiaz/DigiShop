// Explicit opt-in integration runner: node tests/invoice-browser.integration.mjs
// Real Express, production-built React, Chrome, HTTP cookies and MongoDB.
// No Fetch interception, mocked responses, provider calls or existing DB connection.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import mongoose from 'mongoose';

import {mongodBinary} from './mongod-binary.mjs';
const binary=mongodBinary;
const chromeBinary = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert.ok(existsSync(binary) && existsSync(chromeBinary), 'Local MongoDB and Chrome are required; no remote fallback');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'digishop-live-integration-'));
const frontend = path.resolve('../frontend');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const value = server.address().port; await new Promise(resolve => server.close(resolve)); return value; }
const mongoPort = await port(), apiPort = await port(), webPort = await port(), debugPort = await port();
const dbName = 'digishop_local_browser_test';
const uri = `mongodb://127.0.0.1:${mongoPort}/${dbName}?directConnection=true`;
const origin = `http://127.0.0.1:${webPort}`, base = `http://127.0.0.1:${apiPort}/api/v2`;
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: path.join(temp, 'does-not-exist.env'), NODE_ENV: 'development',
  MONGO_DB_URI: uri, CORS_ORIGIN: origin, OPENAI_API_KEY: 'isolated-no-provider-calls',
  ACCESS_TOKEN_SECRET: 'disposable-live-browser-access', REFRESH_TOKEN_SECRET: 'disposable-live-browser-refresh',
  ACCESS_TOKEN_EXPIRY: '15m', REFRESH_TOKEN_EXPIRY: '7d',
});
const {app} = await import('../dist/app.js');
const {User} = await import('../dist/models/user.model.js');
const {Shop} = await import('../dist/models/shop.model.js');
const {Product} = await import('../dist/models/product.model.js');
const {Category} = await import('../dist/models/category.model.js');
const {Order} = await import('../dist/models/order.model.js');
const {Customer} = await import('../dist/models/customer.model.js');
const {CustomerLedger} = await import('../dist/models/customerLedger.model.js');
const {StockLog} = await import('../dist/models/stockLog.model.js');
const {InvoiceAdjustment} = await import('../dist/models/invoiceAdjustment.model.js');
const {salesSummary, productSales} = await import('../dist/utils/salesReporting.js');
const {processQuestion} = await import('../dist/utils/aiQuestions.js');
const children = [], passed = [], errors = [], httpFailures = [];
let httpServer, socket, sequence = 0;
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
async function pickCustomer() { if (await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Select customer')`)) await click('Select customer'); await wait(`!!document.querySelector('.customer-result')`); await evaluate(`document.querySelector('.customer-result').click()`); }
async function sale(quantity, paid, customer = false, credit = 0) {
  await navigation('/' + (await evaluate(`document.body.innerText.includes('Dashboard')`) ? 'owner/sales' : 'cashier/pos'));
  if (await evaluate(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Next sale')`)) await click('Next sale');
  await fill('[aria-label="Search products by name or brand"]', 'Integration Cable');
  await sleep(300); await wait(`!!document.querySelector('.product-result:not(:disabled)')`);
  await evaluate(`document.querySelector('.product-result').click()`);
  await fill('[aria-label="Quantity for Integration Cable"]', quantity);
  if (paid !== null) await label('Amount paid', paid);
  if (customer) await pickCustomer();
  if (credit) await label('Store credit to use', credit);
  await click('Complete sale'); await wait(`document.body.innerText.includes('Sale completed.')`);
  const order = await Order.findOne({type: 'INVOICE'}).sort({createdAt: -1}).lean();
  await consistent(); return order;
}
async function open(order) { await navigation('/owner/sales/' + order._id); await wait(`!!document.querySelector('.receipt')`); }
async function previewConfirm(kind = 'adjustment') {
  const orderId = await evaluate(`location.pathname.split('/').at(-1)`);
  const revision = (await Order.findById(orderId)).revision ?? 0;
  await click('Preview changes'); await wait(`!!document.querySelector('[aria-label="Server preview"]')`);
  const bad = await evaluate(`document.querySelector('[aria-label="Server preview"] [role=alert]')?.textContent`); assert.ok(!bad, bad);
  await evaluate(`[...document.querySelectorAll('[aria-label="Server preview"] input[type=checkbox]')].forEach(e=>e.click())`);
  await click('Confirm ' + kind);
  await wait(`document.body.innerText.includes('Current invoice · Revision ${revision + 1}') && !document.querySelector('[aria-label="Adjust invoice"],[aria-label="Receive invoice payment"],[aria-label="Cancel invoice"]')`);
  assert.equal((await Order.findById(orderId)).revision, revision + 1);
  await consistent();
}
async function reason(text) { await label('Reason', text); }
function pass(name) { passed.push(name); console.log('PASS ' + name); }
let shop, customer, cable, switchProduct;
async function consistent() {
  assert.equal(mongoose.connection.host, '127.0.0.1'); assert.equal(mongoose.connection.port, mongoPort); assert.equal(mongoose.connection.name, dbName);
  for (const c of await Customer.find({}).lean()) {
    const rows = await CustomerLedger.find({customerId: c._id, shopId: c.shopId}).lean();
    const debt = rows.filter(r => r.balanceType !== 'CREDIT').reduce((sum, r) => sum + Math.round(r.amount * 100), 0);
    const credit = rows.filter(r => r.balanceType === 'CREDIT').reduce((sum, r) => sum + r.amountMinor, 0);
    assert.equal(Math.round(c.remainingMoney * 100), debt, 'Persisted customer debt reconciles to ledger');
    assert.equal(c.storeCreditBalanceMinor ?? 0, credit, 'Wallet reconciles to independent credit ledger');
    assert.ok(credit >= 0 && debt >= 0);
  }
  for (const order of await Order.find({type: 'INVOICE', status: {$ne: 'CANCELLED'}}).lean()) {
    assert.equal(Math.round(order.totalPrice * 100), Math.round(order.paidAmount * 100) + Math.round(order.amountDue * 100));
    if (order.settlementState) assert.equal(Math.round(order.paidAmount * 100), order.settlementState.cashNetMinor + order.settlementState.creditNetMinor);
  }
  for (const order of await Order.find({type: 'INVOICE', settlementState: {$exists: true}}).lean()) {
    const events = await InvoiceAdjustment.find({orderId: order._id, kind: {$ne: 'SALE'}}).sort({revisionAfter: 1}).lean();
    const state = order.settlementState;
    assert.equal(state.cashNetMinor, state.openingCashMinor + events.reduce((sum, event) => sum + event.financial.cashReceivedMinor - event.financial.cashRefundMinor - event.financial.creditIssuedMinor, 0));
    assert.equal(state.creditNetMinor, state.openingCreditMinor + events.reduce((sum, event) => sum + event.financial.creditRedeemedMinor - event.financial.creditRestoredMinor, 0));
    assert.equal(events.length, order.revision ?? 0);
    events.forEach((event, index) => { assert.equal(event.revisionBefore, index); assert.equal(event.revisionAfter, index + 1); });
  }
  for (const p of await Product.find({}).lean()) {
    const logs = await StockLog.find({productId: p._id, shopId: p.shopId}).lean();
    assert.equal(p.stockQuantity, 100 + logs.reduce((sum, log) => sum + log.quantityDelta, 0), 'Sellable inventory reconciles to stock audit');
  }
}
try {
  const mongod = child(binary, ['--dbpath', temp, '--bind_ip', '127.0.0.1', '--port', String(mongoPort), '--replSet', 'liveIntegration', '--logpath', path.join(temp, 'mongo.log')]);
  for (let n = 0; ; n++) { try { await mongoose.connect(uri, {serverSelectionTimeoutMS: 500, autoCreate: false, autoIndex: false}); break; } catch { if (n > 40 || mongod.exitCode !== null) throw new Error('Disposable MongoDB unavailable; refusing remote fallback'); await sleep(100); } }
  await mongoose.connection.db.admin().command({replSetInitiate: {_id: 'liveIntegration', members: [{_id: 0, host: `127.0.0.1:${mongoPort}`}]}});
  for (let n = 0; !(await mongoose.connection.db.admin().command({hello: 1})).isWritablePrimary; n++) { assert.ok(n < 200); await sleep(100); }
  assert.equal(mongoose.connection.host, '127.0.0.1'); assert.equal(mongoose.connection.port, mongoPort); assert.equal(mongoose.connection.name, dbName);
  console.log('VERIFIED SAFE DATABASE ' + uri);
  for (const Model of [Shop, User, Category, Product, Order, Customer, CustomerLedger, StockLog, InvoiceAdjustment]) { await Model.createCollection(); await Model.createIndexes(); }
  const ownerId = new mongoose.Types.ObjectId();
  shop = await Shop.create({ownerId, name: 'Integration Hardware', address: 'Local test only', contactNo: '03111111111', subscriptionActive: true, subscriptionExpiry: new Date(Date.now() + 86400000 * 10), isActive: true});
  const owner = await User.create({_id: ownerId, username: 'integrationowner', email: 'owner@local.invalid', password: 'local-test-password', role: 'OWNER', shopId: shop._id});
  const cashier = await User.create({username: 'integrationcashier', email: 'cashier@local.invalid', password: 'local-test-password', role: 'CASHIER', shopId: shop._id});
  const foreignOwnerId = new mongoose.Types.ObjectId();
  const foreignShop = await Shop.create({ownerId: foreignOwnerId, name: 'Untouched other shop', address: 'Local', contactNo: '03222222222', subscriptionActive: true, subscriptionExpiry: new Date(Date.now() + 86400000 * 10), isActive: true});
  await User.create({_id: foreignOwnerId, username: 'otherowner', email: 'other@local.invalid', password: 'local-test-password', role: 'OWNER', shopId: foreignShop._id});
  const category = await Category.create({shopId: shop._id, name: 'Electrical', slug: 'electrical'});
  cable = await Product.create({shopId: shop._id, category: category._id, name: 'Integration Cable', brand: 'Test Wire', slug: 'integration-cable', unit: 'pcs', costPrice: 20, retailPrice: 50, wholesalePrice: 40, stockQuantity: 100});
  switchProduct = await Product.create({shopId: shop._id, category: category._id, name: 'Integration Switch', brand: 'Test', slug: 'integration-switch', unit: 'pcs', costPrice: 10, retailPrice: 30, wholesalePrice: 25, stockQuantity: 100});
  customer = await Customer.create({shopId: shop._id, name: 'Ahmed Integration', phoneNo: '03001234567', address: 'Local', remainingMoney: 0});
  // Simulate an existing customer from before wallets were introduced.
  await Customer.collection.updateOne({_id: customer._id}, {$unset: {storeCreditBalanceMinor: ''}});
  assert.equal(Object.hasOwn(await Customer.collection.findOne({_id: customer._id}), 'storeCreditBalanceMinor'), false);
  const foreignBefore = JSON.stringify(await Shop.findById(foreignShop._id).lean());
  httpServer = app.listen(apiPort, '127.0.0.1'); await new Promise(resolve => httpServer.once('listening', resolve));
  const out = path.join(temp, 'frontend-dist');
  await done(child(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out], {cwd: frontend, env: {...process.env, NODE_ENV: 'production', VITE_API_BASE_URL: base}}));
  child(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort', '--outDir', out], {cwd: frontend});
  for (let n = 0; ; n++) { try { if ((await fetch(origin)).ok) break; } catch {} assert.ok(n < 100); await sleep(100); }
  child(chromeBinary, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=' + debugPort, '--user-data-dir=' + path.join(temp, 'chrome'), 'about:blank']);
  let page;
  for (let n = 0; !page; n++) { try { page = (await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()).find(p => p.type === 'page'); } catch {} assert.ok(n < 100); await sleep(100); }
  socket = new WebSocket(page.webSocketDebuggerUrl); await new Promise(resolve => socket.addEventListener('open', resolve, {once: true}));
  socket.addEventListener('message', async event => { const message = JSON.parse(event.data); if (message.id) { const item = waiting.get(message.id); if (item) { clearTimeout(item.timer); waiting.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); } } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text); else if (message.method === 'Network.responseReceived' && message.params.response.url.startsWith(base) && message.params.response.status >= 400) httpFailures.push({url: message.params.response.url, status: message.params.response.status}); else if (message.method === 'Page.javascriptDialogOpening') await send('Page.handleJavaScriptDialog', {accept: true}); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', {width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false});
  await login(owner.username);
  const a = await sale(4, null);
  assert.equal(a.totalPrice, 200); assert.equal(a.paidAmount, 200); assert.equal((await Product.findById(cable._id)).stockQuantity, 96); pass('ordinary cash invoice through real POS');
  await open(a); await click('Adjust Invoice'); await fill('[aria-label="Return quantity for Integration Cable"]', '1'); await label('Cash to refund', '50'); await reason('Restock one cable'); await previewConfirm();
  assert.equal((await Order.findById(a._id)).totalPrice, 150); assert.equal((await Product.findById(cable._id)).stockQuantity, 97); pass('RESTOCK return, cash refund, stock and financial audits');
  // Change price through the existing API, never by trusting frontend line prices.
  assert.equal((await browserHttp('PATCH', `/products/${cable._id}`, {retailPrice: 60})).status, 200);
  await click('Adjust Invoice'); await fill('[aria-label="Return quantity for Integration Cable"]', 1); await fill('[aria-label="Return condition for Integration Cable"]', 'DAMAGED'); await wait(`!!document.querySelector('[aria-label="Adjust invoice"] .product-result')`); await evaluate(`document.querySelector('[aria-label="Adjust invoice"] .product-result').click()`); await label('Additional cash received', 10); await reason('Damaged identical exchange'); await previewConfirm();
  let saved = await Order.findById(a._id).lean(); assert.deepEqual(saved.items.map(i => [i.quantity, i.unitPrice]), [[2, 50], [1, 60]]); assert.equal(saved.totalPrice, 160); assert.equal((await Product.findById(cable._id)).stockQuantity, 96);
  const damaged = await StockLog.findOne({referenceId: a._id, disposition: 'DAMAGED'}).lean(); assert.equal(damaged.quantityDelta, 0); assert.equal(damaged.returnedQuantity, 1); pass('DAMAGED identical exchange preserves historical prices and charges current replacement price');
  await click('Adjust Invoice'); await fill('[aria-label="Adjust invoice"] input[placeholder="Search name or brand"]', 'Integration Switch'); await sleep(300); await wait(`document.querySelector('[aria-label="Adjust invoice"] .product-result')?.textContent.includes('Integration Switch')`); await evaluate(`document.querySelector('[aria-label="Adjust invoice"] .product-result').click()`); await label('Additional cash received', 30); await reason('Add a new switch'); await previewConfirm();
  assert.equal((await Order.findById(a._id)).totalPrice, 190); pass('new product addition and additional cash settlement');
  await click('Adjust Invoice'); await click('Return all remaining units'); await label('Cash to refund', 190); await reason('Full return'); await previewConfirm();
  saved = await Order.findById(a._id).lean(); assert.equal(saved.items.length, 0); assert.equal(saved.totalPrice, 0); assert.equal(saved.paidAmount, 0); assert.equal(saved.amountDue, 0); assert.equal(saved.invoiceNo, a.invoiceNo); assert.equal(+saved.createdAt, +a.createdAt); assert.equal(String(saved.createdBy), String(owner._id)); assert.equal(saved.originalSnapshot.totalPrice, 200); assert.equal((await Product.findById(cable._id)).stockQuantity, 99); assert.equal((await Product.findById(switchProduct._id)).stockQuantity, 100); pass('full return preserves original invoice, seller and date; damaged loss remains out of sellable inventory');
  const b = await sale(2, 30, true); assert.equal(b.amountDue, 90); assert.equal((await Customer.findById(customer._id)).remainingMoney, 90);
  await open(b); await click('Adjust Invoice'); await fill('[aria-label="Return quantity for Integration Cable"]', 1); await reason('Reduce customer debt first'); await previewConfirm(); assert.equal((await Order.findById(b._id)).amountDue, 30); pass('partial credit sale and debt-first return');
  await click('Receive payment'); await label('Additional cash received', 20); await reason('Receive partial payment'); await previewConfirm('payment'); assert.equal((await Customer.findById(customer._id)).remainingMoney, 10);
  await click('Receive payment'); await label('Additional cash received', 10); await reason('Settle remaining debt'); await previewConfirm('payment'); assert.equal((await Customer.findById(customer._id)).remainingMoney, 0); pass('additional payments reconcile invoice and customer debt without overwriting history');
  await click('Adjust Invoice'); await click('Return all remaining units'); await label('Cash to refund', 20); await label('Refund as store credit', 40); await reason('Split cash and credit refund'); await previewConfirm(); assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 4000); pass('combined cash refund and independent customer store credit');
  await click('Open printable record'); await wait(`document.querySelector('.receipt')?.innerText.includes('Store credit issued')`); assert.ok(await evaluate(`document.querySelector('.receipt').innerText.includes('Sold by: Integrationowner')`));
  const pdf = await send('Page.printToPDF', {printBackground: true}); assert.ok(Buffer.from(pdf.data, 'base64').length > 1500); await navigation('/owner/sales/' + b._id); await wait(`document.body.innerText.includes('Adjustment and payment history')`); assert.equal(await InvoiceAdjustment.countDocuments({orderId: b._id}), 4); pass('real adjustment history and printable receipt PDF');
  await login(cashier.username); const c = await sale(1, null, true, 40); assert.equal(c.paidAmount, 60); assert.equal(c.amountDue, 0); assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 0); assert.equal(String(c.createdBy), String(cashier._id));
  assert.equal((await browserHttp('GET', `/orders/${c._id}`)).status, 403); assert.equal((await browserHttp('POST', `/orders/${c._id}/adjustments/preview`, {})).status, 403); assert.equal((await browserHttp('GET', '/products/search-product')).body.data.product.some(p => 'costPrice' in p), false); pass('CASHIER POS redeems credit once; OWNER-only routes and sensitive prices remain protected');
  await login(owner.username); await open(c); await click('Cancel invoice'); await label('Cash to refund', 20); await reason('Cancel credit-funded sale'); await previewConfirm('cancellation'); saved = await Order.findById(c._id).lean(); assert.equal(saved.status, 'CANCELLED'); assert.equal(saved.paidAmount, 0); assert.equal(saved.amountDue, 0); assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 4000); pass('settlement-aware cancellation restores credit funding before cash refund');
  const d = await sale(1, null); await open(d); await click('Adjust Invoice'); await click('Return all remaining units'); await fill('[aria-label="Return condition for Integration Cable"]', 'DAMAGED'); await label('Refund as store credit', 60); await pickCustomer(); await reason('Anonymous damaged return to separate credit recipient'); await previewConfirm(); saved = await Order.findById(d._id).lean(); assert.ok(!saved.customerId); assert.equal(String(saved.creditRecipientId), String(customer._id)); assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 10000); pass('anonymous damaged return issues credit to verified recipient without rewriting original customer');
  // HTTP concurrency and stale previews use the same real authenticated browser cookies.
  const e = await sale(2, 0, true); const payment = {requestKey: 'live-duplicate-payment', expectedRevision: 0, reason: 'Concurrent payment', returns: [], additions: [], cashReceivedAmount: 10};
  const pre = await browserHttp('POST', `/orders/${e._id}/payments/preview`, payment); assert.equal(pre.status, 200); const mutation = {...payment, confirmationToken: pre.body.data.confirmationToken};
  const parallel = await evaluate(`Promise.all([1,2].map(()=>fetch(${JSON.stringify(base + `/orders/${e._id}/payments`)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(${JSON.stringify(mutation)})}).then(r=>r.status)))`); assert.ok(parallel.includes(200)); assert.ok(parallel.every(s => [200, 409].includes(s))); assert.equal((await browserHttp('POST', `/orders/${e._id}/payments`, mutation)).status, 200); assert.equal(await InvoiceAdjustment.countDocuments({orderId: e._id}), 1); assert.equal((await Order.findById(e._id)).amountDue, 110); await consistent();
  const stale = {...mutation, requestKey: 'live-stale-payment'}; assert.equal((await browserHttp('POST', `/orders/${e._id}/payments`, stale)).status, 409); pass('real HTTP concurrent duplicate payment and stale-preview rejection perform one financial mutation');
  const countsBefore = await Promise.all([Order.countDocuments(), StockLog.countDocuments(), CustomerLedger.countDocuments(), InvoiceAdjustment.countDocuments()]);
  const insufficient = {requestKey: 'live-insufficient-stock', expectedRevision: 1, reason: 'Impossible addition', returns: [], additions: [{productId: String(cable._id), quantity: 10000}]};
  assert.equal((await browserHttp('POST', `/orders/${e._id}/adjustments/preview`, insufficient)).status, 409); assert.deepEqual(await Promise.all([Order.countDocuments(), StockLog.countDocuments(), CustomerLedger.countDocuments(), InvoiceAdjustment.countDocuments()]), countsBefore); await consistent(); pass('insufficient-stock preview leaves all persisted records unchanged');
  // Database-enforced failure at the LAST audit write, not a mocked response or
  // mocked model: all earlier stock/debt/invoice/log writes must abort together.
  const rollbackOrder = await Order.findById(e._id).lean();
  const rollbackBody = {requestKey: 'live-rollback-probe', expectedRevision: 1, reason: 'Disposable database rollback probe',
    returns: [{lineId: rollbackOrder.items[0].lineId, quantity: 1, disposition: 'RESTOCK'}], additions: []};
  const rollbackPreview = await browserHttp('POST', `/orders/${e._id}/adjustments/preview`, rollbackBody);
  assert.equal(rollbackPreview.status, 200); assert.equal(rollbackPreview.body.data.canSubmit, true);
  const beforeRollback = JSON.stringify(await Promise.all([Order.findById(e._id).lean(), Product.findById(cable._id).lean(), Customer.findById(customer._id).lean(), CustomerLedger.find({}).sort({_id: 1}).lean(), StockLog.find({}).sort({_id: 1}).lean(), InvoiceAdjustment.find({}).sort({_id: 1}).lean()]));
  assert.equal(mongoose.connection.name, dbName); assert.equal(mongoose.connection.port, mongoPort);
  await mongoose.connection.db.command({collMod: InvoiceAdjustment.collection.name, validator: {$expr: {$ne: ['$requestKey', 'live-rollback-probe']}}});
  try {
    const failed = await browserHttp('POST', `/orders/${e._id}/adjustments`, {...rollbackBody, confirmationToken: rollbackPreview.body.data.confirmationToken});
    assert.equal(failed.status, 500);
  } finally { await mongoose.connection.db.command({collMod: InvoiceAdjustment.collection.name, validator: {}}); }
  assert.equal(JSON.stringify(await Promise.all([Order.findById(e._id).lean(), Product.findById(cable._id).lean(), Customer.findById(customer._id).lean(), CustomerLedger.find({}).sort({_id: 1}).lean(), StockLog.find({}).sort({_id: 1}).lean(), InvoiceAdjustment.find({}).sort({_id: 1}).lean()])), beforeRollback);
  await consistent(); pass('real MongoDB audit-insert rejection rolls back invoice, stock, debt and all ledger/history writes atomically');
  await login('otherowner'); assert.equal((await browserHttp('GET', `/orders/${e._id}`)).status, 404); assert.equal((await browserHttp('GET', `/orders/${e._id}/history`)).status, 404); assert.equal(JSON.stringify(await Shop.findById(foreignShop._id).lean()), foreignBefore); assert.equal(await Order.countDocuments({shopId: foreignShop._id}), 0); pass('cross-shop invoice/history isolation and untouched foreign shop');
  await login(owner.username);
  // Real quotation UI, including conversion, remains cash-only.
  await navigation('/owner/quotations'); await fill('[aria-label="Search products by name or brand"]', 'Integration Cable'); await sleep(300); await wait(`!!document.querySelector('.product-result')`); await evaluate(`document.querySelector('.product-result').click()`); await click('Create quotation'); await wait(`!!document.querySelector('.receipt')`); const quote = await Order.findOne({type: 'QUOTATION'}).lean(); assert.ok(quote); await click('Make sale'); await label('Amount paid', 60); await click('Complete sale'); await wait(`!!document.querySelector('.receipt[aria-label="Invoice receipt"]') && document.body.innerText.includes('Back to quotations')`); await consistent(); pass('quotation creation and cash-only conversion through real browser');
  const today = new Date(); const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())); const end = new Date(+start + 86400000);
  const report = await salesSummary(shop._id, {start, end});
  const current = await Order.find({shopId: shop._id, type: 'INVOICE', status: {$ne: 'CANCELLED'}}).lean(); assert.equal(report.total, current.reduce((sum, o) => sum + o.totalPrice, 0));
  const ai = await processQuestion('Today sales', owner, async () => ({action: 'sales', period: 'today'})); assert.equal(ai.data.total, report.total); assert.match(ai.answer, /not cash collected/); await productSales(shop._id, {start, end}, undefined, false, 10); pass('real-database sales reporting and AI summary query path agree; payments and refunds do not duplicate revenue');
  // A deliberately seeded, known legacy invoice in THIS disposable database.
  // Its sale belongs to last month; the actual browser return must belong to today.
  const previousStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const previousEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const oldDate = new Date(+previousStart + 3600000);
  const session = await mongoose.startSession(); session.startTransaction();
  let legacy;
  try {
    [legacy] = await Order.create([{shopId: shop._id, type: 'INVOICE', invoiceNo: 'LEGACY-LOCAL-1', status: 'DELIVERED', createdAt: oldDate,
      createdBy: owner._id, createdByName: owner.username, saleType: 'RETAIL', items: [{productId: cable._id, name: cable.name, quantity: 1, unitPrice: 60}],
      subtotal: 60, discountType: 'NONE', discountValue: 0, discountAmount: 0, totalPrice: 60, paidAmount: 60, amountDue: 0}], {session});
    await Order.collection.updateOne({_id: legacy._id}, {$unset: {revision: '', originalSnapshot: '', 'items.0.lineId': ''}}, {session});
    await Product.updateOne({_id: cable._id}, {$inc: {stockQuantity: -1}}, {session});
    await StockLog.create([{shopId: shop._id, productId: cable._id, referenceId: legacy._id, invoiceNo: legacy.invoiceNo, quantityDelta: -1, reason: 'Known legacy test sale', createdBy: owner._id, createdAt: oldDate}], {session});
    await session.commitTransaction();
  } catch (error) { await session.abortTransaction(); throw error; }
  finally { await session.endSession(); }
  assert.equal((await salesSummary(shop._id, {start: previousStart, end: previousEnd})).total, 60);
  await open(legacy); await click('Adjust Invoice'); await click('Return all remaining units'); await label('Cash to refund', 60); await reason('Return an old legacy sale today'); await previewConfirm();
  assert.equal((await salesSummary(shop._id, {start: previousStart, end: previousEnd})).total, 60);
  assert.equal((await salesSummary(shop._id, {start, end})).total, report.total - 60);
  const apiReport = await browserHttp('GET', '/orders/sales-summary?period=today'); assert.equal(apiReport.status, 200);
  assert.equal(apiReport.body.data.total, report.total - 60);
  const datedAi = await processQuestion('Sales today', owner, async () => ({action: 'sales', period: 'today'})); assert.equal(datedAi.data.total, report.total - 60);
  const legacySaved = await Order.findById(legacy._id).lean(); assert.equal(+legacySaved.createdAt, +oldDate); assert.equal(legacySaved.originalSnapshot.source, 'LEGACY_BASELINE');
  pass('legacy invoice compatibility and real browser return preserve prior-month sales while changing current-day HTTP and AI reporting');
  assert.equal((await Customer.findById(customer._id)).remainingMoney, 110);
  assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 10000);
  assert.equal((await Product.findById(cable._id)).stockQuantity, 95);
  assert.equal((await Product.findById(switchProduct._id)).stockQuantity, 100);
  assert.equal(apiReport.body.data.total, 120);
  await consistent(); assert.deepEqual(errors, []);
  console.log(JSON.stringify({database: uri, frontend: origin, backend: base, passed, totals: {invoices: await Order.countDocuments({type: 'INVOICE'}), events: await InvoiceAdjustment.countDocuments(), stockLogs: await StockLog.countDocuments(), ledgers: await CustomerLedger.countDocuments()}, expectedHttpRejections: httpFailures}, null, 2));
} catch (error) {
  console.error('INTEGRATION FAILED:', error.stack);
  if (socket?.readyState === 1) { try { console.error('ACTUAL UI:', await evaluate('document.body.innerText')); } catch {} }
  console.error('Passed scenarios:', passed);
  process.exitCode = 1;
} finally {
  if (socket?.readyState === 1) { try { await send('Browser.close'); } catch {} socket.close(); }
  if (httpServer) await new Promise(resolve => httpServer.close(resolve));
  await mongoose.disconnect();
  for (const process of children.reverse()) { if (process.exitCode === null) { process.kill(); await new Promise(resolve => { if (process.exitCode !== null) resolve(); else process.once('exit', resolve); }); } }
  assert.equal(path.dirname(temp), os.tmpdir()); assert.ok(path.basename(temp).startsWith('digishop-live-integration-'));
  await fs.rm(temp, {recursive: true, force: true, maxRetries: 10, retryDelay: 200});
}
