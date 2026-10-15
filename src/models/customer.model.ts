import { Schema, Types, model } from "mongoose";

export interface ICustomer {
    name: string,
    phoneNo: string,
    address?: string,
    remainingMoney: number,
    storeCreditBalanceMinor: number,
    shopId: Types.ObjectId
}

const customerSchema = new Schema<ICustomer>(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        phoneNo: {
            type: String,
            required: true    
        },
        address: {
            type: String,
            default: ""
        },
        remainingMoney: {
            type: Number,
            required: true,
            default: 0
        },
        storeCreditBalanceMinor: {type: Number, default: 0, min: 0, validate: Number.isSafeInteger},
        shopId: {
            type: Schema.Types.ObjectId,
            ref: 'Shop',
            required: true
            
        }
    }, {timestamps: true})


export const Customer = model<ICustomer>('Customer', customerSchema)
