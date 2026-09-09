import mongoose from "mongoose";
import { Schema, model } from "mongoose";

export interface ICategory {
    name: string,
    description?: string,
    slug: string,
    createdAt: Date,
    updatedAt: Date,

}

const categorySchema = new Schema<ICategory>(
    {
        name: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true
        },
        description: {
            type: String,
            default: true
        },
        slug: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true
        }

    },
    {timestamps: true})

export const Category = model('Category', categorySchema)