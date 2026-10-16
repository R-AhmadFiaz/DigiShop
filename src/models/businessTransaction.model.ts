import {Schema, model} from 'mongoose';
import {apiError} from '../utils/apiError.js';
import {balancedPostings} from '../utils/businessAccounting.js';

const schema = new Schema({
    shopId: {type: Schema.Types.ObjectId, ref: 'Shop', required: true},
    requestKey: {type: String, required: true}, requestHash: {type: String, required: true},
    source: {type: new Schema({kind: {type: String, enum: ['MANUAL', 'OPENING', 'REVERSAL', 'INVOICE_RECEIPT', 'INVOICE_REFUND', 'TRANSFER'], required: true},
        referenceId: {type: Schema.Types.ObjectId, required: true}}, {_id: false}), required: true},
    occurredAt: {type: Date, required: true}, recordedAt: {type: Date, required: true, default: Date.now},
    reason: {type: String, required: true}, currency: {type: String, enum: ['PKR'], required: true, default: 'PKR'},
    createdBy: {type: Schema.Types.ObjectId, ref: 'User', required: true}, createdByName: {type: String, required: true},
    postings: {type: [new Schema({accountId: {type: Schema.Types.ObjectId, ref: 'FinancialAccount', required: true},
        debitMinor: {type: Number, required: true}, creditMinor: {type: Number, required: true}}, {_id: false})], required: true},
    ownerConfirmedAt: Date
}, {versionKey: false});
schema.pre('validate', function () {
    balancedPostings(this.postings.map(row => ({accountId: String(row.accountId), debitMinor: row.debitMinor, creditMinor: row.creditMinor})));
});
schema.index({shopId: 1, requestKey: 1}, {unique: true});
schema.index({shopId: 1, 'source.kind': 1, 'source.referenceId': 1}, {unique: true});
schema.index({shopId: 1, occurredAt: -1, _id: -1});
schema.index({shopId: 1, 'postings.accountId': 1, occurredAt: 1});
schema.pre('save', function () { if (!this.isNew) throw new apiError(409, 'Business ledger is immutable; use a reversal'); });
schema.pre('bulkWrite', function () { throw new apiError(409, 'Business ledger bulk changes are not allowed'); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    schema.pre(operation, function () { throw new apiError(409, 'Business ledger is immutable; use a reversal'); });
}
schema.pre('deleteOne', {document: true, query: false}, function () { throw new apiError(409, 'Business ledger is immutable; use a reversal'); });
export const BusinessTransaction = model('BusinessTransaction', schema);
