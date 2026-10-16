import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {Order} from '../models/order.model.js';
import {Product} from '../models/product.model.js';
import {StockLog} from '../models/stockLog.model.js';
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {Shop} from '../models/shop.model.js';
import {apiError} from '../utils/apiError.js';
import {invoiceTotals, moneyMinor, moneyMajor, settlementPlan} from '../utils/invoiceAccounting.js';
import type {SettlementInput} from '../utils/invoiceAccounting.js';
import {settleInvoice, calculateInvoiceSettlement, verifiedInvoiceFunding} from '../utils/invoiceSettlement.js';
import {asyncHandler} from '../utils/asyncHandler.js';
import {apiResponse} from '../utils/apiResponse.js';
import {listQuery} from '../utils/listQuery.js';
import {periodBounds} from '../utils/aiQuestions.js';
import {salesSummary} from '../utils/salesReporting.js';
import {invoiceAccountingEnabled, invoiceCashRouting, postIntegratedInvoiceEvent, throwAccountingTransactionError} from '../utils/invoiceAccountingIntegration.js';
import type {CashRouting} from '../utils/invoiceAccountingIntegration.js';

type Line = {lineId: string, productId: any, quantity: number, unitPrice: number, name?: string, brand?: string, unit?: string};
type ReturnLine = {lineId: string, quantity: number, disposition: 'RESTOCK' | 'DAMAGED'};
type Addition = {productId: string, quantity: number};
type AdjustmentInput = SettlementInput & CashRouting & {requestKey: string, expectedRevision: number, reason: string,
    returns: ReturnLine[], additions: Addition[], discountType?: string, discountValue?: number, confirmationToken?: string};
type Actor = {_id: any, shopId: any, role: string, username: string};
type Operation = 'ADJUSTMENT' | 'PAYMENT' | 'CANCELLATION';

export const getInvoicePaymentAccounts = asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!invoiceAccountingEnabled()) return res.status(200).json(new apiResponse(200, {accountingEnabled: false, accounts: []}, 'Accounting is disabled'));
    const session = await mongoose.startSession();
    session.startTransaction({readConcern: {level: 'snapshot'}});
    try {
        const {selectInvoicePaymentAccounts} = await import('../utils/businessAccounts.js');
        const accounts = await selectInvoicePaymentAccounts(req.user, session);
        return res.status(200).json(new apiResponse(200, {accountingEnabled: true, accounts}, 'Payment accounts fetched'));
    } finally {await session.abortTransaction(); await session.endSession();}
});

