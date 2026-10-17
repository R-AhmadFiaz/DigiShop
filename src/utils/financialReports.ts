import {apiError} from './apiError.js';
import {moneyMinor} from './invoiceAccounting.js';

export function reportMinor(value: bigint): number {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new apiError(409, 'Report exceeds safe monetary range');
    return Number(value);
}
export function reportRange(from: unknown, to: unknown) {
    const parse = (value: unknown) => {
        if (typeof value !== 'string') throw new apiError(400, 'Select a valid UTC date range');
        const date = new Date(value);
        if (!Number.isFinite(+date) || date.toISOString() !== value) throw new apiError(400, 'Select a valid UTC date range');
        return date;
    };
    const start = parse(from), end = parse(to);
    if (end <= start || +end - +start > 366 * 86400000) throw new apiError(400, 'Select a date range of up to 366 days');
    return {start, end};
}
// Original invoices and dated value changes, never payment receipts, are revenue.
// Accept plain evidence to allow independent invariant tests without a database.
export function reportSales(originals: any[], events: any[], legacyCancellations: any[], datedCancellationIds: Set<string>) {
    let gross = 0n, discounts = 0n, added = 0n, returned = 0n, discountChanges = 0n, netChanges = 0n, excluded = 0;
    const snapshot = (order: any) => {
        if (!order.originalSnapshot && (order.revision ?? 0) > 0) throw new apiError(409, 'Original invoice snapshot missing; sales require reconciliation');
        const row = order.originalSnapshot ?? order;
        const subtotal = moneyMinor(row.subtotal), discount = moneyMinor(row.discountAmount), total = moneyMinor(row.totalPrice);
        if (subtotal - discount !== total) throw new apiError(409, 'Invoice totals require reconciliation');
        return {subtotal: BigInt(subtotal), discount: BigInt(discount), total: BigInt(total)};
    };
    for (const order of originals) {
        if (order.status === 'CANCELLED' && !(order.cancellationMode === 'LEGACY' && order.cancelledAt) && !datedCancellationIds.has(String(order._id))) { excluded++; continue; }
        const s = snapshot(order); gross += s.subtotal; discounts += s.discount;
    }
    for (const event of events) {
        let delta = 0n;
        for (const movement of event.movements) {
            if (!Number.isSafeInteger(movement.quantity) || movement.quantity < 1 || !Number.isSafeInteger(movement.unitPriceMinor) || movement.unitPriceMinor < 0) throw new apiError(409, 'Sales movements require reconciliation');
            const value = BigInt(movement.quantity) * BigInt(movement.unitPriceMinor);
            if (movement.kind === 'RETURN') { returned += value; delta -= value; }
            else if (movement.kind === 'ADD') { added += value; delta += value; }
            else throw new apiError(409, 'Unknown sales movement');
        }
        for (const value of [event.before.discountMinor, event.after.discountMinor, event.financial.salesDeltaMinor]) if (!Number.isSafeInteger(value)) throw new apiError(409, 'Sales amounts require reconciliation');
        const change = BigInt(event.after.discountMinor) - BigInt(event.before.discountMinor);
        if (delta - change !== BigInt(event.financial.salesDeltaMinor)) throw new apiError(409, 'Sales movements and financial totals disagree');
        discountChanges += change; netChanges += BigInt(event.financial.salesDeltaMinor);
    }
    for (const order of legacyCancellations) { const s = snapshot(order); returned += s.subtotal; discountChanges -= s.discount; netChanges -= s.total; }
    return {status: excluded ? 'INCOMPLETE' : 'RECORDED', originalGrossMinor: reportMinor(gross), originalDiscountsMinor: reportMinor(discounts), additionsMinor: reportMinor(added), returnsMinor: reportMinor(returned), discountChangesMinor: reportMinor(discountChanges), netDiscountsMinor: reportMinor(discounts + discountChanges), revenueMinor: reportMinor(gross - discounts + netChanges), excludedUntimedCancellations: excluded, invoiceCount: originals.length - excluded, adjustmentCount: events.length + legacyCancellations.length};
}
