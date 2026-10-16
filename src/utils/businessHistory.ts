import mongoose from 'mongoose';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessEntity} from '../models/businessEntity.model.js';
import {Customer} from '../models/customer.model.js';
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {GoodsReceipt} from '../models/goodsReceipt.model.js';
import {SupplierSettlement} from '../models/supplierSettlement.model.js';
import {SupplierCutover} from '../models/supplierCutover.model.js';
import {Order} from '../models/order.model.js';
import {apiError} from './apiError.js';
import {balancedPostings, signedBalance} from './businessAccounting.js';
import {signedLedgerMinor} from './invoiceSettlement.js';

export const journalTypes = ['MANUAL', 'OPENING', 'REVERSAL', 'INVOICE_RECEIPT', 'INVOICE_REFUND', 'TRANSFER', 'SUPPLIER_OPENING', 'PURCHASE_RECEIPT', 'SUPPLIER_PAYMENT', 'SUPPLIER_RETURN', 'SUPPLIER_REVERSAL'];
export const legacyTypes = ['PURCHASE', 'CANCELLATION', 'PAYMENT', 'ADJUSTMENT', 'CREDIT_ISSUED', 'CREDIT_REDEEMED', 'CREDIT_RESTORED'];
export const journalCoverage = {mode:'INTEGRATION_TEST', complete:false, livePostingEnabled:false,
    records:'BUSINESS_JOURNAL', excludes:['Unposted legacy activity','Noncash settlement events without a journal','Deferred supplier receipts, supplier refund-due balances and full inventory valuation']};

