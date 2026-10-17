import mongoose from 'mongoose';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {Shop} from '../models/shop.model.js';
import {User} from '../models/user.model.js';
import {Customer} from '../models/customer.model.js';
import {Order} from '../models/order.model.js';
import {BusinessSetup} from '../models/businessSetup.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {SupplierCutover} from '../models/supplierCutover.model.js';
import {BusinessEntity} from '../models/businessEntity.model.js';
import {AccountingActivationEvent} from '../models/accountingActivationEvent.model.js';
import {productionAccountingPermitted,accountingContext} from '../utils/accountingActivation.js';
import * as accounts from '../utils/businessAccounts.js';
import {safeMinor} from '../utils/invoiceAccounting.js';
import {asyncHandler} from '../utils/asyncHandler.js';
import {apiError} from '../utils/apiError.js';
import {apiResponse} from '../utils/apiResponse.js';

const digest=(value:any)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const permitted=()=>productionAccountingPermitted()||(process.env.NODE_ENV==='test'&&process.env.BUSINESS_ACCOUNTING_ENABLED==='true');
function text(value:any,max=300){if(typeof value!=='string'||!value.trim()||value.length>max)throw new apiError(400,'Provide valid confirmation details');return value.trim();}
function token(payload:any){const key=process.env.ACCESS_TOKEN_SECRET;if(!key)throw new apiError(503,'Server signing configuration unavailable');return createHmac('sha256',key).update(JSON.stringify(payload)).digest('hex');}

// Read existing authorities. Never reset balances, backfill events or alter stock.
async function readiness(actor:any,shop:any,session:mongoose.ClientSession){
    const setup=await BusinessSetup.findOne({shopId:shop._id,state:'CONFIRMED'}).session(session).lean();
    const blockers:string[]=[];
    if(!permitted())blockers.push('Production accounting permission is disabled on the server.');
    if(!setup)blockers.push('Confirm Existing Business Setup with reviewed cash, inventory, customer and supplier evidence first.');
    if(!['PREPARING','PAUSED'].includes(shop.accounting?.state??''))blockers.push('Begin preparation before requesting activation.');
    const customers=await Customer.find({shopId:shop._id}).sort({_id:1}).limit(1001).session(session).lean();
    const suppliers=await BusinessEntity.find({shopId:shop._id,roles:'SUPPLIER'}).sort({_id:1}).limit(101).session(session).lean();
    const financial=await FinancialAccount.find({shopId:shop._id}).sort({_id:1}).limit(501).session(session).lean();
    if(customers.length>1000||suppliers.length>100||financial.length>500)blockers.push('Shop exceeds guided activation limits; separately reviewed reconciliation required.');
    const customerReviews=[];
    for(const customer of customers){
        const report=await accounts.reconcileBusinessCustomer(actor,String(customer._id),session);
        customerReviews.push({id:String(customer._id),debtMinor:report.debtMinor,creditMinor:report.storeCreditMinor,reconciled:report.reconciled});
        if(!report.reconciled)blockers.push('Customer history requires reconciliation: '+customer.name);
        if(shop.accounting?.strategy==='CLEAN_START'&&!shop.accounting?.activatedAt&&(report.debtMinor!==0||report.storeCreditMinor!==0))blockers.push('Clean start requires zero reconciled customer debt and credit: '+customer.name+'. Nothing will be cleared automatically.');
    }
    const supplierReviews=[];
    for(const supplier of suppliers){
        const cutover=await SupplierCutover.findOne({shopId:shop._id,supplierId:supplier._id}).session(session).lean();
        if(!cutover){if(!shop.accounting?.activatedAt)blockers.push('Supplier opening review missing: '+supplier.name);supplierReviews.push({id:String(supplier._id),status:'UNPREPARED'});continue;}
        const report=await accounts.reconcileSupplier(actor,String(supplier._id),session);
        supplierReviews.push({id:String(supplier._id),report});
        if(!report.authoritative)blockers.push('Supplier reconciliation blocked: '+supplier.name);
        if(shop.accounting?.strategy==='CLEAN_START'&&!shop.accounting?.activatedAt&&cutover.openingBalanceMinor!==0)blockers.push('Clean start cannot import supplier opening debt: '+supplier.name);
    }
    const clearing=financial.find(a=>a.kind==='SETTLEMENT_CLEARING'&&a.isActive&&a.cashIntegration?.state==='PREPARED');
    if(!clearing)blockers.push('Cash/bank cutover is not prepared.');
    else for(const id of clearing.cashIntegration!.accountIds){const account=financial.find(a=>String(a._id)===String(id));if(!account||!account.isActive||String(account.cashCutoverId)!==String(clearing._id))blockers.push('Prepared cash/bank membership requires review.');}
    let cashReview:any=null;
    if(clearing){
        cashReview=await accounts.reconcileCashBank(actor,{clearingAccountId:String(clearing._id),page:1,limit:100},session);
        if(['missingInitialEvents','duplicateInitialEvents','orphanedCashJournals','undatedEvents'].some(key=>cashReview[key].recordCount>0)||cashReview.orphanedSupplierCashJournals.length||cashReview.supplierReconciliation.some((s:any)=>!s.authoritative))blockers.push('Cash/bank source reconciliation has unresolved records.');
        if(cashReview.pagination.recordCount>10000)blockers.push('Financial history exceeds guided activation review limits; separately reviewed reconciliation required.');
        const eventIssues=cashReview.entries.filter((e:any)=>e.issues.length);
        for(let page=2;page<=Math.min(cashReview.pagination.totalPages,100);page++){
            const batch=await accounts.reconcileCashBank(actor,{clearingAccountId:String(clearing._id),page,limit:100},session);
            eventIssues.push(...batch.entries.filter((e:any)=>e.issues.length));
        }
        if(eventIssues.length)blockers.push('Invoice cash events have missing or inconsistent journal postings.');
        cashReview={...cashReview,entries:eventIssues};
    }
    // Verify declared unique constraints exist; do not create/modify indexes here.
    for(const model of Object.values(mongoose.models)){
        if(!model.schema.path('shopId'))continue;
        const required=model.schema.indexes().filter(([,options])=>options.unique);
        if(!required.length)continue;
        const indexes=await model.collection.listIndexes().toArray().catch(()=>[]);
        for(const [key,options] of required)if(!indexes.some(i=>i.unique===true&&digest(i.key)===digest(key)&&digest(i.partialFilterExpression??null)===digest(options.partialFilterExpression??null)))blockers.push('Required unique index missing on '+model.collection.name+': '+Object.keys(key).join(', '));
    }
    const journalCount=await BusinessTransaction.countDocuments({shopId:shop._id}).session(session);
    const lastJournal=await BusinessTransaction.findOne({shopId:shop._id}).sort({recordedAt:-1,_id:-1}).session(session).lean();
    if(shop.accounting?.strategy==='CLEAN_START'&&!shop.accounting?.activatedAt&&await BusinessTransaction.exists({shopId:shop._id,'source.kind':{$nin:['OPENING','SUPPLIER_OPENING']}}).session(session))blockers.push('Existing posted activity cannot be silently discarded by a clean start. Use reviewed reconciliation.');
    const evidence={setupId:setup?._id,cutoffAt:setup?.input?.cutoffAt,customerReviews,supplierReviews,cashReview,accounts:financial,journalCount,lastJournalId:lastJournal?._id,blockers};
    return {ready:blockers.length===0,blockers,evidence,digest:digest(evidence)};
}

