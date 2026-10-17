import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {BusinessEntity} from '../models/businessEntity.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {CapitalEvent} from '../models/capitalEvent.model.js';
import {Customer} from '../models/customer.model.js';
import * as accounts from '../utils/businessAccounts.js';
import {invoiceAccountingEnabled} from '../utils/invoiceAccountingIntegration.js';
import {asyncHandler} from '../utils/asyncHandler.js';
import {apiError} from '../utils/apiError.js';
import {apiResponse} from '../utils/apiResponse.js';

function text(value:unknown,max:number,optional=false){
    if(optional&&(value===undefined||value===''))return '';
    if(typeof value!=='string'||!value.trim()||value.length>max)throw new apiError(400,'Provide valid partner/capital details');
    return value.trim();
}
function id(value:unknown){if(typeof value!=='string'||!/^[a-f\d]{24}$/i.test(value))throw new apiError(400,'Valid selection required');return value.toLowerCase();}
function timestamp(value:unknown){
    if(typeof value!=='string')throw new apiError(400,'Valid UTC timestamp required');const date=new Date(value);
    if(!Number.isFinite(+date)||date.toISOString()!==value||+date>Date.now())throw new apiError(400,'Valid non-future UTC timestamp required');return date;
}
function pageNumber(value:unknown,fallback:number,max:number){if(value===undefined)return fallback;if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(+value)||+value<1||+value>max)throw new apiError(400,'Invalid pagination');return +value;}
function minor(value:bigint){if(value>BigInt(Number.MAX_SAFE_INTEGER)||value< -BigInt(Number.MAX_SAFE_INTEGER))throw new apiError(409,'Capital exceeds safe money range');return Number(value);}

// Read-only reconciliation: event evidence must agree with the authoritative journal.
export async function position(shopId:any,partnerId:string|undefined,session:mongoose.ClientSession){
    const scope:any={shopId:new mongoose.Types.ObjectId(String(shopId)),...(partnerId?{partnerId:new mongoose.Types.ObjectId(partnerId)}:{})};
    const capitalAccounts=await FinancialAccount.find({shopId,kind:'PARTNER_CAPITAL',...(partnerId?{entityId:partnerId}:{})}).select('_id').session(session).lean();
    const [totals]=await CapitalEvent.aggregate([{$match:scope},{$lookup:{from:BusinessTransaction.collection.name,let:{event:'$_id',shop:'$shopId',kind:'$kind'},pipeline:[{$match:{$expr:{$and:[{$eq:['$shopId','$$shop']},{$eq:['$source.referenceId','$$event']},{$eq:['$source.kind','$$kind']}]}}}],as:'journal'}},{$group:{_id:null,count:{$sum:1},missing:{$sum:{$cond:[{$eq:[{$size:'$journal'},1]},0,1]}},contributed:{$sum:{$cond:[{$eq:['$direction','CONTRIBUTION']},{$multiply:[{$toDecimal:'$amountMinor'},{$cond:[{$eq:['$kind','CAPITAL_REVERSAL']},-1,1]}]},0]}},withdrawn:{$sum:{$cond:[{$eq:['$direction','WITHDRAWAL']},{$multiply:[{$toDecimal:'$amountMinor'},{$cond:[{$eq:['$kind','CAPITAL_REVERSAL']},-1,1]}]},0]}}}}]).session(session).option({maxTimeMS:5000});
    const ids=capitalAccounts.map(a=>a._id);
    const journalScope={shopId:scope.shopId,'postings.accountId':{$in:ids}};
    const [balance]=await BusinessTransaction.aggregate([{$match:journalScope},{$unwind:'$postings'},{$match:{'postings.accountId':{$in:ids}}},{$group:{_id:null,value:{$sum:{$subtract:[{$toDecimal:'$postings.creditMinor'},{$toDecimal:'$postings.debitMinor'}]}}}}]).session(session).option({maxTimeMS:5000});
    const contributed=BigInt(totals?.contributed?.toString()??'0'),withdrawn=BigInt(totals?.withdrawn?.toString()??'0'),value=BigInt(balance?.value?.toString()??'0');
    const journalCount=await BusinessTransaction.countDocuments(journalScope).session(session);
    if(totals?.missing||journalCount!==(totals?.count??0)||value!==contributed-withdrawn||value<0n)throw new apiError(409,'Partner capital requires reconciliation; balances unavailable');
    return {authoritative:true,contributionsMinor:minor(contributed),withdrawalsMinor:minor(withdrawn),balanceMinor:minor(value)};
}

