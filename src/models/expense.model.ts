import {Schema, model} from 'mongoose';
import {apiError} from '../utils/apiError.js';

const category = new Schema({
    shopId: {type: Schema.Types.ObjectId, required: true, immutable: true},
    name: {type: String, required: true}, key: {type: String, required: true}
}, {timestamps: true});
category.index({shopId: 1, key: 1}, {unique: true});
export const ExpenseCategory = model('ExpenseCategory', category);

const schema = new Schema({
    shopId: {type: Schema.Types.ObjectId, required: true},
    requestKey: {type: String, required: true}, requestHash: {type: String, required: true},
    kind: {type: String, enum: ['EXPENSE', 'EXPENSE_REVERSAL'], required: true},
    reversalOf: {type: Schema.Types.ObjectId, ref: 'Expense'},
    categoryId: {type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true},
    categoryName: {type: String, required: true},
    amountMinor: {type: Number, required: true, min: 1, validate: Number.isSafeInteger},
    accountId: {type: Schema.Types.ObjectId, ref: 'FinancialAccount', required: true},
    expenseAccountId: {type: Schema.Types.ObjectId, ref: 'FinancialAccount', required: true},
    accountName: {type: String, required: true}, accountKind: {type: String, enum: ['CASH', 'BANK'], required: true},
    occurredAt: {type: Date, required: true}, recordedAt: {type: Date, required: true, default: Date.now},
    description: {type: String, required: true}, reference: String,
    createdBy: {type: Schema.Types.ObjectId, required: true}, createdByName: {type: String, required: true},
    createdByRole: {type: String, enum: ['OWNER'], required: true}
}, {versionKey: false});
schema.index({shopId: 1, requestKey: 1}, {unique: true});
schema.index({shopId: 1, reversalOf: 1}, {unique: true, partialFilterExpression: {reversalOf: {$type: 'objectId'}}});
schema.index({shopId: 1, occurredAt: -1, _id: -1});
schema.index({shopId: 1, categoryId: 1, occurredAt: -1});
schema.pre('save', function () { if (!this.isNew) throw new apiError(409, 'Expense history is immutable; use a reversal'); });
schema.pre('bulkWrite', function () { throw new apiError(409, 'Expense history is immutable'); });
for (const op of ['updateOne','updateMany','findOneAndUpdate','replaceOne','findOneAndReplace','deleteOne','deleteMany','findOneAndDelete'] as const) {
    schema.pre(op, function () { throw new apiError(409, 'Expense history is immutable; use a reversal'); });
}
schema.pre('deleteOne', {document: true, query: false}, function () { throw new apiError(409, 'Expense history is immutable'); });
export const Expense = model('Expense', schema);
