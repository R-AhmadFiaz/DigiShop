import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {Product} from '../models/product.model.js';
import {Customer} from '../models/customer.model.js';
import {CustomerLedger} from '../models/customerLedger.model.js';
import {Order} from '../models/order.model.js';
import {BusinessEntity} from '../models/businessEntity.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {SupplierCutover} from '../models/supplierCutover.model.js';
import {GoodsReceipt} from '../models/goodsReceipt.model.js';
import * as accounts from './businessAccounts.js';
import {moneyMinor,safeMinor} from './invoiceAccounting.js';
import {invoiceAccountingEnabled} from './invoiceAccountingIntegration.js';
import {apiError} from './apiError.js';
import {Shop} from '../models/shop.model.js';

export function setupId(value:unknown){if(typeof value!=='string'||!/^[a-f\d]{24}$/i.test(value))throw new apiError(400,'Valid setup selection required');return value.toLowerCase();}
export function setupText(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max)throw new apiError(400,'Provide valid setup details');return value.trim();}
export function setupDate(value:unknown){if(typeof value!=='string')throw new apiError(400,'Valid cutoff required');const result=new Date(value);if(!Number.isFinite(+result)||result.toISOString()!==value||+result>Date.now())throw new apiError(400,'Cutoff must be a non-future UTC timestamp');return result;}
function signed(value:bigint){if(value>BigInt(Number.MAX_SAFE_INTEGER)||value< -BigInt(Number.MAX_SAFE_INTEGER))throw new apiError(409,'Setup money exceeds safe range');return Number(value);}
export function normalizeSetup(body:any){
    if(!body||!Array.isArray(body.cash)||body.cash.length>20||!Array.isArray(body.suppliers)||body.suppliers.length>100)throw new apiError(400,'Review up to 20 cash/bank accounts and 100 suppliers');
    const cash=body.cash.map((r:any)=>({accountId:setupId(r?.accountId),amountMinor:safeMinor(r?.amountMinor)})).sort((a:any,b:any)=>a.accountId.localeCompare(b.accountId));
    const suppliers=body.suppliers.map((r:any)=>{
        if(!Array.isArray(r?.reviews)||r.reviews.length>100)throw new apiError(400,'Review up to 100 deliveries per supplier');
        const reviews=r.reviews.map((v:any)=>({receiptId:setupId(v?.receiptId),unpaidMinor:safeMinor(v?.unpaidMinor),reason:setupText(v?.reason,300)})).sort((a:any,b:any)=>a.receiptId.localeCompare(b.receiptId));
        if(new Set(reviews.map((v:any)=>v.receiptId)).size!==reviews.length)throw new apiError(400,'Review each delivery once');
        return {supplierId:setupId(r.supplierId),otherOpeningMinor:safeMinor(r.otherOpeningMinor),reviews};
    }).sort((a:any,b:any)=>a.supplierId.localeCompare(b.supplierId));
    if(new Set(cash.map((r:any)=>r.accountId)).size!==cash.length||new Set(suppliers.map((r:any)=>r.supplierId)).size!==suppliers.length)throw new apiError(400,'Duplicate setup selection');
    if(!Number.isSafeInteger(body.expectedNetAssetsMinor))throw new apiError(400,'Enter the expected net business value in paisa');
    return {cutoffAt:setupDate(body.cutoffAt).toISOString(),reason:setupText(body.reason,300),cash,suppliers,expectedNetAssetsMinor:body.expectedNetAssetsMinor,
        acknowledgeLegacyCustomerBalances:body.acknowledgeLegacyCustomerBalances===true,acknowledgeUnallocatedEquity:body.acknowledgeUnallocatedEquity===true};
}

