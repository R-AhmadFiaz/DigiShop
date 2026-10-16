import {apiError} from './apiError.js';
import {safeMinor} from './invoiceAccounting.js';

export const accountKinds = {
    CASH: 'DEBIT', BANK: 'DEBIT', CUSTOMER_RECEIVABLE: 'DEBIT',
    SUPPLIER_PAYABLE: 'CREDIT', STORE_CREDIT_LIABILITY: 'CREDIT',
    INVENTORY: 'DEBIT', REVENUE: 'CREDIT', EXPENSE: 'DEBIT', OPENING_EQUITY: 'CREDIT',
    SETTLEMENT_CLEARING: 'CREDIT', PURCHASES_CLEARING: 'DEBIT'
} as const;
export type AccountKind = keyof typeof accountKinds;
export type Posting = {accountId: string, debitMinor: number, creditMinor: number};

export function balancedPostings(input: Posting[]): Posting[] {
    if (!Array.isArray(input) || input.length < 2 || input.length > 100) throw new apiError(400, 'Provide between 2 and 100 postings');
    const seen = new Set<string>();
    let debit = 0n, credit = 0n;
    const rows = input.map(row => {
        if (!row || typeof row.accountId !== 'string' || !/^[a-f\d]{24}$/i.test(row.accountId)) throw new apiError(400, 'Valid account required');
        const accountId = row.accountId.toLowerCase();
        if (seen.has(accountId)) throw new apiError(400, 'Combine postings for the same account');
        seen.add(accountId);
        safeMinor(row.debitMinor); safeMinor(row.creditMinor);
        if ((row.debitMinor > 0) === (row.creditMinor > 0)) throw new apiError(400, 'Each posting needs one positive debit or credit');
        debit += BigInt(row.debitMinor); credit += BigInt(row.creditMinor);
        return {accountId, debitMinor: row.debitMinor, creditMinor: row.creditMinor};
    });
    if (debit !== credit || debit > BigInt(Number.MAX_SAFE_INTEGER)) throw new apiError(400, 'Postings must balance within the safe money range');
    return rows.sort((a, b) => a.accountId.localeCompare(b.accountId));
}

export function signedBalance(debit: bigint, credit: bigint, side: 'DEBIT' | 'CREDIT'): number {
    const result = side === 'DEBIT' ? debit - credit : credit - debit;
    if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < -BigInt(Number.MAX_SAFE_INTEGER)) throw new apiError(409, 'Account balance exceeds safe money range');
    return Number(result);
}
