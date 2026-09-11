import { Schema, Types, model, Document } from "mongoose";
import { timeStamp } from "node:console";

export interface IStockLog extends Document{
    productId: Types.ObjectId,
    quantityDelta: number,
    reason: string,
    createdAt: Date,
    updatedAt: Date

}

const stockLogSchema = new Schema<IStockLog>(
    {
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
        }
    }, {timestamps: true})

export const StockLog = model<IStockLog>('StockLog', stockLogSchema)

