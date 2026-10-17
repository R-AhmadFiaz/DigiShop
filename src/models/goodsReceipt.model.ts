import {Schema, model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const schema=new Schema({
    shopId:{type:Schema.Types.ObjectId,required:true,ref:'Shop'},purchaseOrderId:{type:Schema.Types.ObjectId,required:true,ref:'PurchaseOrder'},purchaseReference:{type:String,required:true},
    reference:{type:String,required:true},requestKey:{type:String,required:true},requestHash:{type:String,required:true},
    notes:String,supplierDocumentNo:String,
    supplierId:{type:Schema.Types.ObjectId,required:true,ref:'BusinessEntity'},supplierName:{type:String,required:true},
    items:{type:[new Schema({productId:{type:Schema.Types.ObjectId,required:true,ref:'Product'},name:{type:String,required:true},brand:String,unit:String,
        quantity:{type:Number,required:true,min:1,validate:Number.isSafeInteger},unitCostMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},totalMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger}}, {_id:false})],required:true},
    totalMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},currency:{type:String,enum:['PKR'],default:'PKR'},
    obligationType:{type:String,enum:['RECEIVED_GOODS'],required:true},accountingStatus:{type:String,enum:['DEFERRED','POSTED','NO_PAYABLE'],required:true},
    supplierCutoverId:{type:Schema.Types.ObjectId,ref:'SupplierCutover'},
    revisionBefore:{type:Number,required:true},revisionAfter:{type:Number,required:true},
    createdBy:{type:Schema.Types.ObjectId,required:true},createdByName:{type:String,required:true},createdByRole:{type:String,enum:['OWNER'],required:true},
    occurredAt:{type:Date,required:true},recordedAt:{type:Date,required:true}
},{versionKey:false});
schema.index({shopId:1,reference:1},{unique:true});
schema.index({shopId:1,requestKey:1},{unique:true});
schema.index({shopId:1,purchaseOrderId:1,occurredAt:-1,_id:-1});
schema.index({shopId:1,supplierId:1,occurredAt:-1,_id:-1});
schema.pre('save',function(){if(!this.isNew)throw new apiError(409,'Goods receipt is immutable');});
schema.pre('bulkWrite',function(){throw new apiError(409,'Goods receipt is immutable');});
for(const operation of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','deleteOne','deleteMany','findOneAndDelete'] as const)
    schema.pre(operation,function(){throw new apiError(409,'Goods receipt is immutable');});
schema.pre('deleteOne',{document:true,query:false},function(){throw new apiError(409,'Goods receipt is immutable');});
export const GoodsReceipt=model('GoodsReceipt',schema);