// Everything is read in the caller's MongoDB snapshot. Existing balances are never repaired.
export async function setupEvidence(actor:any,input:any,session:mongoose.ClientSession){
    const filter={shopId:actor.shopId};
    // Fail closed rather than silently truncate a large opening review.
    const products=await Product.find(filter).sort({_id:1}).limit(1001).session(session).lean();
    const customers=await Customer.find(filter).sort({_id:1}).limit(1001).session(session).lean();
    const suppliers=await BusinessEntity.find({...filter,roles:'SUPPLIER'}).sort({_id:1}).limit(101).session(session).lean();
    const financial=await FinancialAccount.find(filter).sort({_id:1}).limit(501).session(session).lean();
    const journals=await BusinessTransaction.find(filter).sort({_id:1}).limit(1001).session(session).lean();
    const receipts=await GoodsReceipt.find(filter).sort({_id:1}).limit(10001).session(session).lean();
    const cutovers=await SupplierCutover.find(filter).sort({_id:1}).session(session).lean();
    const ledger=await CustomerLedger.find(filter).sort({_id:1}).limit(10001).session(session).lean();
    const orders=await Order.find(filter).select('_id revision totalPrice paidAmount amountDue status customerId updatedAt').sort({_id:1}).limit(10001).session(session).lean();
    const blockers:string[]=[],inventory:any[]=[],customerRows:any[]=[],supplierRows:any[]=[],cashRows:any[]=[];
    const enabled=invoiceAccountingEnabled();
    const shop=await Shop.findById(actor.shopId).session(session).lean();
    if(shop?.accounting?.strategy==='CLEAN_START'){
        if(customers.some(c=>c.remainingMoney!==0||(c.storeCreditBalanceMinor??0)!==0))blockers.push('Clean start cannot carry demo customer debt or store credit. Use explicit reviewed reconciliation; balances will not be cleared.');
        if(input?.suppliers?.some((s:any)=>s.otherOpeningMinor!==0||s.reviews.some((r:any)=>r.unpaidMinor!==0)))blockers.push('Clean start requires explicitly reviewed zero supplier opening debt.');
        if(journals.some(j=>!['OPENING','SUPPLIER_OPENING'].includes(j.source.kind)))blockers.push('Existing posted activity requires reviewed reconciliation, not a clean start.');
    }
    if(products.length>1000||customers.length>1000||suppliers.length>100||financial.length>500||journals.length>1000||receipts.length>10000||ledger.length>10000||orders.length>10000)blockers.push('This shop exceeds the guided review limits; a separately reviewed reconciliation is required.');
    if(!enabled)blockers.push('Financial confirmation is unavailable: accounting is disabled. Draft review is still available.');
    if(!input)blockers.push('Save a setup draft with a cutoff, declared balances and review acknowledgements.');
    const cutoff=input?new Date(input.cutoffAt):null;
    if(ledger.some(row=>!customers.some(c=>String(c._id)===String(row.customerId))))blockers.push('Customer ledger has a missing or foreign customer; reconcile before confirming.');
    if(orders.some(row=>row.amountDue>0&&row.status!=='CANCELLED'&&!customers.some(c=>String(c._id)===String(row.customerId))))blockers.push('An outstanding invoice has no valid customer in this shop.');
    if(receipts.some(row=>!suppliers.some(s=>String(s._id)===String(row.supplierId)))||cutovers.some(row=>!suppliers.some(s=>String(s._id)===String(row.supplierId))))blockers.push('Supplier delivery/opening has a missing supplier identity; reconcile before confirming.');
    let inventoryMinor=0n,debtMinor=0n,creditMinor=0n,cashMinor=0n,payableMinor=0n;
    for(const p of products){
        let value:number|null=null;
        try{if(!Number.isSafeInteger(p.stockQuantity)||p.stockQuantity<0)throw new apiError(409,'Invalid stock quantity');value=safeMinor(signed(BigInt(p.stockQuantity)*BigInt(moneyMinor(p.costPrice))));inventoryMinor+=BigInt(value);}catch(error){if(!(error instanceof apiError))throw error;blockers.push('Review quantity/cost precision for '+p.name);}
        if(cutoff&&p.updatedAt>cutoff)blockers.push('Product changed after the proposed cutoff: '+p.name+'. Choose a current cutoff and review again.');
        inventory.push({_id:p._id,name:p.name,quantity:p.stockQuantity,unitCostMinor:value===null?null:moneyMinor(p.costPrice),valueMinor:value});
    }
    for(const c of customers){
        let report:any;try{report=await accounts.reconcileBusinessCustomer(actor,String(c._id),session);debtMinor+=BigInt(report.debtMinor);creditMinor+=BigInt(report.storeCreditMinor);}catch(error){if(!(error instanceof apiError))throw error;report={reconciled:false,issues:[{code:'INVALID_EXISTING_BALANCE'}],debtMinor:null,storeCreditMinor:null};}
        if(!report.reconciled)blockers.push('Customer balance/history needs reconciliation: '+c.name+'. Existing balances will not be changed.');
        if(cutoff&&(c as any).updatedAt>cutoff)blockers.push('Customer changed after cutoff: '+c.name);
        customerRows.push({_id:c._id,name:c.name,...report});
    }
    const activeCash=financial.filter(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false);
    if(!activeCash.length)blockers.push('Create at least one cash/bank account before confirming.');
    if(input&&input.cash.length!==activeCash.length)blockers.push('Explicitly review every active cash/bank account.');
    for(const a of activeCash){
        const selected=input?.cash.find((r:any)=>r.accountId===String(a._id));
        const opening=journals.find(j=>j.source.kind==='OPENING'&&String(j.source.referenceId)===String(a._id));
        const amount=selected?.amountMinor;
        if(!selected)blockers.push('Enter the verified balance for '+a.name);
        const activity=journals.filter(j=>j.postings.some(p=>String(p.accountId)===String(a._id)));
        if(activity.some(j=>j.source.kind!=='OPENING'))blockers.push('Cash/bank already has business activity: '+a.name+'. Initial setup cannot reset it.');
        if(opening&&opening.postings.find(p=>String(p.accountId)===String(a._id))?.debitMinor!==amount)blockers.push('Declared balance differs from immutable opening for '+a.name);
        if(a.cashCutoverId&&amount!==undefined&&(await accounts.getAccountBalance(actor,String(a._id),session)).balanceMinor!==amount)blockers.push('Declared balance differs from prepared cash/bank funds: '+a.name);
        if(opening&&!a.cashCutoverId&&cutoff&&+opening.occurredAt!==+cutoff)blockers.push('Unprepared opening must retain its original cutoff: '+a.name);
        if(amount!==undefined)cashMinor+=BigInt(amount);
        cashRows.push({_id:a._id,name:a.name,kind:a.kind,status:a.cashCutoverId?'COMPLETE':opening?'OPENING_RECORDED':'INCOMPLETE',openingMinor:opening?.postings.find(p=>String(p.accountId)===String(a._id))?.debitMinor??(a.cashCutoverId?0:null),declaredMinor:amount??null});
    }
    if(input?.cash.some((r:any)=>!activeCash.some(a=>String(a._id)===r.accountId)))blockers.push('Selected cash/bank account is missing, inactive or outside this shop.');
    const control=financial.find(a=>a.kind==='SETTLEMENT_CLEARING');
    if(control?.cashIntegration&&activeCash.some(a=>!control.cashIntegration!.accountIds.some(id=>String(id)===String(a._id))))blockers.push('Existing cash cutover cannot be extended automatically; separately reconcile additional accounts.');
    for(const s of suppliers){
        const cutover=cutovers.find(c=>String(c.supplierId)===String(s._id)),chosen=input?.suppliers.find((r:any)=>r.supplierId===String(s._id));
        const deliveries=receipts.filter(r=>String(r.supplierId)===String(s._id));
        let value:number|null=null,supplierReady=false;
        if(cutover){
            const report=await accounts.reconcileSupplier(actor,String(s._id),session);
            supplierReady=report.authoritative;
            if(!report.authoritative)blockers.push('Supplier opening/history needs reconciliation: '+s.name);else value=report.balanceMinor!;
        }else{
            if(!chosen)blockers.push('Review supplier opening: '+s.name);
            else{
                let sum=BigInt(chosen.otherOpeningMinor);
                if(chosen.reviews.length!==deliveries.length||deliveries.length>100)blockers.push('Review every deferred delivery for '+s.name+' (maximum 100).');
                for(const receipt of deliveries){const review=chosen.reviews.find((r:any)=>r.receiptId===String(receipt._id));if(!review||review.unpaidMinor>receipt.totalMinor||receipt.accountingStatus!=='DEFERRED'||(cutoff&&receipt.occurredAt>cutoff))blockers.push('Delivery review or cutoff is invalid: '+receipt.reference);else sum+=BigInt(review.unpaidMinor);}
                if(chosen.reviews.some((r:any)=>!deliveries.some(d=>String(d._id)===r.receiptId)))blockers.push('A delivery review does not belong to this supplier.');
                value=signed(sum);
            }
        }
        if(value!==null)payableMinor+=BigInt(value);
        supplierRows.push({_id:s._id,name:s.name,hasOpening:!!cutover,status:cutover?(supplierReady?'COMPLETE':'BLOCKED'):'INCOMPLETE',cutoffAt:cutover?.cutoffAt??null,openingMinor:cutover?.openingBalanceMinor??null,declaredMinor:value,deliveries:deliveries.map(r=>({_id:r._id,reference:r.reference,totalMinor:r.totalMinor,status:r.accountingStatus,occurredAt:r.occurredAt})),existingReviews:cutover?.reviews??[]});
    }
    if(input?.suppliers.some((r:any)=>!suppliers.some(s=>String(s._id)===r.supplierId)))blockers.push('Selected supplier is missing or outside this shop.');
    const inventoryAccounts=financial.filter(a=>a.kind==='INVENTORY');
    const inventoryJournals=journals.filter(j=>j.postings.some(p=>inventoryAccounts.some(a=>String(a._id)===String(p.accountId))));
    if(inventoryJournals.length)blockers.push('Inventory already has posted value. Do not duplicate an opening; a separate reconciliation is required.');
    if(journals.some(j=>j.source.kind==='OPENING'&&!activeCash.some(a=>String(a._id)===String(j.source.referenceId))))blockers.push('Other opening journals need separate reconciliation; they cannot be silently included in this setup.');
    if(journals.some(j=>!['OPENING','SUPPLIER_OPENING'].includes(j.source.kind)))blockers.push('Posted business activity already exists. Initial setup cannot reconstruct a historical cutoff; review existing accounts separately.');
    if(input&&!input.acknowledgeLegacyCustomerBalances)blockers.push('Acknowledge that customer debt and credit remain in their existing ledger.');
    if(input&&!input.acknowledgeUnallocatedEquity)blockers.push('Acknowledge that opening equity is unallocated and is not a new partner investment.');
    const assets=inventoryMinor+cashMinor+debtMinor,liabilities=payableMinor+creditMinor,net=assets-liabilities;
    const knownInventory=inventory.every(r=>r.valueMinor!==null),knownCustomers=customerRows.every(r=>r.debtMinor!==null&&r.storeCreditMinor!==null),knownCash=cashRows.every(r=>r.declaredMinor!==null),knownSuppliers=supplierRows.every(r=>r.declaredMinor!==null);
    const allKnown=knownInventory&&knownCustomers&&knownCash&&knownSuppliers;
    const difference=input&&allKnown?signed(net-BigInt(input.expectedNetAssetsMinor)):null;
    if(difference!==null&&difference!==0)blockers.push('Expected net business value differs from reviewed assets minus liabilities.');
    const digest=createHash('sha256').update(JSON.stringify({input,products,customers,suppliers,financial,journals,receipts,cutovers,ledger,orders,enabled})).digest('hex');
    return {digest,blockers:[...new Set(blockers)],available:enabled,inventory,customers:customerRows,cash:cashRows,suppliers:supplierRows,
        totals:{inventoryMinor:knownInventory?signed(inventoryMinor):null,cashMinor:knownCash?signed(cashMinor):null,customerDebtMinor:knownCustomers?signed(debtMinor):null,storeCreditMinor:knownCustomers?signed(creditMinor):null,supplierPayableMinor:knownSuppliers?signed(payableMinor):null,assetsMinor:knownInventory&&knownCustomers&&knownCash?signed(assets):null,liabilitiesMinor:knownCustomers&&knownSuppliers?signed(liabilities):null,netAssetsMinor:allKnown?signed(net):null,differenceMinor:difference,legacyNetCustomerMinor:knownCustomers?signed(debtMinor-creditMinor):null,journalBackedOpeningNetMinor:knownInventory&&knownCash&&knownSuppliers?signed(inventoryMinor+cashMinor-payableMinor):null},
        inventoryStatus:inventoryJournals.length?'BLOCKED':'REVIEW_REQUIRED',customerStatus:customerRows.some(c=>!c.reconciled)?'BLOCKED':'PRESERVED',
        note:'Opening snapshot only, not live inventory valuation or a complete profit/loss statement. Customer balances stay authoritative in the existing ledger; equity is not automatically assigned to partners.'};
}

