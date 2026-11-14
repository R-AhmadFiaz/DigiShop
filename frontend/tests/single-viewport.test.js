import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const css=read('styles.css');
const block=(start)=>{const at=css.indexOf(start);assert.ok(at>=0,'missing '+start);let depth=0,i=css.indexOf('{',at);for(let j=i;j<css.length;j++){if(css[j]==='{')depth++;else if(css[j]==='}'&&--depth===0)return css.slice(i,j+1);}throw Error('unclosed '+start);};

test('one-screen shell applies to desktop screens only, never to print or phones',()=>{
  const shell=block('@media screen and (min-width:769px) and (min-height:500px)');
  assert.match(shell,/\.app-shell \{[^}]*height:100dvh/);
  assert.match(shell,/\.workspace \{[^}]*min-height:0;[^}]*overflow:auto/);
  assert.match(css,/@media print \{\s*html \{ overflow: visible;/);
});
test('content is never masked: the shell, workspace and page never use overflow hidden',()=>{
  const shell=block('@media screen and (min-width:769px) and (min-height:500px)');
  for(const selector of ['html','body','.app-shell','.workspace'])assert.doesNotMatch(shell,new RegExp('(^|[\\s,}])'+selector.replace('.','\\.')+' \\{[^}]*overflow(-y)?:\\s*hidden'),selector);
  assert.match(shell,/\.fill-panel > \* \{ flex-shrink:0; \}/);
});
test('main lists keep their filters and pager visible with rows scrolling inside',()=>{
  for(const file of ['pages/owner/Products.jsx','pages/owner/Stock.jsx','pages/owner/Sales.jsx','pages/owner/Purchases.jsx','pages/Customers.jsx','pages/owner/Companies.jsx','pages/owner/CashBank.jsx','components/TransactionHistory.jsx','pages/owner/Partners.jsx','pages/owner/Staff.jsx','pages/admin/Shops.jsx','pages/owner/Dashboard.jsx','pages/owner/CustomerServices.jsx'])
    assert.match(read(file),/fill-panel/,file);
  assert.match(read('pages/VoiceStock.jsx'),/assistant-conversation fill-scroll/);
});
test('detail pages use side-by-side columns on wide screens and stack otherwise',()=>{
  for(const [file,layout] of [['pages/owner/Invoice.jsx','invoice-layout'],['pages/owner/PurchaseDetails.jsx','purchase-layout'],['pages/owner/SupplierDetails.jsx','khata-layout'],['pages/owner/ExistingSetup.jsx','setup-layout']]){
    assert.match(read(file),new RegExp('className="'+layout+'"'),file);assert.match(css,new RegExp('\\.'+layout+' \\{[^}]*display:grid'),layout);
  }
});
test('scrolling helpers target the workspace and the real document',()=>{
  const invoice=read('pages/owner/Invoice.jsx');
  assert.match(invoice,/window\.document\.querySelector\("\.workspace"\)\?\.scrollTo\(0, 0\)/);
  assert.doesNotMatch(invoice,/[^.]document\.querySelector\(/,'the Invoice page shadows document with state');
  assert.match(read('components/Common.jsx'),/closest\("\.workspace"\)/);
});
test('Transactions keeps its original register layout without changing the shared component',()=>{
  assert.match(read('pages/owner/Transactions.jsx'),/<section className="panel transactions-accounts">/);
  assert.match(read('components/TransactionHistory.jsx'),/<section className="panel mt-3 fill-panel">/,'shared component unchanged (Supplier Khata)');
  const overrides=css.match(/^[ \t]*\.transactions-accounts[^{]*\{/gm)||[];
  assert.equal(overrides.length,4);
  for(const rule of overrides)assert.match(rule,/^\s*\.transactions-accounts ~ \.fill-panel/,'override is scoped to the register after the Transactions account panel');
  assert.doesNotMatch(read('pages/owner/SupplierDetails.jsx'),/transactions-accounts/);
});
test('POS keeps its tested layout switch and keyboard shortcuts',()=>{
  assert.match(css,/@media \(min-width:1100px\) and \(min-height:600px\) \{\s*\.pos-unified #sale-form > fieldset \{ display:grid;/);
  const pos=read('components/POS.jsx');for(const key of ['F2','F4','F6','F10'])assert.match(pos,new RegExp("e\\.key==='"+key+"'"),key);
});
