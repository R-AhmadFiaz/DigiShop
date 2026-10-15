import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import mongoose from 'mongoose';
const {moneyMinor, moneyMajor, invoiceTotals, settlementPlan, financialSettlement} = await import('../dist/utils/invoiceAccounting.js');
const {planInvoiceAdjustment, applyInvoiceAdjustment, applyInvoicePayment, applyInvoiceCancellation} = await import('../dist/controllers/invoiceAdjustment.controller.js');
const {Order} = await import('../dist/models/order.model.js');
const {InvoiceAdjustment} = await import('../dist/models/invoiceAdjustment.model.js');
const id = n => n.toString(16).padStart(24, '0');
function invoice(overrides = {}) {
    return {_id: id(1), shopId: id(2), type: 'INVOICE', status: 'DELIVERED', saleType: 'RETAIL',
        items: [{lineId: 'original-line', productId: id(3), name: 'Cable', quantity: 2, unitPrice: 50}],
        subtotal: 100, discountType: 'NONE', discountValue: 0, discountAmount: 0,
        totalPrice: 100, paidAmount: 100, amountDue: 0, ...overrides};
}
function input(overrides = {}) {
    return {requestKey: 'request-123', expectedRevision: 0, reason: 'Customer exchange',
        returns: [{lineId: 'original-line', quantity: 1, disposition: 'RESTOCK'}], additions: [], ...overrides};
}
const product = {_id: id(3), shopId: id(2), name: 'Renamed cable', brand: 'Brand', unit: 'm', retailPrice: 70, wholesalePrice: 60};

