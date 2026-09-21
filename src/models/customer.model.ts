import { Schema, Types, model } from "mongoose";

interface ICustomer {
    name: string,
    phoneNo: string,
    address?: string,
    remainingMoney: number,
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
        shopId: {
            type: Schema.Types.ObjectId,
            ref: 'Shop',
            required: true
            
        }
    }, {timestamps: true})


export const Customer = model<ICustomer>('Customer', customerSchema)