import mongoose from 'mongoose';
import {Customer} from '../models/customer.model.js';
import {CustomerLedger} from '../models/customerLedger.model.js';
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {apiError} from './apiError.js';
import {moneyMinor, moneyMajor, safeMinor, financialSettlement} from './invoiceAccounting.js';
import type {SettlementInput} from './invoiceAccounting.js';

export function signedLedgerMinor(entry: any): number {
    if (typeof entry.amount !== 'number' || !Number.isFinite(entry.amount)) throw new apiError(409, 'Customer ledger money is inconsistent');
    const amount = Math.sign(entry.amount) * moneyMinor(Math.abs(entry.amount));
    if (entry.amountMinor !== undefined && entry.amountMinor !== amount) throw new apiError(409, 'Customer ledger money is inconsistent');
    return amount;
}
// Missing balanceType denotes legacy debt. Never net debt against store credit.
export async function checkedCustomer(customerId: any, shopId: any, session: mongoose.ClientSession) {
    const customer = await Customer.findOne({_id: customerId, shopId}).session(session);
    if (!customer) throw new apiError(400, 'Customer not found in shop');
    const entries = await CustomerLedger.find({customerId, shopId}).session(session);
    let debt = 0, credit = 0;
    for (const entry of entries) {
        const amount = signedLedgerMinor(entry);
        if (entry.balanceType === 'CREDIT') {
            if (!['CREDIT_ISSUED', 'CREDIT_REDEEMED', 'CREDIT_RESTORED'].includes(entry.description) ||
                entry.amountMinor === undefined || !entry.adjustmentId) throw new apiError(409, 'Credit ledger requires verified reconciliation');
            if (!amount || (entry.description === 'CREDIT_REDEEMED' ? amount > 0 : amount < 0)) throw new apiError(409, 'Credit ledger direction is inconsistent');
            credit += amount;
        } else {
            if (!['PURCHASE', 'CANCELLATION', 'PAYMENT', 'ADJUSTMENT'].includes(entry.description) ||
                (['PAYMENT', 'ADJUSTMENT'].includes(entry.description) && !entry.adjustmentId)) {
                throw new apiError(409, 'Debt ledger requires verified reconciliation');
            }
            debt += amount;
        }
        if (!Number.isSafeInteger(debt) || !Number.isSafeInteger(credit)) throw new apiError(409, 'Customer balances out of range');
    }
    if (debt !== moneyMinor(customer.remainingMoney) || credit !== (customer.storeCreditBalanceMinor ?? 0) || debt < 0 || credit < 0) {
        throw new apiError(409, 'Customer balance requires verified ledger reconciliation');
    }
    return customer;
}

export async function changeStoreCredit(customerId: any, order: any, deltaMinor: number,
    description: string, actor: any, adjustmentId: any, session: mongoose.ClientSession) {
    if (!deltaMinor) return;
    if (!Number.isSafeInteger(deltaMinor)) throw new apiError(400, 'Invalid credit movement');
    const customer = await checkedCustomer(customerId, actor.shopId, session);
    const next = (customer.storeCreditBalanceMinor ?? 0) + deltaMinor;
    if (next < 0) throw new apiError(409, 'Insufficient store credit');
    safeMinor(next);
    const filter: any = {_id: customer._id, shopId: actor.shopId};
    if (deltaMinor < 0) filter.storeCreditBalanceMinor = {$gte: -deltaMinor};
    const saved = await Customer.updateOne(filter, {$set: {storeCreditBalanceMinor: next}}, {session, runValidators: true});
    if (saved.modifiedCount !== 1) throw new apiError(409, 'Customer credit changed; retry the same request key');
    await CustomerLedger.create([{customerId, shopId: actor.shopId, referenceId: order._id, invoiceNo: order.invoiceNo,
        createdBy: actor._id, adjustmentId, balanceType: 'CREDIT', amountMinor: deltaMinor, amount: moneyMajor(deltaMinor), description}], {session});
}

