import mongoose from 'mongoose';
import {Shop} from '../models/shop.model.js';
import {Order} from '../models/order.model.js';
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {Product} from '../models/product.model.js';
import {Customer} from '../models/customer.model.js';
import {BusinessEntity} from '../models/businessEntity.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {Expense} from '../models/expense.model.js';
import {BusinessSetup} from '../models/businessSetup.model.js';
import {GoodsReceipt} from '../models/goodsReceipt.model.js';
import {StockLog} from '../models/stockLog.model.js';
import * as accounts from '../utils/businessAccounts.js';
import {invoiceAccountingEnabled} from '../utils/invoiceAccountingIntegration.js';
import {moneyMinor} from '../utils/invoiceAccounting.js';
import {reportMinor, reportRange, reportSales} from '../utils/financialReports.js';
import {position} from './capital.controller.js';
import {asyncHandler} from '../utils/asyncHandler.js';
import {apiError} from '../utils/apiError.js';
import {apiResponse} from '../utils/apiResponse.js';
import {accountingMode} from '../utils/accountingActivation.js';

// Bounded evidence scans fail closed, never present a partial page as a total.
async function bounded(query: any, session: mongoose.ClientSession, limit = 1000): Promise<any[]> {
    const rows = await query.limit(limit + 1).session(session).maxTimeMS(5000).lean();
    if (rows.length > limit) throw new apiError(409, 'Report evidence limit reached; use a shorter date range or existing paginated statements');
    return rows;
}
async function section(work: () => Promise<any>) {
    try { return await work(); } catch (error) {
        if (!(error instanceof apiError) || error.statusCode !== 409) throw error;
        return {status: 'UNAVAILABLE', message: error.message};
    }
}
export const financialReports = asyncHandler(async (req, res) => {
    const range = reportRange(req.query.from, req.query.to), actor = req.user;
    res.setHeader('Cache-Control', 'no-store');
    const data = await accounts.businessTransaction(actor, async session => {
        const shopId = actor.shopId, dates = {$gte: range.start, $lt: range.end};
        const shop=await Shop.findById(shopId).session(session).lean();
        const cleanCutoff=shop?.accounting?.strategy==='CLEAN_START'&&shop.accounting.activatedAt?shop.accounting.cutoffAt:null;
        const salesDates=cleanCutoff?{$gte:new Date(Math.max(+range.start,+cleanCutoff+1)),$lt:range.end}:dates;
        const enabled = invoiceAccountingEnabled();
        const postedStatus = accountingMode()==='INTEGRATION_TEST'?'POSTED_TEST':'POSTED';
        const requireAccounting = () => { if (!enabled) throw new apiError(409, 'Activated, prepared accounting is required; financial balances are unavailable'); };
        const sales = await section(async () => {
            const originals = await bounded(Order.find({shopId, type: 'INVOICE', status: {$in: ['PENDING', 'DELIVERED', 'CANCELLED']}, createdAt: salesDates}), session);
            const events = await bounded(InvoiceAdjustment.find({shopId, kind: {$in: ['ADJUSTMENT', 'CANCELLATION']}, occurredAt: salesDates}), session);
            const cancellations = await bounded(InvoiceAdjustment.find({shopId, kind: 'CANCELLATION', orderId: {$in: originals.map(r => r._id)}}).select('orderId'), session);
            const ids = events.map(e => e.orderId);
            const linked = await bounded(Order.find({shopId, type: 'INVOICE', _id: {$in: ids}}).select('_id'), session);
            if (events.some(e => !linked.some(o => String(o._id) === String(e.orderId)))) throw new apiError(409, 'Unlinked sales events require reconciliation');
            const legacy = await bounded(Order.find({shopId, type: 'INVOICE', status: 'CANCELLED', cancellationMode: 'LEGACY', cancelledAt: salesDates}), session);
            return reportSales(originals, events, legacy, new Set(cancellations.map(e => String(e.orderId))));
        });
        if(cleanCutoff){sales.financialStartAt=cleanCutoff;sales.coverageMessage='Clean-start financial sales exclude invoices at or before the opening cutoff. Original Sales and AI histories remain unchanged and may include demo activity.';}
        const expenses = await section(async () => {
            requireAccounting();
            await accounts.selectInvoicePaymentAccounts(actor, session);
            const rows = await bounded(Expense.find({shopId, occurredAt: dates}), session);
            const journals = await bounded(BusinessTransaction.find({shopId, 'source.kind': {$in: ['EXPENSE', 'EXPENSE_REVERSAL']}, occurredAt: dates}), session);
            if (journals.length !== rows.length) throw new apiError(409, 'Expense journals require reconciliation');
            const categories = new Map<string, {name: string, total: bigint}>(); let spent = 0n, reversed = 0n;
            for (const row of rows) {
                const journal = journals.find(j => String(j.source.referenceId) === String(row._id) && j.source.kind === row.kind);
                const reverse = row.kind === 'EXPENSE_REVERSAL';
                if (!journal || +journal.occurredAt !== +row.occurredAt || journal.postings.length !== 2 || !journal.postings.some((p: any) => String(p.accountId) === String(row.accountId) && p.debitMinor === (reverse ? row.amountMinor : 0) && p.creditMinor === (reverse ? 0 : row.amountMinor)) || !journal.postings.some((p: any) => String(p.accountId) === String(row.expenseAccountId) && p.debitMinor === (reverse ? 0 : row.amountMinor) && p.creditMinor === (reverse ? row.amountMinor : 0))) throw new apiError(409, 'Expense source and postings disagree');
                const value = BigInt(row.amountMinor); if (reverse) reversed += value; else spent += value;
                const key = String(row.categoryId), category = categories.get(key) ?? {name: row.categoryName, total: 0n}; category.total += reverse ? -value : value; categories.set(key, category);
            }
            return {status: postedStatus, spentMinor: reportMinor(spent), reversedMinor: reportMinor(reversed), netMinor: reportMinor(spent - reversed), categories: [...categories].map(([id, c]) => ({id, name: c.name, totalMinor: reportMinor(c.total)}))};
        });
        const cashBank = await section(async () => {
            requireAccounting();
            const rows = await bounded(FinancialAccount.find({shopId, kind: {$in: ['CASH', 'BANK']}}).sort({name: 1, _id: 1}), session, 100);
            const entries = [];
            for (const row of rows) {
                const result = await section(async () => {
                    const clearing = row.cashCutoverId && await FinancialAccount.findOne({_id: row.cashCutoverId, shopId, kind: 'SETTLEMENT_CLEARING'}).session(session);
                    if (!clearing?.cashIntegration || clearing.cashIntegration.state !== 'PREPARED' || clearing.cashIntegration.cutoffAt > new Date() || !clearing.cashIntegration.accountIds.some((id: any) => String(id) === String(row._id))) throw new apiError(409, 'Confirmed cash/bank coverage is unavailable');
                    const current = await accounts.getAccountBalance(actor, String(row._id), session);
                    // A date-only through-today filter ends tomorrow. Statements must
                    // use a non-future boundary; future movements cannot be reported.
                    const end = new Date(Math.min(+range.end, Date.now()));
                    if (range.start < clearing.cashIntegration.cutoffAt || range.start >= end) return {status: postedStatus, rangeAvailable: false, currentBalanceMinor: current.balanceMinor, openingMinor: null, closingMinor: null, netMovementMinor: null, transactions: [], message: 'Selected dates are before confirmed coverage or in the future; range balances unavailable.'};
                    const statement = await accounts.getAccountStatement(actor, {accountId: String(row._id), from: range.start.toISOString(), to: end.toISOString(), limit: 5}, session);
                    return {status: postedStatus, rangeAvailable: true, currentBalanceMinor: statement.balanceMinor, openingMinor: statement.rangeOpeningBalanceMinor, closingMinor: statement.rangeClosingBalanceMinor, netMovementMinor: statement.rangeNetChangeMinor, transactions: statement.transactions};
                });
                entries.push({id: row._id, name: row.name, kind: row.kind, active: row.isActive, ...result});
            }
            return {status: postedStatus, entries};
        });
        const customers = await section(async () => {
            const rows = await bounded(Customer.find({shopId}).sort({name: 1, _id: 1}), session, 500);
            let debt = 0n, credit = 0n; const entries = [];
            for (const row of rows) {
                const state = await accounts.reconcileBusinessCustomer(actor, String(row._id), session);
                debt += BigInt(state.debtMinor); credit += BigInt(state.storeCreditMinor);
                entries.push({id: row._id, name: row.name, ...state});
            }
            return {status: entries.every(e => e.reconciled) ? 'RECONCILED' : 'PROVISIONAL', debtMinor: reportMinor(debt), storeCreditMinor: reportMinor(credit), entries};
        });
        const suppliers = await section(async () => {
            requireAccounting(); const rows = await bounded(BusinessEntity.find({shopId, roles: 'SUPPLIER'}).sort({name: 1, _id: 1}), session, 100);
            let total = 0n, credit = 0n; const entries = [];
            for (const row of rows) {
                const state = await section(async () => { const s = await accounts.requireSupplierPayable(actor, String(row._id), session); if (s.balanceMinor === null || s.creditMinor === null) throw new apiError(409, 'Supplier balance unavailable'); total += BigInt(s.balanceMinor); credit += BigInt(s.creditMinor); return {status: postedStatus, balanceMinor: s.balanceMinor, creditMinor: s.creditMinor}; });
                entries.push({id: row._id, name: row.name, ...state});
            }
            const complete = entries.every(r => r.status === postedStatus);
            return {status: complete ? postedStatus : 'INCOMPLETE', totalMinor: complete ? reportMinor(total) : null, creditMinor: complete ? reportMinor(credit) : null, entries};
        });
        const capital = await section(async () => {
            requireAccounting(); await accounts.selectInvoicePaymentAccounts(actor, session);
            const rows = await bounded(BusinessEntity.find({shopId, roles: 'PARTNER'}).sort({name: 1, _id: 1}), session, 100);
            const entries = []; for (const row of rows) entries.push({id: row._id, name: row.name, ...await position(shopId, String(row._id), session)});
            return {status: postedStatus, ...await position(shopId, undefined, session), entries};
        });
        const inventory = await section(async () => {
            const rows = await bounded(Product.find({shopId}).select('name unit stockQuantity costPrice').sort({name: 1, _id: 1}), session);
            let value = 0n; const entries = rows.map(row => {
                if (!Number.isSafeInteger(row.stockQuantity) || row.stockQuantity < 0) throw new apiError(409, 'Stock quantities require reconciliation');
                const estimate = BigInt(row.stockQuantity) * BigInt(moneyMinor(row.costPrice)); value += estimate;
                return {id: row._id, name: row.name, unit: row.unit, quantity: row.stockQuantity, referenceValueMinor: reportMinor(estimate)};
            });
            return {status: 'PROVISIONAL', referenceValueMinor: reportMinor(value), entries, message: 'Current quantities multiplied by current product costs: reference estimate only, not historical valuation or cost of goods sold.'};
        });
        const setup = await BusinessSetup.findOne({shopId, state: 'CONFIRMED'}).select('input.cutoffAt review.evidence.totals').session(session).lean();
        const valuationEvidence={invoicesInRange:await Order.countDocuments({shopId,type:'INVOICE',createdAt:dates}).session(session),
            receiptCostRecordsInRange:await GoodsReceipt.countDocuments({shopId,occurredAt:dates}).session(session),
            quantityOnlyStockRecordsInRange:await StockLog.countDocuments({shopId,createdAt:dates}).session(session),
            costAtSaleSnapshots:false,continuousCostedStockLedger:false};
        return {currency: 'PKR', asOf: new Date(), range: {from: range.start, to: range.end, convention: 'UTC; start inclusive, end exclusive'}, coverage: 'Posted accounting covers confirmed openings and supported posted events; unposted historical activity is excluded. Date filters apply to sales, expenses and cash statements. Debt, capital and inventory are current snapshots.', sales, expenses, cashBank, customers, suppliers, capital, inventory, opening: setup ? {status: 'HISTORICAL', cutoffAt: (setup.input as any)?.cutoffAt, totals: (setup.review as any)?.evidence?.totals} : null, profit: {status: 'UNAVAILABLE', evidence:valuationEvidence, message: 'Sales do not snapshot cost at sale. Opening stock, manual stock changes, purchase costs and damaged returns do not form a complete costed inventory ledger. Historical cost of goods sold and profit cannot be calculated reliably.'}};
    });
    res.status(200).json(new apiResponse(200, data, 'Financial reports'));
});
