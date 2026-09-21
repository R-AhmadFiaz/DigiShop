import { Schema, model, Types } from "mongoose";


interface IShop {
    name: string,
    address: string,
    ownerId: Types.ObjectId,
    contactNo: string,
    createdAt: Date,
    updatedAt: Date
}

const shopSchema = new Schema<IShop>(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        address: {
            type: String,
            required: true
        },
        ownerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            unique: true
            
        },
        contactNo: {
            type: String,
            required: true,
            unique: true
        }


    }, {timestamps: true})

export const Shop = model<IShop>('Shop', shopSchema)