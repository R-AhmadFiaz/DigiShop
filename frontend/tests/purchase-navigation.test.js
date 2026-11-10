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
test('Purchases page opens the existing form from ?create=1 and has no standalone create button',()=>{
  const page=read('pages/owner/Purchases.jsx');
  assert.match(page,/useQueryParam\('create'\)/);
  assert.match(page,/const creating=createParam==='1'/);
  assert.match(page,/<PageTitle title="Purchases"\/>/);
  assert.doesNotMatch(page,/onClick=\{\(\)=>setCreating\(true\)\}/);
  assert.match(page,/<CreatePurchase prepare=\{prepare\} locked=\{locked\} onClose=\{\(\)=>setCreating\(false\)\}\/>/);
  assert.match(page,/onChanged=\{\(\)=>\{setCreating\(false\);list\.reload\(\);\}\}/);
});
