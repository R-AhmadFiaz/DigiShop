import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';
import jwt from 'jsonwebtoken';

// Never reads MONGO_DB_URI, connects to existing databases, or uses app startup.
const binary = 'C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.ACCESS_TOKEN_SECRET = 'isolated-replica-route-access';
process.env.REFRESH_TOKEN_SECRET = 'isolated-replica-route-refresh';
process.env.OPENAI_API_KEY = 'test-only';
const {app} = await import('../dist/app.js');
const {User} = await import('../dist/models/user.model.js');
const {salesSummary, productSales} = await import('../dist/utils/salesReporting.js');
const {processQuestion, periodBounds} = await import('../dist/utils/aiQuestions.js');
const {createOrder, cancelOrder, createQuotation, updateQuotationToInvoice} = await import('../dist/controllers/order.controller.js');
const {applyInvoiceAdjustment, applyInvoicePayment, applyInvoiceCancellation} = await import('../dist/controllers/invoiceAdjustment.controller.js');
const {Order} = await import('../dist/models/order.model.js');
const {Product} = await import('../dist/models/product.model.js');
const {Shop} = await import('../dist/models/shop.model.js');
const {StockLog} = await import('../dist/models/stockLog.model.js');
const {InvoiceAdjustment} = await import('../dist/models/invoiceAdjustment.model.js');
const {Customer} = await import('../dist/models/customer.model.js');
const {CustomerLedger} = await import('../dist/models/customerLedger.model.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

await test('isolated real MongoDB replica-set invoice adjustment tests', {skip: !existsSync(binary)}, async t => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'digishop-adjustment-replica-'));
    const portFinder = net.createServer();
    await new Promise(resolve => portFinder.listen(0, '127.0.0.1', resolve));
    const port = portFinder.address().port;
    await new Promise(resolve => portFinder.close(resolve));
    const mongod = spawn(binary, ['--dbpath', temp, '--bind_ip', '127.0.0.1', '--port', String(port), '--replSet', 'adjustmentTest', '--logpath', path.join(temp, 'mongo.log')], {windowsHide: true, stdio: 'ignore'});
    const uri = `mongodb://127.0.0.1:${port}/digishop_adjustment_test?directConnection=true`;
    let httpServer;
    try {
        for (let n = 0; ; n++) {
            try { await mongoose.connect(uri, {serverSelectionTimeoutMS: 500, autoCreate: false, autoIndex: false}); break; }
            catch { if (n > 30) throw new Error('Temporary MongoDB did not start'); await sleep(100); }
        }
        await mongoose.connection.db.admin().command({replSetInitiate: {_id: 'adjustmentTest', members: [{_id: 0, host: `127.0.0.1:${port}`} ]}});
        for (let n = 0; ; n++) {
            if ((await mongoose.connection.db.admin().command({hello: 1})).isWritablePrimary) break;
            if (n > 200) throw new Error('Replica set did not elect primary');
            await sleep(100);
        }
        for (const Model of [Order, Product, Shop, StockLog, InvoiceAdjustment, Customer, CustomerLedger, User]) {
            await Model.createCollection(); await Model.createIndexes();
        }
        const ownerId = new mongoose.Types.ObjectId();
        const shop = await Shop.create({name: 'Isolated test shop', address: 'Test', contactNo: '03111111111', ownerId,
            isActive: true, subscriptionActive: true, subscriptionExpiry: new Date(Date.now() + 86400000)});
        const category = new mongoose.Types.ObjectId();
        const actor = {_id: ownerId, shopId: shop._id, username: 'Original owner', role: 'OWNER'};
        const ownerUser = await User.create({_id: ownerId, role: 'OWNER', username: 'replicaowner', email: 'owner@replica.test', password: 'test-password', shopId: shop._id});
        const cashierUser = await User.create({role: 'CASHIER', username: 'replicacashier', email: 'cashier@replica.test', password: 'test-password', shopId: shop._id});
        const adminUser = await User.create({role: 'ADMIN', username: 'replicaadmin', email: 'admin@replica.test', password: 'test-password'});
        const foreignOwnerId = new mongoose.Types.ObjectId();
        const foreignShop = await Shop.create({name: 'Other isolated shop', address: 'Test', contactNo: '03222222222', ownerId: foreignOwnerId,
            isActive: true, subscriptionActive: true, subscriptionExpiry: new Date(Date.now() + 86400000)});
        const foreignOwner = await User.create({_id: foreignOwnerId, role: 'OWNER', username: 'foreignowner', email: 'foreign@replica.test', password: 'test-password', shopId: foreignShop._id});
        httpServer = app.listen(0, '127.0.0.1');
        await new Promise(resolve => httpServer.once('listening', resolve));
        const httpBase = `http://127.0.0.1:${httpServer.address().port}/api/v2`;
        async function http(method, route, body, user = ownerUser) {
            const response = await fetch(httpBase + route, {method, headers: {
                ...(user ? {Authorization: 'Bearer ' + jwt.sign({_id: user._id}, process.env.ACCESS_TOKEN_SECRET)} : {}),
                ...(body ? {'Content-Type': 'application/json'} : {})
            }, ...(body ? {body: JSON.stringify(body)} : {})});
            return {status: response.status, body: await response.json(), cache: response.headers.get('cache-control')};
        }
        let sequence = 0;
        async function fixture({stock = 0, paid = 100, legacy = false, status = 'DELIVERED', customerId} = {}) {
            const product = await Product.create({name: 'Cable ' + ++sequence, brand: 'Wire', slug: 'cable-' + sequence,
                category, unit: 'm', shopId: shop._id, costPrice: 20, retailPrice: 50, wholesalePrice: 40, stockQuantity: stock});
            const order = await Order.create({shopId: shop._id, invoiceNo: 'LEGACY-INV-' + sequence, type: 'INVOICE', status,
                createdBy: ownerId, createdByName: 'Historical seller', saleType: 'RETAIL',
                items: [{productId: product._id, quantity: 2, unitPrice: 50, name: 'Original cable', brand: 'Wire', unit: 'm'}],
                subtotal: 100, discountType: 'NONE', discountValue: 0, discountAmount: 0, totalPrice: 100, paidAmount: paid, amountDue: 100 - paid,
                ...(customerId ? {customerId} : {})});
            if (legacy) await Order.collection.updateOne({_id: order._id}, {$unset: {revision: '', originalSnapshot: '', 'items.0.lineId': ''}});
            const input = {requestKey: 'request-' + sequence, expectedRevision: 0, reason: 'Exchange',
                returns: [{lineId: legacy ? 'legacy-0' : order.items[0].lineId, quantity: 1, disposition: 'RESTOCK'}],
                additions: [{productId: String(product._id), quantity: 1}]};
            return {product, order, input};
        }
        await t.test('commits stock and audit together; preserves original identity; identical replay performs no writes', async () => {
            const {product, order, input} = await fixture();
            const first = await applyInvoiceAdjustment(actor, String(order._id), input);
            const replay = await applyInvoiceAdjustment(actor, String(order._id), input);
            assert.equal(String(first._id), String(replay._id));
            const saved = await Order.findById(order._id);
            assert.equal(saved.revision, 1); assert.equal(saved.createdByName, 'Historical seller');
            assert.equal(saved.invoiceNo, order.invoiceNo); assert.equal(+saved.createdAt, +order.createdAt);
            assert.equal(saved.originalSnapshot.items[0].quantity, 2);
            assert.equal(saved.items.length, 2);
            assert.equal((await Product.findById(product._id)).stockQuantity, 0);
            assert.equal(await StockLog.countDocuments({referenceId: order._id}), 2);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 1);
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), {...input, reason: 'Different request'}), /key already used/);
            first.reason = 'Tampered'; await assert.rejects(first.save(), /immutable/);
        });
        await t.test('DAMAGED cannot fund same-product replacement; insufficient stock rolls back invoice claim', async () => {
            const {product, order, input} = await fixture(); input.returns[0].disposition = 'DAMAGED';
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), input), /insufficient/);
            assert.equal((await Order.findById(order._id)).revision, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 0);
            assert.equal(await StockLog.countDocuments({referenceId: order._id}), 0);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 0);
        });
        await t.test('DAMAGED return is audited with zero sellable delta when replacement stock exists', async () => {
            const {product, order, input} = await fixture({stock: 1}); input.returns[0].disposition = 'DAMAGED';
            await applyInvoiceAdjustment(actor, String(order._id), input);
            assert.equal((await Product.findById(product._id)).stockQuantity, 0);
            const log = await StockLog.findOne({referenceId: order._id, disposition: 'DAMAGED'});
            assert.equal(log.quantityDelta, 0); assert.equal(log.returnedQuantity, 1);
        });
        await t.test('missing refund allocation is rejected without stock, debt or refund changes', async () => {
            const {order, input} = await fixture(); input.additions = [];
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), input), /Refund allocation/);
            assert.equal((await Order.findById(order._id)).revision, 0);
            assert.equal(await StockLog.countDocuments({referenceId: order._id}), 0);
            assert.equal(await CustomerLedger.countDocuments({referenceId: order._id}), 0);
        });
        await t.test('cross-shop invoice and products rejected, legacy snapshot captured only on successful adjustment', async () => {
            const {order, input} = await fixture({legacy: true});
            const stranger = {...actor, shopId: new mongoose.Types.ObjectId()};
            await assert.rejects(applyInvoiceAdjustment(stranger, String(order._id), input), /shop access/);
            const foreignProduct = await Product.create({name: 'Foreign', brand: 'Wire', slug: 'foreign', category,
                shopId: new mongoose.Types.ObjectId(), retailPrice: 50, costPrice: 10, stockQuantity: 10});
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), {...input, additions: [{productId: String(foreignProduct._id), quantity: 1}]}), /shop/);
            await applyInvoiceAdjustment(actor, String(order._id), input);
            const saved = await Order.findById(order._id);
            assert.equal(saved.originalSnapshot.source, 'LEGACY_BASELINE');
            assert.equal(saved.originalSnapshot.items[0].quantity, 2);
            assert.equal((await Product.findById(foreignProduct._id)).stockQuantity, 10);
        });
        await t.test('two simultaneous revisions commit only once; stale request returns controlled conflict', async () => {
            const {order, input} = await fixture({stock: 2});
            const outcomes = await Promise.allSettled([applyInvoiceAdjustment(actor, String(order._id), input),
                applyInvoiceAdjustment(actor, String(order._id), {...input, requestKey: input.requestKey + '-other'})]);
            assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
            assert.equal(outcomes.find(result => result.status === 'rejected').reason.statusCode, 409);
            assert.equal((await Order.findById(order._id)).revision, 1);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 1);
        });
        await t.test('concurrent identical keys converge on one committed record after safe replay', async () => {
            const {order, input} = await fixture({stock: 1});
            const attempts = await Promise.allSettled([applyInvoiceAdjustment(actor, String(order._id), input),
                applyInvoiceAdjustment(actor, String(order._id), input)]);
            assert.ok(attempts.some(result => result.status === 'fulfilled'));
            for (const result of attempts) if (result.status === 'rejected') assert.equal(result.reason.statusCode, 409);
            const replay = await applyInvoiceAdjustment(actor, String(order._id), input);
            assert.equal(replay.revisionAfter, 1);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 1);
            assert.equal(await StockLog.countDocuments({referenceId: order._id}), 2);
        });
        await t.test('failure after stock/log writes rolls back all documents on real MongoDB', async () => {
            const {product, order, input} = await fixture({stock: 1});
            const originalCreate = InvoiceAdjustment.create;
            InvoiceAdjustment.create = async () => { throw new Error('Injected audit failure'); };
            try { await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), input), /audit failure/); }
            finally { InvoiceAdjustment.create = originalCreate; }
            assert.equal((await Order.findById(order._id)).revision, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 1);
            assert.equal(await StockLog.countDocuments({referenceId: order._id}), 0);
        });
        await t.test('original snapshots cannot be overwritten through ordinary model updates', async () => {
            const {order} = await fixture();
            await Order.updateOne({_id: order._id}, {$set: {originalSnapshot: {tampered: true}}});
            assert.equal((await Order.findById(order._id)).originalSnapshot.source, 'CREATION');
        });
        await t.test('full zero-value return commits empty current state without deleting original invoice', async () => {
            const {product, order} = await fixture();
            // Test-only fixture replaces a document before any adjustment; no real data touched.
            await Order.collection.updateOne({_id: order._id}, {$set: {
                'items.0.unitPrice': 0, subtotal: 0, totalPrice: 0, paidAmount: 0,
                originalSnapshot: {...order.originalSnapshot, items: [{...order.items[0].toObject(), unitPrice: 0}], subtotal: 0, totalPrice: 0, paidAmount: 0}
            }});
            await applyInvoiceAdjustment(actor, String(order._id), {requestKey: 'full-return-' + sequence, expectedRevision: 0,
                reason: 'Return free items', returns: [{lineId: order.items[0].lineId, quantity: 2, disposition: 'RESTOCK'}], additions: []});
            const saved = await Order.findById(order._id);
            assert.equal(saved.returnState, 'FULL'); assert.equal(saved.items.length, 0);
            assert.equal(saved.originalSnapshot.items[0].quantity, 2);
            assert.equal((await Product.findById(product._id)).stockQuantity, 2);
        });
        await t.test('direct credit creation/cancellation still use real stock/debt transactions and preserve snapshot', async () => {
            const {product} = await fixture({stock: 5});
            const customer = await Customer.create({name: 'Test buyer', phoneNo: '03000000000', shopId: shop._id});
            let result, error;
            const response = {status() {return response;}, json(value) {result = value; return response;}};
            await createOrder({user: actor, body: {items: [{productId: String(product._id), quantity: 2}],
                saleType: 'RETAIL', paidAmount: 40, customerId: String(customer._id)}}, response, e => {error = e;});
            assert.equal(error, undefined);
            const created = result.data;
            assert.equal(created.originalSnapshot.paidAmount, 40);
            assert.equal(created.originalSnapshot.items[0].name, product.name);
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 60);
            await cancelOrder({user: actor, params: {orderId: String(created._id)}}, response, e => {error = e;});
            assert.equal(error, undefined);
            const cancelled = await Order.findById(created._id);
            assert.equal(cancelled.status, 'CANCELLED');
            assert.equal(cancelled.originalSnapshot.totalPrice, 100);
            assert.equal(cancelled.createdByName, actor.username);
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 5);
            assert.equal(await CustomerLedger.countDocuments({referenceId: created._id}), 2);
        });
        await t.test('cancellation racing an adjustment cannot double-restock remaining units', async () => {
            const {product, order, input} = await fixture({stock: 1, status: 'PENDING'});
            const cancellation = {...input, requestKey: input.requestKey + '-cancel', returns: [], additions: [], cashRefundAmount: 100};
            await Promise.allSettled([applyInvoiceAdjustment(actor, String(order._id), input),
                applyInvoiceCancellation(actor, String(order._id), cancellation)]);
            const current = await Order.findById(order._id);
            if (current.status !== 'CANCELLED') await applyInvoiceCancellation(actor, String(order._id), {...cancellation, expectedRevision: current.revision});
            assert.equal((await Order.findById(order._id)).status, 'CANCELLED');
            assert.equal((await Product.findById(product._id)).stockQuantity, 3);
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), {...input, requestKey: 'locked-' + sequence, expectedRevision: 1}), /locked|changed/);
        });

        async function buyer(shopId = shop._id) {
            return Customer.create({name: 'Buyer ' + ++sequence, phoneNo: '03000000000', shopId});
        }
        async function invoke(handler, request) {
            let result, error;
            const response = {status() {return response;}, json(value) {result = value; return response;}};
            await handler(request, response, e => {error = e;});
            if (error) throw error;
            return result.data;
        }
        async function issueCredit(customer, amount = 100) {
            const {order, input} = await fixture();
            // All source units are returned. Remainder of the actual cash receipt is refunded.
            const event = await applyInvoiceAdjustment(actor, String(order._id), {...input, additions: [],
                returns: [{lineId: order.items[0].lineId, quantity: 2, disposition: 'RESTOCK'}],
                creditIssueAmount: amount, cashRefundAmount: 100 - amount, creditRecipientId: String(customer._id)});
            return {order, event};
        }
        async function sale(customer, {paid = 0, credit = 0, as = actor, requestKey} = {}) {
            const {product} = await fixture({stock: 10});
            const body = {items: [{productId: String(product._id), quantity: 2}], saleType: 'RETAIL', paidAmount: paid,
                customerId: String(customer._id), ...(credit ? {creditAmount: credit, requestKey: requestKey ?? 'pos-sale-' + sequence} : {})};
            const order = await invoke(createOrder, {user: as, body});
            return {product, order, body, as};
        }
        function payment(order, overrides = {}) {
            return {requestKey: 'payment-' + ++sequence, expectedRevision: order.revision ?? 0, reason: 'Invoice payment', ...overrides};
        }
        function returned(order, quantity = 1, overrides = {}) {
            return {requestKey: 'returned-' + ++sequence, expectedRevision: order.revision ?? 0, reason: 'Customer return',
                returns: [{lineId: order.items[0].lineId, quantity, disposition: 'RESTOCK'}], additions: [], ...overrides};
        }
        await t.test('partial credit return reduces only invoice debt, then payment and mixed full-return settlement are audited', async () => {
            const customer = await buyer(); const {order, product} = await sale(customer, {paid: 40});
            await applyInvoiceAdjustment(actor, String(order._id), returned(order));
            let current = await Order.findById(order._id);
            assert.equal(current.totalPrice, 50); assert.equal(current.amountDue, 10);
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 10);
            const paid = await applyInvoicePayment(actor, String(order._id), payment(current, {cashReceivedAmount: 10}));
            assert.equal(paid.financial.cashReceivedMinor, 1000);
            current = await Order.findById(order._id);
            await applyInvoiceAdjustment(actor, String(order._id), returned(current, 1, {cashRefundAmount: 25, creditIssueAmount: 25}));
            current = await Order.findById(order._id);
            assert.equal(current.totalPrice, 0); assert.equal(current.paidAmount, 0); assert.equal(current.amountDue, 0);
            assert.equal(current.returnState, 'FULL'); assert.equal(current.originalSnapshot.paidAmount, 40);
            const saved = await Customer.findById(customer._id);
            assert.equal(saved.remainingMoney, 0); assert.equal(saved.storeCreditBalanceMinor, 2500);
            assert.equal((await Product.findById(product._id)).stockQuantity, 10);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 3);
            assert.equal(await CustomerLedger.countDocuments({referenceId: order._id, balanceType: 'CREDIT'}), 1);
        });
        await t.test('anonymous full return issues separate recipient credit without rewriting invoice customer', async () => {
            const customer = await buyer(); const {order, event} = await issueCredit(customer, 60);
            const current = await Order.findById(order._id);
            assert.equal(current.customerId, undefined); assert.equal(current.originalSnapshot.customerId, undefined);
            assert.equal(String(current.creditRecipientId), String(customer._id));
            assert.equal(event.financial.cashRefundMinor, 4000); assert.equal(event.financial.creditIssuedMinor, 6000);
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 6000);
            const foreign = await buyer(new mongoose.Types.ObjectId());
            const fixtureOrder = (await fixture()).order;
            await assert.rejects(applyInvoiceAdjustment(actor, String(fixtureOrder._id), returned(fixtureOrder, 2,
                {creditIssueAmount: 100, creditRecipientId: String(foreign._id)})), /shop/);
            assert.equal((await Order.findById(fixtureOrder._id)).revision, 0);
        });
        await t.test('anonymous additions must be fully settled, and cash payment preserves original identity', async () => {
            const {order, product, input} = await fixture({stock: 5});
            const added = {...input, returns: [], additions: [{productId: String(product._id), quantity: 1}]};
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), added), /fully settled/);
            const event = await applyInvoiceAdjustment(actor, String(order._id), {...added, cashReceivedAmount: 50});
            const current = await Order.findById(order._id);
            assert.equal(current.totalPrice, 150); assert.equal(current.paidAmount, 150); assert.equal(current.amountDue, 0);
            assert.equal(current.customerId, undefined); assert.equal(current.originalSnapshot.totalPrice, 100);
            assert.equal(event.financial.cashReceivedMinor, 5000);
        });
        await t.test('CASHIER POS credit redemption records payment, retries once, and returns credit before cash', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const cashier = {...actor, _id: new mongoose.Types.ObjectId(), role: 'CASHIER', username: 'Counter'};
            const {order, body, product} = await sale(customer, {paid: 40, credit: 60, as: cashier});
            assert.equal(order.paidAmount, 100); assert.equal(order.settlementState.creditNetMinor, 6000);
            const replay = await invoke(createOrder, {user: cashier, body});
            assert.equal(String(replay._id), String(order._id));
            assert.equal((await Product.findById(product._id)).stockQuantity, 8);
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 4000);
            await assert.rejects(applyInvoiceAdjustment(cashier, String(order._id), returned(order)), /Owner/);
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), returned(order, 1, {cashRefundAmount: 50})), /Refund allocation/);
            const first = await applyInvoiceAdjustment(actor, String(order._id), returned(order));
            assert.equal(first.financial.creditRestoredMinor, 5000); assert.equal(first.financial.cashRefundMinor, 0);
            const current = await Order.findById(order._id);
            const final = await applyInvoiceAdjustment(actor, String(order._id), returned(current, 1, {cashRefundAmount: 40}));
            assert.equal(final.financial.creditRestoredMinor, 1000); assert.equal(final.financial.cashRefundMinor, 4000);
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 10000);
        });
        await t.test('invoice payment redeems credit independently of debt and rejects overpayment or insufficient credit', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const {order} = await sale(customer, {paid: 40});
            await assert.rejects(applyInvoicePayment(actor, String(order._id), payment(order, {cashReceivedAmount: 61})), /exceeds/);
            const input = payment(order, {cashReceivedAmount: 20, creditRedeemedAmount: 40});
            const first = await applyInvoicePayment(actor, String(order._id), input);
            const replay = await applyInvoicePayment(actor, String(order._id), input);
            assert.equal(String(first._id), String(replay._id));
            const saved = await Customer.findById(customer._id);
            assert.equal(saved.remainingMoney, 0); assert.equal(saved.storeCreditBalanceMinor, 6000);
            const current = await Order.findById(order._id);
            const refund = await applyInvoiceAdjustment(actor, String(order._id), returned(current, 1, {cashRefundAmount: 10}));
            assert.equal(refund.financial.creditRestoredMinor, 4000);
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 10000);
            const emptyBuyer = await buyer(); const another = await sale(emptyBuyer);
            await assert.rejects(applyInvoicePayment(actor, String(another.order._id), payment(another.order, {creditRedeemedAmount: 100})), /Insufficient/);
            assert.equal((await Order.findById(another.order._id)).revision, 0);
        });
        await t.test('concurrent credit POS requests cannot overspend and insufficient credit rolls back stock/counter/history', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const {product} = await fixture({stock: 10});
            const cashier = {...actor, role: 'CASHIER', _id: new mongoose.Types.ObjectId(), username: 'Cashier'};
            const body = {items: [{productId: String(product._id), quantity: 2}], saleType: 'RETAIL', paidAmount: 0,
                creditAmount: 100, customerId: String(customer._id), requestKey: 'concurrent-sale-' + sequence};
            const beforeCounter = (await Shop.findById(shop._id)).invoiceCounter;
            const outcomes = await Promise.allSettled([invoke(createOrder, {user: cashier, body}),
                invoke(createOrder, {user: cashier, body: {...body, requestKey: body.requestKey + '-other'}})]);
            assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(outcomes.find(r => r.status === 'rejected').reason.statusCode, 409);
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 8);
            assert.equal((await Shop.findById(shop._id)).invoiceCounter, beforeCounter + 1);
            await assert.rejects(invoke(createOrder, {user: cashier, body: {...body, requestKey: body.requestKey + '-third'}}), /Insufficient/);
            assert.equal((await Product.findById(product._id)).stockQuantity, 8);
            assert.equal((await Shop.findById(shop._id)).invoiceCounter, beforeCounter + 1);
        });
        await t.test('ledger or audit failure rolls back payment, wallet, refund, debt, stock and revision', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const {order, product} = await sale(customer, {paid: 40});
            const create = InvoiceAdjustment.create;
            InvoiceAdjustment.create = async () => {throw new Error('Injected settlement audit failure');};
            try {
                await assert.rejects(applyInvoicePayment(actor, String(order._id), payment(order, {creditRedeemedAmount: 60})), /audit failure/);
                await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), returned(order, 2, {cashRefundAmount: 20, creditIssueAmount: 20})), /audit failure/);
            } finally {InvoiceAdjustment.create = create;}
            const saved = await Customer.findById(customer._id);
            assert.equal(saved.remainingMoney, 60); assert.equal(saved.storeCreditBalanceMinor, 10000);
            assert.equal((await Order.findById(order._id)).revision, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 8);
            assert.equal(await CustomerLedger.countDocuments({referenceId: order._id}), 1);
        });
        await t.test('settlement-aware cancellation restores only remaining stock, records refunds and preserves original snapshot', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const {order, product} = await sale(customer, {paid: 40, credit: 60});
            let error;
            const response = {status() {return response;}, json() {return response;}};
            await cancelOrder({user: actor, params: {orderId: String(order._id)}}, response, e => {error = e;});
            assert.equal(error.statusCode, 409); assert.equal((await Order.findById(order._id)).status, 'PENDING');
            await applyInvoiceAdjustment(actor, String(order._id), returned(order));
            const current = await Order.findById(order._id);
            const input = {...payment(current), returns: [], additions: [], cashRefundAmount: 40};
            const result = await applyInvoiceCancellation(actor, String(order._id), input);
            assert.equal(result.kind, 'CANCELLATION'); assert.equal(result.financial.creditRestoredMinor, 1000);
            assert.equal(result.financial.cashRefundMinor, 4000);
            const cancelled = await Order.findById(order._id);
            assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.paidAmount, 0); assert.equal(cancelled.totalPrice, 0);
            assert.equal(cancelled.originalSnapshot.totalPrice, 100); assert.equal(cancelled.createdByName, actor.username);
            assert.equal((await Product.findById(product._id)).stockQuantity, 10);
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 10000);
            const replay = await applyInvoiceCancellation(actor, String(order._id), input);
            assert.equal(String(replay._id), String(result._id));
        });
        await t.test('ambiguous legacy balances and externally changed paidAmount are rejected before mutation', async () => {
            const customer = await buyer(); const {order} = await sale(customer, {paid: 40});
            await Customer.collection.updateOne({_id: customer._id}, {$set: {remainingMoney: 50}});
            await assert.rejects(applyInvoicePayment(actor, String(order._id), payment(order, {cashReceivedAmount: 10})), /reconciliation/);
            await Customer.collection.updateOne({_id: customer._id}, {$set: {remainingMoney: 60}});
            await Order.collection.updateOne({_id: order._id}, {$set: {paidAmount: 50, amountDue: 50}});
            await assert.rejects(applyInvoicePayment(actor, String(order._id), payment(order, {cashReceivedAmount: 10})), /reconciliation/);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 0);
        });
        await t.test('concurrent payments/returns and duplicate refunds cannot double-pay or double-restock', async () => {
            const customer = await buyer(); const {order} = await sale(customer, {paid: 40});
            const outcomes = await Promise.allSettled([
                applyInvoicePayment(actor, String(order._id), payment(order, {cashReceivedAmount: 60})),
                applyInvoiceAdjustment(actor, String(order._id), returned(order))
            ]);
            assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
            assert.equal(outcomes.find(r => r.status === 'rejected').reason.statusCode, 409);
            const saved = await Order.findById(order._id);
            assert.equal(saved.totalPrice, saved.paidAmount + saved.amountDue);
            assert.equal((await Customer.findById(customer._id)).remainingMoney, saved.amountDue);
            const source = await fixture();
            const refund = returned(source.order, 2, {cashRefundAmount: 100});
            const refunds = await Promise.allSettled([
                applyInvoiceAdjustment(actor, String(source.order._id), refund),
                applyInvoiceAdjustment(actor, String(source.order._id), refund)
            ]);
            assert.ok(refunds.some(r => r.status === 'fulfilled'));
            const replay = await applyInvoiceAdjustment(actor, String(source.order._id), refund);
            assert.equal(replay.financial.cashRefundMinor, 10000);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: source.order._id}), 1);
            assert.equal((await Product.findById(source.product._id)).stockQuantity, 2);
        });
        await t.test('POS identical concurrent key, different payload and foreign credit customer are safe', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const {product} = await fixture({stock: 10});
            const body = {items: [{productId: String(product._id), quantity: 2}], saleType: 'RETAIL', paidAmount: 0,
                creditAmount: 100, customerId: String(customer._id), requestKey: 'same-credit-key-' + sequence};
            const results = await Promise.allSettled([invoke(createOrder, {user: actor, body}), invoke(createOrder, {user: actor, body})]);
            assert.ok(results.some(r => r.status === 'fulfilled'));
            const replay = await invoke(createOrder, {user: actor, body});
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: replay._id, kind: 'SALE'}), 1);
            assert.equal((await Product.findById(product._id)).stockQuantity, 8);
            await assert.rejects(invoke(createOrder, {user: actor, body: {...body, creditAmount: 50, paidAmount: 50}}), /key already used/);
            const foreign = await buyer(new mongoose.Types.ObjectId());
            await assert.rejects(invoke(createOrder, {user: actor, body: {...body, requestKey: body.requestKey + '-foreign', customerId: String(foreign._id)}}), /customer Id is not valid/);
            assert.equal((await Product.findById(product._id)).stockQuantity, 8);
        });
        await t.test('POS audit failure rolls back wallet, sale, stock, counter and new ledger', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const {product} = await fixture({stock: 10});
            const counter = (await Shop.findById(shop._id)).invoiceCounter;
            const ledgerCount = await CustomerLedger.countDocuments({customerId: customer._id});
            const create = InvoiceAdjustment.create;
            InvoiceAdjustment.create = async () => {throw new Error('Injected POS audit failure');};
            try {
                await assert.rejects(invoke(createOrder, {user: actor, body: {
                    items: [{productId: String(product._id), quantity: 2}], saleType: 'RETAIL', paidAmount: 0,
                    creditAmount: 50, customerId: String(customer._id), requestKey: 'rollback-credit-' + sequence
                }}));
            } finally {InvoiceAdjustment.create = create;}
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 10000);
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 10);
            assert.equal((await Shop.findById(shop._id)).invoiceCounter, counter);
            assert.equal(await CustomerLedger.countDocuments({customerId: customer._id}), ledgerCount);
        });
        await t.test('credit recipient cannot switch, payment cannot alter discounts, and malformed money is blocked', async () => {
            const first = await buyer(), second = await buyer();
            const {order} = await fixture();
            await applyInvoiceAdjustment(actor, String(order._id), returned(order, 1, {creditIssueAmount: 50, creditRecipientId: String(first._id)}));
            const current = await Order.findById(order._id);
            await assert.rejects(applyInvoiceAdjustment(actor, String(order._id), returned(current, 1,
                {creditIssueAmount: 50, creditRecipientId: String(second._id)})), /recipient cannot be changed/);
            assert.equal((await Customer.findById(first._id)).storeCreditBalanceMinor, 5000);
            assert.equal((await Customer.findById(second._id)).storeCreditBalanceMinor, 0);
            const cash = await sale(second);
            await assert.rejects(applyInvoicePayment(actor, String(cash.order._id), payment(cash.order, {cashReceivedAmount: 10, discountType: 'FIXED', discountValue: 5})), /discounts/);
            for (const bad of [-1, NaN, Infinity, 1.001, '10']) {
                await assert.rejects(applyInvoicePayment(actor, String(cash.order._id), payment(cash.order, {cashReceivedAmount: bad})));
            }
            assert.equal((await Order.findById(cash.order._id)).revision, 0);
        });
        await t.test('full unpaid return reverses only this invoice debt and refuses anonymous credit without recipient', async () => {
            const customer = await buyer();
            const first = await sale(customer), second = await sale(customer, {paid: 40});
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 160);
            const result = await applyInvoiceAdjustment(actor, String(first.order._id), returned(first.order, 2));
            assert.equal(result.financial.debtDeltaMinor, -10000);
            assert.equal(result.financial.cashRefundMinor, 0); assert.equal(result.financial.creditIssuedMinor, 0);
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 60);
            assert.equal((await Order.findById(second.order._id)).amountDue, 60);
            const anonymous = await fixture();
            await assert.rejects(applyInvoiceAdjustment(actor, String(anonymous.order._id), returned(anonymous.order, 2, {creditIssueAmount: 100})), /recipient/);
            assert.equal((await Order.findById(anonymous.order._id)).revision, 0);
        });
        await t.test('damaged exchange with new-price addition records payment and never restocks damaged quantity', async () => {
            const {order, product, input} = await fixture({stock: 1});
            await Product.updateOne({_id: product._id}, {$set: {retailPrice: 70}});
            await applyInvoiceAdjustment(actor, String(order._id), {...input, cashReceivedAmount: 20,
                returns: [{lineId: order.items[0].lineId, quantity: 1, disposition: 'DAMAGED'}]});
            const current = await Order.findById(order._id);
            assert.equal(current.items[0].unitPrice, 50); assert.equal(current.items[1].unitPrice, 70);
            assert.equal(current.totalPrice, 120); assert.equal(current.paidAmount, 120);
            assert.equal((await Product.findById(product._id)).stockQuantity, 0);
            assert.equal((await StockLog.findOne({referenceId: order._id, disposition: 'DAMAGED'})).quantityDelta, 0);
            const reported = await productSales(shop._id, periodBounds('today'), [product._id], false, 20);
            assert.equal(reported[0].quantity, 2); assert.equal(reported[0].revenue, 120);
        });
        await t.test('new converted invoices retain verified customer/discount metadata for later reconciliation, without redeeming credit', async () => {
            const customer = await buyer(); await issueCredit(customer);
            const {product} = await fixture({stock: 5});
            const quoted = await invoke(createQuotation, {user: actor, body: {
                items: [{productId: String(product._id), quantity: 2}], saleType: 'RETAIL', discountType: 'PERCENTAGE', discountValue: 10
            }});
            const converted = await invoke(updateQuotationToInvoice, {user: actor, params: {quotationId: String(quoted.quotation._id)},
                body: {paidAmount: 40, customerId: String(customer._id), creditAmount: 50}});
            const order = converted.createOrder;
            assert.equal(String(order.customerId), String(customer._id)); assert.equal(order.discountValue, 10);
            assert.equal(order.totalPrice, 90); assert.equal(order.paidAmount, 40); assert.equal(order.amountDue, 50);
            assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor, 10000);
            await applyInvoicePayment(actor, String(order._id), payment(order, {cashReceivedAmount: 50}));
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 0);
            assert.equal((await Order.findById(order._id)).originalSnapshot.discountValue, 10);
            assert.equal((await Order.findById(quoted.quotation._id)).status, 'CONVERTED');
        });
        await t.test('mounted financial/read routes enforce roles, authentication, shop scope and subscription gates', async () => {
            const {order} = await fixture();
            const input = returned(order, 1, {cashRefundAmount: 50});
            const paths = [
                ['GET', `/orders/${order._id}`], ['GET', `/orders/${order._id}/history`], ['GET', '/orders/sales-summary'],
                ...['adjustments', 'payments', 'cancellations'].flatMap(name => [['POST', `/orders/${order._id}/${name}/preview`], ['POST', `/orders/${order._id}/${name}`]])
            ];
            for (const [method, route] of paths) {
                for (const user of [cashierUser, adminUser]) assert.equal((await http(method, route, method === 'POST' ? input : undefined, user)).status, 403, route);
                assert.equal((await http(method, route, method === 'POST' ? input : undefined, null)).status, 400, route);
            }
            assert.equal((await http('GET', `/orders/${order._id}/history`, undefined, foreignOwner)).status, 404);
            assert.equal((await http('POST', `/orders/${order._id}/adjustments/preview`, input, foreignOwner)).status, 404);
            await Shop.updateOne({_id: shop._id}, {$set: {subscriptionActive: false}});
            for (const [method, route] of paths) assert.equal((await http(method, route, method === 'POST' ? input : undefined)).status, 403);
            await Shop.updateOne({_id: shop._id}, {$set: {subscriptionActive: true, isActive: false}});
            const blocked = await http('POST', `/orders/${order._id}/adjustments/preview`, input);
            assert.equal(blocked.status, 403); assert.match(blocked.body.message, /deactivated/);
            await Shop.updateOne({_id: shop._id}, {$set: {isActive: true}});
        });
        await t.test('HTTP preview is read-only, binds current prices, and confirmed mutation has safe replay and pagination', async () => {
            const {order, product} = await fixture({stock: 3});
            const input = returned(order, 1, {cashRefundAmount: 50});
            const detail = await http('GET', `/orders/${order._id}`);
            assert.equal(detail.status, 200); assert.equal(detail.body.data.eligibility.adjustmentEligible, true);
            assert.equal(detail.body.data.eligibility.revision, 0);
            assert.equal(detail.body.data.originalSnapshot.totalPrice, 100);
            assert.equal(detail.cache, 'no-store');
            const beforeLogs = await StockLog.countDocuments({referenceId: order._id});
            const preview = await http('POST', `/orders/${order._id}/adjustments/preview`, input);
            assert.equal(preview.status, 200); assert.equal(preview.body.data.canSubmit, true);
            assert.equal(preview.body.data.settlement.cashRefundMinor, 5000);
            assert.equal((await Order.findById(order._id)).revision, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 3);
            assert.equal(await StockLog.countDocuments({referenceId: order._id}), beforeLogs);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 0);
            assert.equal((await http('POST', `/orders/${order._id}/adjustments`, input)).status, 400);
            const confirmed = {...input, confirmationToken: preview.body.data.confirmationToken, shopId: String(foreignShop._id), createdBy: String(cashierUser._id)};
            const saved = await http('POST', `/orders/${order._id}/adjustments`, confirmed);
            assert.equal(saved.status, 200); assert.equal(saved.body.data.event.createdBy, String(ownerUser._id));
            assert.equal(saved.body.data.event.requestHash, undefined);
            const replay = await http('POST', `/orders/${order._id}/adjustments`, confirmed);
            assert.equal(replay.status, 200); assert.equal(replay.body.data.event._id, saved.body.data.event._id);
            const current = await Order.findById(order._id);
            const next = returned(current, 1, {cashRefundAmount: 50});
            const secondPreview = await http('POST', `/orders/${order._id}/adjustments/preview`, next);
            assert.equal((await http('POST', `/orders/${order._id}/adjustments`, {...next, confirmationToken: secondPreview.body.data.confirmationToken})).status, 200);
            const history = await http('GET', `/orders/${order._id}/history?page=2&limit=1`);
            assert.equal(history.status, 200); assert.equal(history.body.data.history.length, 1);
            assert.equal(history.body.data.pagination.recordCount, 2); assert.equal(history.body.data.pagination.totalPages, 2);
            assert.equal(history.body.data.history[0]._id, saved.body.data.event._id);
            assert.ok(!JSON.stringify(history.body).includes('requestHash'));
            assert.equal((await http('GET', `/orders/${order._id}/history?limit=101`)).status, 400);
            assert.equal((await http('GET', `/orders/${order._id}/history?kind=unknown`)).status, 400);
            const added = await fixture({stock: 4});
            const exchange = {...added.input, returns: [], additions: [{productId: String(added.product._id), quantity: 1}], cashReceivedAmount: 50};
            const quote = await http('POST', `/orders/${added.order._id}/adjustments/preview`, exchange);
            await Product.updateOne({_id: added.product._id}, {$set: {retailPrice: 60}});
            const stale = await http('POST', `/orders/${added.order._id}/adjustments`, {...exchange, confirmationToken: quote.body.data.confirmationToken, cashReceivedAmount: 60});
            assert.equal(stale.status, 409); assert.match(stale.body.message, /preview and confirm/);
            assert.equal((await Order.findById(added.order._id)).revision, 0);
        });
        await t.test('mounted payment and cancellation record settlement; legacy cancel cannot bypass history', async () => {
            const customer = await buyer(); const {order, product} = await sale(customer, {paid: 40});
            const input = payment(order, {cashReceivedAmount: 20, reason:''});
            const preview = await http('POST', `/orders/${order._id}/payments/preview`, input);
            assert.equal(preview.status, 200);
            const result = await http('POST', `/orders/${order._id}/payments`, {...input, confirmationToken: preview.body.data.confirmationToken});
            assert.equal(result.status, 200); assert.equal(result.body.data.event.kind, 'PAYMENT'); assert.equal(result.body.data.event.reason,'Customer invoice payment');
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 40);
            assert.equal((await http('PATCH', `/orders/${order._id}/cancel`, {})).status, 409);
            const current = await Order.findById(order._id);
            const cancelInput = {...payment(current), returns: [], additions: [], cashRefundAmount: 60};
            const cancelPreview = await http('POST', `/orders/${order._id}/cancellations/preview`, cancelInput);
            assert.equal(cancelPreview.status, 200);
            const cancelled = await http('POST', `/orders/${order._id}/cancellations`, {...cancelInput, confirmationToken: cancelPreview.body.data.confirmationToken});
            assert.equal(cancelled.status, 200); assert.equal(cancelled.body.data.event.kind, 'CANCELLATION');
            assert.equal((await Order.findById(order._id)).status, 'CANCELLED');
            assert.equal((await Customer.findById(customer._id)).remainingMoney, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 10);
            const detail = await http('GET', `/orders/${order._id}`);
            assert.equal(detail.body.data.eligibility.adjustmentEligible, false);
            const history = await http('GET', `/orders/${order._id}/history?kind=PAYMENT`);
            assert.equal(history.body.data.pagination.recordCount, 1);
        });
        await t.test('customer read exposes separate debt/credit without cross-shop data or private history', async () => {
            const customer = await buyer(); await issueCredit(customer, 70); await sale(customer, {paid: 40});
            for (const user of [ownerUser, cashierUser]) {
                const result = await http('GET', '/customers/?search=' + encodeURIComponent(customer.name), undefined, user);
                assert.equal(result.status, 200);
                const found = result.body.data.customers.find(row => row._id === String(customer._id));
                assert.equal(found.remainingMoney, 60); assert.equal(found.storeCreditBalanceMinor, 7000);
                assert.ok(!JSON.stringify(result.body).includes('costPrice'));
            }
            const foreign = await http('GET', '/customers/?search=' + encodeURIComponent(customer.name), undefined, foreignOwner);
            assert.equal(foreign.status, 200); assert.equal(foreign.body.data.customers.length, 0);
            assert.equal((await http('GET', '/customers/', undefined, adminUser)).status, 403);
        });
        await t.test('real dated reporting keeps old sales, applies today returns/exchanges/cancellation and excludes payments/credit', async () => {
            const reportOwnerId = new mongoose.Types.ObjectId();
            const reportShop = await Shop.create({name: 'Reporting isolated shop', address: 'Test', contactNo: '03333333333', ownerId: reportOwnerId,
                isActive: true, subscriptionActive: true, subscriptionExpiry: new Date(Date.now() + 86400000)});
            const reportActor = {_id: reportOwnerId, shopId: reportShop._id, username: 'Reporter', role: 'OWNER'};
            const reportProduct = await Product.create({name: 'Report bulb', brand: 'Local', slug: 'report-bulb', category,
                shopId: reportShop._id, retailPrice: 50, wholesalePrice: 40, costPrice: 10, stockQuantity: 20});
            const lastMonth = periodBounds('lastMonth'), today = periodBounds('today');
            const oldDate = new Date(lastMonth.start.getTime() + 1000);
            const original = await invoke(createOrder, {user: reportActor, body: {items: [{productId: String(reportProduct._id), quantity: 2}], saleType: 'RETAIL', paidAmount: 100}});
            // Synthetic fixture dates only, inside this fresh disposable database.
            await Order.collection.updateOne({_id: original._id}, {$set: {createdAt: oldDate, 'originalSnapshot.createdAt': oldDate}});
            assert.equal((await salesSummary(reportShop._id, lastMonth)).total, 100);
            await applyInvoiceAdjustment(reportActor, String(original._id), returned(original, 1, {cashRefundAmount: 50}));
            assert.equal((await salesSummary(reportShop._id, lastMonth)).total, 100);
            assert.equal((await salesSummary(reportShop._id, today)).total, -50);
            const units = await productSales(reportShop._id, today, [reportProduct._id], false, 20);
            assert.equal(units[0].quantity, -1); assert.equal(units[0].revenue, -50);
            const now = await Order.findById(original._id);
            await applyInvoiceCancellation(reportActor, String(original._id), {...payment(now), returns: [], additions: [], cashRefundAmount: 50});
            assert.equal((await salesSummary(reportShop._id, lastMonth)).total, 100);
            assert.equal((await salesSummary(reportShop._id, today)).total, -100);
            const ai = await processQuestion('Sales today?', reportActor, async () => ({action: 'sales', period: 'today'}));
            assert.equal(ai.data.total, -100); assert.match(ai.answer, /not cash collected/);
            const aiCompare = await processQuestion('Compare months', reportActor, async () => ({action: 'compareSales'}));
            assert.equal(aiCompare.data.previous.total, 100); assert.equal(aiCompare.data.current.total, -100);
            const customer = await Customer.create({name: 'Report customer', phoneNo: '03000000000', shopId: reportShop._id});
            const creditSale = await invoke(createOrder, {user: reportActor, body: {items: [{productId: String(reportProduct._id), quantity: 2}], saleType: 'RETAIL', paidAmount: 40, customerId: String(customer._id)}});
            const beforePay = await salesSummary(reportShop._id, today);
            await applyInvoicePayment(reportActor, String(creditSale._id), payment(creditSale, {cashReceivedAmount: 60}));
            assert.equal((await salesSummary(reportShop._id, today)).total, beforePay.total);
            const paid = await Order.findById(creditSale._id);
            await applyInvoiceAdjustment(reportActor, String(creditSale._id), returned(paid, 1, {creditIssueAmount: 50}));
            assert.equal((await salesSummary(reportShop._id, today)).total, beforePay.total - 50);
            const exchange = await Order.findById(creditSale._id);
            await Product.updateOne({_id: reportProduct._id}, {$set: {retailPrice: 70}});
            await applyInvoiceAdjustment(reportActor, String(creditSale._id), {...returned(exchange, 1), additions: [{productId: String(reportProduct._id), quantity: 1}], cashReceivedAmount: 20});
            assert.equal((await salesSummary(reportShop._id, today)).total, beforePay.total - 30);
            const productRows = await productSales(reportShop._id, today, [reportProduct._id], true, 20);
            assert.equal(productRows[0].quantity, -1); assert.equal(productRows[0].revenue, -30);
            const otherRows = await productSales(foreignShop._id, today, [reportProduct._id], false, 20);
            assert.equal(otherRows.length, 0);
        });
        await t.test('new legacy cancellation uses actual date; untimed historical cancellations stay excluded without fabricated dates', async () => {
            const legacy = await fixture({status: 'PENDING'});
            const yesterday = new Date(periodBounds('today').start.getTime() - 1000);
            await Order.collection.updateOne({_id: legacy.order._id}, {$set: {createdAt: yesterday, 'originalSnapshot.createdAt': yesterday}});
            const today = periodBounds('today'), oldRange = {start: new Date(yesterday.getTime() - 1000), end: new Date(yesterday.getTime() + 1)};
            const before = await salesSummary(shop._id, today), beforeOld = await salesSummary(shop._id, oldRange);
            assert.equal((await http('PATCH', `/orders/${legacy.order._id}/cancel`, {})).status, 200);
            const cancelled = await Order.findById(legacy.order._id);
            assert.ok(cancelled.cancelledAt); assert.equal(cancelled.cancellationMode, 'LEGACY');
            assert.equal((await salesSummary(shop._id, today)).total, before.total - 100);
            assert.equal((await salesSummary(shop._id, oldRange)).total, beforeOld.total);
            const unknown = await fixture({status: 'CANCELLED'});
            const summary = await salesSummary(shop._id, today);
            assert.ok(summary.legacyCancelledExcluded >= 1);
            const detail = await Order.findById(unknown.order._id);
            assert.equal(detail.cancelledAt, undefined);
        });
        await t.test('public preview explains missing refund allocation and HTTP rollback/replay protects the confirmed operation', async () => {
            const {order, product} = await fixture({stock: 2});
            const missing = returned(order);
            const incomplete = await http('POST', `/orders/${order._id}/adjustments/preview`, missing);
            assert.equal(incomplete.status, 200); assert.equal(incomplete.body.data.canSubmit, false);
            assert.equal(incomplete.body.data.requirements.cashRefundMaximumMinor, 5000);
            assert.match(incomplete.body.data.validationMessage, /Refund allocation/);
            assert.equal(incomplete.body.data.confirmationToken, null);
            const input = {...missing, cashRefundAmount: 50};
            const preview = await http('POST', `/orders/${order._id}/adjustments/preview`, input);
            const body = {...input, confirmationToken: preview.body.data.confirmationToken};
            const create = InvoiceAdjustment.create;
            InvoiceAdjustment.create = async () => {throw new Error('Injected HTTP audit failure');};
            try {assert.equal((await http('POST', `/orders/${order._id}/adjustments`, body)).status, 500);}
            finally {InvoiceAdjustment.create = create;}
            assert.equal((await Order.findById(order._id)).revision, 0);
            assert.equal((await Product.findById(product._id)).stockQuantity, 2);
            assert.equal(await StockLog.countDocuments({referenceId: order._id}), 0);
            const attempts = await Promise.all([http('POST', `/orders/${order._id}/adjustments`, body), http('POST', `/orders/${order._id}/adjustments`, body)]);
            assert.ok(attempts.some(r => r.status === 200));
            assert.ok(attempts.every(r => [200, 409].includes(r.status)));
            const replay = await http('POST', `/orders/${order._id}/adjustments`, body);
            assert.equal(replay.status, 200);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 1);
            assert.equal((await Product.findById(product._id)).stockQuantity, 3);
            const eligible = await http('GET', `/orders/${order._id}`);
            assert.equal(eligible.body.data.eligibility.revision, 1);
            const malformed = await fixture();
            await Order.collection.updateOne({_id: malformed.order._id}, {$set: {discountType: 'PERCENTAGE', discountValue: 0, discountAmount: 10, totalPrice: 90, paidAmount: 90}});
            const detail = await http('GET', `/orders/${malformed.order._id}`);
            assert.equal(detail.status, 200); assert.equal(detail.body.data.eligibility.adjustmentEligible, false);
            assert.match(detail.body.data.eligibility.reason, /reconciliation/);
        });
        await t.test('reason-free adjustment preview and commit preserve the immutable audit and replay contract', async () => {
            const {order, product} = await fixture({stock: 1});
            const body = {...returned(order, 1, {cashRefundAmount: 50}), reason: '   '};
            const preview = await http('POST', `/orders/${order._id}/adjustments/preview`, body);
            assert.equal(preview.status, 200);
            assert.equal(preview.body.data.canSubmit, true);
            const confirmedBody = {...body, confirmationToken: preview.body.data.confirmationToken};
            const committed = await http('POST', `/orders/${order._id}/adjustments`, confirmedBody);
            assert.equal(committed.status, 200);
            const event = committed.body.data.event;
            assert.equal(event.reason, 'Invoice adjusted');
            assert.equal(event.reasonSource, 'SYSTEM');
            assert.equal(String(event.createdBy), String(ownerId));
            assert.ok(event.occurredAt);
            assert.equal(event.kind, 'ADJUSTMENT');
            assert.ok(event.before && event.after && event.movements.length);
            assert.ok(event.financial);
            assert.equal(preview.body.data.funding.cashNetMinor, 10000);
            assert.equal(preview.body.data.funding.availableCreditMinor, 0);
            const afterFirstReturn = await Order.findById(order._id);
            const laterPreview = await http('POST', '/orders/' + order._id + '/adjustments/preview', returned(afterFirstReturn, 1));
            assert.equal(laterPreview.status, 200);
            assert.equal(laterPreview.body.data.funding.cashReceivedMinor, 10000);
            assert.equal(laterPreview.body.data.funding.cashRefundedMinor, 5000);
            assert.equal(laterPreview.body.data.funding.cashNetMinor, 5000);
            const replay = await http('POST', `/orders/${order._id}/adjustments`, confirmedBody);
            assert.equal(replay.status, 200);
            assert.equal(replay.body.data.event._id, event._id);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId: order._id}), 1);
            assert.equal((await Product.findById(product._id)).stockQuantity, 2);

            const cancellation = await fixture({status: 'PENDING', stock: 1});
            const missingCancellationReason = {...returned(cancellation.order), reason: '  '};
            const rejected = await http('POST', `/orders/${cancellation.order._id}/cancellations/preview`, missingCancellationReason);
            assert.equal(rejected.status, 400);
            const walkIn = await fixture({stock: 3, paid: 100});
            const walkInChange = {...returned(walkIn.order), returns: [], additions: [{productId: String(walkIn.product._id), quantity: 1}], reason: ''};
            const unpaidWalkIn = await http('POST', '/orders/' + walkIn.order._id + '/adjustments/preview', walkInChange);
            assert.equal(unpaidWalkIn.status, 200);
            assert.equal(unpaidWalkIn.body.data.requirements.dueMinor, 5000);
            assert.match(unpaidWalkIn.body.data.validationMessage, /Anonymous invoice must remain fully settled/);
            assert.equal(unpaidWalkIn.body.data.confirmationToken, null);
            const paidWalkIn = await http('POST', '/orders/' + walkIn.order._id + '/adjustments/preview', {...walkInChange, cashReceivedAmount: 50});
            assert.equal(paidWalkIn.status, 200);
            assert.equal(paidWalkIn.body.data.canSubmit, true);
            assert.equal(paidWalkIn.body.data.settlement.dueMinor, 0);
        });
    } finally {
        if (httpServer) await new Promise(resolve => httpServer.close(resolve));
        await mongoose.disconnect();
        mongod.kill();
        await new Promise(resolve => { if (mongod.exitCode !== null) resolve(); else mongod.once('exit', resolve); });
        // Delete only the verified directory created for this isolated test instance.
        if (path.dirname(temp) !== os.tmpdir() || !path.basename(temp).startsWith('digishop-adjustment-replica-')) throw new Error('Unsafe test cleanup path');
        await fs.rm(temp, {recursive: true, force: true});
    }
});