export async function verifiedInvoiceFunding(order: any, session: mongoose.ClientSession) {
    const events = await InvoiceAdjustment.find({shopId: order.shopId, orderId: order._id}).sort({revisionAfter: 1}).session(session);
    const opening = order.originalSnapshot?.openingFunding;
    const openingCashMinor = opening?.openingCashMinor ?? moneyMinor(order.originalSnapshot?.paidAmount ?? order.paidAmount);
    const openingCreditMinor = opening?.openingCreditMinor ?? 0;
    let cashNetMinor = openingCashMinor, creditNetMinor = openingCreditMinor, revision = 0;
    let cashReceivedMinor = openingCashMinor, cashRefundedMinor = 0;
    let creditRedeemedMinor = openingCreditMinor, creditIssuedMinor = 0, creditRestoredMinor = 0;
    let expectedTotal = moneyMinor(order.originalSnapshot?.totalPrice ?? order.totalPrice);
    let expectedDue = moneyMinor(order.originalSnapshot?.amountDue ?? order.amountDue);
    for (const event of events) {
        for (const field of ['cashReceivedMinor', 'cashRefundMinor', 'creditIssuedMinor', 'creditRedeemedMinor', 'creditRestoredMinor'] as const) {
            safeMinor(event.financial[field] ?? 0);
        }
        if (event.kind === 'SALE') {
            if (event.financial.creditRedeemedMinor !== openingCreditMinor || event.financial.cashReceivedMinor !== openingCashMinor) {
                throw new apiError(409, 'Original payment history is inconsistent');
            }
            if (event.after.totalMinor !== expectedTotal || event.after.dueMinor !== expectedDue ||
                event.after.settledMinor !== openingCashMinor + openingCreditMinor) throw new apiError(409, 'Original sale settlement is inconsistent');
            continue;
        }
        cashReceivedMinor += event.financial.cashReceivedMinor;
        cashRefundedMinor += event.financial.cashRefundMinor;
        creditRedeemedMinor += event.financial.creditRedeemedMinor;
        creditIssuedMinor += event.financial.creditIssuedMinor;
        creditRestoredMinor += event.financial.creditRestoredMinor ?? 0;
        safeMinor(cashReceivedMinor); safeMinor(cashRefundedMinor); safeMinor(creditRedeemedMinor);
        safeMinor(creditIssuedMinor); safeMinor(creditRestoredMinor);
        if (event.revisionBefore !== revision || event.revisionAfter !== revision + 1) throw new apiError(409, 'Invoice revision history is incomplete');
        if (event.before.settledMinor !== cashNetMinor + creditNetMinor) throw new apiError(409, 'Invoice payment history is inconsistent');
        if (event.before.totalMinor !== expectedTotal || event.before.dueMinor !== expectedDue) throw new apiError(409, 'Invoice history baseline is inconsistent');
        cashNetMinor += event.financial.cashReceivedMinor - event.financial.cashRefundMinor - event.financial.creditIssuedMinor;
        creditNetMinor += event.financial.creditRedeemedMinor - (event.financial.creditRestoredMinor ?? 0);
        safeMinor(cashNetMinor); safeMinor(creditNetMinor);
        if (event.after.settledMinor !== cashNetMinor + creditNetMinor) throw new apiError(409, 'Invoice settlement history is inconsistent');
        if (event.after.totalMinor !== event.after.settledMinor + event.after.dueMinor ||
            event.before.totalMinor !== event.before.settledMinor + event.before.dueMinor ||
            event.financial.debtDeltaMinor !== event.after.dueMinor - event.before.dueMinor ||
            event.financial.salesDeltaMinor !== event.after.totalMinor - event.before.totalMinor) {
            throw new apiError(409, 'Invoice financial history is inconsistent');
        }
        revision++;
        expectedTotal = event.after.totalMinor;
        expectedDue = event.after.dueMinor;
    }
    if (revision !== (order.revision ?? 0) || expectedTotal !== moneyMinor(order.totalPrice) || expectedDue !== moneyMinor(order.amountDue) ||
        cashNetMinor + creditNetMinor !== moneyMinor(order.paidAmount) ||
        (order.settlementState && (order.settlementState.cashNetMinor !== cashNetMinor || order.settlementState.creditNetMinor !== creditNetMinor ||
            order.settlementState.openingCashMinor !== openingCashMinor || order.settlementState.openingCreditMinor !== openingCreditMinor))) {
        throw new apiError(409, 'Invoice funding requires verified reconciliation');
    }
    if (openingCreditMinor && !events.some(e => e.kind === 'SALE')) throw new apiError(409, 'Original credit payment history is missing');
    const entries = await CustomerLedger.find({shopId: order.shopId, referenceId: order._id}).session(session);
    for (const event of events) {
        const linked = entries.filter(e => String(e.adjustmentId) === String(event._id));
        for (const [description, expected, customerId] of [
            ['CREDIT_REDEEMED', -event.financial.creditRedeemedMinor, order.customerId],
            ['CREDIT_RESTORED', event.financial.creditRestoredMinor ?? 0, order.customerId],
            ['CREDIT_ISSUED', event.financial.creditIssuedMinor, event.creditRecipientId]
        ] as const) {
            const rows = linked.filter(e => e.balanceType === 'CREDIT' && e.description === description);
            if (rows.reduce((sum, e) => sum + signedLedgerMinor(e), 0) !== expected || rows.some(e => String(e.customerId) !== String(customerId))) {
                throw new apiError(409, 'Invoice credit history requires verified reconciliation');
            }
        }
        if (event.kind !== 'SALE' && linked.filter(e => e.balanceType !== 'CREDIT').reduce((sum, e) => sum + signedLedgerMinor(e), 0) !== event.financial.debtDeltaMinor) {
            throw new apiError(409, 'Invoice debt movements are inconsistent');
        }
    }
    if (entries.some(e => e.adjustmentId && !events.some(event => String(event._id) === String(e.adjustmentId)))) throw new apiError(409, 'Invoice ledger history is incomplete');
    const debtEntries = entries.filter(e => e.balanceType !== 'CREDIT');
    const debt = debtEntries.reduce((sum, e) => sum + signedLedgerMinor(e), 0);
    if (debt !== moneyMinor(order.amountDue) || (debt > 0 && !order.customerId) ||
        debtEntries.some(e => String(e.customerId) !== String(order.customerId))) throw new apiError(409, 'Invoice debt history requires verified reconciliation');
    const customer = order.customerId ? await checkedCustomer(order.customerId, order.shopId, session) : null;
    return {cashNetMinor, creditNetMinor, openingCashMinor, openingCreditMinor,
        cashReceivedMinor, cashRefundedMinor, creditRedeemedMinor, creditIssuedMinor, creditRestoredMinor,
        availableCreditMinor: customer?.storeCreditBalanceMinor ?? 0};
}

