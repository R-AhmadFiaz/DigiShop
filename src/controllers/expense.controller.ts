import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {Expense, ExpenseCategory} from '../models/expense.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {businessTransaction, createFinancialAccount, postExpenseMovement, selectInvoicePaymentAccounts} from '../utils/businessAccounts.js';
import {invoiceAccountingEnabled} from '../utils/invoiceAccountingIntegration.js';
import {asyncHandler} from '../utils/asyncHandler.js';
import {apiError} from '../utils/apiError.js';
import {apiResponse} from '../utils/apiResponse.js';

function text(value: unknown, max: number, optional = false) {
    if (optional && (value === undefined || value === '')) return '';
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new apiError(400, 'Provide valid expense details');
    return value.trim();
}
function id(value: unknown) {
    if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new apiError(400, 'Valid record required');
    return value.toLowerCase();
}
function date(value: unknown) {
    if (typeof value !== 'string') throw new apiError(400, 'Valid expense timestamp required');
    const result = new Date(value);
    if (!Number.isFinite(+result) || result.toISOString() !== value || +result > Date.now()) throw new apiError(400, 'Valid non-future UTC timestamp required');
    return result;
}
function pageNumber(value: unknown, fallback: number, max: number) {
    if (value === undefined) return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(+value) || +value < 1 || +value > max) throw new apiError(400, 'Invalid pagination');
    return +value;
}
function enabled() { if (!invoiceAccountingEnabled()) throw new apiError(409, 'Accounting unavailable; expenses require prepared accounting'); }

