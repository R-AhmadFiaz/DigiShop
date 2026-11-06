import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const pos=fs.readFileSync(new URL('../src/components/POS.jsx',import.meta.url),'utf8');
test('POS keeps search separate, checkout outside both scrollers and native validation disabled',()=>{
 assert.match(pos,/pos-search-panel/);assert.match(pos,/pos-lines/);assert.match(pos,/pos-payments/);assert.match(pos,/pos-checkout/);
 assert.ok(pos.indexOf('pos-search-panel')>pos.indexOf('</tbody>'));
 assert.match(pos,/aria-label="Product search panel"/);
 assert.match(pos,/<form id="sale-form" noValidate onSubmit=\{submit\}/);
 assert.match(pos,/validateSale\(/);assert.match(pos,/aria-invalid=\{!!rowError\}/);
 assert.match(pos,/ResizeObserver/);assert.match(pos,/root.getBoundingClientRect\(\).top\+window.scrollY/);
});
test('customer picker dialog is opt-in and retained request keys/calculations are untouched',()=>{
 assert.match(pos,/<Modal title="Select customer"/);assert.match(pos,/<CustomerPicker expanded/);
 for(const token of ['readPending(storageKey)','pending.body','requestKey: requestKey()','saleTotals(cart, saleType, discountType, discountValue)','/orders/create-order','/orders/quotation'])assert.ok(pos.includes(token));
 const picker=fs.readFileSync(new URL('../src/components/CustomerPicker.jsx',import.meta.url),'utf8');assert.match(picker,/expanded = false/);
});
