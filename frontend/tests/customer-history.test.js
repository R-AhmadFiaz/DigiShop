import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {formatBalanceChange,formatCustomerDate} from '../src/components/customerActivityFormat.js';

test('customer account workspace keeps reconciled debt and credit with compact filtered activity',()=>{
  const page=fs.readFileSync(new URL('../src/pages/Customers.jsx',import.meta.url),'utf8');
  assert.match(page,/\/accounts\/customers\/'.*\/history/);
  assert.match(page,/position\.debtMinor/);assert.match(page,/position\.storeCreditMinor/);
  assert.match(page,/Balances need review/);assert.match(page,/coverage\.complete/);
  assert.match(page,/Chronological customer account activity/);assert.match(page,/Pagination pagination=\{history\.data\.pagination\}/);
  assert.match(page,/\/owner\/sales\/'\+event\.orderId/);
  assert.match(page,/customer-account-workspace/);assert.match(page,/customer-identity/);
  assert.match(page,/customer-history-layout/);
  assert.match(page,/Balance change/);assert.match(page,/detailLabel="View"/);assert.match(page,/customer-activity-table/);assert.match(page,/No records have been changed/);
  assert.doesNotMatch(page,/entries\.reduce\(/);
});

test('customer balance change keeps debt and credit separate and marks incomplete data unavailable',()=>{
  assert.equal(formatBalanceChange({debtEffectMinor:260000,creditEffectMinor:0}),'+2,600.00');
  assert.equal(formatBalanceChange({debtEffectMinor:-200000,creditEffectMinor:0}),'−2,000.00');
  assert.equal(formatBalanceChange({debtEffectMinor:0,creditEffectMinor:50000}),'Credit +500.00');
  assert.equal(formatBalanceChange({debtEffectMinor:0,creditEffectMinor:-50000}),'Credit −500.00');
  assert.equal(formatBalanceChange({debtEffectMinor:260000,creditEffectMinor:50000}),'Debt +2,600.00 · Credit +500.00');
  assert.equal(formatBalanceChange({debtEffectMinor:0,creditEffectMinor:0}),'—');
  assert.equal(formatBalanceChange({debtEffectMinor:0,creditEffectMinor:null}),'Unavailable');
  assert.equal(formatBalanceChange({debtEffectMinor:undefined,creditEffectMinor:0}),'Unavailable');
});

test('customer activity date uses Pakistan local time with minute precision',()=>{
  assert.equal(formatCustomerDate('2026-10-17T11:19:46.000Z'),'17 Oct 2026, 4:19 PM');
  assert.equal(formatCustomerDate(null),'Recorded date unavailable');
  assert.equal(formatCustomerDate('not a date'),'Recorded date unavailable');
});

test('customer history uses an adjacent contextual inspector and keyboard-operable rows',()=>{
  const page=fs.readFileSync(new URL('../src/pages/Customers.jsx',import.meta.url),'utf8');
  const table=fs.readFileSync(new URL('../src/components/RecordTable.jsx',import.meta.url),'utf8');
  const details=fs.readFileSync(new URL('../src/components/CustomerActivityDetails.jsx',import.meta.url),'utf8');
  assert.match(page,/RecordTable label="Chronological customer account activity"/);
  assert.match(table,/onKeyDown/);assert.match(table,/e\.key/);assert.match(table,/aria-controls/);
  assert.match(table,/arrowNavigation/);assert.match(table,/ArrowDown/);
  assert.match(page,/onOpen=/);assert.match(page,/CustomerActivityDetails/);
  assert.match(details,/event\.details\?\.cashRefundMinor/);assert.match(details,/event\.details\?\.products/);
  assert.match(details,/Debt effect/);assert.match(details,/Store-credit effect/);
  assert.doesNotMatch(details,/Cash refunded.*None recorded/);
  assert.match(page,/aria-label="Search customer activity"/);assert.match(page,/aria-label="Filter customer activity type"/);
});

test('Customers dropdown uses the main navigation pattern and keeps legacy service routes',()=>{
  const layout=fs.readFileSync(new URL('../src/layouts/ShopLayout.jsx',import.meta.url),'utf8');
  const routes=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(layout,/className="more-nav customer-nav"/);assert.match(layout,/Customer accounts/);
  assert.match(layout,/Customer invoices/);assert.match(layout,/Customer activity/);
  assert.match(layout,/ArrowDown/);assert.match(layout,/ArrowUp/);assert.match(layout,/e.key==='Escape'/);
  assert.doesNotMatch(layout,/SecondaryNavigation/);
  assert.match(routes,/customers\/invoices/);assert.match(routes,/customers\/:service/);
});

test('global customer services are read-only and expose contextual records from the shared activity API',()=>{
  const page=fs.readFileSync(new URL('../src/pages/owner/CustomerServices.jsx',import.meta.url),'utf8');
  const backend=fs.readFileSync(new URL('../../store-backend/src/utils/businessAccounts.ts',import.meta.url),'utf8');
  const controller=fs.readFileSync(new URL('../../store-backend/src/controllers/businessAccounts.controller.ts',import.meta.url),'utf8');
  const route=fs.readFileSync(new URL('../../store-backend/src/routes/businessAccounts.route.ts',import.meta.url),'utf8');
  assert.match(page,/accounts\/customers\/activity/);assert.match(page,/payments:\{key:'PAYMENTS'/);assert.match(page,/Filter customer record type/);
  assert.match(page,/INVOICES/);assert.match(page,/REFUNDS/);assert.match(page,/Invoice/);assert.match(page,/filterCustomer/);
  assert.match(page,/coverage.complete/);assert.match(page,/onOpen=/);assert.match(page,/CustomerActivityDetails/);assert.match(page,/Balance change/);assert.match(page,/detailLabel="View"/);assert.match(page,/customer-activity-table/);
  assert.match(route,/customers\/activity/);assert.match(controller,/customerActivity/);assert.match(controller,/INVOICES.*RETURNS.*REFUNDS/);
  assert.match(backend,/shopId:actor.shopId/);assert.match(backend,/creditIssuedMinor/);
});

test('backend history exposes authoritative source joins, pagination, isolation and duplicate suppression',()=>{
  const backend=fs.readFileSync(new URL('../../store-backend/src/utils/businessAccounts.ts',import.meta.url),'utf8');
  const route=fs.readFileSync(new URL('../../store-backend/src/routes/businessAccounts.route.ts',import.meta.url),'utf8');
  const controller=fs.readFileSync(new URL('../../store-backend/src/controllers/businessAccounts.controller.ts',import.meta.url),'utf8');
  assert.match(route,/customers\/:id\/history/);assert.match(controller,/customerHistory/);
  assert.match(backend,/shopId:actor\.shopId,customerId:customer\._id/);
  assert.match(backend,/emittedAdjustmentIds\.has\(String\(row\.adjustmentId\)\)/);
  assert.match(backend,/invoiceSaleIds\.has\(String\(row\.referenceId\)\)/);
  assert.match(backend,/journalEventsDeduplicated:true/);assert.match(backend,/limit:input\.limit/);
  assert.match(backend,/transactionIds:relatedJournals\.map/);assert.match(backend,/accountIds:/);
  const transactions=fs.readFileSync(new URL('../src/components/TransactionHistory.jsx',import.meta.url),'utf8');
  assert.match(transactions,/sourceId:sourceId\|\|undefined/);
});
