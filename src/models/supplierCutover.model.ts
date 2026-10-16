import {Schema, model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

// An explicit historical boundary, never a cached supplier balance.
const schema=new Schema({
    shopId:{type:Schema.Types.ObjectId,required:true,ref:'Shop'},
    supplierId:{type:Schema.Types.ObjectId,required:true,ref:'BusinessEntity'},
    payableAccountId:{type:Schema.Types.ObjectId,required:true,ref:'FinancialAccount'},
    offsetAccountId:{type:Schema.Types.ObjectId,required:true,ref:'FinancialAccount'},
    equityAccountId:{type:Schema.Types.ObjectId,required:true,ref:'FinancialAccount'},
    cutoffAt:{type:Date,required:true},openingBalanceMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},
    otherOpeningMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},
    reviews:{type:[new Schema({receiptId:{type:Schema.Types.ObjectId,required:true},unpaidMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},reason:{type:String,required:true}}, {_id:false})],required:true},
    evidenceDigest:{type:String,required:true},requestKey:{type:String,required:true},requestHash:{type:String,required:true},reason:{type:String,required:true},
    createdBy:{type:Schema.Types.ObjectId,required:true},createdByName:{type:String,required:true},createdByRole:{type:String,enum:['OWNER'],required:true},
    ownerConfirmedAt:{type:Date,required:true},recordedAt:{type:Date,required:true}
},{versionKey:false});
schema.index({shopId:1,supplierId:1},{unique:true});
schema.index({shopId:1,payableAccountId:1},{unique:true});
schema.index({shopId:1,requestKey:1},{unique:true});
schema.pre('save',function(){if(!this.isNew)throw new apiError(409,'Supplier cutover is immutable');});
schema.pre('bulkWrite',function(){throw new apiError(409,'Supplier cutover is immutable');});
for(const operation of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','deleteOne','deleteMany','findOneAndDelete'] as const)
    schema.pre(operation,function(){throw new apiError(409,'Supplier cutover is immutable');});
schema.pre('deleteOne',{document:true,query:false},function(){throw new apiError(409,'Supplier cutover is immutable');});
export const SupplierCutover=model('SupplierCutover',schema);
