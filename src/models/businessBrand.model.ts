import {Schema, model} from 'mongoose';

const brandSchema = new Schema({
    shopId: {type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true},
    name: {type: String, required: true}, nameKey: {type: String, required: true},
    entityIds: {type: [Schema.Types.ObjectId], ref: 'BusinessEntity', default: []}
}, {timestamps: true});
brandSchema.index({shopId: 1, nameKey: 1}, {unique: true});
export const BusinessBrand = model('BusinessBrand', brandSchema);

// Keep Product.brand and all existing product/POS behavior unchanged.
const linkSchema = new Schema({
    shopId: {type: Schema.Types.ObjectId, ref: 'Shop', required: true, immutable: true},
    productId: {type: Schema.Types.ObjectId, ref: 'Product', required: true, immutable: true},
    brandId: {type: Schema.Types.ObjectId, ref: 'BusinessBrand', required: true}
}, {timestamps: true});
linkSchema.index({shopId: 1, productId: 1}, {unique: true});
linkSchema.index({shopId: 1, brandId: 1});
export const ProductBrandLink = model('ProductBrandLink', linkSchema);
