import {Schema, model} from 'mongoose';
import {accountKinds} from '../utils/businessAccounting.js';
import type {AccountKind} from '../utils/businessAccounting.js';

const schema = new Schema({
    shopId: {type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true},
    code: {type: String, required: true, immutable: true}, name: {type: String, required: true},
    kind: {type: String, enum: Object.keys(accountKinds), required: true, immutable: true},
    normalSide: {type: String, enum: ['DEBIT', 'CREDIT'], required: true, immutable: true},
    authority: {type: String, enum: ['JOURNAL', 'LEGACY_CUSTOMER'], required: true, immutable: true},
    entityId: {type: Schema.Types.ObjectId, ref: 'BusinessEntity', immutable: true},
    currency: {type: String, enum: ['PKR'], default: 'PKR', immutable: true},
    isActive: {type: Boolean, default: true},
    postingRevision: {type: Number, default: 0, min: 0, validate: Number.isSafeInteger},
    openingAt: Date, lastPostedAt: Date,
    cashCutoverId: {type: Schema.Types.ObjectId, ref: 'FinancialAccount'},
    // Preparation evidence only. There is deliberately no LIVE state in Phase 2A.
    cashIntegration: {type: new Schema({
        state: {type: String, enum: ['PREPARED'], required: true},
        cutoffAt: {type: Date, required: true},
        accountIds: {type: [Schema.Types.ObjectId], required: true},
        preparedBy: {type: Schema.Types.ObjectId, required: true},
        preparedAt: {type: Date, required: true}
    }, {_id: false})}
}, {timestamps: true});
schema.pre('validate', function () {
    const legacy = ['CUSTOMER_RECEIVABLE', 'STORE_CREDIT_LIABILITY'].includes(this.kind);
    const party = legacy || this.kind === 'SUPPLIER_PAYABLE';
    if (accountKinds[this.kind as AccountKind] !== this.normalSide || this.authority !== (legacy ? 'LEGACY_CUSTOMER' : 'JOURNAL') || party !== !!this.entityId) throw new Error('Invalid account classification or authority');
});
schema.index({shopId: 1, code: 1}, {unique: true});
schema.index({shopId: 1, entityId: 1, kind: 1}, {unique: true, partialFilterExpression: {entityId: {$type: 'objectId'}}});
schema.index({shopId: 1, kind: 1}, {unique: true, partialFilterExpression: {kind: 'SETTLEMENT_CLEARING'}});
export const FinancialAccount = model('FinancialAccount', schema);
