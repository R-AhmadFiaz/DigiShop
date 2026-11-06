import mongoose, { Types } from "mongoose";
import { Schema, model } from "mongoose";

export interface ICategory {
    name: string,
    description?: string,
    slug: string,
    shopId: Types.ObjectId,

    createdAt: Date,
    updatedAt: Date,

}

const categorySchema = new Schema<ICategory>(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        description: {
            type: String,
            default: ''
        },
        slug: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        shopId: {
            type: Schema.Types.ObjectId,
            ref: 'Shop',
            required: true
        },
        

    },
    {timestamps: true})

    categorySchema.index({shopId: 1, name: 1}, {unique: true})
    categorySchema.index({shopId: 1, slug: 1}, {unique: true})

export const Category = model('Category', categorySchema)