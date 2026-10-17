import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {activity,accountName,pkr} from '../src/api/purchases.js';

test('plain financial labels keep debt, credit and money movements distinct',()=>{
  assert.equal(activity('SUPPLIER_PAYABLE'),'We owe supplier');
  assert.equal(activity('SUPPLIER_CREDIT'),'Supplier owes us');
  assert.equal(activity('CUSTOMER_RECEIVABLE'),'Customer owes us');
  assert.equal(activity('CAPITAL_CONTRIBUTION'),'Money added to business');
  assert.equal(activity('CAPITAL_WITHDRAWAL'),'Money taken out');
  assert.equal(activity('INVOICE_RECEIPT'),'Money received on invoice');
  assert.equal(pkr(null),'Unavailable');assert.match(pkr(0),/0\.00/);
});

test('account display preserves owner names and translates generated technical names',()=>{
  assert.equal(accountName({kind:'CASH',name:'Main Cash'}),'Main Cash');
  assert.equal(accountName({kind:'SUPPLIER_PAYABLE',name:'SUPPLIER PAYABLE'}),'We owe supplier');
});

test('dialogs retain accessible unique titles and prevent focus-induced page jumps',()=>{
  const source=fs.readFileSync(new URL('../src/components/Common.jsx',import.meta.url),'utf8');
  assert.match(source,/useId\(/);assert.match(source,/preventScroll:\s*true/);
  assert.match(source,/dialog-header/);assert.match(source,/showModal\(/);
});

test('sole-account convenience remains restricted to server-prepared lists and preview validation',()=>{
  for(const file of ['components/POS.jsx','pages/Quotations.jsx']){
    const source=fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
    assert.match(source,/paymentAccounts\.data\?\.accounts\?\.length\s*===\s*1/);
    assert.match(source,/chosenReceiptAccountId/);assert.match(source,/\/orders\/payment-accounts/);
  }
  const preview=fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx',import.meta.url),'utf8');
  assert.match(preview,/accounts\.some\(a=>a\._id===accountId\)/);
  assert.match(preview,/body\[field\]=accountId/);assert.match(preview,/confirmationToken: preview.confirmationToken/);
});

test('checkout waits for account choices before allowing a click',()=>{
  const pos=fs.readFileSync(new URL('../src/components/POS.jsx',import.meta.url),'utf8');
  const quotes=fs.readFileSync(new URL('../src/pages/Quotations.jsx',import.meta.url),'utf8');
  assert.match(pos,/disabled=\{busy \|\| customerBusy \|\| !cart.length \|\| \(!quotation && paymentAccounts.loading\)\}/);
  assert.match(quotes,/disabled=\{customerBusy \|\| paymentAccounts.loading\}/);
});
