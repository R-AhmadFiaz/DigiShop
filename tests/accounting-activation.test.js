import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../src/components/AccountingActivation.jsx',import.meta.url),'utf8');
test('activation is on the existing OWNER-only setup page',()=>{
  const page=fs.readFileSync(new URL('../src/pages/owner/ExistingSetup.jsx',import.meta.url),'utf8');
  const app=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');
  const owner=app.split('<Route element={<Guard role="OWNER" />}>')[1].split('<Route element={<Guard role="CASHIER" />}>')[0];
  assert.match(owner,/existing-setup/);assert.match(page,/<AccountingActivation onChanged={changed}/);
});
test('explicit preparation, readiness, activation and pause use server state',()=>{
  for(const text of ['CLEAN_START','RECONCILE','Review activation readiness','PREPARE ACCOUNTING','ACTIVATE ACCOUNTING','PAUSE ACCOUNTING','status.data.permitted','preview.ready','previewToken:preview.previewToken','expectedRevision:revision'])assert.ok(source.includes(text),text);
});
test('activation and enrollment retain exact requests through the existing financial confirmation component',()=>{
  assert.match(source,/SupplierAction operation="accounting-activation"/);assert.match(source,/SupplierAction operation="accounting-enrollment"/);
  assert.match(source,/requestKey:requestKey\(\)/);assert.match(source,/locked\|\|busy/);assert.match(source,/expiresAt:preview.expiresAt/);
});
test('clean-start instructions do not promise silent demo cleanup',()=>{
  assert.match(source,/Nothing is cleared automatically/);assert.match(source,/zero customer debt and credit/);assert.match(source,/unexplained demo balances/i);
  assert.doesNotMatch(source,/method:'DELETE'|remainingMoney:|storeCreditBalanceMinor:/);
});
test('additional account enrollment requires verified money and explicit confirmation',()=>{
  assert.match(source,/ENROLL ACCOUNT/);assert.match(source,/minorAmount\(values.amount\)/);assert.match(source,/!a.cashCutoverId/);assert.match(source,/not sales revenue or a new partner investment/);
});