function validateInput(input: AdjustmentInput) {
    if (!input || typeof input.requestKey !== 'string' || !/^[\w-]{8,100}$/.test(input.requestKey) ||
        !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
        typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 300 ||
        !Array.isArray(input.returns) || !Array.isArray(input.additions) ||
        input.returns.length + input.additions.length > 100) throw new apiError(400, 'Invalid adjustment request');
    if ((input.discountType !== undefined && !['NONE', 'PERCENTAGE', 'FIXED'].includes(input.discountType)) ||
        (input.discountValue !== undefined && (typeof input.discountValue !== 'number' || !Number.isFinite(input.discountValue) || input.discountValue < 0))) {
        throw new apiError(400, 'Invalid invoice discount');
    }
    const lines = new Set<string>();
    for (const item of input.returns) {
        if (!item || typeof item.lineId !== 'string' || lines.has(item.lineId) ||
            !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
            !['RESTOCK', 'DAMAGED'].includes(item.disposition)) throw new apiError(400, 'Invalid returned line');
        lines.add(item.lineId);
    }
    for (const item of input.additions) {
        if (!item || !mongoose.isValidObjectId(item.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
            throw new apiError(400, 'Invalid added product');
        }
    }
}

function operationInput(order: any, input: AdjustmentInput, kind: Operation): AdjustmentInput {
    if (kind === 'CANCELLATION') {
        if (order.status !== 'PENDING') throw new apiError(409, 'Only pending invoices can be cancelled; use a full return');
        if (input.additions.length || input.returns.length) throw new apiError(400, 'Cancellation returns all remaining units as restock');
        return {...input, discountType: 'NONE', discountValue: 0,
            returns: order.items.map((line: any, index: number) => ({lineId: line.lineId ?? `legacy-${index}`, quantity: line.quantity, disposition: 'RESTOCK'}))};
    }
    if (kind === 'PAYMENT') {
        if (!moneyMinor(input.cashReceivedAmount ?? 0) && !moneyMinor(input.creditRedeemedAmount ?? 0)) throw new apiError(400, 'A positive invoice payment is required');
        if (input.discountType !== undefined || input.discountValue !== undefined || input.returns.length || input.additions.length) throw new apiError(400, 'Payments cannot change invoice discounts or items');
        if (moneyMinor(input.cashRefundAmount ?? 0) || moneyMinor(input.creditIssueAmount ?? 0) || input.creditRecipientId) throw new apiError(400, 'Payment cannot issue refunds or credit');
    }
    return input;
}
function confirmationToken(order: any, plan: any, settlement: any, kind: Operation, routing?: CashRouting) {
    return createHash('sha256').update(JSON.stringify({kind, orderId: String(order._id), shopId: String(order.shopId),
        revision: order.revision ?? 0, status: order.status, before: [plan.before.totalMinor, plan.before.settledMinor, plan.before.dueMinor],
        after: [plan.after.totalMinor, plan.after.discountMinor, settlement.settledMinor, settlement.dueMinor],
        items: plan.after.items.map((i: any) => ({productId: String(i.productId), quantity: i.quantity, unitPrice: i.unitPrice, name: i.name, brand: i.brand, unit: i.unit})),
        movements: plan.movements.map((m: any) => ({productId: String(m.productId), lineId: m.kind === 'RETURN' ? m.lineId : undefined,
            kind: m.kind, quantity: m.quantity, price: m.unitPriceMinor, disposition: m.disposition})),
        financial: [settlement.cashReceivedMinor, settlement.creditRedeemedMinor, settlement.cashRefundMinor,
            settlement.creditIssuedMinor, settlement.creditRestoredMinor], recipient: String(settlement.recipientId ?? order.customerId ?? ''),
        ...(invoiceAccountingEnabled() ? {cashRouting: routing ?? {}} : {})})).digest('hex');
}

export async function invoiceEligibility(order: any, session: mongoose.ClientSession) {
    const base = {revision: order.revision ?? 0, originalSnapshotAvailable: !!order.originalSnapshot};
    if (order.accountingMode && !invoiceAccountingEnabled()) return {...base, adjustmentEligible: false, paymentEligible: false, cancellationEligible: false, reason: 'Accounting invoice is locked while integration is disabled'};
    if (!['PENDING', 'DELIVERED'].includes(order.status)) return {...base, adjustmentEligible: false, paymentEligible: false, cancellationEligible: false, reason: 'Invoice is locked'};
    try {
        planInvoiceAdjustment(order, {requestKey: 'eligibility-read', expectedRevision: base.revision, reason: 'Read eligibility', returns: [], additions: []}, [], true);
        await verifiedInvoiceFunding(order, session);
        return {...base, adjustmentEligible: true, paymentEligible: order.amountDue > 0 && !!order.customerId,
            cancellationEligible: order.status === 'PENDING', reason: null};
    } catch (error) {
        if (!(error instanceof apiError) || ![400, 409].includes(error.statusCode)) throw error;
        return {...base, adjustmentEligible: false, paymentEligible: false, cancellationEligible: false, reason: error.message};
    }
}

function httpInput(body: any, kind: Operation): AdjustmentInput {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new apiError(400, 'Invoice operation body required');
    const input = {...body, returns: body.returns ?? [], additions: body.additions ?? []};
    validateInput(input);
    return input;
}
export function invoiceMutation(kind: Operation) {
    return asyncHandler(async (req, res) => {
        const input = httpInput(req.body, kind);
        if (typeof input.confirmationToken !== 'string' || !/^[a-f0-9]{64}$/.test(input.confirmationToken)) throw new apiError(400, 'Preview and confirm this invoice operation first');
        const event = await applyInvoiceOperation(req.user, String(req.params.orderId), input, kind);
        const result = event?.toObject();
        if (result) delete (result as any).requestHash;
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(new apiResponse(200, {event: result}, 'Invoice operation recorded'));
    });
}
export function invoicePreview(kind: Operation) {
    return asyncHandler(async (req, res) => {
        const input = httpInput(req.body, kind);
        if (!mongoose.isValidObjectId(req.params.orderId)) throw new apiError(400, 'Valid invoice required');
        const session = await mongoose.startSession(); session.startTransaction();
        try {
            const shop = await Shop.findById(req.user.shopId).session(session);
            if (!shop || String(shop.ownerId) !== String(req.user._id)) throw new apiError(403, 'Owner shop access required');
            if (shop.isActive === false) throw new apiError(403, 'Shop has been deactivated. Contact administrator.');
            if (!shop.subscriptionActive || !shop.subscriptionExpiry || shop.subscriptionExpiry <= new Date()) throw new apiError(403, 'Subscription expired or inactive');
            const order = await Order.findOne({_id: String(req.params.orderId), shopId: req.user.shopId, type: 'INVOICE'}).session(session);
            if (!order) throw new apiError(404, 'Invoice not found');
            const accounting = invoiceAccountingEnabled();
            if (!accounting && order.accountingMode) throw new apiError(409, 'Accounting invoice is locked while integration is disabled');
            if ((order.revision ?? 0) !== input.expectedRevision) throw new apiError(409, 'Invoice changed; reload before preview');
            const planned = operationInput(order, input, kind);
            const products = await Product.find({shopId: req.user.shopId, _id: {$in: [...order.items.map(i => i.productId), ...input.additions.map(i => i.productId)]}})
                .select('name brand unit retailPrice wholesalePrice stockQuantity shopId').session(session);
            const plan = planInvoiceAdjustment(order.toObject(), planned, products, kind !== 'ADJUSTMENT');
            const funding = await verifiedInvoiceFunding(order, session);
            const requirements = settlementPlan(plan.after.totalMinor, funding.cashNetMinor + funding.creditNetMinor, funding.creditNetMinor);
            for (const productId of new Set(plan.movements.map(m => String(m.productId)))) {
                const product = products.find(p => String(p._id) === productId);
                const delta = plan.movements.filter(m => String(m.productId) === productId).reduce((sum, m) => sum + m.stockDelta, 0);
                if (!product || !Number.isFinite(product.stockQuantity) || product.stockQuantity + delta < 0) throw new apiError(409, 'Product missing or insufficient sellable stock');
            }
            let settlement: any = null, token: string | null = null, validationMessage: string | null = null;
            try {
                settlement = await calculateInvoiceSettlement(order, plan.after.totalMinor, input, req.user, session);
                if (accounting) {
                    const {validateInvoiceCashRouting} = await import('../utils/businessAccounts.js');
                    await validateInvoiceCashRouting(req.user, invoiceCashRouting(input), settlement, session);
                }
                token = confirmationToken(order, plan, settlement, kind, accounting ? invoiceCashRouting(input) : undefined);
            } catch (error) {
                if (!(error instanceof apiError) || error.statusCode !== 400) throw error;
                validationMessage = error.message;
            }
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json(new apiResponse(200, {revision: order.revision ?? 0, before: plan.before,
                proposed: {...plan.after, ...(settlement ? {settledMinor: settlement.settledMinor, dueMinor: settlement.dueMinor} : {})},
                movements: plan.movements, requirements, settlement, confirmationToken: token, canSubmit: !!token, validationMessage}, 'Invoice preview calculated'));
        } finally {await session.abortTransaction(); await session.endSession();}
    });
}
export const getInvoiceHistory = asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.orderId)) throw new apiError(400, 'Valid invoice required');
    const session = await mongoose.startSession(); session.startTransaction();
    try {
    const order = await Order.findOne({_id: String(req.params.orderId), shopId: req.user.shopId, type: 'INVOICE'}).session(session);
    if (!order) throw new apiError(404, 'Invoice not found');
    const {page, limit, skip} = listQuery(req.query);
    const kind = req.query.kind, requestKey = req.query.requestKey;
    if (kind !== undefined && (typeof kind !== 'string' || !['SALE', 'ADJUSTMENT', 'PAYMENT', 'CANCELLATION'].includes(kind))) throw new apiError(400, 'Invalid history kind');
    if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[\w-]{8,100}$/.test(requestKey))) throw new apiError(400, 'Invalid history request key');
    const filter: any = {shopId: req.user.shopId, orderId: order._id, ...(kind ? {kind} : {}), ...(requestKey ? {requestKey} : {})};
    const history = await InvoiceAdjustment.find(filter).select('-requestHash').sort({occurredAt: -1, _id: -1}).skip(skip).limit(limit).session(session);
    const recordCount = await InvoiceAdjustment.countDocuments(filter).session(session);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(new apiResponse(200, {history, revision: order.revision ?? 0,
        pagination: {recordCount, totalPages: Math.ceil(recordCount / limit), currentPage: page, limit}}, 'Invoice history fetched'));
    } finally {await session.abortTransaction(); await session.endSession();}
});
export const getSalesSummary = asyncHandler(async (req, res) => {
    const period = req.query.period ?? 'today';
    if (typeof period !== 'string' || !['today', 'thisMonth', 'lastMonth'].includes(period)) throw new apiError(400, 'Use today, thisMonth or lastMonth');
    const bounds = periodBounds(period);
    const summary = await salesSummary(req.user.shopId, bounds);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(new apiResponse(200, {...summary, period, start: bounds.start, end: bounds.end}, 'Sales summary fetched'));
});

