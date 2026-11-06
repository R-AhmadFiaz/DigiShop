import mongoose from 'mongoose';
import {asyncHandler} from '../utils/asyncHandler.js';
import {apiError} from '../utils/apiError.js';
import {apiResponse} from '../utils/apiResponse.js';
import * as accounts from '../utils/businessAccounts.js';
import {invoiceAccountingEnabled} from '../utils/invoiceAccountingIntegration.js';
import {BusinessEntity, businessRoles} from '../models/businessEntity.model.js';
import {BusinessBrand,ProductBrandLink} from '../models/businessBrand.model.js';
import {Product} from '../models/product.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {Customer} from '../models/customer.model.js';
import {accountingContext,developmentAccountingPermitted,productionPostingActive} from '../utils/accountingActivation.js';

function recordId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new apiError(400, 'Valid record selection required');
    return value;
}
function paging(query: any) {
    if (['page', 'limit'].some(key => query[key] !== undefined && (typeof query[key] !== 'string' || !/^\d+$/.test(query[key])))) throw new apiError(400, 'Invalid pagination');
    const page = query.page === undefined ? 1 : Number(query.page), limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new apiError(400, 'Invalid pagination');
    return {page, limit};
}
function search(value: unknown) {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.length > 100) throw new apiError(400, 'Search must be text of at most 100 characters');
    return new RegExp(value.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}
function enabled() {
    if (!invoiceAccountingEnabled()) throw new apiError(409, 'Accounting is disabled; live balances and financial mutations are unavailable');
}
// Journal history is only a test subledger, not a complete live business balance.
async function readableAccount(actor: any, accountId: string, session: mongoose.ClientSession) {
    const account = await FinancialAccount.findOne({_id: recordId(accountId), shopId: actor.shopId}).session(session).lean();
    if (!account) throw new apiError(404, 'Account not found in shop');
    if (account.authority === 'JOURNAL') {
        enabled();
        if(account.kind==='PARTNER_CAPITAL'){await accounts.selectInvoicePaymentAccounts(actor,session);return account;}
          if(['SUPPLIER_PAYABLE','SUPPLIER_CREDIT'].includes(account.kind)){await accounts.requireSupplierPayable(actor,String(account.entityId),session);return account;}
        if (!['CASH', 'BANK'].includes(account.kind)) throw new apiError(409, 'This journal account has no approved live balance integration');
        const clearing = account.cashCutoverId && await FinancialAccount.findOne({_id: account.cashCutoverId, shopId: actor.shopId, kind: 'SETTLEMENT_CLEARING'}).session(session);
        if (!clearing?.cashIntegration || clearing.cashIntegration.state !== 'PREPARED' || clearing.cashIntegration.cutoffAt > new Date() || !clearing.cashIntegration.accountIds.some(id => String(id) === String(account._id))) throw new apiError(409, 'Prepared cash/bank cutover required; balance unavailable');
    }
    return account;
}

