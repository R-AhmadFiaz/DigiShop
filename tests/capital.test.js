import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {minorAmount,pkr} from '../src/api/purchases.js';
const source=fs.readFileSync(new URL('../src/pages/owner/Partners.jsx',import.meta.url),'utf8');
test('Partners & Capital is an OWNER-only route and sidebar item',()=>{
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const owner=app.split('<Route element={<Guard role="OWNER" />}>')[1].split('<Route element={<Guard role="CASHIER" />}>')[0];
  assert.match(owner,/path="partners" element={<Partners/);
  const sidebar=fs.readFileSync(new URL('../src/layouts/ShopLayout.jsx',import.meta.url),'utf8');assert.match(sidebar.split('CASHIER:')[0],/Partners & Capital/);assert.doesNotMatch(sidebar.split('CASHIER:')[1],/Partners & Capital/);
});
test('capital balances are server-authoritative and unavailable is distinct from zero',()=>{
  assert.match(source,/list.data.total.balanceMinor/);assert.match(source,/Finish money-record setup before adding or taking out partner money/);
  assert.match(source,/pkr\(row.capital\?\.balanceMinor\)/);assert.equal(pkr(undefined),'Unavailable');assert.equal(minorAmount('12.50'),1250);
  assert.match(source,/These totals are not the cash available/);assert.doesNotMatch(source,/reduce\(/);
});
test('capital actions use retained same-key confirmations and original-account reversals',()=>{
  assert.match(source,/SupplierAction operation="capital-operation"/);assert.match(source,/CONFIRM CAPITAL REVERSAL/);assert.match(source,/money has actually moved back/);
  assert.match(source,/requestKey:crypto.randomUUID\(\)/);assert.match(source,/if\(locked\)return/);assert.doesNotMatch(source,/method:'DELETE'/);
});
test('partner identity reuse, revision-safe management and Pakistan timestamps are explicit',()=>{
  assert.match(source,/entityId:business._id,expectedRevision:business.revision/);assert.match(source,/expectedRevision:editing.revision/);assert.match(source,/zero remaining capital only/);assert.match(source,/timeZone:'Asia\/Karachi'/);
  assert.match(source,/No login account is created/);assert.match(source,/customer\/supplier balances stay separate/);
});
