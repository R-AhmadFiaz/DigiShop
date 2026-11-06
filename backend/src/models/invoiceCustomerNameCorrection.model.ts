import {Schema, model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const schema = new Schema({
    shopId: {type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true},
    orderId: {type: Schema.Types.ObjectId, ref: 'Order', required: true, immutable: true},
    invoiceNo: {type: String, required: true, immutable: true},
    requestKey: {type: String, required: true, immutable: true},
    requestHash: {type: String, required: true, immutable: true},
    previousName: {type: String, required: true, immutable: true},
    newName: {type: String, required: true, immutable: true},
    customerId: {type: Schema.Types.ObjectId, ref: 'Customer', immutable: true},
    actorId: {type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true},
    actorName: {type: String, required: true, immutable: true},
    recordedAt: {type: Date, required: true, immutable: true},
    revisionBefore: {type: Number, required: true, immutable: true},
    revisionAfter: {type: Number, required: true, immutable: true}
}, {versionKey: false});

schema.index({shopId: 1, orderId: 1, requestKey: 1}, {unique: true});
schema.index({shopId: 1, orderId: 1, recordedAt: -1, _id: -1});
schema.pre('save', function () {
    if (!this.isNew) throw new apiError(409, 'Customer name history is immutable');
});
schema.pre('bulkWrite', function () { throw new apiError(409, 'Customer name history is immutable'); });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete'] as const) {
    schema.pre(operation, function () { throw new apiError(409, 'Customer name history is immutable'); });
}
schema.pre('deleteOne', {document: true, query: false}, function () {
    throw new apiError(409, 'Customer name history is immutable');
});

export const InvoiceCustomerNameCorrection = model('InvoiceCustomerNameCorrection', schema);
