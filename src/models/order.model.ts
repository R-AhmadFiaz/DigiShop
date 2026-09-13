import {Schema, model, Document, Types} from 'mongoose'

export interface IOrderItems {
    productId: Types.ObjectId,
    quantity: number,
    unitPrice: number,

    
}

export interface IOrder extends Document{
    items: IOrderItems[],
    totalPrice: number,
    status: 'PENDING' | 'DELIVERED' | 'CANCELLED',
    createdAt: Date,
    updatedAt: Date
}

const orderItemSchema = new Schema<IOrderItems>({
    productId: {
        type: Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
    },
    unitPrice: {
        type: Number,
        required: true,
        min: 0
    },
    
}, {_id: false})

const orderSchema = new Schema<IOrder>(
    {
        items: {
            type: [orderItemSchema],
            required: true,
        },
        totalPrice: {
            type: Number,
            required: true,
            default: 0
        },
        status: {
            type: String,
            enum: ['PENDING', 'DELIVERED', 'CANCELLED'],
            default: 'PENDING'

        }


    }, {timestamps: true})

export const Order = model<IOrder>('Order', orderSchema)