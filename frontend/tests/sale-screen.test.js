import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { subscriptionPill } from '../src/api/subscription.js';
const read=path=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');
const pos=read('components/POS.jsx');

test('only Sales > New sale uses the one-screen layout; cashier POS and quotations keep theirs',()=>{
  const sales=read('pages/owner/Sales.jsx');
  assert.match(sales,/<POS screen active=\{tab === "sale"\} \/>/);
  assert.match(sales,/className="sales-screen-host"/);
  assert.match(read('App.jsx'),/<POS \/>/,'cashier POS is unchanged');
  assert.match(pos,/screen = false/);
  assert.match(pos,/if\(!root\|\|quotation\|\|screen\)return;/,'the measured height is only for the old layout');
});

test('new sale screen: search, results, sale lines and payment bar',()=>{
  const screen=pos.slice(pos.indexOf('if(screen){'),pos.indexOf('className={"pos-grid pos-unified"'));
  for(const text of ['Find a product</label>','Current sale','Price list','Walk-in customer','<span>Amount paid</span>','<span>Discount</span>','Customer</span>','Amount due','Total','Enter less than the total to record a credit sale.',"'Complete sale'"])
    assert.ok(screen.includes(text),text);
  assert.match(screen,/No items yet\. Type a product name in search, then press Enter\./);
  for(const heading of ['Product','Qty','Unit rate','Disc/unit','Line total'])assert.ok(screen.includes('<th>'+heading+'</th>')||screen.includes('<th className="text-end">'+heading+'</th>'),heading);
  assert.match(screen,/Out of stock/);assert.match(screen,/disabled=\{busy\|\|products\.loading\|\|out\|\|noPrice\}/,'out-of-stock rows cannot be added');
  assert.match(screen,/· Stock \{product\.stockQuantity\}/);
  assert.doesNotMatch(screen,/<kbd|aria-keyshortcuts="/,'no key badges or shortcut hints on the New sale screen');
});

test('new sale keyboard: no F-key, Ctrl+Enter or Esc shortcuts; search Enter and sale-line keys remain',()=>{
  assert.match(pos,/if\(screen\)return;/,'the page-wide F-key handler is off on the New sale screen');
  assert.doesNotMatch(pos,/screenShortcut|onHistory|typedQuantity|saleTypeSelect|discountSelect/);
  assert.match(pos,/if\(screen\)requestAnimationFrame\(\(\)=>\{searchInput\.current\?\.focus\(\{preventScroll:true\}\);searchInput\.current\?\.select\(\);/,'after adding, search keeps focus with its text selected');
  assert.match(pos,/if\(suggestions\|\|screen\)add\(/);
  assert.doesNotMatch(pos,/e\.key==='\+'\|\|e\.key==='='\|\|e\.key==='-'/,'no + / − quantity keys');assert.doesNotMatch(pos,/\/\^\[0-9\]\$\/\.test\(e\.key\)/,'no typed-digit quantity');
  assert.match(pos,/e\.key==='Delete'/);
  assert.match(pos,/next>line\.stockQuantity/,'the + button never goes past stock');
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
