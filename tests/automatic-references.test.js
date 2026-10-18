import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=p=>fs.readFileSync(new URL('../src/'+p,import.meta.url),'utf8');

test('transaction forms request automatic references and retain stable request keys',()=>{
  for(const file of ['pages/owner/Purchases.jsx','pages/owner/PurchaseDetails.jsx','pages/owner/SupplierDetails.jsx','components/SupplierReturn.jsx','pages/owner/Expenses.jsx','pages/owner/Partners.jsx']){
    const text=source(file);
    assert.doesNotMatch(text,/name="reference"|reference:fields\.get\('reference'\)|reference:values\.reference/);
    assert.match(text,/requestKey:crypto\.randomUUID\(\)/);
  }
});
test('external documents and optional identity details remain explicitly optional',()=>{
  for(const [file,label] of [['pages/owner/Purchases.jsx','Supplier invoice / challan (Optional)'],['pages/owner/PurchaseDetails.jsx','Delivery invoice / challan (Optional)'],['components/CustomerPicker.jsx','Address (Optional)'],['pages/owner/Companies.jsx','Address (Optional)'],['pages/owner/Products.jsx','Description (Optional)'],['components/Common.jsx','Profile picture (Optional)']])assert.ok(source(file).includes(label),file);
});
test('issued references display on quotations, payment history and stock records',()=>{
  assert.match(source('pages/Quotations.jsx'),/d\.order\.invoiceNo/);
  assert.match(source('components/Receipt.jsx'),/\? receipt\.invoiceNo \|\| "Quotation"/);
  assert.match(source('components/InvoiceHistory.jsx'),/e\.reference\|\|e\.invoiceNo/);
  assert.match(source('pages/owner/Stock.jsx'),/l\.reference\|\|l\.invoiceNo/);
});