export const expenses = (operation: string) => asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const actor = req.user, body = req.body ?? {};
    const data = await businessTransaction(actor, async session => {
        if (operation === 'setup') {
            const active = invoiceAccountingEnabled();
            return {available: active, message: active ? 'Select a prepared cash/bank account. Posting remains subject to server checks.' : 'Expense posting unavailable. Accounting is disabled; no paid expenses can be recorded.', accounts: active ? await selectInvoicePaymentAccounts(actor, session) : []};
        }
        if (operation === 'categories') return {entries: await ExpenseCategory.find({shopId: actor.shopId}).sort({name: 1, _id: 1}).session(session).lean()};
        if (operation === 'createCategory') {
            const name = text(body.name, 80), key = name.toLowerCase();
            const prior = await ExpenseCategory.findOne({shopId: actor.shopId, key}).session(session);
            if (prior) return prior;
            if (await ExpenseCategory.countDocuments({shopId:actor.shopId}).session(session) >= 200) throw new apiError(409, 'Expense category limit reached');
            const [row] = await ExpenseCategory.create([{shopId: actor.shopId, name, key}], {session}); return row!;
        }
        enabled();
        if (operation === 'create' || operation === 'reverse') {
            const requestKey = text(body.requestKey, 100);
            if (!/^[\w-]{8,100}$/.test(requestKey)) throw new apiError(400, 'Valid idempotency key required');
            const occurredAt = date(body.occurredAt), description=operation==='create'&&(body.description===undefined||body.description===null||(typeof body.description==='string'&&body.description.length<=300&&!body.description.trim()))?('Shop expense'):text(body.description,300), reference = text(body.reference, 100, true);
            const kind = operation === 'reverse' ? 'EXPENSE_REVERSAL' : 'EXPENSE';
            let values: any = {kind, occurredAt, description, reference};
            if (operation === 'reverse') {
                if (body.confirmation !== 'CONFIRM EXPENSE REVERSAL') throw new apiError(400, 'Confirm that the original funds were actually restored');
                const original = await Expense.findOne({_id: id(req.params.id), shopId: actor.shopId, kind: 'EXPENSE'}).session(session);
                if (!original) throw new apiError(404, 'Expense not found in shop');
                if (occurredAt < original.occurredAt) throw new apiError(400, 'Reversal cannot predate expense');
                const journal = await BusinessTransaction.findOne({shopId:actor.shopId,'source.kind':'EXPENSE','source.referenceId':original._id}).session(session);
                const cash = journal?.postings.find(p=>String(p.accountId)===String(original.accountId));
                const cost = journal?.postings.find(p=>String(p.accountId)===String(original.expenseAccountId));
                if(!journal || journal.postings.length!==2 || cash?.creditMinor!==original.amountMinor || cash.debitMinor!==0 || cost?.debitMinor!==original.amountMinor || cost.creditMinor!==0 || +journal.occurredAt!==+original.occurredAt) throw new apiError(409,'Original expense journal requires reconciliation');
                values = {...values, reversalOf: original._id, categoryId: original.categoryId, categoryName: original.categoryName, accountId: original.accountId, accountName: original.accountName, accountKind: original.accountKind, expenseAccountId: original.expenseAccountId, amountMinor: original.amountMinor};
            } else {
                if (!Number.isSafeInteger(body.amountMinor) || body.amountMinor <= 0) throw new apiError(400, 'Enter a positive amount in paisa');
                const category = await ExpenseCategory.findOne({_id: id(body.categoryId), shopId: actor.shopId}).session(session);
                const account = await FinancialAccount.findOne({_id: id(body.accountId), shopId: actor.shopId, kind: {$in: ['CASH','BANK']}, isActive: true}).session(session);
                if (!category || !account) throw new apiError(404, 'Category or payment account not found in shop');
                values = {...values, categoryId: category._id, categoryName: category.name, accountId: account._id, accountName: account.name, accountKind: account.kind, amountMinor: body.amountMinor};
            }
            const requestHash = createHash('sha256').update(JSON.stringify({...values, actor: String(actor._id)})).digest('hex');
            const prior = await Expense.findOne({shopId: actor.shopId, requestKey}).session(session);
            if (prior) {
                // expenseAccountId is server-selected, not part of the create request identity.
                if (prior.requestHash !== requestHash) throw new apiError(409, 'Request key already used for different expense details');
                return {expense: prior, replayed: true};
            }
            if (operation === 'reverse' && await Expense.exists({shopId: actor.shopId, reversalOf: values.reversalOf}).session(session)) throw new apiError(409, 'Expense already reversed');
            if (operation === 'create') {
                let account = await FinancialAccount.findOne({shopId: actor.shopId, code: 'OPERATING_EXPENSE'}).session(session);
                if (!account) account = await createFinancialAccount(actor, {code: 'OPERATING_EXPENSE', name: 'Operating expenses', kind: 'EXPENSE'}, session);
                if (account.kind !== 'EXPENSE' || account.authority !== 'JOURNAL' || !account.isActive) throw new apiError(409, 'Dedicated expense account requires review');
                values.expenseAccountId = account._id;
            }
            const [expense] = await Expense.create([{...values, requestKey, requestHash, shopId: actor.shopId, createdBy: actor._id, createdByName: actor.username, createdByRole: 'OWNER'}], {session});
            const journal = await postExpenseMovement(actor, expense, session);
            return {expense, journalId: journal._id, replayed: false};
        }
        if (operation === 'detail') {
            const expense = await Expense.findOne({_id: id(req.params.id), shopId: actor.shopId}).session(session).lean();
            if (!expense) throw new apiError(404, 'Expense not found in shop');
            const reversal = await Expense.findOne({shopId: actor.shopId, reversalOf: expense._id}).session(session).lean();
            const journal = await BusinessTransaction.findOne({shopId: actor.shopId, 'source.kind': expense.kind, 'source.referenceId': expense._id}).session(session).lean();
            return {expense, reversal, journal};
        }
        const page = pageNumber(req.query.page, 1, 100000), limit = pageNumber(req.query.limit, 20, 100);
        const filter: any = {shopId: new mongoose.Types.ObjectId(String(actor.shopId))};
        if (req.query.q !== undefined) {
            const term = text(req.query.q, 100, true).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            filter.$or = ['description','reference','categoryName','accountName'].map(key => ({[key]: new RegExp(term, 'i')}));
        }
        if (req.query.categoryId) filter.categoryId = new mongoose.Types.ObjectId(id(req.query.categoryId));
        if (req.query.month !== undefined) {
            if (typeof req.query.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)) throw new apiError(400, 'Valid month required');
            // Display/reporting month follows the fixed Pakistan timezone (UTC+05:00).
            const start = new Date(req.query.month + '-01T00:00:00+05:00');
            const [year, month] = req.query.month.split('-').map(Number);
            filter.occurredAt = {$gte: start, $lt: new Date(Date.UTC(year!, month!, 1) - 5 * 3600000)};
        }
        const count = await Expense.countDocuments(filter).session(session);
        const entries = await Expense.find(filter).sort({occurredAt: -1, _id: -1}).skip((page - 1) * limit).limit(limit).session(session).lean();
        if (operation === 'reconcile') {
            const results = [];
            for (const row of entries) {
                const journal = await BusinessTransaction.findOne({shopId: actor.shopId, 'source.kind':row.kind, 'source.referenceId':row._id}).session(session);
                const reverse = row.kind === 'EXPENSE_REVERSAL';
                const cash = journal?.postings.find(p => String(p.accountId) === String(row.accountId));
                const cost = journal?.postings.find(p => String(p.accountId) === String(row.expenseAccountId));
                const valid = journal && journal.postings.length === 2 && +journal.occurredAt === +row.occurredAt && String(journal.createdBy) === String(row.createdBy) && cash?.debitMinor === (reverse?row.amountMinor:0) && cash?.creditMinor === (reverse?0:row.amountMinor) && cost?.debitMinor === (reverse?0:row.amountMinor) && cost?.creditMinor === (reverse?row.amountMinor:0);
                results.push({expenseId:row._id, issues:valid?[]:['MISSING_OR_MISMATCHED_EXPENSE_JOURNAL']});
            }
            const orphaned = await BusinessTransaction.aggregate([{$match:{shopId:filter.shopId,'source.kind':{$in:['EXPENSE','EXPENSE_REVERSAL']}}},{$lookup:{from:Expense.collection.name,let:{id:'$source.referenceId',shop:'$shopId',kind:'$source.kind'},pipeline:[{$match:{$expr:{$and:[{$eq:['$_id','$$id']},{$eq:['$shopId','$$shop']},{$eq:['$kind','$$kind']}]}}}],as:'event'}},{$match:{'event.0':{$exists:false}}},{$count:'count'}]).session(session);
            return {entries:results,orphanedJournalCount:orphaned[0]?.count??0,pagination:{currentPage:page,limit,recordCount:count,totalPages:Math.ceil(count/limit)}};
        }
        const totals = await Expense.aggregate([{$match: filter}, {$group: {_id: '$categoryId', category: {$first: '$categoryName'}, netMinor: {$sum: {$cond: [{$eq: ['$kind','EXPENSE']}, {$toDecimal: '$amountMinor'}, {$multiply: [{$toDecimal: '$amountMinor'}, -1]}]}}}}]).session(session);
        let total = 0n;
        const breakdown = totals.map(row => {const value = BigInt(row.netMinor.toString()); total += value; if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) throw new apiError(409, 'Expense totals exceed safe money range'); return {categoryId: row._id, category: row.category, netMinor: Number(value)};});
        if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < -BigInt(Number.MAX_SAFE_INTEGER)) throw new apiError(409, 'Expense totals exceed safe money range');
        return {entries, totalMinor: Number(total), breakdown, pagination: {currentPage: page, limit, recordCount: count, totalPages: Math.ceil(count / limit)}};
    }, ['create','reverse','createCategory'].includes(operation));
    res.json(new apiResponse(200, data, 'Expense request completed'));
});