test('PKR uses exact safe paisa, rejects ambiguous legacy precision, rounds percentage half-up', () => {
    assert.equal(moneyMinor(0.1 + 0.2), 30);
    assert.equal(moneyMajor(-12345), -123.45);
    for (const paisa of [0, 1, 23, 101, 10000000001]) assert.equal(moneyMinor(moneyMajor(paisa)), paisa);
    for (const value of [-1, NaN, Infinity, '10', 1.001, Number.MAX_SAFE_INTEGER]) assert.throws(() => moneyMinor(value));
    assert.deepEqual(invoiceTotals([{quantity: 1, unitPrice: 0.01}], 'PERCENTAGE', 50), {subtotalMinor: 1, discountMinor: 1, totalMinor: 0});
    assert.throws(() => invoiceTotals([{quantity: 2, unitPrice: 1}], 'PERCENTAGE', 101));
});
test('settlement reduces debt first; credit-funded excess is restored before cash; invariant always holds', () => {
    assert.deepEqual(settlementPlan(7000, 4000), {netSettledMinor: 4000, dueMinor: 3000, refundMinor: 0, creditRestoreMinor: 0, cashRefundMaximumMinor: 0});
    assert.equal(settlementPlan(2000, 4000).refundMinor, 2000);
    assert.equal(settlementPlan(0, 10000, 3000).creditRestoreMinor, 3000);
    for (let total = 0; total < 10000; total += 97) {
        const result = settlementPlan(total, 4000, 1000);
        assert.equal(result.netSettledMinor + result.dueMinor, total);
        assert.equal(result.creditRestoreMinor + result.cashRefundMaximumMinor, result.refundMinor);
        assert.ok(result.dueMinor >= 0);
    }
    assert.throws(() => settlementPlan(0, 10, 11));
});
test('financial allocation is exact, preserves funding types and never converts credit into cash', () => {
    const reduced = financialSettlement(7000, 4000, 0, {});
    assert.equal(reduced.dueMinor, 3000); assert.equal(reduced.cashRefundMinor, 0);
    const paid = financialSettlement(10000, 4000, 0, {cashReceivedAmount: 20, creditRedeemedAmount: 40});
    assert.equal(paid.cashNetMinor, 6000); assert.equal(paid.creditNetMinor, 4000); assert.equal(paid.dueMinor, 0);
    const returned = financialSettlement(2000, 4000, 6000, {cashRefundAmount: 10, creditIssueAmount: 10});
    assert.equal(returned.creditRestoredMinor, 6000); assert.equal(returned.cashNetMinor, 2000); assert.equal(returned.creditNetMinor, 0);
    // Credit is restored first: new retained settlement remains cash-funded in this case.
    assert.equal(returned.settledMinor, 2000);
    assert.throws(() => financialSettlement(2000, 4000, 6000, {cashRefundAmount: 80}), /allocation/);
    assert.throws(() => financialSettlement(10000, 4000, 0, {cashReceivedAmount: 61}), /exceeds/);
    for (const bad of [-1, NaN, Infinity, 1.001, '10', null]) assert.throws(() => financialSettlement(10000, 0, 0, {cashReceivedAmount: bad}));
});
test('existing and returned units retain price; newly supplied same-product units use current server price', () => {
    const plan = planInvoiceAdjustment(invoice(), input({additions: [{productId: id(3), quantity: 2}]}), [product]);
    assert.equal(plan.after.items[0].unitPrice, 50);
    assert.equal(plan.after.items[1].unitPrice, 70);
    assert.notEqual(plan.after.items[0].lineId, plan.after.items[1].lineId);
    assert.equal(plan.movements[0].unitPriceMinor, 5000);
    assert.equal(plan.after.totalMinor, 19000);
});
test('restock/damaged returns and same-product exchange record gross movements separately', () => {
    for (const disposition of ['RESTOCK', 'DAMAGED']) {
        const plan = planInvoiceAdjustment(invoice(), input({returns: [{lineId: 'original-line', quantity: 1, disposition}], additions: [{productId: id(3), quantity: 1}]}), [product]);
        assert.equal(plan.movements[0].stockDelta, disposition === 'RESTOCK' ? 1 : 0);
        assert.equal(plan.movements[1].stockDelta, -1);
        assert.equal(plan.movements[0].quantity, 1);
    }
});
test('percentage recalculates; fixed remains until explicitly edited and cannot exceed revised subtotal', () => {
    const percentage = invoice({discountType: 'PERCENTAGE', discountValue: 10, discountAmount: 10, totalPrice: 90, paidAmount: 90});
    assert.equal(planInvoiceAdjustment(percentage, input(), []).after.discountMinor, 500);
    const fixed = invoice({discountType: 'FIXED', discountValue: 20, discountAmount: 20, totalPrice: 80, paidAmount: 80});
    assert.equal(planInvoiceAdjustment(fixed, input(), []).after.discountMinor, 2000);
    const full = input({returns: [{lineId: 'original-line', quantity: 2, disposition: 'RESTOCK'}]});
    assert.throws(() => planInvoiceAdjustment(fixed, full, []), /exceed subtotal/);
    assert.equal(planInvoiceAdjustment(fixed, {...full, discountValue: 0}, []).after.totalMinor, 0);
});
test('full return preserves before state and plans refund; does not mutate input invoice', () => {
    const order = invoice(); const before = structuredClone(order);
    const plan = planInvoiceAdjustment(order, input({returns: [{lineId: 'original-line', quantity: 2, disposition: 'DAMAGED'}]}), []);
    assert.deepEqual(order, before);
    assert.deepEqual(plan.after.items, []);
    assert.equal(plan.settlement.refundMinor, 10000);
    assert.equal(plan.before.items[0].quantity, 2);
});
test('legacy lines get deterministic references without rewriting; ambiguous totals/discounts are blocked', () => {
    const legacy = invoice(); delete legacy.items[0].lineId;
    assert.equal(planInvoiceAdjustment(legacy, input({returns: [{lineId: 'legacy-0', quantity: 1, disposition: 'RESTOCK'}]}), []).before.items[0].lineId, 'legacy-0');
    assert.throws(() => planInvoiceAdjustment(invoice({subtotal: 99}), input(), []), /reconciliation/);
    assert.throws(() => planInvoiceAdjustment(invoice({discountType: 'PERCENTAGE', discountAmount: 10, totalPrice: 90, paidAmount: 90}), input(), []), /reconciliation/);
});
test('foreign added products, excessive/duplicate returns, fractional quantities and cancelled invoices rejected', () => {
    assert.throws(() => planInvoiceAdjustment(invoice(), input({additions: [{productId: id(3), quantity: 1}]}), [{...product, shopId: id(99)}]), /shop/);
    assert.throws(() => planInvoiceAdjustment(invoice(), input({returns: [{lineId: 'original-line', quantity: 3, disposition: 'RESTOCK'}]}), []));
    assert.throws(() => planInvoiceAdjustment(invoice(), input({returns: [...input().returns, ...input().returns]}), []));
    assert.throws(() => planInvoiceAdjustment(invoice(), input({additions: [{productId: id(3), quantity: 1.5}]}), [product]));
    assert.throws(() => planInvoiceAdjustment(invoice({status: 'CANCELLED'}), input(), []), /locked/);
});
test('core denies CASHIER/ADMIN and public financial routes require existing owner authorization', async () => {
    for (const operation of [applyInvoiceAdjustment, applyInvoicePayment, applyInvoiceCancellation]) {
        for (const role of ['CASHIER', 'ADMIN']) await assert.rejects(operation({_id: id(1), shopId: id(2), username: 'other', role}, id(1), input()), /Owner/);
    }
    const routes = fs.readFileSync('src/routes/order.routes.ts', 'utf8');
    assert.match(routes, /verifyJWT, verifyShopUser, verifyOwner, invoiceMutation/);
});
test('new invoice validation creates stable lines and original snapshot without changing monetary values', async () => {
    const doc = new Order({...invoice(), createdBy: id(7), createdByName: 'Ali', invoiceNo: 'INV-1'});
    await doc.validate();
    assert.equal(doc.revision, 0);
    assert.equal(doc.originalSnapshot.source, 'CREATION');
    assert.equal(doc.originalSnapshot.paidAmount, 100);
    assert.equal(doc.originalSnapshot.items[0].lineId, 'original-line');
    assert.equal(doc.createdByName, 'Ali');
    assert.equal(doc.totalPrice, 100);
});
test('history schema requires dates, actor, snapshots and scoped unique request keys', () => {
    assert.ok(InvoiceAdjustment.schema.path('occurredAt'));
    assert.ok(InvoiceAdjustment.schema.path('before'));
    assert.ok(InvoiceAdjustment.schema.path('after'));
    assert.ok(InvoiceAdjustment.schema.indexes().some(([keys, options]) => options.unique && keys.shopId && keys.orderId && keys.requestKey));
});
