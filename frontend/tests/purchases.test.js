import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {activity,minorAmount,pakistanTime,pkr,purchaseItems,quantityItems,returnQuantities} from '../src/api/purchases.js';

test('purchase values use exact minor units and whole quantities',()=>{
  assert.equal(minorAmount('1234.56'),123456);
  assert.deepEqual(purchaseItems([{_id:'p',quantity:'2',cost:'1.25'}]),[{productId:'p',quantity:2,unitCostMinor:125}]);
  for(const value of ['','-1','0.001','NaN','Infinity'])assert.throws(()=>minorAmount(value));
  assert.throws(()=>purchaseItems([]));assert.throws(()=>purchaseItems([{_id:'p',quantity:'1.5',cost:'1'}]));
});
test('purchase confirmation reviews validated line totals and clearly separates receipt and payment',()=>{
  const source=fs.readFileSync(new URL('../src/pages/owner/Purchases.jsx',import.meta.url),'utf8');
  assert.match(source,/confirmationType:'purchase-order'/);assert.match(source,/unitCostMinor:items\[index\]\.unitCostMinor/);
  assert.match(source,/totalMinor:items\[index\]\.quantity\*items\[index\]\.unitCostMinor/);
  const action=fs.readFileSync(new URL('../src/components/SupplierAction.jsx',import.meta.url),'utf8');
  for(const label of ['Supplier:','Product','Quantity','Unit price','Total','Order total','Stock and payment will be recorded separately.','Confirm order','Back'])assert.ok(action.includes(label));
  assert.doesNotMatch(source,/Automatic purchase reference|This does not receive stock or make a payment/);
  assert.match(action,/request\.confirmationType==='purchase-order'\?<>/);
  assert.match(action,/lock\.current=true/);assert.match(action,/savePending\(storageKey,request\)/);
  const modal=fs.readFileSync(new URL('../src/components/Common.jsx',import.meta.url),'utf8');assert.match(modal,/data-modal-initial-focus/);
});
test('receiving validates remaining units and does not silently receive ordered totals',()=>{
  const rows=[{productId:'p',quantity:5,receivedQuantity:2}],remaining=r=>r.quantity-r.receivedQuantity;
  assert.deepEqual(quantityItems(rows,{p:'1'},remaining),[{productId:'p',quantity:1}]);
  for(const value of ['','0','4','-1','1.5'])assert.throws(()=>quantityItems(rows,{p:value},remaining));
});
test('return eligibility includes multiple returns and linked reversals without changing original costs',()=>{
  const receipt={items:[{productId:'p',quantity:10,unitCostMinor:123}]};
  const events=[{kind:'RETURN',items:[{productId:'p',quantity:4}]},{kind:'RETURN',items:[{productId:'p',quantity:2}]},{kind:'REVERSAL',items:[{productId:'p',quantity:4}]}];
  assert.deepEqual(returnQuantities(receipt,events),{p:{returned:2,eligible:8}});assert.equal(receipt.items[0].unitCostMinor,123);
  assert.throws(()=>returnQuantities(receipt,[{kind:'RETURN',items:[{productId:'p',quantity:11}]}]));
});
test('unavailable money is not zero and timestamps explicitly use Pakistan time',()=>{
  assert.equal(pkr(null),'Unavailable');assert.match(pkr(0),/0\.00/);assert.match(pkr(123456),/1,234\.56/);
  assert.match(pakistanTime('2026-01-01T20:00:00.000Z'),/2.*Jan.*2026/);assert.equal(activity('SUPPLIER_RETURN'),'Goods returned to supplier');
});
test('purchase and supplier routes stay inside OWNER routing and use real endpoints',()=>{
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8'),owner=app.split('<Route element={<Guard role="OWNER" />}>')[1].split('<Route element={<Guard role="CASHIER" />}>')[0];
  assert.match(owner,/purchases\/:purchaseId/);assert.match(owner,/accounts\/suppliers\/:supplierId/);
  const source=fs.readFileSync(new URL('../src/components/SupplierAction.jsx',import.meta.url),'utf8');
  assert.match(source,/savePending\(storageKey,request\)/);assert.match(source,/Retry same request/);assert.match(source,/lock\.current=true/);
  assert.doesNotMatch(source,/activate|BUSINESS_ACCOUNTING_ENABLED/);
});

test('new supplier setup requires explicit zero-opening confirmation and purchase receiving links to it',()=>{
  const source=fs.readFileSync(new URL('../src/components/SupplierOpening.jsx',import.meta.url),'utf8');
  assert.match(source,/preview\.entries\.length===0/);
  assert.match(source,/enrollNewSupplier:true/);
  assert.match(source,/openingBalanceMinor:0,otherOpeningMinor:0,reviews:\[\]/);
  assert.match(source,/This is a new supplier/);
  assert.match(source,/type="checkbox" className="form-check-input" required/);
  assert.match(source,/availability\.data\?\.accountingEnabled!==true/);
  assert.match(source,/CONFIRM SUPPLIER OPENING/);
  const purchase=fs.readFileSync(new URL('../src/pages/owner/PurchaseDetails.jsx',import.meta.url),'utf8');
  assert.match(purchase,/Prepare or review supplier opening/);
});

test('supplier openings use simple choices and server-resolved accounts',()=>{
  const source=fs.readFileSync(new URL('../src/components/SupplierOpening.jsx',import.meta.url),'utf8');
  for(const label of ['Does this supplier have previous records?','New supplier','Existing supplier','Previous amount owed (PKR)','Additional previous debt (PKR)','Total starting debt:'])assert.ok(source.includes(label));
  assert.doesNotMatch(source,/Create account|SUPPLIER_PAYABLE|PURCHASES_CLEARING|OPENING_EQUITY|payableAccountId|offsetAccountId|equityAccountId/);
  for(const safeguard of ['evidenceDigest:preview.evidenceDigest','crypto.randomUUID()','CONFIRM SUPPLIER OPENING','An unpaid amount cannot exceed its delivery value','I verified every old delivery'])assert.ok(source.includes(safeguard));
  assert.match(source,/Additional previous debt must not include these deliveries/);
});
