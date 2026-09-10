import {Document, Types, Schema, model} from "mongoose";

export interface IProduct extends Document {
    name: string,
    description?: string,
    slug: string,
    brand: string,
    category: Types.ObjectId
    unit: string,
    costPrice: number,
    retailPrice: number,
    wholesalePrice?: number,
    stockQuantity: number,
    minStockThreshold: number,
    createdAt: Date,
    updatedAt: Date
}


const productSchema = new Schema<IProduct>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true

        },
        description: {
            type: String,
            default: ""

        },
        slug: {
            type: String,
            required: true,
            unique: true,
            lowercase: true
            
        },
        brand: {
            type: String,
            required: true,
            index: true
        },
        unit: {
            type: String,
            default: 'pcs',
            trim: true,
            lowercase: true

        },
        category: {
            type: Schema.Types.ObjectId,
            ref: 'Category',
            required: true

        },
        costPrice: {
            type: Number,
            min: [0,'Cost cant be negative'],
            default: 0,
            required: true

        },
        retailPrice: {
            type: Number,
            min: [0,'Cost cant be negative'],
            default: 0,
            required: true

        },
        wholesalePrice: {
            type: Number,
            min: [0,'Cost cant be negative'],
            default: 0

        },
        stockQuantity: {
            type: Number,
            min: [0,'Cost cant be negative'],
            default: 0,
            required: true

        },
        minStockThreshold: {
            type: Number,
            min: [0,'Cost cant be negative'],
            default: 0,
            required: true

        },

    }, {timestamps: true})

    productSchema.index({ name: "text", brand: "text" });


export const Product = model<IProduct>('Product', productSchema)



