import {Schema, model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const snapshotSchema = new Schema({
    items: {type: [new Schema({
        lineId: {type: String, required: true},
        productId: {type: Schema.Types.ObjectId, required: true},
        name: String, brand: String, unit: String,
        quantity: {type: Number, required: true, min: 1},
        unitPrice: {type: Number, required: true, min: 0}
    }, {_id: false})], required: true},
    subtotalMinor: {type: Number, required: true},
    discountMinor: {type: Number, required: true},
    totalMinor: {type: Number, required: true},
    settledMinor: {type: Number, required: true},
    dueMinor: {type: Number, required: true},
    discountType: {type: String, required: true},
    discountValue: {type: Number, required: true}
}, {_id: false});
const adjustmentSchema = new Schema({
    kind: {type: String, enum: ['SALE', 'ADJUSTMENT', 'PAYMENT', 'CANCELLATION'], default: 'ADJUSTMENT'},
    debtCustomerId: {type: Schema.Types.ObjectId},
    creditCustomerId: {type: Schema.Types.ObjectId},
    creditRecipientId: {type: Schema.Types.ObjectId},
    shopId: {type: Schema.Types.ObjectId, required: true},
    orderId: {type: Schema.Types.ObjectId, ref: 'Order', required: true},
    invoiceNo: {type: String, required: true},
    requestKey: {type: String, required: true},
    requestHash: {type: String, required: true},
    sourceQuotationId: {type: Schema.Types.ObjectId},
    cashRouting: {type: new Schema({
        mode: {type: String, enum: ['INTEGRATION_TEST'], required: true},
        receiptAccountId: {type: Schema.Types.ObjectId}, refundAccountId: {type: Schema.Types.ObjectId}
    }, {_id: false})},
    revisionBefore: {type: Number, required: true},
    revisionAfter: {type: Number, required: true},
    createdBy: {type: Schema.Types.ObjectId, required: true},
    createdByName: {type: String, required: true},
    createdByRole: {type: String, enum: ['OWNER', 'CASHIER']},
    reason: {type: String, required: true},
    before: {type: snapshotSchema, required: true},
    after: {type: snapshotSchema, required: true},
    movements: {type: [new Schema({
        lineId: {type: String, required: true},
        productId: {type: Schema.Types.ObjectId, required: true},
        kind: {type: String, enum: ['RETURN', 'ADD'], required: true},
        quantity: {type: Number, required: true, min: 1},
        unitPriceMinor: {type: Number, required: true},
        stockDelta: {type: Number, required: true},
        disposition: {type: String, enum: ['RESTOCK', 'DAMAGED']}
    }, {_id: false})], required: true},
    // Signed sales/debt deltas; nonnegative receipts/refunds/credit movements, in paisa.
    financial: {type: new Schema({
        salesDeltaMinor: {type: Number, required: true, default: 0},
        debtDeltaMinor: {type: Number, required: true, default: 0},
        cashReceivedMinor: {type: Number, required: true, default: 0},
        cashRefundMinor: {type: Number, required: true, default: 0},
        creditRedeemedMinor: {type: Number, required: true, default: 0},
        creditIssuedMinor: {type: Number, required: true, default: 0},
        creditRestoredMinor: {type: Number, required: true, default: 0}
    }, {_id: false}), required: true},
    occurredAt: {type: Date, required: true, default: Date.now}
}, {versionKey: false});
adjustmentSchema.index({shopId: 1, orderId: 1, requestKey: 1}, {unique: true});
adjustmentSchema.index({shopId: 1, occurredAt: 1});
adjustmentSchema.index({shopId: 1, orderId: 1, occurredAt: -1, _id: -1});
adjustmentSchema.index({shopId: 1, kind: 1, requestKey: 1}, {unique: true, partialFilterExpression: {kind: 'SALE'}});
adjustmentSchema.index({shopId: 1, orderId: 1, kind: 1}, {unique: true, partialFilterExpression: {kind: 'SALE'}});
// Application-level append-only history. A database administrator can still alter records.
adjustmentSchema.pre('save', function () {
    if (!this.isNew) throw new apiError(409, 'Adjustment history is immutable');
});
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'] as const) {
    adjustmentSchema.pre(operation, function () { throw new apiError(409, 'Adjustment history is immutable'); });
}
export const InvoiceAdjustment = model('InvoiceAdjustment', adjustmentSchema);
