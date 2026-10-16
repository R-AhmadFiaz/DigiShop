import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {PurchaseOrder,purchaseStates} from '../models/purchaseOrder.model.js';
import {GoodsReceipt} from '../models/goodsReceipt.model.js';
import {Product} from '../models/product.model.js';
import {User} from '../models/user.model.js';
import {StockLog} from '../models/stockLog.model.js';
import {getBusinessEntity} from './businessAccounts.js';
import {invoiceAccountingEnabled} from './invoiceAccountingIntegration.js';
import {historyFilters} from './businessHistory.js';
import {safeMinor} from './invoiceAccounting.js';
import {apiError} from './apiError.js';

type Actor={_id:any,shopId:any,role:string};
type Session=mongoose.ClientSession;
const accounting={status:'DEFERRED',supplierBalanceAvailable:false,cashMovementMinor:0};
function id(value:unknown):string {
    if(typeof value!=='string'||!/^[a-f\d]{24}$/i.test(value))throw new apiError(400,'Valid record selection required');
    return value.toLowerCase();
}
function key(value:unknown):string {
    if(typeof value!=='string'||!/^[\w-]{8,100}$/.test(value))throw new apiError(400,'Stable request key of 8 to 100 characters required');
    return value;
}
function reference(value:unknown):string {
    if(typeof value!=='string'||!value.trim()||value.trim().length>50||!/^[a-z\d][a-z\d/_-]*$/i.test(value.trim()))throw new apiError(400,'Reference must contain letters, numbers, dashes, slashes or underscores');
    return value.trim().toUpperCase();
}
function revision(value:unknown):number {
    if(!Number.isSafeInteger(value)||Number(value)<0)throw new apiError(400,'Expected purchase revision required');
    return value as number;
}
function hash(input:any){return createHash('sha256').update(JSON.stringify(input)).digest('hex');}
function lines(value:any,costs:boolean):{productId:string,quantity:number,unitCostMinor?:number}[] {
    if(!Array.isArray(value)||!value.length||value.length>100)throw new apiError(400,'Provide 1 to 100 purchase items');
    const result=value.map(row=>{
        if(!row||!Number.isSafeInteger(row.quantity)||row.quantity<1)throw new apiError(400,'Whole positive quantities required');
        if(costs)safeMinor(row.unitCostMinor);
        return {productId:id(row.productId),quantity:row.quantity,...(costs?{unitCostMinor:row.unitCostMinor}:{})};
    }).sort((a,b)=>a.productId.localeCompare(b.productId));
    if(new Set(result.map(r=>r.productId)).size!==result.length)throw new apiError(400,'Each product may appear once per purchase or receipt');
    return result;
}
function amount(value:bigint):number {
    if(value<0n||value>BigInt(Number.MAX_SAFE_INTEGER))throw new apiError(400,'Purchase amount exceeds safe money range');
    return Number(value);
}
async function actorSnapshot(actor:Actor,session:Session) {
    const user=await User.findOne({_id:actor._id,shopId:actor.shopId,role:'OWNER'}).select('_id username').session(session);
    if(!user)throw new apiError(403,'Owner shop access required');
    return {createdBy:user._id,createdByName:user.username,createdByRole:'OWNER' as const};
}
async function supplier(actor:Actor,supplierId:string,session:Session){
    const entity=await getBusinessEntity(actor,id(supplierId),session);
    if(!entity.roles.includes('SUPPLIER'))throw new apiError(400,'Select an existing supplier in this shop');
    if(typeof entity.name!=='string'||!entity.name.trim())throw new apiError(409,'Supplier identity requires reconciliation');
    return {...entity,name:entity.name};
}
async function order(actor:Actor,orderId:string,session:Session){
    const result=await PurchaseOrder.findOne({_id:id(orderId),shopId:actor.shopId}).session(session);
    if(!result)throw new apiError(404,'Purchase order not found in shop');
    return result;
}
export async function createPurchase(actor:Actor,body:any,session:Session){
    const input={reference:reference(body.reference),supplierId:id(body.supplierId),items:lines(body.items,true)},requestKey=key(body.requestKey);
    const requestHash=hash({actorId:String(actor._id),...input});
    const existing=await PurchaseOrder.findOne({shopId:actor.shopId,requestKey}).session(session);
    if(existing){if(existing.requestHash!==requestHash)throw new apiError(409,'Purchase request key already used for different details');return {purchaseOrder:existing,replayed:true,accounting};}
    const entity=await supplier(actor,input.supplierId,session);
    const products=await Product.find({shopId:actor.shopId,_id:{$in:input.items.map(r=>r.productId)}}).session(session);
    if(products.length!==input.items.length)throw new apiError(404,'Product not found in shop');
    const items=input.items.map(row=>{const p=products.find(p=>String(p._id)===row.productId)!;return {...row,unitCostMinor:row.unitCostMinor!,productId:p._id,name:p.name,brand:p.brand,unit:p.unit,totalMinor:amount(BigInt(row.quantity)*BigInt(row.unitCostMinor!)),receivedQuantity:0};});
    const totalMinor=amount(items.reduce((sum,row)=>sum+BigInt(row.totalMinor),0n));
    const [purchaseOrder]=await PurchaseOrder.create([{shopId:actor.shopId,requestKey,requestHash,reference:input.reference,supplierId:entity._id,supplierName:entity.name,items,totalMinor,...await actorSnapshot(actor,session)}],{session});
    return {purchaseOrder,replayed:false,accounting};
}
export async function changePurchaseState(actor:Actor,orderId:string,body:any,kind:'CONFIRM'|'CANCEL',session:Session){
    const expectedRevision=revision(body.expectedRevision),requestKey=key(body.requestKey),po=await order(actor,orderId,session);
    const reason=kind==='CANCEL'?body.reason:undefined;
    if(kind==='CANCEL'&&(typeof reason!=='string'||!reason.trim()||reason.length>300))throw new apiError(400,'Cancellation reason required');
    const requestHash=hash({actorId:String(actor._id),orderId:String(po._id),expectedRevision,kind,...(kind==='CANCEL'?{reason:reason.trim()}:{})});
    const prior=po.actions.find(a=>a.requestKey===requestKey);
    if(prior){if(prior.requestHash!==requestHash)throw new apiError(409,'Action key already used for different details');return {purchaseOrder:po,replayed:true,accounting};}
    if(po.revision!==expectedRevision)throw new apiError(409,'Purchase changed; reload before continuing');
    if(kind==='CONFIRM'){
        if(po.status!=='DRAFT')throw new apiError(409,'Only draft purchases can be confirmed');
        await supplier(actor,String(po.supplierId),session);
        const count=await Product.countDocuments({shopId:actor.shopId,_id:{$in:po.items.map(r=>r.productId)}}).session(session);
        if(count!==po.items.length)throw new apiError(409,'Purchase product unavailable; review the order');
    }else if(!['DRAFT','CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status))throw new apiError(409,'This purchase cannot be cancelled');
    const purchaseOrder=await PurchaseOrder.findOneAndUpdate({_id:po._id,shopId:actor.shopId,revision:expectedRevision,status:po.status},
        {$set:{status:kind==='CONFIRM'?'CONFIRMED':'CANCELLED'},$inc:{revision:1},$push:{actions:{kind,requestKey,requestHash,reason:kind==='CANCEL'?reason.trim():undefined,occurredAt:new Date(),...await actorSnapshot(actor,session)}}},{session,new:true,runValidators:true});
    if(!purchaseOrder)throw new apiError(409,'Purchase changed; retry the identical request');
    return {purchaseOrder,replayed:false,accounting};
}
export async function receivePurchase(actor:Actor,orderId:string,body:any,session:Session){
    const enabled=invoiceAccountingEnabled();
    const input={orderId:id(orderId),expectedRevision:revision(body.expectedRevision),reference:reference(body.reference),items:lines(body.items,false)},requestKey=key(body.requestKey);
    const requestHash=hash({actorId:String(actor._id),...input});
    const existing=await GoodsReceipt.findOne({shopId:actor.shopId,requestKey}).session(session);
    if(existing){if(existing.requestHash!==requestHash)throw new apiError(409,'Receiving request key already used for different details');return {receipt:existing,purchaseOrder:await order(actor,input.orderId,session),replayed:true,accounting};}
    if(enabled)throw new apiError(409,'Supplier payable cutover is not approved; receiving with accounting enabled is unavailable');
    const po=await order(actor,input.orderId,session);
    if(po.revision!==input.expectedRevision)throw new apiError(409,'Purchase changed; reload before receiving');
    if(!['CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status))throw new apiError(409,'Only confirmed open purchases can receive goods');
    await supplier(actor,String(po.supplierId),session);
    const items=input.items.map(row=>{
        const line=po.items.find(p=>String(p.productId)===row.productId);
        if(!line)throw new apiError(400,'Received product is not on this purchase');
        if(row.quantity>line.quantity-line.receivedQuantity)throw new apiError(409,'Received quantity exceeds the remaining order quantity');
        return {productId:line.productId,name:line.name,brand:line.brand,unit:line.unit,quantity:row.quantity,unitCostMinor:line.unitCostMinor,totalMinor:amount(BigInt(row.quantity)*BigInt(line.unitCostMinor))};
    });
    const totalMinor=amount(items.reduce((sum,row)=>sum+BigInt(row.totalMinor),0n)),receiptId=new mongoose.Types.ObjectId(),now=new Date(),actorFields=await actorSnapshot(actor,session);
    for(const line of items){
        const product=await Product.findOne({_id:line.productId,shopId:actor.shopId}).session(session);
        if(!product)throw new apiError(404,'Product not found in shop');
        if(!Number.isSafeInteger(product.stockQuantity)||product.stockQuantity<0||!Number.isSafeInteger(product.stockQuantity+line.quantity))throw new apiError(409,'Product stock requires reconciliation before receiving');
        const changed=await Product.updateOne({_id:product._id,shopId:actor.shopId,stockQuantity:product.stockQuantity},{$inc:{stockQuantity:line.quantity}},{session,runValidators:true});
        if(changed.modifiedCount!==1)throw new apiError(409,'Stock changed; retry the identical request');
        await StockLog.create([{shopId:actor.shopId,productId:product._id,quantityDelta:line.quantity,reason:'PURCHASE_RECEIVED',purchaseReceiptId:receiptId,purchaseReference:po.reference,receivingReference:input.reference,createdBy:actorFields.createdBy,createdAt:now,updatedAt:now}],{session});
    }
    const [receipt]=await GoodsReceipt.create([{_id:receiptId,shopId:actor.shopId,purchaseOrderId:po._id,purchaseReference:po.reference,reference:input.reference,requestKey,requestHash,
        supplierId:po.supplierId,supplierName:po.supplierName,items,totalMinor,obligationType:'RECEIVED_GOODS',accountingStatus:'DEFERRED',revisionBefore:po.revision,revisionAfter:po.revision+1,occurredAt:now,recordedAt:new Date(),...actorFields}],{session});
    const updatedItems=po.items.map(line=>({...line.toObject(),receivedQuantity:line.receivedQuantity+(items.find(r=>String(r.productId)===String(line.productId))?.quantity??0)}));
    const status=updatedItems.every(line=>line.receivedQuantity===line.quantity)?'RECEIVED':'PARTIALLY_RECEIVED';
    const purchaseOrder=await PurchaseOrder.findOneAndUpdate({_id:po._id,shopId:actor.shopId,revision:input.expectedRevision,status:po.status},
        {$set:{items:updatedItems,status,receivedValueMinor:amount(BigInt(po.receivedValueMinor)+BigInt(totalMinor))},$inc:{revision:1}},{session,new:true,runValidators:true});
    if(!purchaseOrder)throw new apiError(409,'Purchase changed; retry the identical request');
    return {receipt,purchaseOrder,replayed:false,accounting};
}
export async function getPurchase(actor:Actor,orderId:string,session:Session){return {purchaseOrder:await order(actor,orderId,session),accounting};}
export async function listPurchases(actor:Actor,input:any,session:Session,orderId?:string){
    for(const k of ['page','limit'])if(input[k]!==undefined&&(typeof input[k]!=='string'||!/^\d+$/.test(input[k])))throw new apiError(400,'Invalid purchase pagination');
    const page=Number(input.page??1),limit=Number(input.limit??20);
    if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new apiError(400,'Invalid purchase pagination');
    const {from,to,pattern}=historyFilters(input,[]),filter:any={shopId:actor.shopId};
    const field=orderId?'occurredAt':'createdAt';
    if(from||to)filter[field]={...(from?{$gte:from}:{}),...(to?{$lt:to}:{})};
    if(pattern)filter.$or=[{reference:pattern},{supplierName:pattern}];
    if(input.supplierId!==undefined)filter.supplierId=id(input.supplierId);
    if(input.status!==undefined){if(orderId||typeof input.status!=='string'||!purchaseStates.includes(input.status))throw new apiError(400,'Invalid purchase status');filter.status=input.status;}
    if(orderId){await order(actor,orderId,session);filter.purchaseOrderId=id(orderId);}
    const Model:any=orderId?GoodsReceipt:PurchaseOrder;
    const recordCount=await Model.countDocuments(filter).session(session);
    const entries=await Model.find(filter).select('-requestHash -actions.requestHash').sort({[field]:-1,_id:-1}).skip((page-1)*limit).limit(limit).session(session).lean();
    return {entries,pagination:{currentPage:page,limit,recordCount,totalPages:Math.ceil(recordCount/limit)},accounting};
}
