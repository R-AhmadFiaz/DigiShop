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
    discountAmount: number,
    discountType: 'PERCENTAGE' | 'FIXED' | 'NONE',
    discountValue: number,
    subtotal: number,
    totalPrice: number,
    status: 'PENDING' | 'DELIVERED' | 'CANCELLED' | 'DRAFT' | 'EXPIRED' | 'CONVERTED',
    saleType: 'WHOLESALE' | 'RETAIL',
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

        },
        discountType: {
            type: String,
            enum: ['PERCENTAGE', 'FIXED', 'NONE'],
            default: 'NONE'

        },
        discountValue: {
            type: Number,
            default: 0

        },
        discountAmount: {
            type: Number,
            required: true,
            default: 0,
            min: 0
        },
        subtotal: {
            type: Number,
            required: true,
            default: 0
        },
        saleType: {
            type: String,
            enum: ['WHOLESALE', 'RETAIL'],
            required: true,
            default: 'RETAIL'
        }



    }, {timestamps: true})

    orderSchema.index({type: 1, status: 1})

export const Order = model<IOrder>('Order', orderSchema)