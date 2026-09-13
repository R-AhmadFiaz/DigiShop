import {Schema, model, Document, Types} from 'mongoose'

// sub order interface

export interface IOrderItems {
    productId: Types.ObjectId,
    quantity: number,
    unitPrice: number,

    
} 

// Order interface

export interface IOrder extends Document{
    type: 'INVOICE' | 'QUOTATION',
    items: IOrderItems[],
    totalPrice: number,
    status: 'PENDING' | 'DELIVERED' | 'CANCELLED' | 'DRAFT' | 'EXPIRED' | 'CONVERTED',
    createdAt: Date,
    updatedAt: Date
}

// sub-Order schema

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


// Order schema

const orderSchema = new Schema<IOrder>(
    {

        type: {

            type: String,
            enum: ['INVOICE', 'QUOTATION'],
            required: true,
            default: 'INVOICE'

        },
        
        
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
            enum: ['PENDING', 'DELIVERED', 'CANCELLED', 'DRAFT', 'EXPIRED', 'CONVERTED'],
            default: 'PENDING'

        }


    }, {timestamps: true})

export const Order = model<IOrder>('Order', orderSchema)