export async function calculateInvoiceSettlement(order: any, newTotalMinor: number, input: SettlementInput, actor: any,
    session: mongoose.ClientSession) {
    const funding = await verifiedInvoiceFunding(order, session);
    const result = financialSettlement(newTotalMinor, funding.cashNetMinor, funding.creditNetMinor, input);
    if (!order.customerId && result.dueMinor > 0) throw new apiError(400, 'Anonymous invoice must remain fully settled');
    if (result.creditRedeemedMinor && !order.customerId) throw new apiError(400, 'Credit redemption requires the original invoice customer');
    let recipientId = order.creditRecipientId;
    if (input.creditRecipientId) {
        if (typeof input.creditRecipientId !== 'string' || !mongoose.isValidObjectId(input.creditRecipientId) ||
            (order.customerId && String(order.customerId) !== input.creditRecipientId) ||
            (recipientId && String(recipientId) !== input.creditRecipientId)) throw new apiError(400, 'Original credit recipient cannot be changed');
        if (!result.creditIssuedMinor) throw new apiError(400, 'Anonymous recipient may be linked only to issue store credit');
        recipientId = input.creditRecipientId;
    }
    const issuanceRecipient = order.customerId ?? recipientId;
    if (result.creditIssuedMinor && !issuanceRecipient) throw new apiError(400, 'Store credit requires a same-shop recipient');
    if (result.creditRestoredMinor && !order.customerId) throw new apiError(409, 'Credit funding customer is missing');
    const debtDeltaMinor = result.dueMinor - moneyMinor(order.amountDue);
    if (result.creditRedeemedMinor) {
        const customer = await checkedCustomer(order.customerId, actor.shopId, session);
        if ((customer.storeCreditBalanceMinor ?? 0) < result.creditRedeemedMinor) throw new apiError(409, 'Insufficient store credit');
    }
    if (result.creditIssuedMinor) await checkedCustomer(issuanceRecipient, actor.shopId, session);
    return {...result, debtDeltaMinor, recipientId,
        settlementState: {cashNetMinor: result.cashNetMinor, creditNetMinor: result.creditNetMinor,
            openingCashMinor: funding.openingCashMinor, openingCreditMinor: funding.openingCreditMinor}};
}
export async function settleInvoice(order: any, newTotalMinor: number, input: SettlementInput, actor: any,
    adjustmentId: any, session: mongoose.ClientSession, kind: string) {
    const result = await calculateInvoiceSettlement(order, newTotalMinor, input, actor, session);
    const {debtDeltaMinor, recipientId} = result;
    const issuanceRecipient = order.customerId ?? recipientId;
    // Redeem first so credit created in this operation cannot fund its own payment.
    if (result.creditRedeemedMinor) await changeStoreCredit(order.customerId, order, -result.creditRedeemedMinor, 'CREDIT_REDEEMED', actor, adjustmentId, session);
    if (debtDeltaMinor) {
        const customer = await checkedCustomer(order.customerId, actor.shopId, session);
        const nextDebt = safeMinor(moneyMinor(customer.remainingMoney) + debtDeltaMinor);
        const changed = await Customer.updateOne({_id: customer._id, shopId: actor.shopId, remainingMoney: customer.remainingMoney},
            {$set: {remainingMoney: moneyMajor(nextDebt)}}, {session});
        if (changed.modifiedCount !== 1) throw new apiError(409, 'Customer debt changed; retry the same request key');
        await CustomerLedger.create([{customerId: customer._id, shopId: actor.shopId, referenceId: order._id, invoiceNo: order.invoiceNo,
            createdBy: actor._id, adjustmentId, balanceType: 'DEBT', amountMinor: debtDeltaMinor, amount: moneyMajor(debtDeltaMinor),
            description: kind === 'PAYMENT' ? 'PAYMENT' : kind === 'CANCELLATION' ? 'CANCELLATION' : 'ADJUSTMENT'}], {session});
    }
    if (result.creditRestoredMinor) await changeStoreCredit(order.customerId, order, result.creditRestoredMinor, 'CREDIT_RESTORED', actor, adjustmentId, session);
    if (result.creditIssuedMinor) await changeStoreCredit(issuanceRecipient, order, result.creditIssuedMinor, 'CREDIT_ISSUED', actor, adjustmentId, session);
    return result;
}
