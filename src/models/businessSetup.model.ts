import {Schema,model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const schema=new Schema({
    shopId:{type:Schema.Types.ObjectId,required:true,immutable:true},
    state:{type:String,enum:['DRAFT','CONFIRMED'],default:'DRAFT',required:true},
    input:{type:Schema.Types.Mixed,required:true},
    review:{type:Schema.Types.Mixed},
    requestKey:String,requestHash:String,
    createdBy:{type:Schema.Types.ObjectId,required:true},updatedBy:{type:Schema.Types.ObjectId,required:true},
    confirmedBy:{type:Schema.Types.ObjectId},confirmedByName:String,confirmedAt:Date
},{timestamps:true,versionKey:'revision',optimisticConcurrency:true});
schema.index({shopId:1},{unique:true});
schema.post('init',function(doc){doc.$locals.confirmed=doc.state==='CONFIRMED';});
schema.pre('save',function(){if(this.$locals.confirmed)throw new apiError(409,'Confirmed setup is immutable; reconcile corrections separately');});
schema.post('save',function(doc){doc.$locals.confirmed=doc.state==='CONFIRMED';});
schema.pre('bulkWrite',function(){throw new apiError(409,'Setup requires revision-safe confirmation');});
for(const op of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','deleteOne','deleteMany','findOneAndDelete'] as const){schema.pre(op,function(){throw new apiError(409,'Setup requires revision-safe confirmation');});}
schema.pre('deleteOne',{document:true,query:false},function(){throw new apiError(409,'Confirmed setup cannot be deleted');});
export const BusinessSetup=model('BusinessSetup',schema);
