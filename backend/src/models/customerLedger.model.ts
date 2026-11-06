import { Schema, Types, model } from "mongoose";

interface ICustomerLedger {
    balanceType?: 'DEBT' | 'CREDIT',
    amountMinor?: number,
    adjustmentId?: Types.ObjectId,
    customerId: Types.ObjectId,
    amount: number,
    description: string,
    referenceId: Types.ObjectId,
    createdBy: Types.ObjectId,
    shopId: Types.ObjectId,
    invoiceNo: string

    createdAt: Date,
    updatedAt: Date

    
}

const customerLedgerSchema = new Schema<ICustomerLedger>(
    {
        balanceType: {type: String, enum: ['DEBT', 'CREDIT'], default: 'DEBT'},
        amountMinor: {type: Number, validate: Number.isSafeInteger},
        adjustmentId: {type: Schema.Types.ObjectId, ref: 'InvoiceAdjustment'},
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
        },
        shopId: {
            type: Schema.Types.ObjectId,
            ref: 'Shop',
            required: true
        },
        invoiceNo: {
            type: String,
            default: '',
            required: true
        }
        
    }, {timestamps: true})


export const CustomerLedger = model<ICustomerLedger>('CustomerLedger', customerLedgerSchema)
