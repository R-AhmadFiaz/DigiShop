import {Schema, model} from 'mongoose';

export const purchaseStates=['DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'];
const schema=new Schema({
    shopId:{type:Schema.Types.ObjectId,required:true,immutable:true,ref:'Shop'},
    reference:{type:String,required:true,immutable:true},requestKey:{type:String,required:true,immutable:true},requestHash:{type:String,required:true,immutable:true},
    supplierId:{type:Schema.Types.ObjectId,required:true,immutable:true,ref:'BusinessEntity'},supplierName:{type:String,required:true,immutable:true},
    items:{type:[new Schema({productId:{type:Schema.Types.ObjectId,required:true,ref:'Product'},name:{type:String,required:true},brand:String,unit:String,
        quantity:{type:Number,required:true,min:1,validate:Number.isSafeInteger},unitCostMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},
        totalMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},receivedQuantity:{type:Number,required:true,default:0,min:0,validate:Number.isSafeInteger}}, {_id:false})],required:true},
    totalMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},receivedValueMinor:{type:Number,default:0,min:0,validate:Number.isSafeInteger},currency:{type:String,enum:['PKR'],default:'PKR',immutable:true},
    status:{type:String,enum:purchaseStates,default:'DRAFT'},revision:{type:Number,default:0,min:0,validate:Number.isSafeInteger},
    createdBy:{type:Schema.Types.ObjectId,required:true,immutable:true},createdByName:{type:String,required:true,immutable:true},createdByRole:{type:String,enum:['OWNER'],required:true,immutable:true},
    actions:{type:[new Schema({kind:{type:String,enum:['CONFIRM','CANCEL'],required:true},requestKey:{type:String,required:true},requestHash:{type:String,required:true},reason:String,
        occurredAt:{type:Date,required:true},createdBy:{type:Schema.Types.ObjectId,required:true},createdByName:{type:String,required:true},createdByRole:{type:String,enum:['OWNER'],required:true}}, {_id:false})],default:[]}
},{timestamps:true});
schema.index({shopId:1,reference:1},{unique:true});
schema.index({shopId:1,requestKey:1},{unique:true});
schema.index({shopId:1,createdAt:-1,_id:-1});
schema.index({shopId:1,supplierId:1,createdAt:-1,_id:-1});
schema.index({shopId:1,status:1,createdAt:-1,_id:-1});
export const PurchaseOrder=model('PurchaseOrder',schema);
