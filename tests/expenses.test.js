import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {minorAmount,pkr} from '../src/api/purchases.js';
const source=fs.readFileSync(new URL('../src/pages/owner/Expenses.jsx',import.meta.url),'utf8');

test('expenses are only routed and navigated inside OWNER management',()=>{
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const owner=app.split('<Route element={<Guard role="OWNER" />}>')[1].split('<Route element={<Guard role="CASHIER" />}>')[0];
  assert.match(owner,/path="expenses" element={<Expenses/);
  const sidebar=fs.readFileSync(new URL('../src/layouts/ShopLayout.jsx',import.meta.url),'utf8');
  assert.match(sidebar.split('CASHIER:')[0],/\["expenses", "Expenses"\]/);
  assert.doesNotMatch(sidebar.split('CASHIER:')[1].split('export default')[0],/Expenses/);
});
test('expense UI uses server totals and explicit unavailable accounting',()=>{
  assert.match(source,/Expense posting unavailable/);assert.match(source,/list.data.totalMinor/);
  assert.match(source,/list.data.breakdown/);assert.match(source,/setup.data\?\.available/);
  assert.match(source,/This is not a profit calculation/);assert.match(source,/Pagination/);
  assert.doesNotMatch(source,/reduce\(/);
});
test('expense payment and reversal reuse retained exact-key financial confirmation',()=>{
  assert.match(source,/SupplierAction operation="expense-operation"/);
  assert.match(source,/requestKey:crypto.randomUUID\(\)/);
  assert.match(source,/CONFIRM EXPENSE REVERSAL/);assert.match(source,/funds have actually been returned/);
  assert.match(source,/disabled=\{locked/);assert.match(source,/if\(locked\)return/);
  assert.doesNotMatch(source,/method:'DELETE'/);
});
test('expense amounts use paisa precision and explicit Pakistan timestamps',()=>{
  assert.equal(minorAmount('12.50'),1250);assert.throws(()=>minorAmount('12.505'));
  assert.equal(pkr(undefined),'Unavailable');assert.match(source,/timeZone:'Asia\/Karachi'/);
  assert.match(source,/values.date\+'\+05:00'/);assert.match(source,/timeStyle:'medium'/);
});
