import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {Shop} from '../models/shop.model.js';
import {User} from '../models/user.model.js';
import {Customer} from '../models/customer.model.js';
import {CustomerLedger} from '../models/customerLedger.model.js';
import {Product} from '../models/product.model.js';
import {Order} from '../models/order.model.js';
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {BusinessEntity, businessRoles} from '../models/businessEntity.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {BusinessBrand, ProductBrandLink} from '../models/businessBrand.model.js';
import {PurchaseOrder} from '../models/purchaseOrder.model.js';
import {apiError} from './apiError.js';
import {checkedCustomer, signedLedgerMinor, verifiedInvoiceFunding} from './invoiceSettlement.js';
import {moneyMinor, safeMinor} from './invoiceAccounting.js';
import {accountKinds, balancedPostings, signedBalance} from './businessAccounting.js';
import type {AccountKind, Posting} from './businessAccounting.js';
import {historyFilters, invoiceSourceLookup, journalCoverage, journalTypes, journalViews, legacyTypes, legacyViews} from './businessHistory.js';
import {invoiceAccountingEnabled} from './invoiceAccountingIntegration.js';

type Actor = {_id: any, shopId: any, role: string};
type Session = mongoose.ClientSession;
type JournalInput = {requestKey: string, reason: string, occurredAt: string, postings: Posting[]};
function id(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) throw new apiError(400, 'Valid record selection required');
    return value.toLowerCase();
}
function text(value: unknown, max: number, label: string): string {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new apiError(400, `Valid ${label} required`);
    return value.trim();
}
function utcDate(value: unknown): Date {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) throw new apiError(400, 'Explicit UTC date required');
    const result = new Date(value);
    if (!Number.isFinite(+result) || result.toISOString() !== value || +result > Date.now()) throw new apiError(400, 'Use a valid UTC date, not in the future');
    return result;
}
// Strict OWNER by default. The private opt-in is used only after verifying a
// cashier's own initial SALE or for the balance-free payment-account selector.
async function owner(actor: Actor, session: Session, write = false, cashierSale = false) {
    if (!session?.inTransaction()) throw new apiError(400, 'An active MongoDB transaction is required');
    if (!actor || !((actor.role === 'OWNER') || (cashierSale && actor.role === 'CASHIER')) || !mongoose.isValidObjectId(actor._id) || !mongoose.isValidObjectId(actor.shopId)) throw new apiError(403, 'Owner shop access required');
    const user = await User.findOne({_id: actor._id, shopId: actor.shopId, role: actor.role}).session(session);
    const shopScope = {_id: actor.shopId, ...(actor.role === 'OWNER' ? {ownerId: actor._id} : {})};
    const shop = await Shop.findOne(shopScope).session(session);
    if (!user || !shop) throw new apiError(403, 'Owner shop access required');
    if (shop.isActive === false) throw new apiError(403, 'Shop has been deactivated. Contact administrator.');
    if (!shop.subscriptionActive || !shop.subscriptionExpiry || shop.subscriptionExpiry <= new Date()) throw new apiError(403, 'Subscription expired or inactive');
    if (write) {
        // Acquire a real write on existing shop metadata. A concurrent permanent
        // deletion/deactivation must conflict, rather than leave orphan records.
        const claim = await Shop.updateOne(shopScope, {$set: {updatedAt: new Date(Math.max(Date.now(), +shop.updatedAt + 1))}}, {session, timestamps: false});
        if (claim.modifiedCount !== 1) throw new apiError(409, 'Shop changed; retry the same request');
    }
    return user;
}

// Internal only. Future inventory adapters must pass THIS session to all stock
// and financial writes. No automatic financial retry or public route is added.
export async function businessTransaction<T>(actor: Actor, work: (session: Session) => Promise<T>, write=false): Promise<T> {
    const session = await mongoose.startSession();
    session.startTransaction({readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}});
    try {
        await owner(actor, session, write);
        const result = await work(session);
        await session.commitTransaction();
        return result;
    } catch (error: any) {
        if (session.inTransaction()) await session.abortTransaction().catch(() => {});
        if (error?.hasErrorLabel?.('UnknownTransactionCommitResult')) throw new apiError(503, 'Transaction outcome uncertain; check or retry the identical request key');
        if (error?.code === 11000 || error?.code === 112 || error?.hasErrorLabel?.('TransientTransactionError')) throw new apiError(409, 'Business records changed or key already exists; retry the identical request');
        throw error;
    } finally {await session.endSession();}
}

export async function createBusinessEntity(actor: Actor, input: {key: string, roles: string[], customerId?: string, name?: string, phoneNo?: string, address?: string, customerType?: string}, session: Session) {
    await owner(actor, session);
    const key = text(input.key, 80, 'identity key').toLowerCase();
    if (!Array.isArray(input.roles) || !input.roles.length || input.roles.some(r => !businessRoles.includes(r as any)) || new Set(input.roles).size !== input.roles.length) throw new apiError(400, 'Valid unique business roles required');
    const roles = [...input.roles].sort() as (typeof businessRoles)[number][];
    if (input.customerType !== undefined && (!roles.includes('CUSTOMER') || !['RETAIL', 'WHOLESALE'].includes(input.customerType))) throw new apiError(400, 'Valid customer type required');
    const customerId = input.customerId ? id(input.customerId) : undefined;
    if (roles.includes('CUSTOMER') !== !!customerId) throw new apiError(400, 'Customer role must link an existing customer, not a second financial identity');
    if (customerId && !await Customer.findOne({_id: customerId, shopId: actor.shopId}).session(session)) throw new apiError(404, 'Customer not found in shop');
    if (customerId && (input.name !== undefined || input.phoneNo !== undefined || input.address !== undefined)) throw new apiError(400, 'Linked identity uses the existing customer details');
    if ((input.phoneNo !== undefined && typeof input.phoneNo !== 'string') || (input.address !== undefined && typeof input.address !== 'string')) throw new apiError(400, 'Contact details must be text');
    const name = customerId ? undefined : text(input.name, 100, 'business name');
    const phoneNo = (input.phoneNo ?? '').trim(), address = (input.address ?? '').trim();
    if (phoneNo && !/^\d{11}$/.test(phoneNo)) throw new apiError(400, 'Contact number must contain 11 digits');
    if (address.length > 300) throw new apiError(400, 'Address is too long');
    if (phoneNo && await Customer.exists({shopId: actor.shopId, phoneNo}).session(session)) throw new apiError(409, 'Contact belongs to a customer; explicitly link that customer instead');
    const existing = await BusinessEntity.findOne({shopId: actor.shopId, key}).session(session);
    if (existing) {
        if (String(existing.customerId ?? '') !== (customerId ?? '') || existing.name !== name || existing.phoneNo !== phoneNo || existing.address !== address || existing.roles.join() !== roles.join() || existing.customerType !== input.customerType) throw new apiError(409, 'Identity key already used for different details');
        return existing;
    }
    await owner(actor, session, true);
    const [entity] = await BusinessEntity.create([{shopId: actor.shopId, key, roles, phoneNo, address, ...(customerId ? {customerId} : {}), ...(name ? {name} : {}), ...(input.customerType ? {customerType: input.customerType as 'RETAIL' | 'WHOLESALE'} : {})}], {session});
    return entity!;
}

export async function getBusinessEntity(actor: Actor, entityId: string, session: Session) {
    await owner(actor, session);
    const entity = await BusinessEntity.findOne({_id: id(entityId), shopId: actor.shopId}).session(session).lean();
    if (!entity) throw new apiError(404, 'Business not found in shop');
    if (!entity.customerId) return entity;
    const customer = await Customer.findOne({_id: entity.customerId, shopId: actor.shopId}).select('name phoneNo address').session(session).lean();
    if (!customer) throw new apiError(409, 'Linked customer unavailable; reconciliation required');
    return {...entity, name: customer.name, phoneNo: customer.phoneNo, address: customer.address};
}

