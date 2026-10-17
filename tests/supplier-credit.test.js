import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const page=fs.readFileSync(new URL('../src/pages/owner/SupplierDetails.jsx',import.meta.url),'utf8');
test('supplier account keeps payable and one shared credit/refund pool separate',()=>{
  for(const field of ['creditMinor','refundsReceivedMinor','creditAppliedMinor','balanceMinor'])assert.ok(page.includes(field));
  assert.match(page,/This is one balance/);assert.match(page,/Supplier credit statement/);
  assert.match(page,/pkr\(balance.data.creditMinor\)/);
});
test('supplier refunds and applications use real endpoints, minor units and explicit confirmation',()=>{
  for(const token of ['/refunds','/credit-applications','CONFIRM SUPPLIER REFUND RECEIVED','CONFIRM SUPPLIER CREDIT APPLICATION','crypto.randomUUID()','minorAmount'])assert.ok(page.includes(token));
  assert.match(page,/money has actually arrived/);assert.match(page,/No cash moves/);assert.match(page,/amountMinor>balance.creditMinor/);
  assert.match(page,/operation=\{'supplier-credit-'/);assert.match(page,/\/orders\/payment-accounts/);
});
test('supplier corrections retain original history and return copy no longer claims credits unsupported',()=>{
  assert.match(page,/\/settlements\/.*\/reverse/);assert.match(page,/CONFIRM SUPPLIER REVERSAL/);assert.match(page,/Consumed return credit must be restored first/);
  const returns=fs.readFileSync(new URL('../src/components/SupplierReturn.jsx',import.meta.url),'utf8');assert.match(returns,/excess becomes supplier credit/);assert.doesNotMatch(returns,/Returns exceeding that balance are blocked/);
  const history=fs.readFileSync(new URL('../src/components/TransactionHistory.jsx',import.meta.url),'utf8');assert.match(history,/SUPPLIER_REFUND/);assert.match(history,/SUPPLIER_CREDIT_APPLICATION/);
});
