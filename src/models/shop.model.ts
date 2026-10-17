import { Schema, model, Types } from "mongoose";


interface IShop {
    name: string,
    address: string,
    ownerId: Types.ObjectId,
    contactNo: string,
    invoiceCounter: number,
    purchaseCounter: number,
    receiptCounter: number,
    subscriptionActive: boolean,
    isActive: boolean,
    subscriptionExpiry: Date | null,
    accounting?: {state: 'PREPARING' | 'ACTIVE' | 'PAUSED', revision: number, strategy: 'CLEAN_START' | 'RECONCILE', cutoffAt?: Date, activatedAt?: Date, setupId?: Types.ObjectId},
    accountingWriteRevision: number,
    createdAt: Date,
    updatedAt: Date
}

const shopSchema = new Schema<IShop>(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        address: {
            type: String,
            required: true
        },
        ownerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            unique: true
            
        },
        contactNo: {
            type: String,
            required: true,
            unique: true
        },
        invoiceCounter: {
            type: Number,
            required: true,
            default: 0
        },
        purchaseCounter: {type:Number,default:0,min:0,validate:Number.isSafeInteger},
        receiptCounter: {type:Number,default:0,min:0,validate:Number.isSafeInteger},
        accountingWriteRevision: {type:Number,default:0},
        accounting: {type: new Schema({
            state: {type:String,enum:['PREPARING','ACTIVE','PAUSED'],required:true},
            revision: {type:Number,required:true,min:1},
            strategy: {type:String,enum:['CLEAN_START','RECONCILE'],required:true},
            cutoffAt: Date, activatedAt: Date, setupId: Schema.Types.ObjectId
        }, {_id:false})},
        subscriptionActive: {
            type: Boolean,
            default: false
        },
        isActive: {
            type: Boolean,
            default: true
        },
        subscriptionExpiry: {
            type: Date,
            default: null
        }


    }, {timestamps: true})

export const Shop = model<IShop>('Shop', shopSchema)
