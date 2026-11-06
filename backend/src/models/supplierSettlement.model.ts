import {automaticReference} from '../utils/references.js';
import {Schema,model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const schema=new Schema({
    shopId:{type:Schema.Types.ObjectId,ref:'Shop',required:true},supplierId:{type:Schema.Types.ObjectId,ref:'BusinessEntity',required:true},
    kind:{type:String,enum:['PAYMENT','RETURN','REFUND','CREDIT_APPLICATION','REVERSAL'],required:true},
    creditAccountId:{type:Schema.Types.ObjectId,ref:'FinancialAccount'},
    payableReductionMinor:{type:Number,min:0,validate:Number.isSafeInteger},
    creditMovementMinor:{type:Number,min:0,validate:Number.isSafeInteger},
    reference:{type:String,required:true},requestKey:{type:String,required:true},requestHash:{type:String,required:true},
    payableAccountId:{type:Schema.Types.ObjectId,ref:'FinancialAccount',required:true},offsetAccountId:{type:Schema.Types.ObjectId,ref:'FinancialAccount',required:true},
    receiptId:{type:Schema.Types.ObjectId,ref:'GoodsReceipt'},receiptReference:String,purchaseReference:String,
    reversalOf:{type:Schema.Types.ObjectId,ref:'SupplierSettlement'},originalKind:{type:String,enum:['PAYMENT','RETURN','REFUND','CREDIT_APPLICATION']},
    amountMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},currency:{type:String,enum:['PKR'],default:'PKR'},
    items:{type:[new Schema({productId:{type:Schema.Types.ObjectId,required:true,ref:'Product'},name:{type:String,required:true},
        quantity:{type:Number,required:true,min:1,validate:Number.isSafeInteger},unitCostMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger},totalMinor:{type:Number,required:true,min:0,validate:Number.isSafeInteger}},{_id:false})],default:[]},
    reason:{type:String,required:true},occurredAt:{type:Date,required:true},recordedAt:{type:Date,required:true},
    createdBy:{type:Schema.Types.ObjectId,ref:'User',required:true},createdByName:{type:String,required:true},createdByRole:{type:String,enum:['OWNER'],required:true}
},{versionKey:false});
schema.index({shopId:1,requestKey:1},{unique:true});
schema.index({shopId:1,reference:1},{unique:true});
schema.index({shopId:1,reversalOf:1},{unique:true,partialFilterExpression:{reversalOf:{$type:'objectId'}}});
schema.index({shopId:1,supplierId:1,occurredAt:1,_id:1});
schema.index({shopId:1,receiptId:1,kind:1});
schema.pre('save',function(){if(!this.isNew)throw new apiError(409,'Supplier settlement is immutable; use a reversal');});
schema.pre('bulkWrite',function(){throw new apiError(409,'Supplier settlement is immutable');});
for(const operation of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','deleteOne','deleteMany','findOneAndDelete'] as const)
    schema.pre(operation,function(){throw new apiError(409,'Supplier settlement is immutable; use a reversal');});
schema.pre('deleteOne',{document:true,query:false},function(){throw new apiError(409,'Supplier settlement is immutable');});
automaticReference(schema,d=>({PAYMENT:'SP',RETURN:'SR',REFUND:'SF',CREDIT_APPLICATION:'SC',REVERSAL:'SX'} as any)[d.kind]);
export const SupplierSettlement=model('SupplierSettlement',schema);
