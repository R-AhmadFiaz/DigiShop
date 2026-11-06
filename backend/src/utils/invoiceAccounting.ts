import {apiError} from './apiError.js';

// Existing PKR amounts must be representable in paisa. Allow binary floating-point
// noise, but never silently round an ambiguous legacy price/total to a new value.
export function moneyMinor(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new apiError(409, 'Invoice money requires verified reconciliation');
    }
    const rounded = Math.round(value * 100);
    if (!Number.isSafeInteger(rounded) || Math.abs(value * 100 - rounded) > 0.000001) {
        throw new apiError(409, 'Invoice money has unsupported precision; reconciliation required');
    }
    return rounded;
}
export function safeMinor(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0) throw new apiError(400, 'Money is out of range');
    return value;
}
// Existing amount fields use PKR Numbers. Reject values that cannot round-trip
// back to the exact signed paisa value instead of losing a cent on serialization.
export function moneyMajor(minor: number): number {
    if (!Number.isSafeInteger(minor)) throw new apiError(400, 'Money is out of range');
    const major = minor / 100;
    if (Math.sign(major) * moneyMinor(Math.abs(major)) !== minor) throw new apiError(409, 'Money cannot be represented safely in existing fields');
    return major;
}
export function invoiceTotals(items: {quantity: number, unitPrice: number}[], type: string, value: number) {
    let subtotalMinor = 0;
    for (const item of items) {
        if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new apiError(400, 'Whole positive quantities required');
        subtotalMinor = safeMinor(subtotalMinor + safeMinor(moneyMinor(item.unitPrice) * item.quantity));
    }
    let discountMinor = 0;
    if (type === 'PERCENTAGE') {
        const basisPoints = moneyMinor(value);
        if (basisPoints > 10000) throw new apiError(400, 'Percentage must be between zero and 100');
        // BigInt prevents overflow and rounds half-up once at invoice level.
        discountMinor = Number((BigInt(subtotalMinor) * BigInt(basisPoints) + 5000n) / 10000n);
    } else if (type === 'FIXED') discountMinor = moneyMinor(value);
    else if (type !== 'NONE' || value !== 0) throw new apiError(400, 'Invalid discount');
    if (discountMinor > subtotalMinor) throw new apiError(400, 'Fixed discount cannot exceed subtotal');
    return {subtotalMinor, discountMinor, totalMinor: subtotalMinor - discountMinor};
}

// Debt is reduced first; only settled money exceeding the new total is refundable.
export function settlementPlan(totalMinor: number, settledMinor: number, creditFundedMinor = 0) {
    safeMinor(totalMinor); safeMinor(settledMinor); safeMinor(creditFundedMinor);
    if (creditFundedMinor > settledMinor) throw new apiError(409, 'Credit funding is inconsistent');
    const refundMinor = Math.max(0, settledMinor - totalMinor);
    const creditRestoreMinor = Math.min(refundMinor, creditFundedMinor);
    const netSettledMinor = settledMinor - refundMinor;
    const dueMinor = totalMinor - netSettledMinor;
    return {netSettledMinor, dueMinor, refundMinor, creditRestoreMinor,
        cashRefundMaximumMinor: refundMinor - creditRestoreMinor};
}

export type SettlementInput = {cashReceivedAmount?: number, creditRedeemedAmount?: number,
    cashRefundAmount?: number, creditIssueAmount?: number, creditRecipientId?: string};
export function financialSettlement(totalMinor: number, cashNetMinor: number, creditNetMinor: number, input: SettlementInput) {
    const priorSettled = safeMinor(cashNetMinor + creditNetMinor);
    const reduction = settlementPlan(totalMinor, priorSettled, creditNetMinor);
    const cashReceivedMinor = moneyMinor(input.cashReceivedAmount === undefined ? 0 : input.cashReceivedAmount);
    const creditRedeemedMinor = moneyMinor(input.creditRedeemedAmount === undefined ? 0 : input.creditRedeemedAmount);
    const cashRefundMinor = moneyMinor(input.cashRefundAmount === undefined ? 0 : input.cashRefundAmount);
    const creditIssuedMinor = moneyMinor(input.creditIssueAmount === undefined ? 0 : input.creditIssueAmount);
    if (safeMinor(cashReceivedMinor + creditRedeemedMinor) > reduction.dueMinor) throw new apiError(400, 'Payment exceeds outstanding invoice amount');
    if (safeMinor(cashRefundMinor + creditIssuedMinor) !== reduction.cashRefundMaximumMinor) {
        throw new apiError(400, 'Refund allocation must exactly match refundable cash-funded amount');
    }
    const nextCash = safeMinor(cashNetMinor + cashReceivedMinor - cashRefundMinor - creditIssuedMinor);
    const nextCredit = safeMinor(creditNetMinor + creditRedeemedMinor - reduction.creditRestoreMinor);
    const settledMinor = safeMinor(nextCash + nextCredit);
    const dueMinor = totalMinor - settledMinor;
    safeMinor(dueMinor);
    return {cashNetMinor: nextCash, creditNetMinor: nextCredit, settledMinor, dueMinor,
        cashReceivedMinor, creditRedeemedMinor, cashRefundMinor, creditIssuedMinor, creditRestoredMinor: reduction.creditRestoreMinor};
}
