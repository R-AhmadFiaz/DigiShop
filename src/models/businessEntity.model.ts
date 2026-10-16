import {Schema, model} from 'mongoose';

export const businessRoles = ['CUSTOMER', 'SUPPLIER', 'COMPANY', 'MANUFACTURER', 'OTHER'] as const;
const schema = new Schema({
    shopId: {type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true},
    key: {type: String, required: true, immutable: true},
    customerId: {type: Schema.Types.ObjectId, ref: 'Customer'},
    // Linked customer identity is read from Customer, not copied into this record.
    name: {type: String, trim: true}, phoneNo: {type: String, default: ''}, address: {type: String, default: ''},
    roles: {type: [String], enum: businessRoles, required: true},
    customerType: {type: String, enum: ['RETAIL', 'WHOLESALE']},
    revision: {type: Number, default: 0, min: 0, validate: Number.isSafeInteger}
}, {timestamps: true});
schema.pre('validate', function () {
    if (!this.roles.length || new Set(this.roles).size !== this.roles.length) throw new Error('Valid unique business roles required');
    if (this.customerId ? !!this.name || !this.roles.includes('CUSTOMER') : !this.name?.trim() || this.roles.includes('CUSTOMER')) throw new Error('Customer role must use the existing customer identity');
    if (this.customerType && !this.roles.includes('CUSTOMER')) throw new Error('Customer type requires customer role');
});
schema.index({shopId: 1, key: 1}, {unique: true});
schema.index({shopId: 1, customerId: 1}, {unique: true, partialFilterExpression: {customerId: {$type: 'objectId'}}});
schema.index({shopId: 1, roles: 1});
export const BusinessEntity = model('BusinessEntity', schema);
