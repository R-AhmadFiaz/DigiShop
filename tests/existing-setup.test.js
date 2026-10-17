import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/pages/owner/ExistingSetup.jsx',import.meta.url),'utf8');
test('existing setup is OWNER-only and uses the existing financial confirmation pattern',()=>{
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');const owner=app.split('<Route element={<Guard role="OWNER" />}>')[1].split('<Route element={<Guard role="CASHIER" />}>')[0];
  assert.match(owner,/path="existing-setup" element={<ExistingSetup/);assert.match(source,/SupplierAction operation="existing-setup-confirmation"/);
  assert.match(source,/previewToken:preview.previewToken/);assert.match(source,/requestKey:crypto.randomUUID/);assert.match(source,/expectedRevision:preview.expectedRevision/);
});
test('opening review displays server assets, liabilities and unresolved differences separately',()=>{
  for(const field of ['inventoryMinor','cashMinor','customerDebtMinor','storeCreditMinor','supplierPayableMinor','netAssetsMinor','differenceMinor','journalBackedOpeningNetMinor'])assert.ok(source.includes('t.'+field));
  assert.match(source,/setup is incomplete or blocked/i);assert.match(source,/history needs review/);assert.match(source,/existing customer ledger/);
  assert.match(source,/not live stock valuation or profit/);assert.doesNotMatch(source,/stockQuantity\s*:/);
});
test('drafts can be corrected, zeros are preserved and irreversible confirmation is explicitly typed',()=>{
  assert.match(source,/method:'PUT'/);assert.match(source,/expectedRevision:setup\?\.revision/);
  assert.match(source,/confirmation!=='CONFIRM EXISTING BUSINESS SETUP'/);assert.match(source,/preview.evidence.blockers.length>0/);
  assert.match(source,/row.openingMinor===null\?'':row.openingMinor\/100/);assert.match(source,/filter\(row=>!row.hasOpening\)/);
});
test('historical opening equity and supplier reviews are not fabricated sales or investments',()=>{
  assert.match(source,/No historical payment is invented/);assert.match(source,/unallocated opening equity, not a partner investment/);
  assert.match(source,/unpaidMinor:minorAmount/);assert.match(source,/otherOpeningMinor:minorAmount/);assert.match(source,/time\)/);
  assert.doesNotMatch(source,/create-order|\/capital'|\/expenses'/);
});