export const accountingActivation=(operation:string)=>asyncHandler(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const actor=req.user,body=req.body??{},session=await mongoose.startSession();
    session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
    try{
        const shop=await Shop.findOne({_id:actor.shopId,ownerId:actor._id}).session(session);
        const user=await User.findOne({_id:actor._id,shopId:actor.shopId,role:'OWNER'}).session(session);
        if(!shop||!user)throw new apiError(403,'Owner shop access required');
        if(shop.isActive===false)throw new apiError(403,'Shop has been deactivated. Contact administrator.');
        if(!shop.subscriptionActive||!shop.subscriptionExpiry||shop.subscriptionExpiry<=new Date())throw new apiError(403,'Subscription expired or inactive');
        const state=shop.accounting?.state??'DISABLED',revision=shop.accounting?.revision??0;
        const data=await accountingContext.run({shopId:String(shop._id),state,preparation:state==='PREPARING'||state==='PAUSED'},async()=>{
            if(operation==='status')return {state,revision,strategy:shop.accounting?.strategy??null,cutoffAt:shop.accounting?.cutoffAt??null,permitted:permitted(),history:await AccountingActivationEvent.find({shopId:shop._id}).sort({recordedAt:-1,_id:-1}).limit(30).session(session).lean()};
            if(operation==='preview'){
                const report=await readiness(actor,shop,session),expiresAt=new Date(Date.now()+5*60000).toISOString();
                const payload={shopId:String(shop._id),actorId:String(actor._id),revision,digest:report.digest,expiresAt};
                return {...report,expectedRevision:revision,expiresAt,previewToken:token(payload)};
            }
            const requestKey=text(body.requestKey,100),reason=text(body.reason);
            if(!/^[\w-]{8,100}$/.test(requestKey))throw new apiError(400,'Valid idempotency key required');
            const requestHash=digest({operation,actorId:String(actor._id),body});
            const prior=await AccountingActivationEvent.findOne({shopId:shop._id,requestKey}).session(session);
            if(prior){if(prior.requestHash!==requestHash)throw new apiError(409,'Request key already used for different details');return {replayed:true,event:prior,state,revision};}
            if(body.expectedRevision!==revision)throw new apiError(409,'Accounting state changed; refresh and review again');
            if(operation!=='pause'&&!permitted())throw new apiError(503,'Production accounting permission is disabled on the server');
            let evidence:any={previousState:state,reason};
            if(operation==='prepare'){
                if(!['DISABLED','PREPARING'].includes(state)||!['CLEAN_START','RECONCILE'].includes(body.strategy)||body.confirmation!=='PREPARE ACCOUNTING')throw new apiError(409,'Choose clean start or reviewed reconciliation and type PREPARE ACCOUNTING');
                if(state==='PREPARING'&&await BusinessSetup.exists({shopId:shop._id,state:'CONFIRMED'}).session(session))throw new apiError(409,'Confirmed openings cannot change starting-point policy');
                shop.accounting={state:'PREPARING',revision:revision+1,strategy:body.strategy};
                evidence.strategy=body.strategy;
            }else if(operation==='pause'){
                if(state!=='ACTIVE'||body.confirmation!=='PAUSE ACCOUNTING')throw new apiError(409,'Only active accounting can be paused; type PAUSE ACCOUNTING');
                shop.accounting!.state='PAUSED';shop.accounting!.revision++;
            }else if(operation==='confirm'||operation==='resume'){
                if(state!==(operation==='confirm'?'PREPARING':'PAUSED')||body.confirmation!=='ACTIVATE ACCOUNTING')throw new apiError(409,'Review accounting readiness and type ACTIVATE ACCOUNTING');
                const report=await readiness(actor,shop,session);
                if(!report.ready)throw new apiError(409,'Accounting readiness has unresolved blockers: '+report.blockers.join(' '));
                const expiresAt=text(body.expiresAt,40);
                const expected=token({shopId:String(shop._id),actorId:String(actor._id),revision,digest:report.digest,expiresAt});
                if(!Number.isFinite(+new Date(expiresAt))||+new Date(expiresAt)<=Date.now()||typeof body.previewToken!=='string'||!/^[a-f0-9]{64}$/.test(body.previewToken)||!timingSafeEqual(Buffer.from(expected),Buffer.from(body.previewToken)))throw new apiError(409,'Preview expired or records changed; request a fresh preview');
                evidence=report.evidence;
                shop.accounting!.state='ACTIVE';shop.accounting!.revision++;
                shop.accounting!.activatedAt??=new Date();shop.accounting!.cutoffAt=new Date(report.evidence.cutoffAt);shop.accounting!.setupId=report.evidence.setupId!;
            }else if(operation==='enroll'){
                if(state!=='ACTIVE'||body.confirmation!=='ENROLL ACCOUNT')throw new apiError(409,'Active accounting and ENROLL ACCOUNT confirmation required');
                const accountId=text(body.accountId,24);if(!/^[a-f\d]{24}$/i.test(accountId))throw new apiError(400,'Valid account selection required');
                const amountMinor=safeMinor(body.amountMinor);
                const account=await FinancialAccount.findOne({_id:accountId,shopId:shop._id,kind:{$in:['CASH','BANK']},isActive:true}).session(session);
                const clearing=await FinancialAccount.findOne({shopId:shop._id,kind:'SETTLEMENT_CLEARING','cashIntegration.state':'PREPARED',isActive:true}).session(session);
                const setup=await BusinessSetup.findOne({shopId:shop._id,state:'CONFIRMED'}).session(session);
                if(!account||account.cashCutoverId||account.postingRevision!==0||!clearing?.cashIntegration||!setup?.review?.accounts?.equityAccountId||await BusinessTransaction.exists({shopId:shop._id,'postings.accountId':accountId}).session(session))throw new apiError(409,'Select a new unused account and confirmed setup');
                if(clearing.cashIntegration.accountIds.length>=100)throw new apiError(409,'Account enrollment limit reached');
                const at=new Date();
                if(amountMinor)await accounts.recordOpeningBalance(actor,{accountId,equityAccountId:String(setup.review.accounts.equityAccountId),amountMinor,occurredAt:at.toISOString(),requestKey:'enroll-'+requestKey,reason,confirmation:'CONFIRM OPENING BALANCE'},session);
                account.cashCutoverId=clearing._id;account.openingAt=at;account.lastPostedAt=at;account.postingRevision++;await account.save({session});
                clearing.cashIntegration.accountIds.push(account._id);clearing.postingRevision++;await clearing.save({session});
                shop.accounting!.revision++;
                evidence={accountId,amountMinor,occurredAt:at,offset:'Owner-confirmed opening equity, not income or partner investment'};
            }else throw new apiError(404,'Accounting operation not found');
            shop.accountingWriteRevision=(shop.accountingWriteRevision??0)+1;
            await shop.save({session});
            const [event]=await AccountingActivationEvent.create([{shopId:shop._id,requestKey,requestHash,operation,actorId:user._id,actorName:user.username,recordedAt:new Date(),reason,evidence}],{session});
            return {state:shop.accounting!.state,revision:shop.accounting!.revision,event,replayed:false};
        });
        await session.commitTransaction();res.json(new apiResponse(200,data,'Accounting operation completed'));
    }catch(error:any){
        if(session.inTransaction())await session.abortTransaction().catch(()=>{});
        if(error?.hasErrorLabel?.('UnknownTransactionCommitResult'))throw new apiError(503,'Outcome uncertain; check status or retry the identical request key');
        if(error?.code===11000||error?.code===112||error?.name==='VersionError'||error?.hasErrorLabel?.('TransientTransactionError'))throw new apiError(409,'Accounting state changed; refresh or retry the identical request');
        throw error;
    }finally{await session.endSession();}
});
