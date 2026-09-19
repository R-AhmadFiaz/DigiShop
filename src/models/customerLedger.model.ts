import { Schema, Types, model } from "mongoose";

interface ICustomerLedger {
    customerId: Types.ObjectId,
    amount: number,
    description: string,
    referenceId: Types.ObjectId,
    createdBy: Types.ObjectId,
    createdAt: Date,
    updatedAt: Date

    
}

const customerLedgerSchema = new Schema<ICustomerLedger>(
    {
        customerId: {
            type: Schema.Types.ObjectId,
            ref: 'Customer',
            required: true
        },
        amount: {
            type: Number,
            required: true,
        },
        description: {
            type: String,
            required: true,

        },
        referenceId: {
            type: Schema.Types.ObjectId,
            ref: 'Order'
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        }
        
    }, {timestamps: true})


export const CustomerLedger = model<ICustomerLedger>('CustomerLedger', customerLedgerSchema)