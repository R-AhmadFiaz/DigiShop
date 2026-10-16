import type mongoose from 'mongoose';
import {apiError} from './apiError.js';
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {Order} from '../models/order.model.js';
import {moneyMinor} from './invoiceAccounting.js';
import {verifiedInvoiceFunding} from './invoiceSettlement.js';

export type CashRouting = {receiptAccountId?: string, refundAccountId?: string};

// Off unless explicitly requested. LIVE activation is deliberately unavailable.
export function invoiceAccountingEnabled(): boolean {
    if (process.env.BUSINESS_ACCOUNTING_ENABLED !== 'true') return false;
    if (process.env.NODE_ENV !== 'test') throw new apiError(503, 'Live accounting is not approved; disable BUSINESS_ACCOUNTING_ENABLED');
    return true;
}
export function invoiceCashRouting(input: CashRouting): CashRouting {
    const routing: CashRouting = {};
    for (const field of ['receiptAccountId', 'refundAccountId'] as const) {
        const value = input[field];
        if (value !== undefined) {
            if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new apiError(400, 'Select a valid cash/bank account');
            routing[field] = value.toLowerCase();
        }
    }
    return routing;
}
export function requireAccountingOwner(actor: {role: string}) {
    if (actor.role !== 'OWNER') throw new apiError(403, 'Cashier accounting integration is not supported yet; accounting must remain disabled');
}
export function throwAccountingTransactionError(error: any) {
    if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) throw new apiError(503, 'Accounting transaction outcome uncertain; check or retry the identical request');
    if (error?.code === 11000 || error?.code === 112 || error?.hasErrorLabel?.('TransientTransactionError')) throw new apiError(409, 'Concurrent accounting operation; retry the identical request key');
}

// Called only after the source event and all business writes exist in THIS session.
export async function postIntegratedInvoiceEvent(actor: any, event: any, session: mongoose.ClientSession) {
    if (!invoiceAccountingEnabled() || !session?.inTransaction()) throw new apiError(409, 'Accounting integration requires enabled test mode and an active transaction');
    requireAccountingOwner(actor);
    // Keep optional accounting/JWT dependencies out of disabled pure planning.
    const {validateInvoiceCashRouting, postInvoiceCashMovement} = await import('./businessAccounts.js');
    const routing = invoiceCashRouting({...(event.cashRouting?.receiptAccountId ? {receiptAccountId: String(event.cashRouting.receiptAccountId)} : {}),
        ...(event.cashRouting?.refundAccountId ? {refundAccountId: String(event.cashRouting.refundAccountId)} : {})});
    const config = await validateInvoiceCashRouting(actor, routing, event.financial, session);
    const order = await Order.findOne({_id: event.orderId, shopId: actor.shopId, type: 'INVOICE'}).session(session).lean();
    const initial = await InvoiceAdjustment.find({shopId: actor.shopId, orderId: event.orderId, kind: 'SALE'}).select('_id cashRouting').limit(2).session(session).lean();
    if (!order || !(order.createdAt instanceof Date) || initial.length > 1 || (order.createdAt >= config.cutoffAt && (initial.length !== 1 || initial[0]?.cashRouting?.mode !== 'INTEGRATION_TEST'))) throw new apiError(409, 'Initial invoice funding requires reconciliation before accounting integration');
    if (!(event.occurredAt instanceof Date) || event.occurredAt < config.cutoffAt) throw new apiError(409, 'Event precedes the prepared cutover');
    // Zero-money debt/credit events need the same funding reconciliation as cash.
    await verifiedInvoiceFunding(order, session);
    for (const [direction, amount, accountId] of [
        ['RECEIPT', event.financial.cashReceivedMinor, routing.receiptAccountId],
        ['REFUND', event.financial.cashRefundMinor, routing.refundAccountId]
    ] as const) {
        if (amount) await postInvoiceCashMovement(actor, {eventId: String(event._id), cashAccountId: accountId!, direction,
            requestKey: `invoice-${event._id}-${direction.toLowerCase()}`}, session);
    }
}

// New creations only: never synthesize an event for an already-created invoice.
export async function recordIntegratedSale(actor: any, order: any, input: {requestKey: string, requestHash: string,
    routing: CashRouting, sourceQuotationId?: string, eventId?: mongoose.Types.ObjectId}, session: mongoose.ClientSession) {
    if (!invoiceAccountingEnabled() || !session?.inTransaction()) throw new apiError(409, 'Accounting integration requires enabled test mode and an active transaction');
    requireAccountingOwner(actor);
    const snapshot = {items: order.items, subtotalMinor: moneyMinor(order.subtotal), discountMinor: moneyMinor(order.discountAmount),
        totalMinor: moneyMinor(order.totalPrice), discountType: order.discountType, discountValue: order.discountValue};
    const [event] = await InvoiceAdjustment.create([{...(input.eventId ? {_id: input.eventId} : {}), shopId: order.shopId, orderId: order._id, invoiceNo: order.invoiceNo,
        kind: 'SALE', requestKey: input.requestKey, requestHash: input.requestHash, revisionBefore: 0, revisionAfter: 0,
        createdBy: actor._id, createdByName: actor.username, reason: input.sourceQuotationId ? 'Quotation converted to invoice' : 'Initial invoice payment',
        ...(input.sourceQuotationId ? {sourceQuotationId: input.sourceQuotationId} : {}),
        occurredAt: order.createdAt, before: {...snapshot, settledMinor: 0, dueMinor: snapshot.totalMinor},
        after: {...snapshot, settledMinor: moneyMinor(order.paidAmount), dueMinor: moneyMinor(order.amountDue)}, movements: [],
        debtCustomerId: order.customerId, cashRouting: {mode: 'INTEGRATION_TEST', ...input.routing},
        ...(order.settlementState.creditNetMinor ? {creditCustomerId: order.customerId} : {}),
        financial: {salesDeltaMinor: 0, debtDeltaMinor: moneyMinor(order.amountDue), cashReceivedMinor: order.settlementState.cashNetMinor,
            creditRedeemedMinor: order.settlementState.creditNetMinor, cashRefundMinor: 0, creditIssuedMinor: 0, creditRestoredMinor: 0}}], {session});
    await postIntegratedInvoiceEvent(actor, event!, session);
    return event!;
}
