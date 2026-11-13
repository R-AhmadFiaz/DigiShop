import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { subscriptionPill } from '../src/api/subscription.js';
const read=path=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const pos=read('components/POS.jsx');

test('only Sales > New sale uses the one-screen layout; cashier POS and quotations keep theirs',()=>{
  const sales=read('pages/owner/Sales.jsx');
  assert.match(sales,/<POS screen active=\{tab === "sale"\} onHistory=\{\(\) => setTab\("history"\)\} \/>/);
  assert.match(sales,/className="sales-screen-host"/);
  assert.match(read('App.jsx'),/<POS \/>/,'cashier POS is unchanged');
  assert.match(pos,/screen = false/);
  assert.match(pos,/if\(!root\|\|quotation\|\|screen\)return;/,'the measured height is only for the old layout');
});

test('new sale screen: search, results, sale lines, payment bar and shortcut bar',()=>{
  const screen=pos.slice(pos.indexOf('if(screen){'),pos.indexOf('  return (\n    <div ref={workspace} className={"pos-grid')>0?pos.indexOf('  return (\n    <div ref={workspace} className={"pos-grid'):pos.length);
  for(const text of ['Find a product <kbd>F2</kbd>','Current sale','Price list <kbd>F3</kbd>','Walk-in customer','Amount paid <kbd>F8</kbd>','Discount <kbd>F7</kbd>','Customer <kbd>F9</kbd>','Amount due','Total','Enter less than the total to record a credit sale.','Complete sale <kbd>F10</kbd>'])
    assert.ok(screen.includes(text),text);
  assert.match(screen,/No items yet\. Press <kbd>F2<\/kbd>, type a product name, then <kbd>Enter<\/kbd>\./);
  for(const heading of ['Product','Qty','Unit rate','Disc/unit','Line total'])assert.ok(screen.includes('<th>'+heading+'</th>')||screen.includes('<th className="text-end">'+heading+'</th>'),heading);
  assert.match(screen,/Out of stock/);assert.match(screen,/disabled=\{busy\|\|products\.loading\|\|out\|\|noPrice\}/,'out-of-stock rows cannot be added');
  assert.match(screen,/· Stock \{product\.stockQuantity\}/);
  assert.match(screen,/aria-keyshortcuts="F10 Control\+Enter"/);
  for(const [key] of [['F2'],['F3'],['F4'],['F6'],['F7'],['F8'],['F9'],['F10'],['Esc']])assert.ok(pos.includes("['"+key+"'"),key);
});

test('new sale keyboard: F-keys, Ctrl+Enter, Esc, search Enter and sale-line keys',()=>{
  assert.match(pos,/F2:\(\)=>focus\(searchInput\.current\),F3:\(\)=>focus\(saleTypeSelect\.current\),F4:/);
  assert.match(pos,/F6:\(\)=>onHistory\?\.\(\),F7:\(\)=>focus\(discountSelect\.current\),F8:\(\)=>focus\(paymentInput\.current\),F9:\(\)=>setCustomerOpen\(true\),F10:checkout/);
  assert.match(pos,/if\(action\)\{e\.preventDefault\(\);/,'F-keys cancel browser defaults such as F3 find');
  assert.doesNotMatch(pos,/F5:/,'F5 reload is left alone');
  assert.match(pos,/if\(e\.ctrlKey\)\{if\(e\.key==='Enter'/);
  assert.match(pos,/e\.key==='Escape'&&!e\.defaultPrevented/);
  assert.match(pos,/if\(screen\)requestAnimationFrame\(\(\)=>\{searchInput\.current\?\.focus\(\{preventScroll:true\}\);searchInput\.current\?\.select\(\);/,'after adding, search keeps focus with its text selected');
  assert.match(pos,/if\(suggestions\|\|screen\)add\(/);
  assert.match(pos,/e\.key==='\+'\|\|e\.key==='='\|\|e\.key==='-'/);assert.match(pos,/\/\^\[0-9\]\$\/\.test\(e\.key\)/);assert.match(pos,/e\.key==='Delete'/);
  assert.match(pos,/next>line\.stockQuantity/,'+ never goes past stock');
});

test('subscription warning becomes a header pill on New sale only',()=>{
  const day=86400000,now=Date.UTC(2026,10,13,9);
  assert.equal(subscriptionPill(new Date(now+2*day).toISOString(),now),'Subscription ends in 2 days');
  assert.equal(subscriptionPill(new Date(now+30*day).toISOString(),now),'');
  const layout=read('layouts/ShopLayout.jsx');
  assert.match(layout,/new URLSearchParams\(search\)\.get\("view"\) !== "history"/);
  assert.match(layout,/<SubscriptionWarning expiry=\{subscriptionExpiry\} compact \/>/);
  assert.match(layout,/user\.role === "OWNER" && !saleScreen && \(/,'other pages keep the banner');
  assert.match(read('components/SubscriptionWarning.jsx'),/\{text\} · <span className="subscription-pill-action">Renew<\/span>/);
});

test('one screen at 1100px+, stacked below, amber focus ring',()=>{
  const css=read('styles.css');
  assert.match(css,/@media screen and \(min-width:1100px\) and \(min-height:500px\) \{\s*\.sales-screen-host \{ flex:1 1 0; min-height:0;/);
  assert.match(css,/\.sale-main \{ flex:1 1 0; min-height:0; grid-template-columns:480px minmax\(0,1fr\); \}/);
  assert.match(css,/\.sale-lines \{ flex:1 1 0; max-height:none; \}/);
  assert.match(css,/\.app-shell:has\(\.sales-screen-host:not\(\[hidden\]\) \.sale-screen\) :focus-visible \{ outline:3px solid #f59e0b !important;/);
  assert.match(css,/\.sale-result:disabled \{ opacity:1;/,'out-of-stock rows stay readable');
});