export function historyFilters(input: {from?: unknown, to?: unknown, q?: unknown, type?: unknown, sourceId?: unknown}, types: string[]) {
    function date(value: unknown) {
        if (typeof value !== 'string') throw new apiError(400, 'Canonical UTC date required');
        const result = new Date(value);
        if (!Number.isFinite(+result) || result.toISOString() !== value || +result > Date.now()) throw new apiError(400, 'Valid non-future canonical UTC date required');
        return result;
    }
    const from = input.from === undefined ? null : date(input.from), to = input.to === undefined ? null : date(input.to);
    if (from && to && from >= to) throw new apiError(400, 'History end must follow its start');
    if (input.q !== undefined && (typeof input.q !== 'string' || input.q.length > 100)) throw new apiError(400, 'Search must be text of at most 100 characters');
    if (input.type !== undefined && (typeof input.type !== 'string' || !types.includes(input.type))) throw new apiError(400, 'Invalid transaction type');
    if (input.sourceId !== undefined && (typeof input.sourceId !== 'string' || !/^[a-f\d]{24}$/i.test(input.sourceId))) throw new apiError(400, 'Valid source reference required');
    return {from, to, type:input.type as string|undefined, sourceId:typeof input.sourceId==='string'?input.sourceId.toLowerCase():undefined,
        pattern:typeof input.q === 'string' && input.q.trim() ? new RegExp(input.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null};
}

// This pipeline is always preceded by a shop match, including for source search.
export function invoiceSourceLookup(shopId: any): any[] {
    return [{$lookup:{from:InvoiceAdjustment.collection.name, let:{event:'$source.referenceId',kind:'$source.kind'}, pipeline:[
        {$match:{shopId:new mongoose.Types.ObjectId(String(shopId)), $expr:{$and:[{$eq:['$_id','$$event']},{$in:['$$kind',['INVOICE_RECEIPT','INVOICE_REFUND']]}]}}},
        {$project:{invoiceNo:1, orderId:1}}
    ], as:'invoiceSource'}}, {$set:{invoice:{$arrayElemAt:['$invoiceSource',0]}}}, {$unset:'invoiceSource'}, {$lookup:{from:GoodsReceipt.collection.name,let:{event:'$source.referenceId',kind:'$source.kind'},pipeline:[{$match:{shopId:new mongoose.Types.ObjectId(String(shopId)),$expr:{$and:[{$eq:['$_id','$$event']},{$eq:['$$kind','PURCHASE_RECEIPT']}]}}},{$project:{reference:1,purchaseReference:1,purchaseOrderId:1}}],as:'receiptSource'}},{$set:{receipt:{$arrayElemAt:['$receiptSource',0]}}},{$unset:'receiptSource'},
    {$lookup:{from:SupplierSettlement.collection.name,let:{event:'$source.referenceId',kind:'$source.kind'},pipeline:[{$match:{shopId:new mongoose.Types.ObjectId(String(shopId)),$expr:{$and:[{$eq:['$_id','$$event']},{$in:['$$kind',['SUPPLIER_PAYMENT','SUPPLIER_RETURN','SUPPLIER_REVERSAL']]}]}}},{$project:{reference:1,receiptId:1,receiptReference:1,purchaseReference:1,reversalOf:1}}],as:'settlementSource'}},{$set:{supplierSettlement:{$arrayElemAt:['$settlementSource',0]}}},{$unset:'settlementSource'}];
}

// Batch enrichment is read-only. Actor names/roles never come from today's User.
export async function journalViews(shopId: any, journals: any[], session: mongoose.ClientSession, details=false) {
    if (!journals.length) return [];
    const ids = journals.map(row=>row._id), accountIds = journals.flatMap(row=>row.postings.map((p:any)=>p.accountId));
    const accounts = await FinancialAccount.find({shopId,_id:{$in:accountIds}}).session(session).lean();
    const entities = await BusinessEntity.find({shopId,_id:{$in:accounts.flatMap(a=>a.entityId?[a.entityId]:[])}}).session(session).lean();
    const customers = await Customer.find({shopId,_id:{$in:entities.flatMap(e=>e.customerId?[e.customerId]:[])}}).select('_id name').session(session).lean();
    const receipts=await GoodsReceipt.find({shopId,_id:{$in:journals.filter(j=>j.source.kind==='PURCHASE_RECEIPT').map(j=>j.source.referenceId)}}).session(session).lean();
    const settlements=await SupplierSettlement.find({shopId,_id:{$in:journals.filter(j=>['SUPPLIER_PAYMENT','SUPPLIER_RETURN','SUPPLIER_REVERSAL'].includes(j.source.kind)).map(j=>j.source.referenceId)}}).session(session).lean();
    const supplierReversals=await SupplierSettlement.find({shopId,reversalOf:{$in:settlements.map(e=>e._id)}}).session(session).lean();
    const supplierRelatedJournals=await BusinessTransaction.find({shopId,'source.kind':{$in:['SUPPLIER_PAYMENT','SUPPLIER_RETURN','SUPPLIER_REVERSAL']},'source.referenceId':{$in:[...settlements.flatMap(e=>e.reversalOf?[e.reversalOf]:[]),...supplierReversals.map(e=>e._id)]}}).select('_id source occurredAt').session(session).lean();
    const cutovers=await SupplierCutover.find({shopId,_id:{$in:journals.filter(j=>j.source.kind==='SUPPLIER_OPENING').map(j=>j.source.referenceId)}}).session(session).lean();
    const events = await InvoiceAdjustment.find({shopId,_id:{$in:journals.filter(j=>['INVOICE_RECEIPT','INVOICE_REFUND'].includes(j.source.kind)).map(j=>j.source.referenceId)}}).session(session).lean();
    const orders = await Order.find({shopId,_id:{$in:events.flatMap(e=>[e.orderId,...(e.sourceQuotationId?[e.sourceQuotationId]:[])])}}).select('_id invoiceNo customerId type').session(session).lean();
    const counterparties=await Customer.find({shopId,_id:{$in:orders.flatMap(o=>o.customerId?[o.customerId]:[])}}).select('_id name').session(session).lean();
    const customerEntities=await BusinessEntity.find({shopId,customerId:{$in:counterparties.map(c=>c._id)}}).select('_id customerId roles').session(session).lean();
    const reversals = await BusinessTransaction.find({shopId,'source.kind':'REVERSAL','source.referenceId':{$in:ids}}).select('_id source occurredAt').session(session).lean();
    return journals.map(journal=>{
        const postings = balancedPostings(journal.postings.map((p:any)=>({accountId:String(p.accountId),debitMinor:p.debitMinor,creditMinor:p.creditMinor}))).map(p=>{
            const account=accounts.find(a=>String(a._id)===p.accountId);
            if(!account)throw new apiError(409,'Posted account unavailable in shop; reconciliation required');
            const entity=entities.find(e=>String(e._id)===String(account.entityId));
            if(account.entityId&&!entity)throw new apiError(409,'Posted business identity unavailable; reconciliation required');
            const customer=entity?.customerId?customers.find(c=>String(c._id)===String(entity.customerId)):null;
            return {...p,account:{_id:account._id,name:account.name,kind:account.kind,normalSide:account.normalSide},
                businessEntity:entity?{_id:entity._id,name:entity.customerId?customer?.name??null:entity.name??null,customerId:entity.customerId??null}:null,
                balanceDeltaMinor:signedBalance(BigInt(p.debitMinor),BigInt(p.creditMinor),account.normalSide as 'DEBIT'|'CREDIT'),
                moneyInMinor:['CASH','BANK'].includes(account.kind)?p.debitMinor:null,
                moneyOutMinor:['CASH','BANK'].includes(account.kind)?p.creditMinor:null};
        });
        const event=['INVOICE_RECEIPT','INVOICE_REFUND'].includes(journal.source.kind)?events.find(e=>String(e._id)===String(journal.source.referenceId)):null, order=event?orders.find(o=>String(o._id)===String(event.orderId)&&o.type==='INVOICE'):null;
        const customer=order?counterparties.find(c=>String(c._id)===String(order.customerId)):null;
        const customerEntity=customer?customerEntities.find(e=>String(e.customerId)===String(customer._id)):null;
        const receipt=receipts.find(r=>String(r._id)===String(journal.source.referenceId)),cutover=cutovers.find(c=>String(c._id)===String(journal.source.referenceId));
        const settlement=settlements.find(e=>String(e._id)===String(journal.source.referenceId));
        const supplierEntity=entities.find(e=>String(e._id)===String(receipt?.supplierId??cutover?.supplierId??settlement?.supplierId));
        const supplierCustomer=supplierEntity?.customerId?customers.find(c=>String(c._id)===String(supplierEntity.customerId)):null;
        return {eventId:journal._id,recordKind:'BUSINESS_JOURNAL',eventType:journal.source.kind,currency:journal.currency,
            occurredAt:journal.occurredAt??null,recordedAt:journal.recordedAt??null,timestampBasis:'EFFECTIVE_AND_RECORDED',reason:journal.reason,
            actor:{_id:journal.createdBy??null,name:journal.createdByName??null,role:journal.createdByRole??(event&&String(event.createdBy)===String(journal.createdBy)?event.createdByRole??null:null)},
            source:{kind:journal.source.kind,referenceId:journal.source.referenceId},
            sourceDocument:settlement?{settlementId:settlement._id,reference:settlement.reference,receiptId:settlement.receiptId??null,receiptReference:settlement.receiptReference??null,purchaseReference:settlement.purchaseReference??null,reversalOf:settlement.reversalOf??null}:order&&event?{orderId:order._id,invoiceNo:order.invoiceNo,eventId:event._id,eventType:event.kind,sourceQuotationId:orders.find(o=>String(o._id)===String(event.sourceQuotationId)&&o.type==='QUOTATION')?event.sourceQuotationId:null}:receipt?{receiptId:receipt._id,reference:receipt.reference,purchaseOrderId:receipt.purchaseOrderId,purchaseReference:receipt.purchaseReference}:cutover?{cutoverId:cutover._id,cutoffAt:cutover.cutoffAt}:null,
            counterparty:customer?{customerId:customer._id,name:customer.name,entityId:customerEntity?._id??null}:supplierEntity?{entityId:supplierEntity._id,name:supplierCustomer?.name??supplierEntity.name??null}:null,
            ...(details?{businessAction:settlement?{settlementId:settlement._id,kind:settlement.kind,amountMinor:settlement.amountMinor,items:settlement.items,allocation:'UNAPPLIED_SUPPLIER_LEVEL',reversalOf:settlement.reversalOf??null}:event?{eventId:event._id,eventType:event.kind,occurredAt:event.occurredAt??null,financial:event.financial,movements:event.movements,revisionBefore:event.revisionBefore,revisionAfter:event.revisionAfter}:receipt?{receiptId:receipt._id,items:receipt.items,totalMinor:receipt.totalMinor,accountingStatus:receipt.accountingStatus}:cutover?{cutoffAt:cutover.cutoffAt,openingBalanceMinor:cutover.openingBalanceMinor,ownerConfirmedAt:cutover.ownerConfirmedAt}:null}:{}),
            amountMinor:signedBalance(postings.reduce((sum,p)=>sum+BigInt(p.debitMinor),0n),0n,'DEBIT'),postings,
            reversalOf:journal.source.kind==='REVERSAL'?journal.source.referenceId:supplierRelatedJournals.find(j=>String(j.source.referenceId)===String(settlement?.reversalOf))?._id??null,
            reversedBy:[...reversals.filter(r=>String(r.source.referenceId)===String(journal._id)).map(r=>({_id:r._id,occurredAt:r.occurredAt})),...supplierRelatedJournals.filter(j=>supplierReversals.some(r=>String(r._id)===String(j.source.referenceId)&&String(r.reversalOf)===String(settlement?._id))).map(j=>({_id:j._id,occurredAt:j.occurredAt}))],
            runningBalanceMinor:null};
    });
}

export async function legacyViews(shopId:any, account:any, entity:any, rows:any[], session:mongoose.ClientSession) {
    const events=await InvoiceAdjustment.find({shopId,_id:{$in:rows.flatMap(r=>r.adjustmentId?[r.adjustmentId]:[])}}).session(session).lean();
    const orders=await Order.find({shopId,_id:{$in:rows.flatMap(r=>r.referenceId?[r.referenceId]:[])}}).select('_id invoiceNo createdBy createdByName').session(session).lean();
    return rows.map(row=>{
        const order=orders.find(o=>String(o._id)===String(row.referenceId));
        const event=events.find(e=>String(e._id)===String(row.adjustmentId)&&String(e.orderId)===String(row.referenceId));
        const actorSource=event&&String(event.createdBy)===String(row.createdBy)?event:row.description==='PURCHASE'&&order&&String(order.createdBy)===String(row.createdBy)?order:null;
        const delta=signedLedgerMinor(row), debit=account.normalSide==='DEBIT'?Math.max(delta,0):Math.max(-delta,0), credit=account.normalSide==='CREDIT'?Math.max(delta,0):Math.max(-delta,0);
        return {eventId:row._id,recordKind:'CUSTOMER_LEDGER',eventType:row.description,currency:'PKR',
            occurredAt:event?.occurredAt??null,recordedAt:row.createdAt??null,timestampBasis:event?'EFFECTIVE_AND_RECORDED':'RECORDED_ONLY',
            actor:{_id:row.createdBy??null,name:actorSource?.createdByName??null,role:actorSource&&'createdByRole' in actorSource?actorSource.createdByRole??null:null},
            source:{kind:event?'INVOICE_EVENT':'LEGACY_INVOICE',referenceId:event?event._id:row.referenceId??null},
            sourceDocument:order?{orderId:order._id,invoiceNo:order.invoiceNo,eventId:event?._id??null,eventType:event?.kind??null}:null,
            amountMinor:Math.abs(delta),postings:[{accountId:account._id,account:{_id:account._id,name:account.name,kind:account.kind,normalSide:account.normalSide},businessEntity:{_id:entity._id,name:entity.name,customerId:entity.customerId},debitMinor:debit,creditMinor:credit,balanceDeltaMinor:delta,moneyInMinor:null,moneyOutMinor:null}],
            runningBalanceMinor:row.runningBalanceMinor??null,reversalOf:null,reversedBy:[],
            correctionEventId:event&&['CANCELLATION','ADJUSTMENT'].includes(event.kind)?event._id:null};
    });
}
