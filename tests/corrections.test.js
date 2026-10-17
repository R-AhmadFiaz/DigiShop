import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../src/'+p,import.meta.url),'utf8');
test('business setup edits existing roles with revision and preserves customer links',()=>{
  const source=read('pages/owner/Companies.jsx');assert.match(source,/\/roles'/);assert.match(source,/expectedRevision:entity.revision/);assert.match(source,/disabled=\{value==='CUSTOMER'\}/);assert.match(source,/Business details/);assert.match(source,/Open supplier Khata/);
});
test('company products require an explicit matching brand and owner confirmation',()=>{
  const source=read('pages/owner/Companies.jsx');assert.match(source,/\/accounts\/products\//);assert.match(source,/method:'PUT'/);assert.match(source,/window.confirm\('Link '/);assert.match(source,/\/products'\+query/);assert.match(source,/Historical|historical sales/);assert.match(source,/No explicitly linked products/);
});
test('purchase/delivery reference inputs are optional and retain external identifiers and notes',()=>{
  for(const file of ['pages/owner/Purchases.jsx','pages/owner/PurchaseDetails.jsx']){
    const source=read(file);assert.match(source,/reference \(optional\)/i);assert.match(source,/name="supplierDocumentNo"/);assert.match(source,/name="notes"/);assert.doesNotMatch(source,/name="reference"[^>]*required/);assert.match(source,/requestKey:crypto.randomUUID/);
  }
});
test('historical supplier review uses the existing confirmed cutover without fabricated payments',()=>{
  const source=read('components/SupplierOpening.jsx');for(const token of ['/cutover-preview','/cutover','evidenceDigest:preview.evidenceDigest','CONFIRM SUPPLIER OPENING','otherOpeningMinor','unpaidMinor','accountingEnabled!==true'])assert.ok(source.includes(token));
  assert.match(source,/not a new purchase, payment or investment/);assert.doesNotMatch(source,/\/payments'|\/create-order|\/capital'/);
});
test('profit and ambiguous customer openings remain blocked with evidence explanations',()=>{
  assert.match(read('pages/owner/FinancialReports.jsx'),/quantityOnlyStockRecordsInRange/);assert.match(read('pages/owner/FinancialReports.jsx'),/Today.s buying price is not used as historical cost/);
  assert.match(read('pages/Customers.jsx'),/Unverified historical balances remain blocked/);
});