export const businessAccounts = (operation: string) => asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const actor = req.user, body = req.body ?? {};
    const data = await accounts.businessTransaction(actor, async session => {
        switch (operation) {
            case 'supplierPreview':return accounts.previewSupplierCutover(actor,recordId(req.params.id),paging(req.query),session);
            case 'supplierOpening':return accounts.initializeSupplierCutover(actor,recordId(req.params.id),body,session);
            case 'supplierReconcile':return accounts.reconcileSupplier(actor,recordId(req.params.id),session);
            case 'supplierPayment':return accounts.settleSupplier(actor,recordId(req.params.id),body,'PAYMENT',session);
            case 'supplierReturn':return accounts.settleSupplier(actor,recordId(req.params.id),body,'RETURN',session);
            case 'supplierRefund':return accounts.settleSupplier(actor,recordId(req.params.id),body,'REFUND',session);
            case 'supplierCreditApplication':return accounts.settleSupplier(actor,recordId(req.params.id),body,'CREDIT_APPLICATION',session);
            case 'supplierReverse':return accounts.settleSupplier(actor,recordId(req.params.id),body,'REVERSAL',session,recordId(req.params.eventId));
            case 'supplierSettlements':return accounts.supplierSettlementHistory(actor,recordId(req.params.id),{...req.query,...paging(req.query)},session);
            case 'supplierBalance':return accounts.requireSupplierPayable(actor,recordId(req.params.id),session);
            case 'createEntity': {
                if (typeof body.key !== 'string' || !body.key.trim() || body.key.length > 80 || (body.name !== undefined && (typeof body.name !== 'string' || body.name.length > 100)) || (body.phoneNo !== undefined && typeof body.phoneNo !== 'string')) throw new apiError(400, 'Valid identity and contact details required');
                // Explicit keys handle retries; exact standalone name/contact matches
                // require review rather than creating another possible identity.
                if (!body.customerId && typeof body.name === 'string') {
                    const name = new RegExp('^' + body.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
                    const existing = await BusinessEntity.findOne({shopId: actor.shopId, key: {$ne: typeof body.key === 'string' ? body.key.trim().toLowerCase() : ''}, $or: [{name}, ...(body.phoneNo ? [{phoneNo: body.phoneNo}] : [])]}).session(session);
                    if (existing) throw new apiError(409, 'Business name or contact already exists; review the existing identity');
                }
                return accounts.createBusinessEntity(actor, body, session);
            }
            case 'entities': {
                const {page, limit} = paging(req.query), pattern = search(req.query.q);
                const filter: any = {shopId: actor.shopId};
                if (req.query.role !== undefined) {
                    if (typeof req.query.role !== 'string' || !businessRoles.includes(req.query.role as any)) throw new apiError(400, 'Invalid business role');
                    filter.roles = req.query.role;
                }
                if (pattern) {
                    // Query linked customer names without copying identity or balances.
                    const linked = await BusinessEntity.aggregate([
                        {$match: {shopId: new mongoose.Types.ObjectId(String(actor.shopId)), customerId: {$exists: true}}},
                        {$lookup: {from: Customer.collection.name, let: {customer: '$customerId', shop: '$shopId'}, pipeline: [{$match: {$expr: {$and: [{$eq: ['$_id', '$$customer']}, {$eq: ['$shopId', '$$shop']}]}}}, {$match: {$or: [{name: pattern}, {phoneNo: pattern}]}}], as: 'matched'}},
                        {$match: {'matched.0': {$exists: true}}}, {$project: {_id: 1}}
                    ]).session(session).option({maxTimeMS: 5000});
                    filter.$or = [{name: pattern}, {phoneNo: pattern}, {key: pattern}, {_id: {$in: linked.map(row => row._id)}}];
                }
                const count = await BusinessEntity.countDocuments(filter).session(session);
                const rows = await BusinessEntity.find(filter).sort({key: 1, _id: 1}).skip((page - 1) * limit).limit(limit).session(session);
                const entries = [];
                for (const row of rows) entries.push(await accounts.getBusinessEntity(actor, String(row._id), session));
                return {entries, pagination: {currentPage: page, limit, recordCount: count, totalPages: Math.ceil(count / limit)}};
            }
            case 'entity': return accounts.getBusinessEntity(actor, recordId(req.params.id), session);
            case 'roles': return accounts.setBusinessRoles(actor, recordId(req.params.id), body.roles, body.expectedRevision, session);
            case 'linkCustomer': return accounts.linkBusinessCustomer(actor, recordId(req.params.id), body.customerId, body.expectedRevision, body.confirmation, session);
            case 'brands': {
                const {page, limit} = paging(req.query), pattern = search(req.query.q);
                const filter = {shopId: actor.shopId, ...(pattern ? {name: pattern} : {})};
                const count = await BusinessBrand.countDocuments(filter).session(session);
                return {entries: await BusinessBrand.find(filter).sort({nameKey: 1}).skip((page - 1) * limit).limit(limit).session(session).lean(), pagination: {currentPage: page, limit, recordCount: count, totalPages: Math.ceil(count / limit)}};
            }
            case 'createBrand': return accounts.createBusinessBrand(actor, body, session);
            case 'brandEntities': return accounts.setBusinessBrandEntities(actor, recordId(req.params.id), body.entityIds, body.expectedEntityIds, session);
            case 'linkProduct': return accounts.linkProductBrand(actor, recordId(req.params.id), body.brandId, session);
            case 'productLinks': return accounts.getProductBusinessLinks(actor, recordId(req.params.id), session);
            case 'entityProducts': {
                const entity=await accounts.getBusinessEntity(actor,recordId(req.params.id),session),{page,limit}=paging(req.query);
                const brands=await BusinessBrand.find({shopId:actor.shopId,entityIds:entity._id}).limit(1001).session(session).lean();
                if(brands.length>1000)throw new apiError(409,'Brand associations require a separately paginated review');
                const rows=await ProductBrandLink.aggregate([{$match:{shopId:actor.shopId,brandId:{$in:brands.map(b=>b._id)}}},
                    {$lookup:{from:Product.collection.name,let:{product:'$productId'},pipeline:[{$match:{shopId:actor.shopId,$expr:{$eq:['$_id','$$product']}}},{$project:{name:1,brand:1,unit:1,stockQuantity:1}}],as:'product'}},{$unwind:'$product'},
                    {$match:{$expr:{$or:brands.map(b=>({$and:[{$eq:['$brandId',b._id]},{$eq:[{$toLower:{$trim:{input:'$product.brand'}}},b.nameKey]}]}))}}},
                    {$sort:{'product.name':1,_id:1}},{$facet:{count:[{$count:'value'}],entries:[{$skip:(page-1)*limit},{$limit:limit}]}}]).session(session).option({maxTimeMS:5000});
                // Stale free-text changes invalidate links. They must not be silently reattributed.
                const entries=rows[0].entries.map((r:any)=>({...r.product,brandId:r.brandId}));
                return {entries,pagination:{currentPage:page,limit,recordCount:rows[0].count[0]?.value??0,totalPages:Math.ceil((rows[0].count[0]?.value??0)/limit)},sales:{status:'UNAVAILABLE',message:'Company/brand links are not captured on historical sales. Current links cannot prove which company supplied past sales.'}};
            }
            case 'createAccount':
                enabled();
                if (!['CASH', 'BANK', 'CUSTOMER_RECEIVABLE', 'STORE_CREDIT_LIABILITY', 'SUPPLIER_PAYABLE', 'OPENING_EQUITY', 'SETTLEMENT_CLEARING', 'PURCHASES_CLEARING'].includes(body.kind)) throw new apiError(400, 'Unsupported account kind');
                return accounts.createFinancialAccount(actor, body, session);
            case 'accounts': {
                const {page, limit} = paging(req.query), pattern = search(req.query.q);
                const filter: any = {shopId: actor.shopId};
                if (pattern) filter.$or = [{name: pattern}, {code: pattern}];
                if (req.query.entityId !== undefined) filter.entityId = recordId(req.query.entityId);
                const count = await FinancialAccount.countDocuments(filter).session(session);
                // Metadata only; never present incomplete journal money as a balance.
                return {entries: await FinancialAccount.find(filter).sort({code: 1}).skip((page - 1) * limit).limit(limit).session(session).lean(), pagination: {currentPage: page, limit, recordCount: count, totalPages: Math.ceil(count / limit)}, livePostingEnabled: productionPostingActive()};
            }
            case 'account': {
                const account = await readableAccount(actor, recordId(req.params.id), session);
                return {account, ...await accounts.getAccountBalance(actor, String(account._id), session), livePostingEnabled: productionPostingActive()};
            }
            case 'history':
                await readableAccount(actor, recordId(req.params.id), session);
                return accounts.getAccountStatement(actor, {accountId: recordId(req.params.id), ...paging(req.query), ...(req.query.from !== undefined ? {from: req.query.from as string} : {}), ...(req.query.to !== undefined ? {to: req.query.to as string} : {}), ...(req.query.q !== undefined ? {q: req.query.q as string} : {}), ...(req.query.type !== undefined ? {type: req.query.type as string} : {}), ...(req.query.sourceId !== undefined ? {sourceId: req.query.sourceId as string} : {})}, session);
            case 'historyEntry':
                await readableAccount(actor,recordId(req.params.id),session);
                return accounts.getAccountHistoryEntry(actor,recordId(req.params.id),recordId(req.params.entryId),session);
            case 'transactions':
                return accounts.getBusinessTransactions(actor,{...paging(req.query),...(Object.fromEntries(['from','to','q','type','sourceId','accountId'].filter(k=>req.query[k]!==undefined).map(k=>[k,req.query[k]])) as any)},session);
            case 'transaction':return accounts.getBusinessTransaction(actor,recordId(req.params.id),session);
            case 'opening':
                enabled();
                if((process.env.NODE_ENV==='production'||developmentAccountingPermitted())&&accountingContext.getStore()?.state!=='PREPARING')throw new apiError(409,'Use explicit account enrollment after activation; initial openings cannot be recreated');
                if (!await FinancialAccount.exists({_id: recordId(req.params.id), shopId: actor.shopId, kind: {$in: ['CASH', 'BANK']}}).session(session)) throw new apiError(400, 'Select a cash or bank account in this shop');
                return accounts.recordOpeningBalance(actor, {...body, accountId: recordId(req.params.id)}, session);
            case 'cutover':
                enabled();
                if((process.env.NODE_ENV==='production'||developmentAccountingPermitted())&&accountingContext.getStore()?.state!=='PREPARING')throw new apiError(409,'Initial cutover is locked; enroll additional accounts explicitly');
                if (!Array.isArray(body.accounts) || body.accounts.some((row: any) => !row || typeof row !== 'object')) throw new apiError(400, 'Valid cash/bank account confirmations required');
                return accounts.prepareCashBankCutover(actor, body, session);
            case 'reconcileCustomer': return accounts.reconcileBusinessCustomer(actor, recordId(req.params.id), session);
            case 'customerHistory': {
                const {page,limit}=paging(req.query);
                for(const key of ['q','type','from','to'])if(req.query[key]!==undefined&&typeof req.query[key]!=='string')throw new apiError(400,'Invalid customer history filter');
                if(typeof req.query.q==='string'&&req.query.q.length>100)throw new apiError(400,'Search must be text of at most 100 characters');
                return accounts.getCustomerHistory(actor,recordId(req.params.id),{page,limit,...Object.fromEntries(['q','type','from','to'].filter(k=>req.query[k]!==undefined).map(k=>[k,req.query[k]]))},session);
            }
            case 'customerActivity': {
                const {page,limit}=paging(req.query),service=req.query.service??'HISTORY';
                if(typeof service!=='string'||!['INVOICES','PAYMENTS','RETURNS','REFUNDS','CREDIT','HISTORY'].includes(service))throw new apiError(400,'Select a valid customer service');
                for(const key of ['q','from','to','customerId'])if(req.query[key]!==undefined&&typeof req.query[key]!=='string')throw new apiError(400,'Invalid customer activity filter');
                if(typeof req.query.q==='string'&&req.query.q.length>100)throw new apiError(400,'Search must be text of at most 100 characters');
                return accounts.getGlobalCustomerActivity(actor,{service:service as 'INVOICES'|'PAYMENTS'|'RETURNS'|'REFUNDS'|'CREDIT'|'HISTORY',page,limit,...Object.fromEntries(['q','from','to'].filter(k=>req.query[k]!==undefined).map(k=>[k,req.query[k]])),...(req.query.customerId!==undefined?{customerId:recordId(req.query.customerId)}:{})},session);
            }
            case 'reconcile':
                enabled();
                return accounts.reconcileCashBank(actor, {clearingAccountId: recordId(req.query.clearingAccountId), ...paging(req.query)}, session);
            default: throw new apiError(404, 'Operation not found');
        }
    });
    res.status(200).json(new apiResponse(200, data as any, 'Success'));
});
