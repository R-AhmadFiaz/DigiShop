import { Schema, Types, model, Document } from "mongoose";
import { timeStamp } from "node:console";

export interface IStockLog extends Document{
    adjustmentId?: Types.ObjectId,
    disposition?: 'RESTOCK' | 'DAMAGED',
    returnedQuantity?: number,
    productId: Types.ObjectId,
    quantityDelta: number,
    reason: string,
    referenceId?: Types.ObjectId,
    createdBy: Types.ObjectId,
    saleType?: string,
    shopId: Types.ObjectId,
    invoiceNo: string,
    createdAt: Date,
    updatedAt: Date

}

const stockLogSchema = new Schema<IStockLog>(
    {
        adjustmentId: {type: Schema.Types.ObjectId, ref: 'InvoiceAdjustment'},
        disposition: {type: String, enum: ['RESTOCK', 'DAMAGED']},
        returnedQuantity: {type: Number, min: 0},
        productId: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true
        },
        quantityDelta: {
            type: Number,
            required: true,
            default: 0
        },
        reason: {
            type: String,
            required: true,
            default: ""
        },
        referenceId: {
            type: Schema.Types.ObjectId,
            ref: 'Order',
            
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        saleType: {
            type: String
        },
        shopId: {
            type: Schema.Types.ObjectId,
            ref: 'Shop',
            required: true
        },
        invoiceNo: {
            type: String,
            default: ''
        }
    }, {timestamps: true})

    stockLogSchema.index({productId: 1, createdAt: -1})

export const StockLog = model<IStockLog>('StockLog', stockLogSchema)