export const capital=(operation:string)=>asyncHandler(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');const actor=req.user,body=req.body??{};
    const data=await accounts.businessTransaction(actor,async session=>{
        if(operation==='setup'){
            const available=invoiceAccountingEnabled();return {available,accounts:available?await accounts.selectInvoicePaymentAccounts(actor,session):[],message:available?'Prepared accounting; posting is subject to shop activation.':'Capital posting and balances unavailable; accounting is disabled.'};
        }
        if(operation==='createPartner'){
            if(body.entityId){
                const entity=await accounts.getBusinessEntity(actor,id(body.entityId),session);
                if(entity.roles.includes('PARTNER'))return entity;
                return accounts.setBusinessRoles(actor,String(entity._id),[...entity.roles,'PARTNER'],body.expectedRevision,session);
            }
            const name=text(body.name,100),phoneNo=text(body.phoneNo,11,true),address=text(body.address,300,true);
            const prior=await BusinessEntity.findOne({shopId:actor.shopId,$or:[{name:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')},...(phoneNo?[{phoneNo}]:[])]}).session(session);
            if(prior){if(prior.key===body.key&&prior.roles.includes('PARTNER')&&prior.name===name&&prior.phoneNo===phoneNo&&prior.address===address)return prior;throw new apiError(409,'Business already exists; link the existing business instead');}
            return accounts.createBusinessEntity(actor,{key:body.key,name,phoneNo,address,roles:['PARTNER']},session);
        }
        if(operation==='editPartner'){
            const entity=await accounts.getBusinessEntity(actor,id(req.params.id),session);
            if(!entity.roles.includes('PARTNER'))throw new apiError(404,'Partner not found in shop');
            if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new apiError(400,'Current partner revision required');
            const update:any={};
            if(body.name!==undefined){
                if(entity.customerId)throw new apiError(409,'Linked customer details must be managed through their existing identity');
                update.name=text(body.name,100);update.phoneNo=text(body.phoneNo,11,true);update.address=text(body.address,300,true);
                if(update.phoneNo&&!/^\d{11}$/.test(update.phoneNo))throw new apiError(400,'Phone must contain 11 digits');
                const conflict=await BusinessEntity.exists({shopId:actor.shopId,_id:{$ne:entity._id},$or:[{name:new RegExp('^'+update.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','i')},...(update.phoneNo?[{phoneNo:update.phoneNo}]:[])]}).session(session);
                if(conflict)throw new apiError(409,'Business name or phone already exists');
            }
            if(body.partnerActive!==undefined){
                if(typeof body.partnerActive!=='boolean')throw new apiError(400,'Valid partner state required');
                if(!body.partnerActive){if(!invoiceAccountingEnabled())throw new apiError(409,'Prepared accounting required before archiving a partner');await accounts.selectInvoicePaymentAccounts(actor,session);if((await position(actor.shopId,String(entity._id),session)).balanceMinor!==0)throw new apiError(409,'Withdraw or reconcile remaining capital before archiving');}
                update.partnerActive=body.partnerActive;
            }
            if(!Object.keys(update).length)throw new apiError(400,'Provide partner details');
            const result=await BusinessEntity.findOneAndUpdate({_id:entity._id,shopId:actor.shopId,revision:body.expectedRevision},{$set:update,$inc:{revision:1}},{session,new:true,runValidators:true});
            if(!result)throw new apiError(409,'Partner changed; refresh before saving');return result;
        }
        if(operation==='partners'){
            const page=pageNumber(req.query.page,1,100000),limit=pageNumber(req.query.limit,20,100),filter:any={shopId:actor.shopId,roles:'PARTNER'};
            if(req.query.q){const term=text(req.query.q,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),pattern=new RegExp(term,'i');
                const linked=await Customer.find({shopId:actor.shopId,$or:[{name:pattern},{phoneNo:pattern}]}).select('_id').session(session).maxTimeMS(5000).lean();
                filter.$or=[{name:pattern},{phoneNo:pattern},{customerId:{$in:linked.map(c=>c._id)}}];}
            const available=invoiceAccountingEnabled();let ready=available,message=available?'':'Capital balances unavailable; accounting is disabled.';
            if(ready)try{await accounts.selectInvoicePaymentAccounts(actor,session);}catch(error){if(!(error instanceof apiError))throw error;ready=false;message=error.message;}
            const count=await BusinessEntity.countDocuments(filter).session(session),rows=await BusinessEntity.find(filter).sort({name:1,_id:1}).skip((page-1)*limit).limit(limit).session(session);
            const entries=[];for(const row of rows)entries.push({...await accounts.getBusinessEntity(actor,String(row._id),session),capital:ready?await position(actor.shopId,String(row._id),session):null});
            return {entries,available:ready,message,total:ready?await position(actor.shopId,undefined,session):null,pagination:{currentPage:page,limit,recordCount:count,totalPages:Math.ceil(count/limit)}};
        }
        if(!invoiceAccountingEnabled())throw new apiError(409,'Capital posting and history require prepared accounting');
        await accounts.selectInvoicePaymentAccounts(actor,session);
        if(operation==='post'||operation==='reverse'){
            const requestKey=text(body.requestKey,100);if(!/^[\w-]{8,100}$/.test(requestKey))throw new apiError(400,'Valid idempotency key required');
            const occurredAt=timestamp(body.occurredAt),description=text(body.description,300),reference=text(body.reference,100,true);
            let values:any={occurredAt,description,reference};
            if(operation==='reverse'){
                if(body.confirmation!=='CONFIRM CAPITAL REVERSAL')throw new apiError(400,'Confirm the actual money movement has been reversed');
                const original=await CapitalEvent.findOne({_id:id(req.params.id),shopId:actor.shopId,kind:{$ne:'CAPITAL_REVERSAL'}}).session(session);
                if(!original)throw new apiError(404,'Capital transaction not found in shop');
                if(occurredAt<original.occurredAt)throw new apiError(400,'Reversal cannot predate original transaction');
                const journal=await BusinessTransaction.findOne({shopId:actor.shopId,'source.kind':original.kind,'source.referenceId':original._id}).session(session);
                const cash=journal?.postings.find(p=>String(p.accountId)===String(original.accountId)),equity=journal?.postings.find(p=>String(p.accountId)===String(original.capitalAccountId)),incoming=original.direction==='CONTRIBUTION';
                if(!journal||journal.postings.length!==2||+journal.occurredAt!==+original.occurredAt||cash?.debitMinor!==(incoming?original.amountMinor:0)||cash?.creditMinor!==(incoming?0:original.amountMinor)||equity?.debitMinor!==(incoming?0:original.amountMinor)||equity?.creditMinor!==(incoming?original.amountMinor:0))throw new apiError(409,'Original capital journal requires reconciliation');
                values={...values,partnerId:original.partnerId,kind:'CAPITAL_REVERSAL',direction:original.direction,reversalOf:original._id,amountMinor:original.amountMinor,accountId:original.accountId};
            }else{
                if(!['CONTRIBUTION','WITHDRAWAL'].includes(body.direction)||!Number.isSafeInteger(body.amountMinor)||body.amountMinor<=0)throw new apiError(400,'Select investment/withdrawal and a positive amount in paisa');
                values={...values,partnerId:id(body.partnerId),kind:body.direction==='CONTRIBUTION'?'CAPITAL_CONTRIBUTION':'CAPITAL_WITHDRAWAL',direction:body.direction,amountMinor:body.amountMinor,accountId:id(body.accountId)};
            }
            // Canonical IDs make hexadecimal casing irrelevant to exact-request retries.
            values.partnerId=String(values.partnerId);values.accountId=String(values.accountId);if(values.reversalOf)values.reversalOf=String(values.reversalOf);
            const hash=createHash('sha256').update(JSON.stringify({...values,actor:String(actor._id)})).digest('hex');
            const prior=await CapitalEvent.findOne({shopId:actor.shopId,requestKey}).session(session);
            if(prior){if(prior.requestHash!==hash)throw new apiError(409,'Request key already used for different capital details');return {event:prior,replayed:true};}
            const partner=await accounts.getBusinessEntity(actor,values.partnerId,session);
            if(!partner.roles.includes('PARTNER'))throw new apiError(404,'Partner not found in shop');
            if(partner.partnerActive===false)throw new apiError(409,'Partner is archived');
            const current=await position(actor.shopId,values.partnerId,session);
            const incoming=(values.direction==='CONTRIBUTION')!==(operation==='reverse');
            if(!incoming&&values.amountMinor>current.balanceMinor)throw new apiError(409,'Insufficient remaining partner capital');
            if(operation==='reverse'&&await CapitalEvent.exists({shopId:actor.shopId,reversalOf:values.reversalOf}).session(session))throw new apiError(409,'Capital transaction already reversed');
            const payment=await FinancialAccount.findOne({_id:values.accountId,shopId:actor.shopId,kind:{$in:['CASH','BANK']},isActive:true}).session(session);
            if(!payment)throw new apiError(404,'Active cash/bank account not found in shop');
            let equity=await FinancialAccount.findOne({shopId:actor.shopId,entityId:partner._id,kind:'PARTNER_CAPITAL'}).session(session);
            if(!equity)equity=await accounts.createFinancialAccount(actor,{code:'PARTNER_'+String(partner._id),name:'Capital - '+partner.name,kind:'PARTNER_CAPITAL',entityId:String(partner._id)},session);
            const [event]=await CapitalEvent.create([{...values,requestKey,requestHash:hash,shopId:actor.shopId,partnerName:partner.name,accountName:payment.name,accountKind:payment.kind,capitalAccountId:equity._id,createdBy:actor._id,createdByName:actor.username,createdByRole:'OWNER'}],{session});
            const journal=await accounts.postCapitalMovement(actor,event,session);return {event,journalId:journal._id,replayed:false};
        }
        if(operation==='detail'){
            const event=await CapitalEvent.findOne({_id:id(req.params.id),shopId:actor.shopId}).session(session).lean();if(!event)throw new apiError(404,'Capital transaction not found in shop');
            return {event,reversal:await CapitalEvent.findOne({shopId:actor.shopId,reversalOf:event._id}).session(session).lean(),journal:await BusinessTransaction.findOne({shopId:actor.shopId,'source.kind':event.kind,'source.referenceId':event._id}).session(session).lean()};
        }
        const page=pageNumber(req.query.page,1,100000),limit=pageNumber(req.query.limit,20,100),filter:any={shopId:actor.shopId};
        if(req.query.partnerId)filter.partnerId=id(req.query.partnerId);
        if(req.query.q){const term=text(req.query.q,100).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');filter.$or=['description','reference','partnerName','accountName'].map(key=>({[key]:new RegExp(term,'i')}));}
        const count=await CapitalEvent.countDocuments(filter).session(session);
        return {entries:await CapitalEvent.find(filter).select('-requestHash').sort({occurredAt:-1,_id:-1}).skip((page-1)*limit).limit(limit).session(session).lean(),pagination:{currentPage:page,limit,recordCount:count,totalPages:Math.ceil(count/limit)}};
    },['createPartner','editPartner','post','reverse'].includes(operation));
    res.json(new apiResponse(200,data,'Partner/capital request completed'));
});
