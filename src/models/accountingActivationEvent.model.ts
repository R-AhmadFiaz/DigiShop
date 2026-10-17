import {Schema,model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const schema=new Schema({
    shopId:{type:Schema.Types.ObjectId,required:true,immutable:true},
    requestKey:{type:String,required:true,immutable:true},requestHash:{type:String,required:true,immutable:true},
    operation:{type:String,enum:['prepare','confirm','pause','resume','enroll'],required:true,immutable:true},
    actorId:{type:Schema.Types.ObjectId,required:true,immutable:true},actorName:{type:String,required:true,immutable:true},
    recordedAt:{type:Date,required:true,immutable:true},reason:{type:String,required:true,immutable:true},
    evidence:{type:Schema.Types.Mixed,required:true,immutable:true}
},{versionKey:false});
schema.index({shopId:1,requestKey:1},{unique:true});
schema.index({shopId:1,recordedAt:-1,_id:-1});
schema.pre('save',function(){if(!this.isNew)throw new apiError(409,'Activation history is immutable');});
schema.pre('bulkWrite',function(){throw new apiError(409,'Activation history is immutable');});
for(const op of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','deleteOne','deleteMany','findOneAndDelete'] as const)
    schema.pre(op,function(){throw new apiError(409,'Activation history is immutable');});
schema.pre('deleteOne',{document:true,query:false},function(){throw new apiError(409,'Activation history is immutable');});
export const AccountingActivationEvent=model('AccountingActivationEvent',schema);
