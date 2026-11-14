import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/pages/owner/FinancialReports.jsx',import.meta.url),'utf8');
test('financial reports use the shop-scoped read API and never post or calculate profit',()=>{
  assert.match(source,/useLoad\('\/accounts\/reports'/);assert.doesNotMatch(source,/method:|costPrice|\/create-order|BUSINESS_ACCOUNTING_ENABLED/);
  assert.match(source,/Profit & Loss/);assert.match(source,/d.profit.status==='UNAVAILABLE'/);
});
test('reports page is keyboard-operable: tabs, shortcuts and focus rules',()=>{
  assert.match(source,/role="tablist"/);assert.match(source,/role="tab" aria-selected=\{selected===name\}/);assert.match(source,/role="tabpanel"/);
  assert.match(source,/tabIndex=\{selected===name\?0:-1\}/,'roving tab focus');
  assert.match(source,/ArrowRight:.*ArrowLeft:.*Home:0,End:last/,'arrow, Home and End move between tabs');
  assert.match(source,/\{KeyF:fromInput,KeyT:toInput\}\[event\.code\]/,'Alt+F / Alt+T focus the dates');
  assert.match(source,/event\.target\.closest\?\.\('input,select,textarea,\[contenteditable="true"\]'\)\)return;/,'single-key shortcuts ignored while typing');
  assert.match(source,/\/\^\[1-7\]\$\/\.test\(event\.key\)/);assert.match(source,/event\.key==='n'\|\|event\.key==='N'/);
  assert.match(source,/event\.key==='Escape'&&notesOpen/);assert.match(source,/notesOpener\.current/,'focus returns to the opener');
  assert.match(source,/event\.key==='PageDown'\|\|event\.key==='PageUp'/);
  assert.match(source,/panel\.current\?\.focus\(\{preventScroll:true\}\)/,'switching moves focus to the report panel');
  assert.match(source,/customer\)return;/,'shortcuts pause while the Customer Khata dialog is open');
  for(const key of ['Alt+F','Alt+T','Enter','1–7','N','PgUp/PgDn','Esc'])assert.ok(source.includes("['"+key+"'"),key);
  const css=fs.readFileSync(new URL('../src/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.app-shell:has\(\.reports-screen\) :focus-visible \{ outline:3px solid #f59e0b !important;/);
  assert.match(css,/@media screen and \(min-width:1100px\) and \(min-height:500px\) \{\s*\.reports-screen \{ flex:1 1 0; min-height:0; \}\s*\.reports-main \{[^}]*grid-template-columns:380px minmax\(0,1fr\)/);
  assert.match(css,/\.report-panel \{ flex:1 1 0; min-height:0; overflow:auto;/);
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
