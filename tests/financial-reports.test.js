import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/pages/owner/FinancialReports.jsx',import.meta.url),'utf8');
test('financial reports use the shop-scoped read API and never post or calculate profit',()=>{
  assert.match(source,/useLoad\('\/accounts\/reports'/);assert.doesNotMatch(source,/method:|costPrice|\/create-order|BUSINESS_ACCOUNTING_ENABLED/);
  assert.match(source,/Profit & Loss/);assert.match(source,/d.profit.status==='UNAVAILABLE'/);
});
test('report route and navigation are OWNER-only',()=>{
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const owner=app.split('<Route element={<Guard role="OWNER" />}>')[1].split('<Route element={<Guard role="CASHIER" />}>')[0];
  assert.match(owner,/path="reports" element={<FinancialReports/);
  const layout=fs.readFileSync(new URL('../src/layouts/ShopLayout.jsx',import.meta.url),'utf8');
  assert.match(layout.split('CASHIER:')[0],/\["reports", "Reports"\]/);assert.doesNotMatch(layout.split('CASHIER:')[1],/Reports/);
});
test('unavailable amounts are not zeros and current snapshots are separated from dated flows',()=>{
  for(const word of ['UNAVAILABLE','INCOMPLETE','PROVISIONAL','current','not the cash collected','not sales or physical cash','not sales or profit'])assert.ok(source.includes(word));
  assert.match(source,/UTC/);assert.match(source,/86400000/);assert.match(source,/Pakistan time/);
  assert.match(source,/amount=\{d.suppliers.totalMinor\}/);assert.match(source,/'openingMinor','closingMinor','netMovementMinor'/);
});
