import {automaticReference} from '../utils/references.js';
import {apiError} from '../utils/apiError.js';
import {Schema, model, Document, Types} from 'mongoose'

// sub order interface

export interface IOrderItems {
    lineId?: string,
    name?: string,
    brand?: string,
    unit?: string,
    productId: Types.ObjectId,
    quantity: number,
    unitPrice: number,
    sellingPrice?: number,
    itemDiscount?: number,

    
} 


// sub-Order schema

const orderItemSchema = new Schema<IOrderItems>({
    lineId: {type: String},
    name: {type: String},
    brand: {type: String},
    unit: {type: String},
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
    sellingPrice: {type: Number, min: 0},
    itemDiscount: {type: Number, min: 0},
    unitPrice: {
        type: Number,
        required: true,
        min: 0
    },
    
}, {_id: false})

// Order interface

export interface IOrder extends Document{
    accountingMode?: 'INTEGRATION_TEST' | 'LIVE',
    revision?: number,
    originalSnapshot?: Record<string, any>,
    returnState?: 'NONE' | 'PARTIAL' | 'FULL',
    settlementState?: {cashNetMinor: number, creditNetMinor: number, openingCashMinor: number, openingCreditMinor: number},
    creditRecipientId?: Types.ObjectId,
    cancelledAt?: Date,
    cancellationMode?: 'LEGACY' | 'SETTLED',
    invoiceNo: string,
    type: 'INVOICE' | 'QUOTATION',
    items: IOrderItems[],
    discountAmount: number,
    discountType: 'PERCENTAGE' | 'FIXED' | 'NONE',
    discountValue: number,
    subtotal: number,
    totalPrice: number,
    status: 'PENDING' | 'DELIVERED' | 'CANCELLED' | 'DRAFT' | 'EXPIRED' | 'CONVERTED',
    saleType: 'WHOLESALE' | 'RETAIL',
    createdBy: Types.ObjectId,
    createdByName?: string,
    paidAmount: number,
    amountDue: number,
    customerId: Types.ObjectId,
    shopId: Types.ObjectId,
    createdAt: Date,
    updatedAt: Date
}




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
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        createdByName: {
            type: String,
            trim: true
        },
        revision: {type: Number, default: 0, min: 0},
        accountingMode: {type: String, enum: ['INTEGRATION_TEST','LIVE']},
        returnState: {type: String, enum: ['NONE', 'PARTIAL', 'FULL'], default: 'NONE'},
        // Set once by the internal adjustment core; existing public writes are unchanged.
        originalSnapshot: {type: Schema.Types.Mixed, immutable: true},
        settlementState: {type: new Schema({
            cashNetMinor: {type: Number, required: true, min: 0, validate: Number.isSafeInteger},
            creditNetMinor: {type: Number, required: true, min: 0, validate: Number.isSafeInteger},
            openingCashMinor: {type: Number, required: true, min: 0, validate: Number.isSafeInteger},
            openingCreditMinor: {type: Number, required: true, min: 0, validate: Number.isSafeInteger}
        }, {_id: false})},
        creditRecipientId: {type: Schema.Types.ObjectId, ref: 'Customer'},
        cancelledAt: {type: Date},
        cancellationMode: {type: String, enum: ['LEGACY', 'SETTLED']},
        paidAmount: {
            type: Number,
            required: true
        },
        amountDue: {
            type: Number,
            required: true
        },
        customerId: {
            type: Schema.Types.ObjectId,
            ref: 'Customer'
        },
        shopId: {
            type: Schema.Types.ObjectId,
            ref: 'Shop',
            required: true
        },
        invoiceNo: {
            type: String,
            required: false,
            default: ''
        }



    }, {timestamps: true})

    orderSchema.index({type: 1, status: 1})
    orderSchema.index({shopId: 1, type: 1, createdAt: -1})
    orderSchema.index({shopId: 1, cancelledAt: 1})

    orderSchema.pre('validate', function () {
        if (!this.isNew || this.type !== 'INVOICE') return;
        for (const item of this.items) item.lineId ??= new Types.ObjectId().toString();
        if (!this.originalSnapshot) {
            this.createdAt ??= new Date();
            const saved = this.toObject();
            this.originalSnapshot = {
                source: 'CREATION', capturedAt: new Date(),
                createdAt: saved.createdAt,
                invoiceNo: saved.invoiceNo, createdBy: saved.createdBy,
                createdByName: saved.createdByName, customerId: saved.customerId,
                saleType: saved.saleType, status: saved.status, items: saved.items,
                subtotal: saved.subtotal, discountType: saved.discountType,
                discountValue: saved.discountValue, discountAmount: saved.discountAmount,
                totalPrice: saved.totalPrice, paidAmount: saved.paidAmount, amountDue: saved.amountDue,
                openingFunding: saved.settlementState
            };
        }
    });

automaticReference(orderSchema,d=>d.type==='QUOTATION'?'QT':undefined,'invoiceNo');
orderSchema.pre('save',async function(){
    if(this.isNew&&this.type==='INVOICE'&&this.invoiceNo){
        if(await Order.exists({shopId:this.shopId,invoiceNo:this.invoiceNo}).session(this.$session()))throw new apiError(409,'Invoice reference already exists in this shop');
        this.set('referenceIssued',true);
    }
});
export const Order = model<IOrder>('Order', orderSchema)