// Shared pure item planner. Supplied product prices are read by the core from MongoDB,
// never from the request. Existing units are not merged into new-price additions.
export function planInvoiceAdjustment(order: any, input: AdjustmentInput, products: any[], settlementOnly = false) {
    validateInput(input);
    if (order.type !== 'INVOICE' || !['PENDING', 'DELIVERED'].includes(order.status)) throw new apiError(409, 'Invoice is locked');
    if (!['RETAIL', 'WHOLESALE'].includes(order.saleType)) throw new apiError(409, 'Invoice sale type requires reconciliation');
    if (!order.items.length && order.returnState !== 'FULL') throw new apiError(409, 'Legacy invoice items require reconciliation');
    let items: Line[] = order.items.map((item: any, index: number) => ({
        ...item, lineId: item.lineId || `legacy-${index}`, productId: item.productId
    }));
    if (new Set(items.map(item => item.lineId)).size !== items.length) throw new apiError(409, 'Invoice line identities are inconsistent');
    const beforeTotals = invoiceTotals(items, order.discountType, order.discountValue);
    const settledMinor = moneyMinor(order.paidAmount), dueMinor = moneyMinor(order.amountDue);
    if (beforeTotals.subtotalMinor !== moneyMinor(order.subtotal) ||
        beforeTotals.discountMinor !== moneyMinor(order.discountAmount) ||
        beforeTotals.totalMinor !== moneyMinor(order.totalPrice) || settledMinor + dueMinor !== beforeTotals.totalMinor) {
        throw new apiError(409, 'Legacy invoice totals or discount require verified reconciliation');
    }
    const before = {items: items.map(item => ({...item})), ...beforeTotals, settledMinor, dueMinor,
        discountType: order.discountType, discountValue: order.discountValue};
    const movements: {lineId: string, productId: any, kind: 'RETURN' | 'ADD', quantity: number,
        unitPriceMinor: number, stockDelta: number, disposition?: 'RESTOCK' | 'DAMAGED'}[] = [];
    for (const returned of input.returns) {
        const item = items.find(line => line.lineId === returned.lineId);
        if (!item || returned.quantity > item.quantity) throw new apiError(400, 'Returned quantity exceeds remaining invoice quantity');
        item.quantity -= returned.quantity;
        movements.push({lineId: item.lineId, productId: item.productId, kind: 'RETURN', quantity: returned.quantity,
            unitPriceMinor: moneyMinor(item.unitPrice), stockDelta: returned.disposition === 'RESTOCK' ? returned.quantity : 0,
            disposition: returned.disposition});
    }
    items = items.filter(item => item.quantity > 0);
    for (const addition of input.additions) {
        const product = products.find(p => String(p._id) === addition.productId && String(p.shopId) === String(order.shopId));
        if (!product) throw new apiError(404, 'Product not found in shop');
        const price = order.saleType === 'WHOLESALE' ? product.wholesalePrice : product.retailPrice;
        if (order.saleType === 'WHOLESALE' && !price) throw new apiError(400, 'Wholesale price required');
        const unitPriceMinor = moneyMinor(price);
        const item: Line = {lineId: new mongoose.Types.ObjectId().toString(), productId: product._id,
            quantity: addition.quantity, unitPrice: moneyMajor(unitPriceMinor), name: product.name, brand: product.brand, unit: product.unit};
        items.push(item);
        movements.push({lineId: item.lineId, productId: item.productId, kind: 'ADD', quantity: item.quantity,
            unitPriceMinor, stockDelta: -item.quantity});
    }
    const discountType = input.discountType ?? order.discountType;
    const discountValue = input.discountValue ?? order.discountValue;
    const afterTotals = invoiceTotals(items, discountType, discountValue);
    if (!settlementOnly && !movements.length && discountType === order.discountType && discountValue === order.discountValue) throw new apiError(400, 'No invoice change supplied');
    const settlement = settlementPlan(afterTotals.totalMinor, settledMinor);
    return {before, after: {items, ...afterTotals, settledMinor: settlement.netSettledMinor, dueMinor: settlement.dueMinor,
        discountType, discountValue}, movements, settlement};
}

