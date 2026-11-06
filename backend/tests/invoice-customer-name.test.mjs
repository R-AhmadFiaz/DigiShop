import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {normalizeInvoiceDisplayName, invoiceCustomerDisplayUpdate} from '../dist/controllers/invoiceCustomerName.controller.js';
import {InvoiceCustomerNameCorrection} from '../dist/models/invoiceCustomerNameCorrection.model.js';
import {Order} from '../dist/models/order.model.js';

test('invoice display names are normalized and bounded without changing customer identity', () => {
    assert.equal(normalizeInvoiceDisplayName('  Cafe\u0301 Ali  '), 'Café Ali');
    for (const value of ['', '   ', 'x'.repeat(121), 'name\nother', null]) {
        assert.throws(() => normalizeInvoiceDisplayName(value), /customer name/i);
    }
    assert.ok(Order.schema.path('customerDisplayName'));
    assert.ok(Order.schema.path('customerDisplayRevision'));
    assert.ok(Order.schema.path('customerId'));
});

test('display-name write plan only updates invoice display metadata', () => {
    assert.deepEqual(invoiceCustomerDisplayUpdate('Corrected name'), {
        $set: {customerDisplayName: 'Corrected name'},
        $inc: {customerDisplayRevision: 1}
    });
    const fields = Object.keys(invoiceCustomerDisplayUpdate('Name').$set);
    assert.deepEqual(fields, ['customerDisplayName']);
    assert.ok(!fields.some(field => /customerId|amount|total|stock|ledger|journal|items/i.test(field)));
});

test('correction history is immutable, request-key scoped, and reachable only through owner middleware', () => {
    assert.ok(InvoiceCustomerNameCorrection.schema.path('previousName').options.immutable);
    assert.ok(InvoiceCustomerNameCorrection.schema.path('newName').options.immutable);
    assert.ok(InvoiceCustomerNameCorrection.schema.path('actorId').options.immutable);
    assert.ok(InvoiceCustomerNameCorrection.schema.indexes().some(([keys, options]) =>
        options.unique && keys.shopId && keys.orderId && keys.requestKey));
    const routes = fs.readFileSync('src/routes/order.routes.ts', 'utf8');
    assert.match(routes, /route\('\/:orderId\/customer-display-name'\)\.patch\(verifyJWT, verifyShopUser, verifyOwner, correctInvoiceCustomerDisplayName\)/);
    const controller = fs.readFileSync('src/controllers/invoiceCustomerName.controller.ts', 'utf8');
    assert.match(controller, /expectedDisplayRevision/);
    assert.match(controller, /invoiceCustomerDisplayUpdate\(newName\)/);
    assert.match(controller, /prior\.requestHash !== requestHash/);
    assert.doesNotMatch(controller, /CustomerLedger|InvoiceAdjustment|StockLog|BusinessTransaction|FinancialAccount/);
    const access = fs.readFileSync('src/middleware/role.middleware.ts', 'utf8');
    assert.match(access, /invoiceNameCorrection/);
    const history = fs.readFileSync('src/controllers/invoiceAdjustment.controller.ts', 'utf8');
    assert.match(history, /customerNameHistory/);
});