export async function applySetup(actor:any,setup:any,evidence:any,session:mongoose.ClientSession){
    const input=setup.input,at=input.cutoffAt,reason=input.reason;
    // Claim reviewed existing records without altering quantities, prices or balances.
    for(const row of evidence.inventory){const p=await Product.findOne({_id:row._id,shopId:actor.shopId}).session(session);if(!p||p.stockQuantity!==row.quantity||moneyMinor(p.costPrice)!==row.unitCostMinor)throw new apiError(409,'Inventory changed; review again');await Product.updateOne({_id:p._id,shopId:actor.shopId},{$set:{updatedAt:new Date(Math.max(Date.now(),+p.updatedAt+1))}},{session,timestamps:false});}
    for(const row of evidence.customers){const c=await Customer.findOne({_id:row._id,shopId:actor.shopId}).session(session);if(!c)throw new apiError(409,'Customer changed; review again');await Customer.updateOne({_id:c._id,shopId:actor.shopId},{$set:{updatedAt:new Date(Math.max(Date.now(),+(c as any).updatedAt+1))}},{session,timestamps:false});}
    const ensure=(kind:any,code:string,name:string,entityId?:string)=>accounts.createFinancialAccount(actor,{kind,code,name,...(entityId?{entityId}:{})},session);
    const equity=await ensure('OPENING_EQUITY','EXISTING_SETUP_EQUITY','Unallocated existing business equity');
    const inventory=await ensure('INVENTORY','EXISTING_SETUP_INVENTORY','Opening inventory snapshot');
    const opening=(accountId:string,amountMinor:number)=>accounts.recordOpeningBalance(actor,{requestKey:'setup-'+String(setup._id)+'-'+accountId,accountId,equityAccountId:String(equity._id),amountMinor,occurredAt:at,reason,confirmation:'CONFIRM OPENING BALANCE'},session);
    if(evidence.totals.inventoryMinor>0)await opening(String(inventory._id),evidence.totals.inventoryMinor);
    for(const row of input.cash){const a=await FinancialAccount.findOne({_id:row.accountId,shopId:actor.shopId}).session(session);if(!a)throw new apiError(409,'Cash selection changed');const hasOpening=await BusinessTransaction.exists({shopId:actor.shopId,'source.kind':'OPENING','source.referenceId':a._id}).session(session);if(!hasOpening&&!a.cashCutoverId&&row.amountMinor>0)await opening(String(a._id),row.amountMinor);}
    let control=await FinancialAccount.findOne({shopId:actor.shopId,kind:'SETTLEMENT_CLEARING'}).session(session);
    if(!control)control=await ensure('SETTLEMENT_CLEARING','EXISTING_SETUP_CONTROL','Existing business cash cutover');
    if(!control.cashIntegration)await accounts.prepareCashBankCutover(actor,{clearingAccountId:String(control._id),cutoffAt:at,accounts:input.cash.map((r:any)=>({accountId:r.accountId,confirmedBalanceMinor:r.amountMinor})),confirmation:'PREPARE CASH BANK CUTOVER'},session);
    for(const supplier of evidence.suppliers){
        if(supplier.status==='COMPLETE')continue;
        const row=input.suppliers.find((r:any)=>r.supplierId===String(supplier._id));
        let payable=await FinancialAccount.findOne({shopId:actor.shopId,kind:'SUPPLIER_PAYABLE',entityId:supplier._id}).session(session);
        if(!payable)payable=await ensure('SUPPLIER_PAYABLE','SUPPLIER_'+supplier._id,'Payable - '+supplier.name,String(supplier._id));
        const offset=await ensure('PURCHASES_CLEARING','EXISTING_SETUP_PURCHASES','Received goods clearing');
        const preview=await accounts.previewSupplierCutover(actor,String(supplier._id),{page:1,limit:100},session);
        await accounts.initializeSupplierCutover(actor,String(supplier._id),{...row,requestKey:'setup-'+setup._id+'-'+supplier._id,confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt:at,payableAccountId:String(payable._id),offsetAccountId:String(offset._id),equityAccountId:String(equity._id),openingBalanceMinor:supplier.declaredMinor,evidenceDigest:preview.evidenceDigest,reason},session);
    }
    return {inventoryAccountId:inventory._id,equityAccountId:equity._id,clearingAccountId:control._id};
}