// HTTP adapters below require an exact server preview token; internal callers and
// replica tests can use this core without an HTTP confirmation exchange.
export async function applyInvoiceAdjustment(actor: Actor, orderId: string, input: AdjustmentInput) {
    return applyInvoiceOperation(actor, orderId, input, 'ADJUSTMENT');
}
export async function applyInvoicePayment(actor: Actor, orderId: string, input: Omit<AdjustmentInput, 'returns' | 'additions' | 'discountType' | 'discountValue'>) {
    return applyInvoiceOperation(actor, orderId, {...input, returns: [], additions: []}, 'PAYMENT');
}
export async function applyInvoiceCancellation(actor: Actor, orderId: string, input: AdjustmentInput) {
    return applyInvoiceOperation(actor, orderId, input, 'CANCELLATION');
}
async function applyInvoiceOperation(actor: Actor, orderId: string, input: AdjustmentInput, kind: Operation) {
    if (actor.role !== 'OWNER' || !actor.shopId) throw new apiError(403, 'Owner access required');
    if (!mongoose.isValidObjectId(orderId)) throw new apiError(400, 'Valid invoice required');
    validateInput(input);
    const accounting = invoiceAccountingEnabled(), routing = accounting ? invoiceCashRouting(input) : undefined;
    // Only accepted fields participate in replay identity; forged shop/actor/prices are ignored.
    const requestHash = createHash('sha256').update(JSON.stringify({kind, expectedRevision: input.expectedRevision,
        reason: input.reason.trim(), returns: input.returns.map(i => ({lineId: i.lineId, quantity: i.quantity, disposition: i.disposition})),
        additions: input.additions.map(i => ({productId: i.productId, quantity: i.quantity})),
        discountType: input.discountType, discountValue: input.discountValue,
        cashReceivedAmount: input.cashReceivedAmount ?? 0, creditRedeemedAmount: input.creditRedeemedAmount ?? 0,
        cashRefundAmount: input.cashRefundAmount ?? 0, creditIssueAmount: input.creditIssueAmount ?? 0,
        creditRecipientId: input.creditRecipientId, confirmationToken: input.confirmationToken,
        ...(accounting ? {cashRouting: routing} : {})})).digest('hex');
    const session = await mongoose.startSession();
    session.startTransaction(accounting ? {readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}} : undefined);
    try {
        const shop = await Shop.findById(actor.shopId).session(session);
        if (!shop || String(shop.ownerId) !== String(actor._id)) throw new apiError(403, 'Owner shop access required');
        if (shop.isActive === false) throw new apiError(403, 'Shop has been deactivated. Contact administrator.');
        if (!shop.subscriptionActive || !shop.subscriptionExpiry || shop.subscriptionExpiry <= new Date()) throw new apiError(403, 'Subscription expired or inactive');
        const replay = await InvoiceAdjustment.findOne({shopId: actor.shopId, orderId, requestKey: input.requestKey}).session(session);
        if (replay) {
            if (replay.requestHash !== requestHash) throw new apiError(409, 'Request key already used for different adjustment');
            await session.abortTransaction();
            return replay;
        }
        const order = await Order.findOne({_id: orderId, shopId: actor.shopId, type: 'INVOICE'}).session(session);
        if (!order) throw new apiError(404, 'Invoice not found');
        if (!accounting && order.accountingMode) throw new apiError(409, 'Accounting invoice is locked while integration is disabled');
        if ((order.revision ?? 0) !== input.expectedRevision) throw new apiError(409, 'Invoice changed; reload before adjusting');
        const products = await Product.find({shopId: actor.shopId, _id: {$in: input.additions.map(item => item.productId)}}).session(session);
        const plannedInput = operationInput(order, input, kind);
        const plan = planInvoiceAdjustment(order.toObject(), plannedInput, products, kind !== 'ADJUSTMENT');
        const adjustmentId = new mongoose.Types.ObjectId();
        const occurredAt = new Date();
        if (input.confirmationToken) {
            const proposed = await calculateInvoiceSettlement(order, plan.after.totalMinor, input, actor, session);
            if (input.confirmationToken !== confirmationToken(order, plan, proposed, kind, routing)) throw new apiError(409, 'Invoice or prices changed; preview and confirm again');
        }
        const settlement = await settleInvoice(order, plan.after.totalMinor, input, actor, adjustmentId, session, kind);
        plan.after.settledMinor = settlement.settledMinor;
        plan.after.dueMinor = settlement.dueMinor;
        // Conditional invoice claim. All earlier settlement writes roll back if
        // this conflicts with a concurrent adjustment/cancellation/status change.
        const filter: any = {_id: order._id, shopId: actor.shopId, status: order.status};
        filter.$or = [{revision: input.expectedRevision}, ...(input.expectedRevision === 0 ? [{revision: {$exists: false}}] : [])];
        const changes: any = {items: plan.after.items, subtotal: moneyMajor(plan.after.subtotalMinor),
            discountAmount: moneyMajor(plan.after.discountMinor), totalPrice: moneyMajor(plan.after.totalMinor),
            discountType: plan.after.discountType, discountValue: plan.after.discountValue,
            paidAmount: moneyMajor(settlement.settledMinor), amountDue: moneyMajor(settlement.dueMinor),
            settlementState: settlement.settlementState,
            ...(accounting ? {accountingMode: 'INTEGRATION_TEST'} : {}),
            returnState: !plan.after.items.length ? 'FULL' : plannedInput.returns.length || order.returnState === 'PARTIAL' || order.returnState === 'FULL' ? 'PARTIAL' : 'NONE'};
        if (kind === 'CANCELLATION') Object.assign(changes, {status: 'CANCELLED', cancelledAt: occurredAt, cancellationMode: 'SETTLED'});
        if (settlement.recipientId) changes.creditRecipientId = settlement.recipientId;
        if (!order.originalSnapshot) changes.originalSnapshot = {...order.toObject(), source: 'LEGACY_BASELINE', capturedAt: new Date()};
        const claimed = await Order.updateOne(filter, {$set: changes, $inc: {revision: 1}},
            {session, runValidators: true, overwriteImmutable: true});
        if (claimed.modifiedCount !== 1) throw new apiError(409, 'Invoice changed; reload before adjusting');
        // Restocks happen before additions, but DAMAGED never supplies usable inventory.
        const movements = [...plan.movements].sort((a, b) => b.stockDelta - a.stockDelta);
        for (const movement of movements) {
            const productFilter: any = {_id: movement.productId, shopId: actor.shopId};
            if (movement.stockDelta < 0) productFilter.stockQuantity = {$gte: -movement.stockDelta};
            const product = await Product.findOneAndUpdate(productFilter, {$inc: {stockQuantity: movement.stockDelta}}, {session, new: true});
            if (!product) throw new apiError(409, 'Product missing or insufficient sellable stock');
            await StockLog.create([{productId: movement.productId, quantityDelta: movement.stockDelta,
                reason: movement.kind === 'ADD' ? 'Invoice adjustment: added' : `Invoice adjustment: ${movement.disposition}`,
                returnedQuantity: movement.kind === 'RETURN' ? movement.quantity : 0,
                ...(movement.disposition ? {disposition: movement.disposition} : {}),
                referenceId: order._id, adjustmentId, createdBy: actor._id, saleType: order.saleType,
                shopId: actor.shopId, invoiceNo: order.invoiceNo}], {session});
        }
        const [record] = await InvoiceAdjustment.create([{_id: adjustmentId, shopId: actor.shopId, orderId: order._id,
            kind, occurredAt, debtCustomerId: order.customerId,
            ...(settlement.creditRedeemedMinor || settlement.creditRestoredMinor ? {creditCustomerId: order.customerId} : {}),
            ...(settlement.creditIssuedMinor ? {creditRecipientId: order.customerId ?? settlement.recipientId} : {}),
            invoiceNo: order.invoiceNo, requestKey: input.requestKey, requestHash,
            revisionBefore: input.expectedRevision, revisionAfter: input.expectedRevision + 1,
            createdBy: actor._id, createdByName: actor.username, reason: input.reason.trim(),
            ...(accounting ? {createdByRole: actor.role} : {}),
            ...(accounting ? {cashRouting: {mode: 'INTEGRATION_TEST', ...routing}} : {}),
            before: plan.before, after: plan.after, movements: plan.movements,
            financial: {salesDeltaMinor: plan.after.totalMinor - plan.before.totalMinor, debtDeltaMinor: settlement.debtDeltaMinor,
                cashReceivedMinor: settlement.cashReceivedMinor, cashRefundMinor: settlement.cashRefundMinor,
                creditRedeemedMinor: settlement.creditRedeemedMinor, creditIssuedMinor: settlement.creditIssuedMinor,
                creditRestoredMinor: settlement.creditRestoredMinor}}], {session});
        if (accounting) await postIntegratedInvoiceEvent(actor, record!, session);
        await session.commitTransaction();
        return record;
    } catch (error: any) {
        if (accounting) {
            if (session.inTransaction()) await session.abortTransaction().catch(() => {});
            throwAccountingTransactionError(error);
        } else await session.abortTransaction();
        if (error?.code === 11000 || error?.code === 112 || error?.hasErrorLabel?.('TransientTransactionError')) {
            throw new apiError(409, 'Concurrent invoice change; reload or retry the same request key');
        }
        throw error;
    } finally { await session.endSession(); }
}