export async function setBusinessRoles(actor: Actor, entityId: string, roles: string[], expectedRevision: number, session: Session) {
    await owner(actor, session);
    const entity = await getBusinessEntity(actor, entityId, session);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Array.isArray(roles) || !roles.length || new Set(roles).size !== roles.length || roles.some(r => !businessRoles.includes(r as any)) || roles.includes('CUSTOMER') !== !!entity.customerId) throw new apiError(400, 'Retain the linked customer identity and valid roles');
    if (!roles.includes('SUPPLIER') && (await FinancialAccount.exists({shopId: actor.shopId, entityId: entity._id, kind: 'SUPPLIER_PAYABLE'}).session(session) || await PurchaseOrder.exists({shopId:actor.shopId,supplierId:entity._id}).session(session))) throw new apiError(409, 'Supplier account or purchase history requires supplier role');
    await owner(actor, session, true);
    const result = await BusinessEntity.findOneAndUpdate({_id: entity._id, shopId: actor.shopId, revision: expectedRevision}, {$set: {roles: [...roles].sort()}, $inc: {revision: 1}}, {session, new: true, runValidators: true});
    if (!result) throw new apiError(409, 'Business identity changed; reload before editing');
    return result;
}

export async function linkBusinessCustomer(actor: Actor, entityId: string, customerId: string, expectedRevision: number, confirmation: string, session: Session) {
    await owner(actor, session);
    if (confirmation !== 'LINK EXISTING CUSTOMER' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new apiError(400, 'Confirm the existing customer identity and revision');
    const entity = await getBusinessEntity(actor, entityId, session);
    const customer = await Customer.findOne({_id: id(customerId), shopId: actor.shopId}).session(session);
    if (!customer) throw new apiError(404, 'Customer not found in shop');
    if (entity.customerId) {
        if (String(entity.customerId) !== String(customer._id)) throw new apiError(409, 'A linked customer cannot be replaced');
        return entity;
    }
    await owner(actor, session, true);
    const result = await BusinessEntity.findOneAndUpdate({_id: entity._id, shopId: actor.shopId, revision: expectedRevision, customerId: {$exists: false}},
        {$set: {customerId: customer._id, roles: [...new Set([...entity.roles, 'CUSTOMER'])].sort()}, $unset: {name: '', phoneNo: '', address: ''}, $inc: {revision: 1}}, {session, new: true, runValidators: true});
    if (!result) throw new apiError(409, 'Business identity changed; reload before linking');
    return result;
}

export async function createFinancialAccount(actor: Actor, input: {code: string, name: string, kind: AccountKind, entityId?: string}, session: Session) {
    await owner(actor, session);
    const code = text(input.code, 50, 'account code').toUpperCase(), name = text(input.name, 100, 'account name');
    if (!/^[A-Z0-9_-]+$/.test(code) || !Object.hasOwn(accountKinds, input.kind)) throw new apiError(400, 'Valid account code and kind required');
    const party = ['CUSTOMER_RECEIVABLE', 'STORE_CREDIT_LIABILITY', 'SUPPLIER_PAYABLE'].includes(input.kind);
    if (party !== !!input.entityId) throw new apiError(400, 'Only business balance accounts require a business identity');
    const entity = input.entityId ? await getBusinessEntity(actor, input.entityId, session) : null;
    if (input.kind === 'SUPPLIER_PAYABLE' && !entity?.roles.includes('SUPPLIER')) throw new apiError(400, 'Supplier role required');
    const legacy = ['CUSTOMER_RECEIVABLE', 'STORE_CREDIT_LIABILITY'].includes(input.kind);
    if (legacy && !entity?.customerId) throw new apiError(400, 'Existing customer identity required');
    const existing = await FinancialAccount.findOne({shopId: actor.shopId, code}).session(session);
    if (existing) {
        if (existing.kind !== input.kind || existing.name !== name || String(existing.entityId ?? '') !== (input.entityId?.toLowerCase() ?? '')) throw new apiError(409, 'Account code already used');
        return existing;
    }
    await owner(actor, session, true);
    const [account] = await FinancialAccount.create([{shopId: actor.shopId, code, name, kind: input.kind, normalSide: accountKinds[input.kind], authority: legacy ? 'LEGACY_CUSTOMER' : 'JOURNAL', ...(entity ? {entityId: entity._id} : {})}], {session});
    return account!;
}

async function accountInShop(actor: Actor, accountId: string, session: Session) {
    const account = await FinancialAccount.findOne({_id: id(accountId), shopId: actor.shopId}).session(session);
    if (!account) throw new apiError(404, 'Account not found in shop');
    if (account.entityId) await getBusinessEntity(actor, String(account.entityId), session);
    return account;
}
const sumStage = {$group: {_id: null, debit: {$sum: {$toDecimal: '$debitMinor'}}, credit: {$sum: {$toDecimal: '$creditMinor'}}}};
function sumBalance(row: any, side: 'DEBIT' | 'CREDIT') { return signedBalance(BigInt(row?.debit?.toString() ?? '0'), BigInt(row?.credit?.toString() ?? '0'), side); }
function journalRows(shopId: any, accountId: any): any[] {
    return [{$match: {shopId: new mongoose.Types.ObjectId(String(shopId)), 'postings.accountId': accountId}}, {$unwind: '$postings'}, {$match: {'postings.accountId': accountId}},
        {$project: {occurredAt: 1, recordedAt: 1, source: 1, reason: 1, createdBy: 1, createdByName: 1, createdByRole: 1, currency: 1, debitMinor: '$postings.debitMinor', creditMinor: '$postings.creditMinor'}}];
}
async function journalBalance(shopId: any, account: any, session: Session) {
    const rows = await BusinessTransaction.aggregate([...journalRows(shopId, account._id), sumStage]).session(session).option({maxTimeMS: 5000});
    return sumBalance(rows[0], account.normalSide as 'DEBIT' | 'CREDIT');
}
export async function getAccountBalance(actor: Actor, accountId: string, session: Session) {
    await owner(actor, session);
    const account = await accountInShop(actor, accountId, session);
    if (account.authority === 'LEGACY_CUSTOMER') {
        const entity = await getBusinessEntity(actor, String(account.entityId), session);
        if (!entity.customerId) throw new apiError(409, 'Customer identity requires reconciliation');
        const customer = await checkedCustomer(entity.customerId, actor.shopId, session);
        return {authority: 'LEGACY_CUSTOMER', balanceMinor: account.kind === 'CUSTOMER_RECEIVABLE' ? moneyMinor(customer.remainingMoney) : (customer.storeCreditBalanceMinor ?? 0), currency: 'PKR'};
    }
    return {authority: 'JOURNAL', balanceMinor: await journalBalance(actor.shopId, account, session), currency: 'PKR'};
}

export async function getAccountStatement(actor: Actor, input: {accountId: string, page?: number, limit?: number, from?: string, to?: string, q?: string, type?: string, sourceId?: string}, session: Session) {
    await owner(actor, session);
    const account = await accountInShop(actor, input.accountId, session);
    const page = input.page ?? 1, limit = input.limit ?? 20;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new apiError(400, 'Invalid statement pagination');
    const {from,to,pattern,type,sourceId}=historyFilters(input,account.authority==='LEGACY_CUSTOMER'?legacyTypes:journalTypes);
    const filtered=!!(pattern||type||sourceId);
    const skip = (page - 1) * limit, side = account.normalSide as 'DEBIT' | 'CREDIT';
    const balance = await getAccountBalance(actor, input.accountId, session);
    if (account.authority === 'LEGACY_CUSTOMER') {
        const entity = await getBusinessEntity(actor, String(account.entityId), session);
        // Existing reconciliation already reads these legacy entries. Keep its
        // authority and precision checks; bound the returned statement page.
        const filter: any = {shopId: actor.shopId, customerId: entity.customerId};
        if (account.kind === 'STORE_CREDIT_LIABILITY') filter.balanceType = 'CREDIT';
        else filter.$or = [{balanceType: 'DEBT'}, {balanceType: {$exists: false}}];
        const rows = await CustomerLedger.find(filter).sort({createdAt: 1, _id: 1}).session(session).lean();
        let running = 0n, opening = 0n;
        const inRange = rows.filter(row => (!from || row.createdAt >= from) && (!to || row.createdAt < to) && (!pattern || pattern.test([row.description, row.referenceId, row.adjustmentId, row.invoiceNo].join(' '))) && (!type||row.description===type) && (!sourceId||[String(row.referenceId),String(row.adjustmentId)].includes(sourceId)));
        const pageIds = new Set(inRange.slice(skip, skip + limit).map(row => String(row._id)));
        const precedingIds = new Set(inRange.slice(0, skip).map(row => String(row._id)));
        const entries = [];
        for (const row of rows) {
            if ((from && row.createdAt < from) || precedingIds.has(String(row._id))) opening += BigInt(signedLedgerMinor(row));
            running += BigInt(signedLedgerMinor(row));
            if (pageIds.has(String(row._id))) entries.push({...row, runningBalanceMinor: signedBalance(side === 'DEBIT' ? running : 0n, side === 'CREDIT' ? running : 0n, side)});
        }
        const rangeOpeningBalanceMinor=signedBalance(rows.filter(r=>from&&r.createdAt<from).reduce((sum,r)=>sum+BigInt(signedLedgerMinor(r)),0n),0n,'DEBIT');
        const rangeClosingBalanceMinor=signedBalance(rows.filter(r=>!to||r.createdAt<to).reduce((sum,r)=>sum+BigInt(signedLedgerMinor(r)),0n),0n,'DEBIT');
        return {...balance, openingBalanceMinor:filtered?null:signedBalance(opening,0n,'DEBIT'),rangeOpeningBalanceMinor,rangeClosingBalanceMinor,
            rangeNetChangeMinor:signedBalance(BigInt(rangeClosingBalanceMinor),BigInt(rangeOpeningBalanceMinor),'DEBIT'),
            coverage:{complete:false,livePostingEnabled:false,records:'CUSTOMER_LEDGER',rangeTimestampBasis:'RECORDED_ONLY'},
            transactions:await legacyViews(actor.shopId,account,entity,entries,session),entries, pagination: {currentPage: page, limit, recordCount: inRange.length, totalPages: Math.ceil(inRange.length / limit)}};
    }
    const range: any = {};
    if (from || to) range.occurredAt = {...(from ? {$gte: from} : {}), ...(to ? {$lt: to} : {})};
    if(type)range['source.kind']=type;
    if(sourceId)range.$and=[{$or:[{'source.referenceId':new mongoose.Types.ObjectId(sourceId)},{'invoice.orderId':new mongoose.Types.ObjectId(sourceId)}]}];
    if (pattern) range.$or = [{reason: pattern}, {'source.kind': pattern}, {createdByName: pattern}, {'invoice.invoiceNo': pattern}, ...(/^[a-f\d]{24}$/i.test(input.q?.trim() ?? '') ? [{'source.referenceId': new mongoose.Types.ObjectId(input.q!.trim())}] : [])];
    const [result] = await BusinessTransaction.aggregate([...journalRows(actor.shopId, account._id), ...invoiceSourceLookup(actor.shopId),
        {$sort: {occurredAt: 1, _id: 1}}, {$facet: {
        entries: [{$match: range}, {$skip: skip}, {$limit: limit}], count: [{$match: range}, {$count: 'value'}],
        prior: from ? [{$match: {occurredAt: {$lt: from}}}, sumStage] : [{$match: {$expr: {$eq: [1, 0]}}}],
        pagePrior: skip ? [{$match: range}, {$limit: skip}, sumStage] : [{$match: {$expr: {$eq: [1, 0]}}}],
        rangeOpening:from?[{$match:{occurredAt:{$lt:from}}},sumStage]:[{$match:{$expr:{$eq:[1,0]}}}],
        rangeClosing:[...(to?[{$match:{occurredAt:{$lt:to}}}]:[]),sumStage]
    }}]).session(session).option({maxTimeMS: 5000});
    const openingNet = BigInt(sumBalance(result.prior[0], side)) + BigInt(sumBalance(result.pagePrior[0], side));
    const openingBalanceMinor = signedBalance(openingNet, 0n, 'DEBIT');
    let running = BigInt(openingBalanceMinor);
    const entries = result.entries.map((row: any) => {
        running += side === 'DEBIT' ? BigInt(row.debitMinor) - BigInt(row.creditMinor) : BigInt(row.creditMinor) - BigInt(row.debitMinor);
        return {...row, runningBalanceMinor: filtered ? null : signedBalance(side === 'DEBIT' ? running : 0n, side === 'CREDIT' ? running : 0n, side)};
    });
    const count = result.count[0]?.value ?? 0;
    const documents=await BusinessTransaction.find({shopId:actor.shopId,_id:{$in:entries.map((r:any)=>r._id)}}).session(session).lean();
    const views=await journalViews(actor.shopId,documents,session);
    const rangeOpeningBalanceMinor=sumBalance(result.rangeOpening[0],side), rangeClosingBalanceMinor=sumBalance(result.rangeClosing[0],side);
    return {...balance, openingBalanceMinor: filtered ? null : openingBalanceMinor,rangeOpeningBalanceMinor,rangeClosingBalanceMinor,
        rangeNetChangeMinor:signedBalance(BigInt(rangeClosingBalanceMinor),BigInt(rangeOpeningBalanceMinor),'DEBIT'),coverage:journalCoverage,
        transactions:entries.map((r:any)=>{const view=views.find(v=>String(v.eventId)===String(r._id))!;return {...view,accountPosting:view.postings.find(p=>p.accountId===String(account._id)),runningBalanceMinor:r.runningBalanceMinor};}),
        entries, pagination: {currentPage: page, limit, recordCount: count, totalPages: Math.ceil(count / limit)}};
}

export async function getBusinessTransactions(actor:Actor,input:{page?:number,limit?:number,from?:string,to?:string,q?:string,type?:string,sourceId?:string,accountId?:string},session:Session) {
    await owner(actor,session);
    if(!invoiceAccountingEnabled())throw new apiError(409,'Accounting is disabled; posted test journal register is unavailable');
    const page=input.page??1,limit=input.limit??20;
    if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new apiError(400,'Invalid transaction pagination');
    const {from,to,pattern,type,sourceId}=historyFilters(input,journalTypes);
    const scope:any={shopId:new mongoose.Types.ObjectId(String(actor.shopId))};
    if(input.accountId!==undefined){const account=await accountInShop(actor,id(input.accountId),session);scope['postings.accountId']=account._id;}
    if(from||to)scope.occurredAt={...(from?{$gte:from}:{}),...(to?{$lt:to}:{})};
    if(type)scope['source.kind']=type;
    const selection:any={};
    if(sourceId)selection.$and=[{$or:[{'source.referenceId':new mongoose.Types.ObjectId(sourceId)},{'invoice.orderId':new mongoose.Types.ObjectId(sourceId)},{_id:new mongoose.Types.ObjectId(sourceId)}]}];
    if(pattern)selection.$or=[{reason:pattern},{'source.kind':pattern},{createdByName:pattern},{'invoice.invoiceNo':pattern},...(/^[a-f\d]{24}$/i.test(input.q?.trim()??'')?[{'source.referenceId':new mongoose.Types.ObjectId(input.q!.trim())},{_id:new mongoose.Types.ObjectId(input.q!.trim())}]:[])];
    const [result]=await BusinessTransaction.aggregate([{$match:scope},...invoiceSourceLookup(actor.shopId),{$match:selection},{$sort:{occurredAt:1,_id:1}},{$facet:{entries:[{$skip:(page-1)*limit},{$limit:limit}],count:[{$count:'value'}]}}]).session(session).option({maxTimeMS:5000});
    const count=result.count[0]?.value??0;
    return {coverage:journalCoverage,entries:await journalViews(actor.shopId,result.entries,session),pagination:{currentPage:page,limit,recordCount:count,totalPages:Math.ceil(count/limit)}};
}

export async function getBusinessTransaction(actor:Actor,transactionId:string,session:Session) {
    await owner(actor,session);
    if(!invoiceAccountingEnabled())throw new apiError(409,'Accounting is disabled; posted test journal detail is unavailable');
    const journal=await BusinessTransaction.findOne({_id:id(transactionId),shopId:actor.shopId}).session(session).lean();
    if(!journal)throw new apiError(404,'Transaction not found in shop');
    const [transaction]=await journalViews(actor.shopId,[journal],session,true);
    let originalTransaction=null;
    if(journal.source.kind==='REVERSAL'){
        const original=await BusinessTransaction.findOne({_id:journal.source.referenceId,shopId:actor.shopId}).session(session).lean();
        if(original)originalTransaction=(await journalViews(actor.shopId,[original],session))[0]??null;
    }
    return {coverage:journalCoverage,transaction,originalTransaction};
}

export async function getAccountHistoryEntry(actor:Actor,accountId:string,entryId:string,session:Session) {
    await owner(actor,session);
    const account=await accountInShop(actor,accountId,session);
    if(account.authority==='JOURNAL'){
        const journal=await BusinessTransaction.findOne({_id:id(entryId),shopId:actor.shopId,'postings.accountId':account._id}).session(session).lean();
        if(!journal)throw new apiError(404,'Transaction not found for account');
        return getBusinessTransaction(actor,entryId,session);
    }
    await getAccountBalance(actor,accountId,session);
    const entity=await getBusinessEntity(actor,String(account.entityId),session);
    const filter:any={_id:id(entryId),shopId:actor.shopId,customerId:entity.customerId,
        ...(account.kind==='STORE_CREDIT_LIABILITY'?{balanceType:'CREDIT'}:{$or:[{balanceType:'DEBT'},{balanceType:{$exists:false}}]})};
    const row=await CustomerLedger.findOne(filter).session(session).lean();
    if(!row)throw new apiError(404,'Transaction not found for account');
    return {coverage:{complete:false,livePostingEnabled:false,records:'CUSTOMER_LEDGER'},transaction:(await legacyViews(actor.shopId,account,entity,[row],session))[0]};
}

// Private posting engine. Only the fixed adapters below can supply invoice cash
// sources. Full SALE/PURCHASE general-ledger posting remains disabled.
async function post(actor: Actor, input: JournalInput, session: Session, source: {kind: 'MANUAL' | 'OPENING' | 'REVERSAL' | 'INVOICE_RECEIPT' | 'INVOICE_REFUND' | 'TRANSFER', referenceId?: string}, confirmed = false) {
    const cashierSale = actor.role === 'CASHIER' && source.kind === 'INVOICE_RECEIPT' && !!source.referenceId;
    if (cashierSale) await cashierSaleEvent(actor, source.referenceId!, session);
    const user = await owner(actor, session, false, cashierSale);
    const requestKey = text(input.requestKey, 100, 'request key');
    if (!/^[\w-]{8,100}$/.test(requestKey)) throw new apiError(400, 'Valid idempotency key required');
    const reason = text(input.reason, 300, 'transaction reason'), occurredAt = utcDate(input.occurredAt), postings = balancedPostings(input.postings);
    const hash = createHash('sha256').update(JSON.stringify({actorId: String(user._id), reason, occurredAt: occurredAt.toISOString(), postings, kind: source.kind, referenceId: source.referenceId, confirmed})).digest('hex');
    const existing = await BusinessTransaction.findOne({shopId: actor.shopId, requestKey}).session(session);
    if (existing) {
        if (existing.requestHash !== hash) throw new apiError(409, 'Request key already used for a different transaction');
        return existing;
    }
    const accounts = await FinancialAccount.find({shopId: actor.shopId, _id: {$in: postings.map(p => p.accountId)}}).session(session);
    if (accounts.length !== postings.length) throw new apiError(404, 'Account not found in shop');
    await owner(actor, session, true, cashierSale);
    for (const account of accounts) {
        if (account.isActive === false) throw new apiError(409, 'Selected financial account is inactive');
        if (account.authority !== 'JOURNAL') throw new apiError(409, 'Customer debt and credit remain in the existing ledger; cutover is not enabled');
        if (account.kind === 'SETTLEMENT_CLEARING' && !['INVOICE_RECEIPT', 'INVOICE_REFUND'].includes(source.kind)) throw new apiError(409, 'Settlement clearing requires a verified invoice cash event');
        if (account.cashCutoverId && ['MANUAL', 'OPENING'].includes(source.kind)) throw new apiError(409, 'Prepared cash accounts require source-linked integration or transfers');
        if (account.entityId) await getBusinessEntity(actor, String(account.entityId), session);
        if (account.lastPostedAt && occurredAt < account.lastPostedAt) throw new apiError(409, 'Posting cannot predate existing account activity');
        if (source.kind === 'OPENING' && String(account._id) === source.referenceId && account.postingRevision !== 0) throw new apiError(409, 'Opening cannot follow existing activity');
        if (account.kind === 'OPENING_EQUITY' && source.kind === 'MANUAL') throw new apiError(400, 'Opening equity is reserved for confirmed opening balances');
        const row = postings.find(p => p.accountId === String(account._id))!;
        const prior = {balanceMinor: await journalBalance(actor.shopId, account, session)};
        const delta = account.normalSide === 'DEBIT' ? BigInt(row.debitMinor) - BigInt(row.creditMinor) : BigInt(row.creditMinor) - BigInt(row.debitMinor);
        const next = BigInt(prior.balanceMinor) + delta;
        signedBalance(next, 0n, 'DEBIT');
        if (['CASH', 'BANK'].includes(account.kind) && next < 0n) throw new apiError(409, 'Insufficient cash or bank funds');
        const claim = await FinancialAccount.updateOne({_id: account._id, shopId: actor.shopId, postingRevision: account.postingRevision},
            {$inc: {postingRevision: 1}, $set: {lastPostedAt: occurredAt, ...(source.kind === 'OPENING' && String(account._id) === source.referenceId ? {openingAt: occurredAt} : {})}}, {session, runValidators: true});
        if (claim.modifiedCount !== 1) throw new apiError(409, 'Account changed; retry the identical request');
    }
    const transactionId = new mongoose.Types.ObjectId();
    const [transaction] = await BusinessTransaction.create([{_id: transactionId, shopId: actor.shopId, requestKey, requestHash: hash, source: {kind: source.kind, referenceId: source.referenceId ?? transactionId}, occurredAt, reason, createdBy: user._id, createdByName: user.username, createdByRole:user.role as 'OWNER'|'CASHIER', postings, ...(confirmed ? {ownerConfirmedAt: new Date()} : {})}], {session});
    return transaction!;
}
export function postBusinessJournal(actor: Actor, input: JournalInput, session: Session) { return post(actor, input, session, {kind: 'MANUAL'}); }

export async function recordOpeningBalance(actor: Actor, input: {requestKey: string, accountId: string, equityAccountId: string, amountMinor: number, occurredAt: string, reason: string, confirmation: string}, session: Session) {
    await owner(actor, session);
    safeMinor(input.amountMinor);
    if (!input.amountMinor || input.confirmation !== 'CONFIRM OPENING BALANCE') throw new apiError(400, 'Owner must explicitly confirm a positive opening balance');
    const target = await accountInShop(actor, input.accountId, session), equity = await accountInShop(actor, input.equityAccountId, session);
    if (['OPENING_EQUITY', 'SETTLEMENT_CLEARING'].includes(target.kind) || equity.kind !== 'OPENING_EQUITY') throw new apiError(400, 'Valid target and opening equity accounts required');
    const debit = target.normalSide === 'DEBIT';
    return post(actor, {...input, postings: [{accountId: String(target._id), debitMinor: debit ? input.amountMinor : 0, creditMinor: debit ? 0 : input.amountMinor}, {accountId: String(equity._id), debitMinor: debit ? 0 : input.amountMinor, creditMinor: debit ? input.amountMinor : 0}]}, session, {kind: 'OPENING', referenceId: String(target._id)}, true);
}

export async function reverseBusinessJournal(actor: Actor, input: {transactionId: string, requestKey: string, occurredAt: string, reason: string}, session: Session) {
    await owner(actor, session);
    const original = await BusinessTransaction.findOne({_id: id(input.transactionId), shopId: actor.shopId}).session(session);
    if (!original || original.source.kind === 'REVERSAL') throw new apiError(400, 'Select an original transaction in this shop');
    if (['INVOICE_RECEIPT', 'INVOICE_REFUND'].includes(original.source.kind)) throw new apiError(409, 'Correct invoice cash through a verified settlement event, not a standalone reversal');
    if (original.source.kind === 'OPENING') {
        const target = await accountInShop(actor, String(original.source.referenceId), session);
        if (target.cashCutoverId) throw new apiError(409, 'Prepared opening cannot be reversed; reconcile before changing cutover');
    }
    if (utcDate(input.occurredAt) < original.occurredAt) throw new apiError(400, 'Reversal cannot predate its source');
    return post(actor, {...input, postings: original.postings.map(p => ({accountId: String(p.accountId), debitMinor: p.creditMinor, creditMinor: p.debitMinor}))}, session, {kind: 'REVERSAL', referenceId: String(original._id)});
}

export async function selectCashBankAccounts(actor: Actor, session: Session) {
    await owner(actor, session);
    // No implicit first/default account: a future caller must select explicitly.
    return FinancialAccount.find({shopId: actor.shopId, kind: {$in: ['CASH', 'BANK']}, authority: 'JOURNAL', isActive: {$ne: false}})
        .select('code name kind cashCutoverId').sort({code: 1}).limit(100).session(session).lean();
}

export async function prepareCashBankCutover(actor: Actor, input: {clearingAccountId: string, cutoffAt: string,
    accounts: {accountId: string, confirmedBalanceMinor: number}[], confirmation: string}, session: Session) {
    const user = await owner(actor, session), cutoffAt = utcDate(input.cutoffAt);
    if (input.confirmation !== 'PREPARE CASH BANK CUTOVER' || !Array.isArray(input.accounts) || !input.accounts.length || input.accounts.length > 20) throw new apiError(400, 'Confirm cash/bank cutover and opening balances');
    const selected = input.accounts.map(row => ({accountId: id(row.accountId), balance: safeMinor(row.confirmedBalanceMinor)})).sort((a, b) => a.accountId.localeCompare(b.accountId));
    if (new Set(selected.map(row => row.accountId)).size !== selected.length) throw new apiError(400, 'Duplicate cash/bank account');
    const clearing = await accountInShop(actor, input.clearingAccountId, session);
    if (clearing.kind !== 'SETTLEMENT_CLEARING' || clearing.isActive === false) throw new apiError(400, 'An active dedicated settlement clearing account is required');
    if (clearing.cashIntegration) {
        const config = clearing.cashIntegration;
        if (+config.cutoffAt !== +cutoffAt || config.accountIds.map(String).sort().join() !== selected.map(row => row.accountId).join()) throw new apiError(409, 'Cutover already prepared with different details');
        // Check original opening evidence, not balances changed by subsequent postings.
        for (const row of selected) {
            const opening = await BusinessTransaction.findOne({shopId: actor.shopId, 'source.kind': 'OPENING', 'source.referenceId': row.accountId}).session(session);
            const amount = opening?.postings.find(p => String(p.accountId) === row.accountId)?.debitMinor ?? 0;
            if (amount !== row.balance) throw new apiError(409, 'Confirmed opening differs from cutover evidence');
        }
        return clearing;
    }
    if (clearing.postingRevision !== 0 || await BusinessTransaction.exists({shopId: actor.shopId, 'postings.accountId': clearing._id}).session(session)) throw new apiError(409, 'Cutover requires an unused clearing account');
    await owner(actor, session, true);
    for (const row of selected) {
        const account = await accountInShop(actor, row.accountId, session);
        if (!['CASH', 'BANK'].includes(account.kind) || account.cashCutoverId || account.isActive === false) throw new apiError(400, 'Choose active unused same-shop cash/bank accounts');
        const activity = await BusinessTransaction.find({shopId: actor.shopId, 'postings.accountId': account._id}).limit(2).session(session);
        if (activity.length > 1 || (activity[0] && (activity[0].source.kind !== 'OPENING' || String(activity[0].source.referenceId) !== row.accountId || +activity[0].occurredAt !== +cutoffAt))) throw new apiError(409, 'Opening must be the only activity, at the agreed cutoff');
        if ((await getAccountBalance(actor, row.accountId, session)).balanceMinor !== row.balance) throw new apiError(409, 'Confirmed opening does not match ledger');
        const claim = await FinancialAccount.updateOne({_id: account._id, shopId: actor.shopId, postingRevision: account.postingRevision, cashCutoverId: {$exists: false}},
            {$set: {cashCutoverId: clearing._id, openingAt: cutoffAt, lastPostedAt: cutoffAt}, $inc: {postingRevision: 1}}, {session});
        if (claim.modifiedCount !== 1) throw new apiError(409, 'Cash account changed; reload cutover');
    }
    const claimed = await FinancialAccount.findOneAndUpdate({_id: clearing._id, shopId: actor.shopId, postingRevision: 0, cashIntegration: {$exists: false}},
        {$set: {cashIntegration: {state: 'PREPARED', cutoffAt, accountIds: selected.map(row => row.accountId), preparedBy: user._id, preparedAt: new Date()}}, $inc: {postingRevision: 1}}, {session, new: true, runValidators: true});
    if (!claimed) throw new apiError(409, 'Cutover changed; reload before preparing');
    return claimed;
}

async function preparedCashAccount(actor: Actor, accountId: string, session: Session, cashierSale = false) {
    await owner(actor, session, false, cashierSale);
    const account = await accountInShop(actor, accountId, session);
    if (!['CASH', 'BANK'].includes(account.kind) || account.authority !== 'JOURNAL' || !account.cashCutoverId || account.isActive === false) throw new apiError(409, 'Select an active prepared cash/bank account');
    const clearing = await accountInShop(actor, String(account.cashCutoverId), session);
    if (clearing.kind !== 'SETTLEMENT_CLEARING' || clearing.isActive === false || clearing.cashIntegration?.state !== 'PREPARED' || !clearing.cashIntegration.accountIds.some(value => String(value) === String(account._id))) throw new apiError(409, 'Cash/bank cutover requires reconciliation');
    return {account, clearing, cutoffAt: clearing.cashIntegration.cutoffAt};
}

// Internal integration primitive; not an independently callable mutation route.
// Call AFTER writing the invoice and immutable event, within their SAME session.
export async function postInvoiceCashMovement(actor: Actor, input: {eventId: string, cashAccountId: string,
    direction: 'RECEIPT' | 'REFUND', requestKey: string}, session: Session) {
    const cashierSale = actor.role === 'CASHIER';
    if (cashierSale) {
        if (input.direction !== 'RECEIPT') throw new apiError(403, 'Cashiers cannot issue refunds');
        await cashierSaleEvent(actor, input.eventId, session);
    }
    const {account, clearing, cutoffAt} = await preparedCashAccount(actor, input.cashAccountId, session, cashierSale);
    if (!['RECEIPT', 'REFUND'].includes(input.direction)) throw new apiError(400, 'Valid cash movement direction required');
    // lean is intentional: schema defaults must not fabricate a date or missing
    // monetary evidence on older/incomplete persisted events.
    const event = await InvoiceAdjustment.findOne({_id: id(input.eventId), shopId: actor.shopId}).session(session).lean();
    if (!event) throw new apiError(404, 'Payment/refund event not found in shop');
    if (event.cashRouting) {
        const selected = input.direction === 'RECEIPT' ? event.cashRouting.receiptAccountId : event.cashRouting.refundAccountId;
        if (String(selected ?? '') !== String(account._id)) throw new apiError(409, 'Cash account differs from the immutable event routing');
    }
    if (!(event.occurredAt instanceof Date) || !Number.isFinite(+event.occurredAt) || +event.occurredAt > Date.now()) throw new apiError(409, 'Payment/refund event requires a verified actual date');
    for (const field of ['cashReceivedMinor', 'cashRefundMinor', 'creditIssuedMinor', 'creditRedeemedMinor', 'creditRestoredMinor'] as const) {
        if (!Number.isSafeInteger(event.financial?.[field]) || event.financial[field] < 0) throw new apiError(409, 'Payment/refund event requires verified monetary evidence');
    }
    if (event.occurredAt < cutoffAt) throw new apiError(409, 'Pre-cutover event is already excluded by opening balances');
    const order = await Order.findOne({_id: event.orderId, shopId: actor.shopId, type: 'INVOICE'}).session(session);
    if (!order || order.cancellationMode === 'LEGACY') throw new apiError(409, 'Invoice requires verified settlement history');
    await verifiedInvoiceFunding(order, session);
    // Cash fields alone represent physical money. Credit issuance/restoration
    // reduces invoice funding but MUST NOT be mistaken for cash leaving the till.
    const received = input.direction === 'RECEIPT';
    const amount = safeMinor(received ? event.financial.cashReceivedMinor : event.financial.cashRefundMinor);
    if (!amount) return {posted: false as const, reason: 'NO_CASH_MOVEMENT' as const};
    const transaction = await post(actor, {requestKey: input.requestKey, occurredAt: event.occurredAt.toISOString(),
        reason: `${received ? 'Invoice money received' : 'Invoice cash refunded'}: ${event.invoiceNo}`,
        postings: [{accountId: String(account._id), debitMinor: received ? amount : 0, creditMinor: received ? 0 : amount},
            {accountId: String(clearing._id), debitMinor: received ? 0 : amount, creditMinor: received ? amount : 0}]}, session,
        {kind: received ? 'INVOICE_RECEIPT' : 'INVOICE_REFUND', referenceId: String(event._id)});
    return {posted: true as const, transaction};
}

export async function validateInvoiceCashRouting(actor: Actor, routing: {receiptAccountId?: string, refundAccountId?: string},
    financial: {cashReceivedMinor: number, cashRefundMinor: number}, session: Session) {
    return validateRouting(actor, routing, financial, session);
}

async function cashierSaleEvent(actor: Actor, eventId: string, session: Session) {
    await owner(actor, session, false, true);
    const event = await InvoiceAdjustment.findOne({_id: id(eventId), shopId: actor.shopId}).session(session).lean();
    if (!event || event.kind !== 'SALE' || event.createdByRole !== 'CASHIER' || String(event.createdBy) !== String(actor._id) || event.cashRouting?.mode !== 'INTEGRATION_TEST' ||
        event.financial?.cashRefundMinor !== 0 || event.financial?.creditIssuedMinor !== 0 || event.financial?.creditRestoredMinor !== 0 ||
        process.env.BUSINESS_ACCOUNTING_ENABLED !== 'true' || process.env.NODE_ENV !== 'test' ||
        !await Order.exists({_id: event.orderId, shopId: actor.shopId, createdBy: actor._id, type: 'INVOICE'}).session(session)) throw new apiError(403, 'Cashier posting requires their own initial sale');
    return event;
}

export async function validateInvoiceSaleRouting(actor: Actor, routing: {receiptAccountId?: string, refundAccountId?: string}, eventId: string, session: Session) {
    const event = actor.role === 'CASHIER' ? await cashierSaleEvent(actor, eventId, session) : null;
    if (!event) {
        await owner(actor, session);
        const source = await InvoiceAdjustment.findOne({_id: id(eventId), shopId: actor.shopId, kind: 'SALE'}).session(session).lean();
        if (!source) throw new apiError(404, 'Sale event not found in shop');
        return validateRouting(actor, routing, source.financial, session);
    }
    return validateRouting(actor, routing, event.financial, session, true);
}

async function validateRouting(actor: Actor, routing: {receiptAccountId?: string, refundAccountId?: string},
    financial: {cashReceivedMinor: number, cashRefundMinor: number}, session: Session, cashierSale = false) {
    await owner(actor, session, false, cashierSale);
    const clearing = await FinancialAccount.findOne({shopId: actor.shopId, kind: 'SETTLEMENT_CLEARING'}).session(session);
    if (clearing?.isActive === false || !clearing?.cashIntegration || clearing.cashIntegration.state !== 'PREPARED' || clearing.cashIntegration.cutoffAt > new Date()) throw new apiError(409, 'Prepare and reconcile active cash/bank cutover before integration testing');
    for (const [amount, value, direction] of [[financial.cashReceivedMinor, routing.receiptAccountId, 'receipt'], [financial.cashRefundMinor, routing.refundAccountId, 'refund']] as const) {
        safeMinor(amount);
        if (amount && !value) throw new apiError(400, `Select an explicit ${direction} cash/bank account`);
        if (!amount && value) throw new apiError(400, `No ${direction} money movement requires an account`);
        if (value) {
            const {account, clearing: selected} = await preparedCashAccount(actor, value, session, cashierSale);
            if (String(selected._id) !== String(clearing._id)) throw new apiError(409, 'Selected account differs from prepared cutover');
            if (direction === 'refund' && (await getAccountBalance(actor, String(account._id), session)).balanceMinor < amount) throw new apiError(409, 'Insufficient cash or bank funds');
        }
    }
    return clearing.cashIntegration;
}

export async function selectInvoicePaymentAccounts(actor: Actor, session: Session) {
    await owner(actor, session, false, true);
    const clearing = await FinancialAccount.findOne({shopId: actor.shopId, kind: 'SETTLEMENT_CLEARING', isActive: {$ne: false}}).session(session);
    if (!clearing?.cashIntegration || clearing.cashIntegration.state !== 'PREPARED' || clearing.cashIntegration.cutoffAt > new Date()) throw new apiError(409, 'Prepared active cash/bank cutover required');
    return FinancialAccount.find({shopId: actor.shopId, _id: {$in: clearing.cashIntegration.accountIds}, cashCutoverId: clearing._id,
        kind: {$in: ['CASH', 'BANK']}, authority: 'JOURNAL', isActive: {$ne: false}}).select('_id name kind').sort({name: 1, _id: 1}).limit(100).session(session).lean();
}

export async function transferCashBank(actor: Actor, input: {fromAccountId: string, toAccountId: string,
    amountMinor: number, requestKey: string, occurredAt: string, reason: string}, session: Session) {
    const from = await preparedCashAccount(actor, input.fromAccountId, session), to = await preparedCashAccount(actor, input.toAccountId, session);
    const amount = safeMinor(input.amountMinor), date = utcDate(input.occurredAt);
    if (!amount || String(from.account._id) === String(to.account._id)) throw new apiError(400, 'Choose distinct accounts and a positive transfer');
    if (String(from.clearing._id) !== String(to.clearing._id) || date < from.cutoffAt || date < to.cutoffAt) throw new apiError(409, 'Transfer must follow the same prepared cutover');
    return post(actor, {...input, postings: [{accountId: String(from.account._id), debitMinor: 0, creditMinor: amount},
        {accountId: String(to.account._id), debitMinor: amount, creditMinor: 0}]}, session, {kind: 'TRANSFER'});
}

export async function reconcileBusinessCustomer(actor: Actor, customerId: string, session: Session) {
    await owner(actor, session);
    const customer = await Customer.findOne({_id: id(customerId), shopId: actor.shopId}).session(session);
    if (!customer) throw new apiError(404, 'Customer not found in shop');
    const issues: {code: string, invoiceId?: string}[] = [];
    try { await checkedCustomer(customer._id, actor.shopId, session); }
    catch (error) { if (!(error instanceof apiError)) throw error; issues.push({code: 'CUSTOMER_LEDGER_MISMATCH'}); }
    const debtEntries = await CustomerLedger.find({customerId: customer._id, shopId: actor.shopId, balanceType: {$ne: 'CREDIT'}}).session(session);
    const references = debtEntries.flatMap(row => row.referenceId ? [row.referenceId] : []);
    if (debtEntries.some(row => !row.referenceId)) issues.push({code: 'UNLINKED_DEBT_ENTRY'});
    const invoices = await Order.find({shopId: actor.shopId, type: 'INVOICE', $or: [{customerId: customer._id}, {_id: {$in: references}}]}).session(session);
    const invoiceIds = new Set(invoices.map(row => String(row._id)));
    if (references.some(value => !invoiceIds.has(String(value)))) issues.push({code: 'MISSING_OR_FOREIGN_INVOICE'});
    let due = 0n;
    for (const invoice of invoices) {
        try {
            // Legacy cancellation left amountDue on the invoice but reversed debt.
            // This is not evidence that the original cash was ever refunded.
            const legacyCancelled = invoice.status === 'CANCELLED' && invoice.cancellationMode !== 'SETTLED';
            const outstanding = legacyCancelled ? 0 : moneyMinor(invoice.amountDue);
            const ledger = debtEntries.filter(row => String(row.referenceId) === String(invoice._id));
            const ledgerDue = ledger.reduce((sum, row) => sum + BigInt(signedLedgerMinor(row)), 0n);
            if (ledgerDue !== BigInt(outstanding) || (invoice.customerId && String(invoice.customerId) !== String(customer._id))) issues.push({code: 'INVOICE_DEBT_MISMATCH', invoiceId: String(invoice._id)});
            if (!legacyCancelled) await verifiedInvoiceFunding(invoice, session);
            else if (moneyMinor(invoice.paidAmount)) issues.push({code: 'LEGACY_CANCELLATION_CASH_UNKNOWN', invoiceId: String(invoice._id)});
            due += BigInt(outstanding);
        } catch (error) { if (!(error instanceof apiError)) throw error; issues.push({code: 'INVOICE_RECONCILIATION_REQUIRED', invoiceId: String(invoice._id)}); }
    }
    const invoiceOutstandingMinor = signedBalance(due, 0n, 'DEBIT');
    if (invoiceOutstandingMinor !== moneyMinor(customer.remainingMoney)) issues.push({code: 'CUSTOMER_INVOICE_TOTAL_MISMATCH'});
    return {customerId: String(customer._id), debtMinor: moneyMinor(customer.remainingMoney), storeCreditMinor: customer.storeCreditBalanceMinor ?? 0,
        invoiceOutstandingMinor, reconciled: issues.length === 0, issues};
}

export async function reconcileCashBank(actor: Actor, input: {clearingAccountId: string, page?: number, limit?: number}, session: Session) {
    await owner(actor, session);
    const clearing = await accountInShop(actor, input.clearingAccountId, session), config = clearing.cashIntegration;
    if (clearing.kind !== 'SETTLEMENT_CLEARING' || !config) throw new apiError(409, 'Prepared cutover required');
    const page = input.page ?? 1, limit = input.limit ?? 20;
    if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new apiError(400, 'Invalid reconciliation pagination');
    const query = {shopId: actor.shopId, occurredAt: {$gte: config.cutoffAt}};
    const events = await InvoiceAdjustment.find(query).sort({occurredAt: 1, _id: 1}).skip((page - 1) * limit).limit(limit).session(session).lean();
    const count = await InvoiceAdjustment.countDocuments(query).session(session);
    const entries = [];
    for (const event of events) {
        const issues: string[] = [];
        const order = await Order.findOne({_id: event.orderId, shopId: actor.shopId, type: 'INVOICE'}).session(session);
        if (event.sourceQuotationId && !await Order.exists({_id: event.sourceQuotationId, shopId: actor.shopId, type: 'QUOTATION', status: 'CONVERTED'}).session(session)) issues.push('QUOTATION_SOURCE_MISMATCH');
        if (event.createdByRole === 'CASHIER' && (event.kind !== 'SALE' || String(event.createdBy) !== String(order?.createdBy) ||
            event.financial?.cashRefundMinor !== 0 || event.financial?.creditIssuedMinor !== 0 || event.financial?.creditRestoredMinor !== 0)) issues.push('CASHIER_EVENT_PERMISSION_MISMATCH');
        if (!order || order.cancellationMode === 'LEGACY') issues.push('INVOICE_RECONCILIATION_REQUIRED');
        else try {await verifiedInvoiceFunding(order, session);} catch (error) {if (!(error instanceof apiError)) throw error; issues.push('INVOICE_RECONCILIATION_REQUIRED');}
        for (const [kind, amount] of [['INVOICE_RECEIPT', event.financial?.cashReceivedMinor], ['INVOICE_REFUND', event.financial?.cashRefundMinor]] as const) {
            if (!Number.isSafeInteger(amount) || amount < 0) {issues.push(`INVALID_${kind}_EVIDENCE`); continue;}
            const journals = await BusinessTransaction.find({shopId: actor.shopId, 'source.kind': kind, 'source.referenceId': event._id}).limit(2).session(session);
            if (journals.length > 1) issues.push(`DUPLICATE_${kind}`);
            const journal = journals[0];
            if (!journal) {if (amount) issues.push(`MISSING_${kind}`); continue;}
            const cash = journal.postings.find(row => config.accountIds.some(value => String(value) === String(row.accountId)));
            const control = journal.postings.find(row => String(row.accountId) === String(clearing._id));
            const receipt = kind === 'INVOICE_RECEIPT';
            const expectedAccount = receipt ? event.cashRouting?.receiptAccountId : event.cashRouting?.refundAccountId;
            if (event.cashRouting && (!expectedAccount || String(cash?.accountId) !== String(expectedAccount))) issues.push(`ROUTING_MISMATCH_${kind}`);
            if (!amount || journal.postings.length !== 2 || !cash || !control || +journal.occurredAt !== +event.occurredAt ||
                cash.debitMinor !== (receipt ? amount : 0) || cash.creditMinor !== (receipt ? 0 : amount) ||
                control.debitMinor !== (receipt ? 0 : amount) || control.creditMinor !== (receipt ? amount : 0)) issues.push(`MISMATCH_${kind}`);
        }
        entries.push({eventId: String(event._id), invoiceNo: event.invoiceNo, issues});
    }
    // Disabled-mode and legacy sales may have no initial funding event. Missing
    // or duplicate evidence is reported, never reconstructed from paidAmount.
    const missingInitial = await Order.aggregate([{$match: {shopId: new mongoose.Types.ObjectId(String(actor.shopId)), type: 'INVOICE', createdAt: {$gte: config.cutoffAt}}},
        {$lookup: {from: InvoiceAdjustment.collection.collectionName, let: {orderId: '$_id', shopId: '$shopId'}, pipeline: [{$match: {$expr: {$and: [{$eq: ['$orderId', '$$orderId']}, {$eq: ['$shopId', '$$shopId']}, {$eq: ['$kind', 'SALE']}]}}}, {$limit: 2}], as: 'sale'}},
        {$facet: {
            missingCount: [{$match: {'sale.0': {$exists: false}}}, {$count: 'value'}],
            missingEntries: [{$match: {'sale.0': {$exists: false}}}, {$sort: {createdAt: 1, _id: 1}}, {$skip: (page - 1) * limit}, {$limit: limit}, {$project: {invoiceNo: 1}}],
            duplicateCount: [{$match: {'sale.1': {$exists: true}}}, {$count: 'value'}],
            duplicateEntries: [{$match: {'sale.1': {$exists: true}}}, {$sort: {createdAt: 1, _id: 1}}, {$skip: (page - 1) * limit}, {$limit: limit}, {$project: {invoiceNo: 1}}]
        }}
    ]).session(session).option({maxTimeMS: 5000});
    const balances = [];
    for (const value of config.accountIds) balances.push({accountId: String(value), ...await getAccountBalance(actor, String(value), session)});
    const orphaned = await BusinessTransaction.aggregate([{$match: {shopId: new mongoose.Types.ObjectId(String(actor.shopId)), 'postings.accountId': clearing._id, 'source.kind': {$in: ['INVOICE_RECEIPT', 'INVOICE_REFUND']}}},
        {$lookup: {from: InvoiceAdjustment.collection.collectionName, let: {eventId: '$source.referenceId', shopId: '$shopId'}, pipeline: [{$match: {$expr: {$and: [{$eq: ['$_id', '$$eventId']}, {$eq: ['$shopId', '$$shopId']}, {$gte: ['$occurredAt', config.cutoffAt]}]}}}], as: 'event'}},
        {$match: {'event.0': {$exists: false}}}, {$facet: {count: [{$count: 'value'}], entries: [{$sort: {occurredAt: 1, _id: 1}}, {$skip: (page - 1) * limit}, {$limit: limit}, {$project: {source: 1}}]}}
    ]).session(session).option({maxTimeMS: 5000});
    const undated = {shopId: actor.shopId, $or: [{occurredAt: {$exists: false}}, {occurredAt: null}]};
    const undatedCount = await InvoiceAdjustment.countDocuments(undated).session(session);
    const undatedEntries = await InvoiceAdjustment.find(undated).select('_id invoiceNo').sort({_id: 1}).skip((page - 1) * limit).limit(limit).session(session).lean();
    return {state: 'PREPARED' as const, livePostingEnabled: false, cutoffAt: config.cutoffAt, balances, entries,
        pagination: {currentPage: page, limit, recordCount: count, totalPages: Math.ceil(count / limit)},
        missingInitialEvents: {recordCount: missingInitial[0]?.missingCount[0]?.value ?? 0, entries: missingInitial[0]?.missingEntries ?? []},
        duplicateInitialEvents: {recordCount: missingInitial[0]?.duplicateCount[0]?.value ?? 0, entries: missingInitial[0]?.duplicateEntries ?? []},
        orphanedCashJournals: {recordCount: orphaned[0]?.count[0]?.value ?? 0, entries: orphaned[0]?.entries ?? []},
        undatedEvents: {recordCount: undatedCount, entries: undatedEntries}};
}

export async function createBusinessBrand(actor: Actor, input: {name: string, entityIds: string[]}, session: Session) {
    await owner(actor, session);
    const name = text(input.name, 100, 'brand name'), nameKey = name.toLowerCase();
    if (!Array.isArray(input.entityIds) || input.entityIds.length > 20) throw new apiError(400, 'Valid business links required');
    const entityIds = input.entityIds.map(id).sort();
    if (new Set(entityIds).size !== entityIds.length) throw new apiError(400, 'Duplicate business links');
    for (const entityId of entityIds) await getBusinessEntity(actor, entityId, session);
    const existing = await BusinessBrand.findOne({shopId: actor.shopId, nameKey}).session(session);
    if (existing) {
        if (existing.entityIds.map(String).sort().join() !== entityIds.join()) throw new apiError(409, 'Brand already has different business links');
        return existing;
    }
    await owner(actor, session, true);
    const [brand] = await BusinessBrand.create([{shopId: actor.shopId, name, nameKey, entityIds}], {session});
    return brand!;
}
export async function setBusinessBrandEntities(actor: Actor, brandId: string, entityIds: string[], expectedEntityIds: string[], session: Session) {
    await owner(actor, session);
    if (!Array.isArray(entityIds) || !Array.isArray(expectedEntityIds) || entityIds.length > 20 || expectedEntityIds.length > 20) throw new apiError(400, 'Valid current and replacement business links required');
    const desired = entityIds.map(id).sort(), expected = expectedEntityIds.map(id).sort();
    if (new Set(desired).size !== desired.length || new Set(expected).size !== expected.length) throw new apiError(400, 'Duplicate business links');
    const brand = await BusinessBrand.findOne({_id: id(brandId), shopId: actor.shopId}).session(session);
    if (!brand) throw new apiError(404, 'Brand not found in shop');
    for (const entityId of desired) await getBusinessEntity(actor, entityId, session);
    if (brand.entityIds.map(String).sort().join() === desired.join()) return brand;
    if (brand.entityIds.map(String).sort().join() !== expected.join()) throw new apiError(409, 'Brand links changed; reload before editing');
    await owner(actor, session, true);
    const result = await BusinessBrand.findOneAndUpdate({_id: brand._id, shopId: actor.shopId, entityIds: brand.entityIds}, {$set: {entityIds: desired}}, {session, new: true, runValidators: true});
    if (!result) throw new apiError(409, 'Brand links changed; reload before editing');
    return result;
}
export async function linkProductBrand(actor: Actor, productId: string, brandId: string, session: Session) {
    await owner(actor, session);
    const product = await Product.findOne({_id: id(productId), shopId: actor.shopId}).session(session), brand = await BusinessBrand.findOne({_id: id(brandId), shopId: actor.shopId}).session(session);
    if (!product || !brand || product.brand.trim().toLowerCase() !== brand.nameKey) throw new apiError(400, 'Product and matching brand must belong to this shop');
    for (const entityId of brand.entityIds) await getBusinessEntity(actor, String(entityId), session);
    await owner(actor, session, true);
    return ProductBrandLink.findOneAndUpdate({shopId: actor.shopId, productId: product._id}, {$set: {brandId: brand._id}}, {session, upsert: true, new: true, runValidators: true});
}
export async function getProductBusinessLinks(actor: Actor, productId: string, session: Session) {
    await owner(actor, session);
    const product = await Product.findOne({_id: id(productId), shopId: actor.shopId}).session(session);
    if (!product) throw new apiError(404, 'Product not found in shop');
    const link = await ProductBrandLink.findOne({shopId: actor.shopId, productId: product._id}).session(session);
    if (!link) return null;
    const brand = await BusinessBrand.findOne({_id: link.brandId, shopId: actor.shopId}).session(session).lean();
    if (!brand || product.brand.trim().toLowerCase() !== brand.nameKey) return null;
    const entities = [];
    for (const entityId of brand.entityIds) entities.push(await getBusinessEntity(actor, String(entityId), session));
    return {brand, entities};
}
