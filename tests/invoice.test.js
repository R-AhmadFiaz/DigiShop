import assert from "node:assert/strict";
import test from "node:test";
import fs from 'node:fs';
import { adjustmentBody, amount, clearPending, journalKey, readPending, requestKey, savePending, uncertain } from "../src/api/invoice.js";
const order = { revision: 4, items: [{ lineId: "original-line", quantity: 3, unitPrice: 50 }] };
const input = { order, mode: "adjustments", key: "stable-request", reason: "Product returned", returns: {}, additions: [], discountType: "NONE", discountValue: "0", funds: { cashReceivedAmount: "0", creditRedeemedAmount: "0", cashRefundAmount: "0", creditIssueAmount: "0" } };

test('POS accounting checkout sends a body key and explicit account, retaining the exact request for recovery',()=>{
  const source=fs.readFileSync(new URL('../src/components/POS.jsx',import.meta.url),'utf8');
  assert.match(source,/paidAmount, requestKey: requestKey\(\)/);
  assert.match(requestKey(),/^[\w-]{8,100}$/);
  assert.match(source,/useLoad\("\/orders\/payment-accounts"\)/);
  assert.match(source,/retry \? pending\.body/);
  assert.match(source,/const journaled = !quotation && \(retry \|\| paymentAccounts\.data\?\.accountingEnabled \|\| body\.creditAmount > 0\)/);
  assert.match(source,/savePending\(storageKey, \{ body \}\)/);
  assert.match(source,/paymentAccounts\.data\?\.accountingEnabled && paidAmount > 0 \? \{ receiptAccountId \}/);
  assert.match(source,/if \(lock\.current \|\| customerBusy\) return/);
});

test('customer collection reuses invoice settlement and sends preview-bound cash routing',()=>{
  const customers=fs.readFileSync(new URL('../src/pages/Customers.jsx',import.meta.url),'utf8');
  assert.match(customers,/customerId:customer\._id,page,limit:10/);
  assert.match(customers,/Receive Payment/);
  assert.match(customers,/to=\{'\/owner\/sales\/'\+order\._id\}/);
  assert.doesNotMatch(customers,/method:\s*['"]POST/);
  const form=fs.readFileSync(new URL('../src/components/InvoiceAdjustment.jsx',import.meta.url),'utf8');
  assert.match(form,/useLoad\('\/orders\/payment-accounts'\)/);
  assert.match(form,/body\[field\]=routing\[field\]/);
  assert.match(form,/setPreview\(result\); setReviewBody\(body\)/);
  assert.match(form,/confirmationToken: preview\.confirmationToken/);
  assert.match(form,/I have received/);
});
test("adjustment uses stable line identities, dispositions, revision and no client-supplied prices", () => {
  const body = adjustmentBody({ ...input, returns: { "original-line": { quantity: "2", disposition: "DAMAGED" } }, additions: [{ _id: "product", quantity: "2", retailPrice: 999 }] });
  assert.deepEqual(body.returns, [{ lineId: "original-line", quantity: 2, disposition: "DAMAGED" }]);
  assert.deepEqual(body.additions, [{ productId: "product", quantity: 2 }]);
  assert.equal(body.expectedRevision, 4);
  assert.equal(body.requestKey, "stable-request");
  assert.equal(body.cashRefundAmount, 0);
  assert.equal(Object.hasOwn(body, "totalPrice"), false);
});
test("full restock return and explicit fixed/percentage discounts retain owner input", () => {
  for (const discountType of ["FIXED", "PERCENTAGE"]) {
    const body = adjustmentBody({ ...input, discountType, discountValue: "10.25", returns: { "original-line": { quantity: 3, disposition: "RESTOCK" } } });
    assert.equal(body.discountValue, 10.25);
    assert.equal(body.returns[0].quantity, 3);
  }
});
test("payment and cancellation omit item and discount edits; refund recipient is separate", () => {
  for (const mode of ["payments", "cancellations"]) {
    const body = adjustmentBody({ ...input, mode });
    assert.deepEqual(body.returns, []); assert.deepEqual(body.additions, []);
    assert.equal(Object.hasOwn(body, "discountType"), false);
  }
  const body = adjustmentBody({ ...input, funds: { cashRefundAmount: "10", creditIssueAmount: "20", creditRedeemedAmount: "3.25" }, recipient: { _id: "recipient" } });
  assert.equal(body.creditRecipientId, "recipient"); assert.equal(Object.hasOwn(body, "customerId"), false);
  assert.equal(body.creditIssueAmount, 20);
  const cashOnly = adjustmentBody({ ...input, funds: { cashRefundAmount: "10", creditIssueAmount: "0" }, recipient: { _id: "previous-selection" } });
  assert.equal(Object.hasOwn(cashOnly, "creditRecipientId"), false);
});
test("blank, negative, nonfinite and sub-paisa financial inputs are rejected", () => {
  for (const value of ["", " ", "-1", "Infinity", "NaN", "0.001"]) assert.throws(() => amount(value, "payment"));
  for (const value of ["0", "1.23", "8000"]) assert.equal(amount(value, "payment"), Number(value));
  assert.throws(() => adjustmentBody({ ...input, reason: " " }), /reason/);
  for (const quantity of ["-1", "1.5", "4"]) assert.throws(() => adjustmentBody({ ...input, returns: { "original-line": { quantity, disposition: "RESTOCK" } } }), /quantities/);
});
test("uncertain financial requests retain identical tokens/body/key across reload, scoped by user", () => {
  const values = new Map();
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const key = journalKey({ email: "owner@one.test" }, "invoice-one");
  const pending = { endpoint: "/orders/one/adjustments", body: { ...adjustmentBody(input), confirmationToken: "a".repeat(64) } };
  savePending(key, pending);
  assert.deepEqual(readPending(key), pending);
  assert.equal(readPending(journalKey({ email: "owner@two.test" }, "invoice-one")), null);
  assert.equal(uncertain({ status: 0 }), true); assert.equal(uncertain({ status: 500 }), true);
  assert.equal(uncertain({ status: 409 }), false); assert.equal(uncertain({ status: 400 }), false);
  clearPending(key); assert.equal(readPending(key), null);
  assert.equal(journalKey({ _id: "same-user", email: "old@test" }, "invoice-one"), journalKey({ _id: "same-user", email: "new@test" }, "invoice-one"));
  assert.notEqual(journalKey({ _id: "one", email: "same@test" }, "pos-credit"), journalKey({ _id: "two", email: "same@test" }, "pos-credit"));
  assert.notEqual(requestKey(), requestKey());
  delete globalThis.sessionStorage;
});
test("unavailable storage preserves ordinary screens but financial submission fails before sending", () => {
  globalThis.sessionStorage = { getItem() { throw new Error("Storage blocked"); }, setItem() { throw new Error("Storage blocked"); }, removeItem() { throw new Error("Storage blocked"); } };
  assert.equal(readPending("pending"), null);
  assert.throws(() => savePending("pending", {}), error => error.status === 400 && /browser storage/.test(error.message));
  assert.doesNotThrow(() => clearPending("pending"));
  delete globalThis.sessionStorage;
});
