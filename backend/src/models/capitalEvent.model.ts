import {automaticReference} from '../utils/references.js';
import {Schema, model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const schema = new Schema({
    shopId: {type: Schema.Types.ObjectId, required: true},
    partnerId: {type: Schema.Types.ObjectId, ref: 'BusinessEntity', required: true},
    partnerName: {type: String, required: true},
    requestKey: {type: String, required: true}, requestHash: {type: String, required: true},
    kind: {type: String, enum: ['CAPITAL_CONTRIBUTION','CAPITAL_WITHDRAWAL','CAPITAL_REVERSAL'], required: true},
    // Reversals retain their original contribution/withdrawal classification.
    direction: {type: String, enum: ['CONTRIBUTION','WITHDRAWAL'], required: true},
    reversalOf: {type: Schema.Types.ObjectId, ref: 'CapitalEvent'},
    amountMinor: {type: Number, required: true, min: 1, validate: Number.isSafeInteger},
    accountId: {type: Schema.Types.ObjectId, ref: 'FinancialAccount', required: true},
    capitalAccountId: {type: Schema.Types.ObjectId, ref: 'FinancialAccount', required: true},
    accountName: {type: String, required: true}, accountKind: {type: String, enum: ['CASH','BANK'], required: true},
    occurredAt: {type: Date, required: true}, recordedAt: {type: Date, required: true, default: Date.now},
    description: {type: String, required: true}, reference: {type: String, default: ''},
    createdBy: {type: Schema.Types.ObjectId, required: true}, createdByName: {type: String, required: true},
    createdByRole: {type: String, enum: ['OWNER'], required: true}
}, {versionKey: false});
schema.index({shopId:1,requestKey:1},{unique:true});
schema.index({shopId:1,reversalOf:1},{unique:true,partialFilterExpression:{reversalOf:{$type:'objectId'}}});
schema.index({shopId:1,occurredAt:-1,_id:-1});
schema.index({shopId:1,partnerId:1,occurredAt:-1,_id:-1});
schema.pre('save',function(){if(!this.isNew)throw new apiError(409,'Capital history is immutable; use a reversal');});
schema.pre('bulkWrite',function(){throw new apiError(409,'Capital history is immutable');});
for(const op of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','deleteOne','deleteMany','findOneAndDelete'] as const){
    schema.pre(op,function(){throw new apiError(409,'Capital history is immutable; use a reversal');});
}
schema.pre('deleteOne',{document:true,query:false},function(){throw new apiError(409,'Capital history is immutable');});
automaticReference(schema,d=>d.kind==='CAPITAL_REVERSAL'?'CX':d.direction==='CONTRIBUTION'?'CA':'CW');
export const CapitalEvent=model('CapitalEvent',schema);
