import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=path=>fs.readFileSync(new URL('../src/'+path,import.meta.url),'utf8');

test('Purchases menu offers Create Order, which opens the purchase form by URL',()=>{
  const layout=read('layouts/ShopLayout.jsx');
  const menu=layout.slice(layout.indexOf('className="more-nav purchase-nav"'),layout.indexOf('</details>',layout.indexOf('className="more-nav purchase-nav"')));
  assert.match(menu,/<NavLink to="purchases">Purchase orders<\/NavLink>/);
  assert.match(menu,/<Link to=\{\{pathname:"purchases",search:createOrderSearch\}\}[^\n]*?>Create Order<\/Link>/);
  assert.match(menu,/Pay supplier/);
  assert.match(layout,/params\.set\("create", "1"\)/);
});
test('navigation dropdowns are exclusive and close on Escape',()=>{
  const layout=read('layouts/ShopLayout.jsx');
  assert.match(layout,/nav\.addEventListener\('toggle',exclusive,true\)/);
  assert.match(layout,/nav\.addEventListener\('click',activate,true\)/,'others close at activation, not only on the later toggle event');
  assert.match(layout,/if\(d!==opened&&!d\.contains\(opened\)\)d\.open=false/,'nested Accounts keeps More open');
  assert.match(layout,/event\.key!=='Escape'\|\|event\.defaultPrevented\|\|nav\.closest\('dialog\[open\]'\)/,'phone drawer keeps its own Escape');
  assert.match(layout,/document\.addEventListener\('pointerdown',close\)/,'outside click still closes');
  assert.match(layout,/const openMenu=e\.target\.closest\('details\[open\]'\)/,'Escape closes the nearest open menu, not an already closed one');
});
test('Purchases page opens the existing form from ?create=1 and has no standalone create button',()=>{
  const page=read('pages/owner/Purchases.jsx');
  assert.match(page,/useQueryParam\('create'\)/);
  assert.match(page,/const creating=createParam==='1'/);
  assert.match(page,/<PageTitle title="Purchases"\/>/);
  assert.doesNotMatch(page,/onClick=\{\(\)=>setCreating\(true\)\}/);
  assert.match(page,/<CreatePurchase prepare=\{prepare\} locked=\{locked\} onClose=\{\(\)=>setCreating\(false\)\}\/>/);
  assert.match(page,/onChanged=\{\(\)=>\{setCreating\(false\);list\.reload\(\);\}\}/);
});
