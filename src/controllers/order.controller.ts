import {nextReference} from '../utils/references.js';
import {accountingMode, claimAccountingShop} from '../utils/accountingActivation.js';
import { listQuery } from "../utils/listQuery.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { type Request, type Response } from "express";
import { apiError } from "../utils/apiError.js";
import mongoose, { Schema } from "mongoose";
import { Product } from "../models/product.model.js";
import type { IOrder, IOrderItems } from "../models/order.model.js";
import { Order } from "../models/order.model.js";
import { apiResponse } from "../utils/apiResponse.js";
import { StockLog } from "../models/stockLog.model.js";
import { CustomerLedger } from "../models/customerLedger.model.js";
import { Customer } from "../models/customer.model.js";
import { User } from "../models/user.model.js";
import { Shop } from "../models/shop.model.js";
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {createHash} from 'node:crypto';
import {invoiceTotals, moneyMinor, moneyMajor, safeMinor} from '../utils/invoiceAccounting.js';
import {changeStoreCredit} from '../utils/invoiceSettlement.js';
import {invoiceEligibility} from './invoiceAdjustment.controller.js';
import {invoiceAccountingEnabled, invoiceCashRouting, requireAccountingShopUser, recordIntegratedSale, throwAccountingTransactionError} from '../utils/invoiceAccountingIntegration.js';





// Invoice-only prices. Never write these values to Product.
function invoiceItemRate(item:any, fallback:number){
    const sellingPrice=item.unitPrice===undefined?fallback:item.unitPrice,itemDiscount=item.itemDiscount===undefined?0:item.itemDiscount;
    for(const value of [sellingPrice,itemDiscount])if(typeof value!=='number'||!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>0.000001)throw new apiError(400,'Item prices and discounts must be valid PKR amounts with at most two decimal places');
    if(itemDiscount>sellingPrice)throw new apiError(400,'Item discount cannot exceed selling price');
    return {sellingPrice,itemDiscount,unitPrice:moneyMajor(moneyMinor(sellingPrice)-moneyMinor(itemDiscount))};
}

export const createOrder = asyncHandler(async(req: Request, res: Response) => {
    // take product objects have product ids and quantity
    // check if array is valid
    // check if it have both id and quantity
    // activate sessionTransaction 
    // go to mongoose find and update the stock 
    // collect unit price 


    const { items, saleType, discountType = 'NONE', discountValue = 0, paidAmount = 0, customerId} = req.body
    const {_id: userID, shopId} = req.user
    const creditAmount = req.body.creditAmount === undefined ? 0 : req.body.creditAmount
    const creditMinor = moneyMinor(creditAmount)
    const requestKey = req.body.requestKey
    const accounting = invoiceAccountingEnabled()
    if (accounting) {
        requireAccountingShopUser(req.user)
        if (typeof requestKey !== 'string' || !/^[\w-]{8,100}$/.test(requestKey)) throw new apiError(400, 'Accounting sale requires a valid request key')
    }
    const routing = accounting ? invoiceCashRouting(req.body) : undefined
    if (creditMinor && (!['OWNER', 'CASHIER'].includes(req.user.role) || !mongoose.isValidObjectId(customerId) ||
        typeof requestKey !== 'string' || !/^[\w-]{8,100}$/.test(requestKey))) {
        throw new apiError(400, 'Store credit requires a customer and valid request key')
    }
    const creditHash = creditMinor || accounting ? createHash('sha256').update(JSON.stringify({userID: String(userID),
        items, saleType, discountType, discountValue, paidAmount, customerId, creditAmount,
        ...(accounting ? {cashRouting: routing} : {})})).digest('hex') : ''

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new apiError(400, 'Array of items required!')
    }

    if (!saleType || !['WHOLESALE', 'RETAIL'].includes(saleType)) {
        throw new apiError(400, 'REQUIRED VALID SALE TYPE')
    }

    if (!discountType || !['PERCENTAGE', 'FIXED', 'NONE'].includes(discountType)) {
        throw new apiError(400, 'REQUIRED VALID DISCOUNT TYPE')
    }


    
    if (typeof paidAmount !== 'number' || !Number.isFinite(paidAmount) || paidAmount < 0) {
        throw new apiError(400, 'Required valid paid amount')
    }
    if (typeof discountValue !== 'number' || !Number.isFinite(discountValue) || discountValue < 0 || (discountType === 'NONE' && discountValue !== 0)) {
        throw new apiError(400, 'Required valid discount value')
    }

    for (const item of items) {
        const isObject = typeof item === 'object' && item !== null && !Array.isArray(item)
        
        if (!isObject) {

            throw new apiError(400, 'Atleast one Product is required')
            
        }

        const hasValidProductId = typeof item.productId === 'string' && item.productId.trim() !== ''
        const hasValidquantity = typeof item.quantity === 'number' && item.quantity > 0 && Number.isInteger(item.quantity)

        if (!hasValidProductId || !hasValidquantity) {
            throw new apiError(
                400,
                'Required valid Id and Quantity'
            )
        }
   
    
}


const session = await mongoose.startSession()

session.startTransaction(accounting ? {readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}} : undefined)

try {
    await claimAccountingShop(req.user, session);
    if (creditMinor || accounting) {
        const replay = await InvoiceAdjustment.findOne({shopId, kind: 'SALE', requestKey}).session(session)
        if (replay) {
            if (replay.requestHash !== creditHash || String(replay.createdBy) !== String(userID)) throw new apiError(409, 'Request key already used')
            const saved = await Order.findOne({_id: replay.orderId, shopId}).session(session)
            if (!saved) throw new apiError(409, 'Recorded sale requires reconciliation')
            await session.abortTransaction()
            return res.status(200).json(new apiResponse(200, saved, 'Sale already recorded'))
        }
    }

    let discountAmount = 0
    
    let subtotal = 0

    let itemTotal = 0

    let totalPrice: number = 0;

    let processedItems: IOrderItems[] = []

    for(const item of items){   


    // const product = await Product.findById(item.productId)
    
    const updatedproduct = await Product.findOneAndUpdate(
        {
            _id: item.productId,
            stockQuantity: {$gte: item.quantity},
            shopId

        },
        {
            $inc: {stockQuantity: -item.quantity}
        },
        {
            new: true,
            session

        }
              
    )

    if (!updatedproduct) {
        throw new apiError(404, 'Stock is not enough')
    }

    if (saleType == 'RETAIL') {
        
        itemTotal = updatedproduct.retailPrice * item.quantity
    }

    if (saleType == 'WHOLESALE' && !updatedproduct.wholesalePrice) {
        throw new apiError(400 , 'REQUIRED WHOLESALE PRICE')
    }


    if (saleType == 'WHOLESALE') {
        
        itemTotal = item.quantity * updatedproduct.wholesalePrice!
    }

    

   


    const rate=invoiceItemRate(item,saleType==='WHOLESALE'?updatedproduct.wholesalePrice!:updatedproduct.retailPrice)
    itemTotal=moneyMajor(safeMinor(moneyMinor(rate.unitPrice)*item.quantity))
    subtotal += itemTotal

    processedItems.push({

        name: updatedproduct.name,
        brand: updatedproduct.brand,
        unit: updatedproduct.unit,
        productId: updatedproduct._id,
        quantity: item.quantity,
        ...rate

    }) 

}

    


     if (discountType === 'PERCENTAGE') {
        if (discountValue < 0 || discountValue > 100) {
            throw new apiError(400, 'Required Valid Percentage amount')
        }
        discountAmount = subtotal * (discountValue/ 100)
    }

    if (discountType === 'FIXED') {
        if (discountValue < 0 || discountValue > subtotal) {
            throw new apiError(400, 'Required Valid Fixed Amount')
        }
        discountAmount = discountValue
    }

    if(items.some((i:any)=>i.unitPrice!==undefined||i.itemDiscount!==undefined)){const t=invoiceTotals(processedItems,discountType,discountValue);subtotal=moneyMajor(t.subtotalMinor);discountAmount=moneyMajor(t.discountMinor);}
    totalPrice = subtotal - discountAmount
    if (!Number.isFinite(totalPrice) || paidAmount > totalPrice) {
        throw new apiError(400, 'Paid amount cannot exceed final total')
    }

    let recordedPaidAmount = paidAmount
    let creditFunding: any
    if (creditMinor) {
        const totals = invoiceTotals(processedItems, discountType, discountValue)
        subtotal = moneyMajor(totals.subtotalMinor)
        discountAmount = moneyMajor(totals.discountMinor)
        totalPrice = moneyMajor(totals.totalMinor)
        const cashMinor = moneyMinor(paidAmount)
        const settledMinor = safeMinor(cashMinor + creditMinor)
        if (settledMinor > totals.totalMinor) throw new apiError(400, 'Cash and credit cannot exceed invoice total')
        recordedPaidAmount = moneyMajor(settledMinor)
        creditFunding = {cashNetMinor: cashMinor, creditNetMinor: creditMinor, openingCashMinor: cashMinor, openingCreditMinor: creditMinor}
    }
    let amountDue = creditMinor ? moneyMajor(moneyMinor(totalPrice) - moneyMinor(recordedPaidAmount)) : totalPrice - paidAmount
    if (accounting && !creditFunding) creditFunding = {cashNetMinor: moneyMinor(paidAmount), creditNetMinor: 0, openingCashMinor: moneyMinor(paidAmount), openingCreditMinor: 0}

    if (amountDue > 0 && !customerId) {
        throw new apiError(400, 'Required customer Id')
    }

    if (customerId) {
        const customerExist = await Customer.findOne({_id: customerId, shopId})
        if (!customerExist) {
            throw new apiError(400, 'The customer Id is not valid')
        }
    }


    const invoiceNo = await nextReference(shopId,'INV',Order,session,'invoiceNo')



const [createOrder] = await Order.create([{
    items: processedItems,
    status: 'PENDING',
    createdBy: userID,
    createdByName: req.user.username,
    saleType,
    discountAmount,
    discountType,
    discountValue,
    subtotal,
    totalPrice,
    amountDue,
    paidAmount: recordedPaidAmount,
    ...(accounting ? {accountingMode: accountingMode()} : {}),
    ...(creditMinor || accounting ? {settlementState: creditFunding} : {}),
    customerId,
    shopId,
    invoiceNo



}], { session })

if (!createOrder) {
    throw new apiError(500, 'Could not create Order')
}
const paymentRecordId = new mongoose.Types.ObjectId()
if (creditMinor) await changeStoreCredit(customerId, createOrder, -creditMinor, 'CREDIT_REDEEMED', req.user, paymentRecordId, session)


    

for (const item of processedItems) {

    await StockLog.create([{
        productId: item.productId,
        quantityDelta: -item.quantity,
        referenceId: createOrder._id,
        createdBy: userID,
        reason: 'Ordered Created',
        saleType,
        shopId,
        invoiceNo


    }],{session})


}


    if (customerId && amountDue > 0) {

            const customer =
                await Customer.findOneAndUpdate(
                    {
                        _id: customerId,
                        shopId
                    },
                    {
                        $inc: {
                            remainingMoney: amountDue
                        }
                    },
                    {
                        new: true,
                        session
                    }
                )


            if (!customer) {
                throw new apiError(
                    500,
                    'Something went wrong during credit amount in customer'
                )
            }


            // Create ONE ledger entry for the order
            await CustomerLedger.create(
                [{
                    customerId,
                    amount: amountDue,
                    description: 'PURCHASE',
                    referenceId: createOrder._id,
                    createdBy: userID,
                    shopId,
                    invoiceNo
                }],
                {
                    session
                }
            )
        }



if (accounting) {
    await recordIntegratedSale(req.user, createOrder, {requestKey, requestHash: creditHash, routing: routing!, eventId: paymentRecordId}, session)
} else if (creditMinor) {
    const snapshot = {items: createOrder.items, subtotalMinor: moneyMinor(subtotal), discountMinor: moneyMinor(discountAmount),
        totalMinor: moneyMinor(totalPrice), discountType, discountValue}
    await InvoiceAdjustment.create([{_id: paymentRecordId, shopId, orderId: createOrder._id, invoiceNo, kind: 'SALE',
        requestKey, requestHash: creditHash, revisionBefore: 0, revisionAfter: 0,
        createdBy: userID, createdByName: req.user.username, reason: 'POS payment with store credit',
        debtCustomerId: customerId, creditCustomerId: customerId,
        before: {...snapshot, settledMinor: 0, dueMinor: moneyMinor(totalPrice)},
        after: {...snapshot, settledMinor: moneyMinor(recordedPaidAmount), dueMinor: moneyMinor(amountDue)}, movements: [],
        financial: {salesDeltaMinor: 0, debtDeltaMinor: moneyMinor(amountDue), cashReceivedMinor: creditFunding.cashNetMinor,
            creditRedeemedMinor: creditMinor, cashRefundMinor: 0, creditIssuedMinor: 0, creditRestoredMinor: 0}}], {session})
}
await session.commitTransaction()

return res.status(201)
.json(
    new apiResponse(
        201,
        createOrder,
        'Order Created Successfully'
    )
)



}catch (error) {
    if (accounting) {
        if (session.inTransaction()) await session.abortTransaction().catch(() => {})
        throwAccountingTransactionError(error)
    } else await session.abortTransaction()
    if ((creditMinor || accounting) && ((error as any)?.code === 11000 || (error as any)?.code === 112 || (error as any)?.hasErrorLabel?.('TransientTransactionError'))) {
        throw new apiError(409, 'Concurrent credit sale; retry the same request key')
    }
    if (error instanceof apiError) {
        throw error

    }else{

        throw new apiError(500, `Could not fetch the data ${error}`)
    }
} finally {
    session.endSession()
}


})







export const cancelOrder = asyncHandler(async(req: Request, res: Response) => {
    if (invoiceAccountingEnabled()) throw new apiError(409, 'Accounting requires previewed settlement-aware cancellation');
    // fetch the order id from parameter
    // check it in mongo db 
    // check its must be pending state
    // start session transaction
    // use atomic db operation to restok back
    // transition status to cancel

    const {orderId} = req.params

    const {_id: userID, shopId} = req.user

    if (!orderId) {
        throw new apiError(400, 'Could not recieve Order')
    }

    const session = await mongoose.startSession()
    session.startTransaction()
    
    
    
    
    try {
    await claimAccountingShop(req.user, session);
        
        
        const orderInDb = await Order.findOneAndUpdate(
            {_id: orderId, shopId, type: 'INVOICE', status: 'PENDING'},
            {$set: {status: 'CANCELLED', cancelledAt: new Date(), cancellationMode: 'LEGACY'}},
            {new: true, session}
        )

        if (!orderInDb) {
            throw new apiError(404, 'No Order of this id found')
        }
        // Preserve the legacy cash-only route. Financial-history invoices must use
        // explicit, idempotent settlement-aware cancellation (still unmounted).
        if (orderInDb.settlementState || (orderInDb.revision ?? 0) > 0) {
            throw new apiError(409, 'Invoice has financial history; settlement-aware cancellation is required')
        }
        
        
        for (const item of orderInDb.items) {
            const restoredProduct = await Product.findOneAndUpdate(
                
                    {_id: item.productId, shopId},
                    {
                        $inc: {stockQuantity: item.quantity}
                    },
                    {
                        new: true,
                        session
                    }
                
            )

             if (!restoredProduct) {
                 throw new apiError(409, "Cannot restore stock: product missing from shop")
             }

             await StockLog.create([{
                productId: item.productId,
                quantityDelta: item.quantity,
                reason: 'Order get cancelled',
                referenceId: orderInDb._id,
                createdBy: userID,
                saleType: orderInDb.saleType,
                invoiceNo: orderInDb.invoiceNo,
                shopId
        }], {session})

        }


        
        
        

        // Use recorded debt, including legacy converted invoices without customerId.
        // Abort inconsistent histories instead of guessing or clamping balances.
        const purchases = await CustomerLedger.find({
            referenceId: orderInDb._id, shopId, description: 'PURCHASE'
        }).session(session)
        const debt = purchases.reduce((sum, entry) => sum + entry.amount, 0)
        const debtCustomerId = purchases[0]?.customerId
        if (!Number.isFinite(debt) || debt < 0 ||
            purchases.some(entry => String(entry.customerId) !== String(debtCustomerId)) ||
            (orderInDb.customerId && debtCustomerId && String(orderInDb.customerId) !== String(debtCustomerId)) ||
            (orderInDb.amountDue > 0 && debt !== orderInDb.amountDue)) {
            throw new apiError(409, 'Customer debt history is inconsistent; cancellation aborted')
        }
        if (debt > 0) {
            if (!debtCustomerId) throw new apiError(409, "Customer missing from debt history")
            const customer = await Customer.findOneAndUpdate(
                {_id: debtCustomerId, shopId, remainingMoney: {$gte: debt}},
                {$inc: {remainingMoney: -debt}},
                {new: true, session}
            )
            if (!customer) {
                throw new apiError(409, 'Customer balance cannot safely reverse this debt')
            }
            await CustomerLedger.create([{
                customerId: debtCustomerId,
                amount: -debt,
                description: 'CANCELLATION',
                referenceId: orderInDb._id,
                createdBy: userID,
                shopId,
                invoiceNo: orderInDb.invoiceNo
            }], {session})
        }

        await session.commitTransaction()

    return res.status(200)
    .json(
        new apiResponse(
            200,
            {orderInDb},
            'Order Cancel Successfully'
        )
    )
        
    } catch (error) {
    await session.abortTransaction()
    if (error instanceof apiError) {
        throw error

    }else{

        throw new apiError(500, `Could not fetch the data in cancel order ${error}`)
    }      
    } finally {
        session.endSession()
    }


   
    






    
    
})








export const updateOrderStatus = asyncHandler(async(req: Request, res: Response) => {

    const {orderId} = req.params

    const {_id: userID, shopId} = req.user
    
    if (!orderId) {
        throw new apiError(400, 'Doesnt get Order ID')
    }

    const order = await Order.findOneAndUpdate(
        {_id: orderId, shopId, type: 'INVOICE', status: 'PENDING'},
        {$set: {status: 'DELIVERED'}},
        {new: true}
    )

    if (!order) {
        throw new apiError(404, 'Order not found')
    }

    return res.status(200).json(
        new apiResponse(200, order, 'Ordered marked as delivered successfully')
    )





})









export const createQuotation = asyncHandler(async(req: Request, res: Response) => {
    
    // take the array of product from req.body
    // check and validate the array and object inside 
    // find the item from the array 
    // validate it
    // find its quantity and retail price 
    // calculate discount
    // calculate it and store in variable
    // push all items in array and create the final response

    const {items, discountValue = 0, discountType = 'NONE', saleType, paidAmount = 0, amountDue = 0} = req.body

    const {_id: userID, shopId} = req.user

    if (!items || !Array.isArray(items) || items.length == 0) {
        throw new apiError(400, 'Required Atleast one item To proceed')
    }
 
    if (!saleType || !['WHOLESALE', 'RETAIL'].includes(saleType)) {
        throw new apiError(400, 'SALE TYPE IS REQUIRED')
    }

    if(!['NONE','FIXED','PERCENTAGE'].includes(discountType)||typeof discountValue!=='number'||!Number.isFinite(discountValue)||discountValue<0||(discountType==='NONE'&&discountValue!==0))throw new apiError(400,'Required valid discount value');
    for (const item of items) {
        
         if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.quantity) || !item.productId || item.quantity < 1) {
            throw new apiError(400, 'ALL fields are required')
        }
    }
    
    let itemTotal = 0
    let totalCost = 0
    let processedItems = []
    let subtotal = 0
    let discountAmount = 0
    
    for (const item of items) {
        const product = await Product.findOne({_id: item.productId, shopId})
        
        if (!product) {
            throw new apiError(404, 'Product not found')
            
        }

        if (saleType === 'RETAIL') {
            itemTotal = item.quantity * product.retailPrice
        }

        if (saleType === 'WHOLESALE' && !product.wholesalePrice ) {
            throw new apiError(400, 'REQUIRED WHOLESALE PRICE')
        }
        
        
        if (saleType === 'WHOLESALE') {
            itemTotal = item.quantity * product.wholesalePrice!
            
        }

        const rate=invoiceItemRate(item,saleType==='WHOLESALE'?product.wholesalePrice!:product.retailPrice)
        itemTotal=moneyMajor(safeMinor(moneyMinor(rate.unitPrice)*item.quantity))
        subtotal += itemTotal

        processedItems.push({

            productId: product._id,
            quantity: item.quantity,
            ...rate, name:product.name, brand:product.brand, unit:product.unit

        })
        
    }

    if (discountType === 'PERCENTAGE') {
        if (discountValue < 0 || discountValue > 100) {
            throw new apiError(400, 'Required Valid Percentage amount')
        }
        discountAmount = subtotal * (discountValue/ 100)
    }

    if (discountType === 'FIXED') {
        if (discountValue < 0 || discountValue > subtotal) {
            throw new apiError(400, 'Required Valid Fixed Amount')
        }
        discountAmount = discountValue
    }


    if(items.some((i:any)=>i.unitPrice!==undefined||i.itemDiscount!==undefined)){const t=invoiceTotals(processedItems,discountType,discountValue);subtotal=moneyMajor(t.subtotalMinor);discountAmount=moneyMajor(t.discountMinor);}
    totalCost = subtotal - discountAmount

    if (!processedItems || processedItems.length == 0) {
        throw new apiError(500, 'COULD NOT FETCH THE PRODUCTS CORRECTLY')
    }


    const quotation = await Order.create({

        type: 'QUOTATION',
        status: 'DRAFT',
        items: processedItems,
        discountType,
        discountValue,
        discountAmount,
        subtotal,
        totalPrice: totalCost,
        saleType,
        shopId,
        createdBy: userID,
        createdByName: req.user.username,
        paidAmount: 0,
        amountDue: 0

    })



    return res.status(201)
    .json(
        new apiResponse(
            201,
            {
                quotation
            },
            'Quotation Created Successfully'
        )
    )




    
})










export const updateQuotationToInvoice = asyncHandler(async(req: Request, res: Response) => {
    // take the data come from quotation id
    // validate all data 
    // check if its type is 'QUOTATION'
    // check if status is draft
    // start the session  
    // fetch the product document 
    // use the each product id in quantity.items through for loop
    // use find and update method to update the stock for every product by its quantity tag the session with each
    // change the status of quotation from draft to closed
    // with each product save the price in total variable
    // when the array of products is update from stock and cost is found we will write create() 
    // we will use createOrder id to stockLog history of it 
    // after that we will put that create order array in response

    const { quotationId } = req.params
    const {_id: userID, shopId} = req.user
    const { customerId, paidAmount } = req.body
    const accounting = invoiceAccountingEnabled()
    const requestKey = req.body.requestKey
    if (accounting) {
        requireAccountingShopUser(req.user)
        if (typeof requestKey !== 'string' || !/^[\w-]{8,100}$/.test(requestKey)) throw new apiError(400, 'Accounting conversion requires a valid request key')
        if (req.body.creditRedeemedAmount !== undefined) throw new apiError(400, 'Use creditAmount for quotation conversion store credit')
    }
    const creditMinor = accounting ? moneyMinor(req.body.creditAmount ?? 0) : 0
    if (creditMinor && !mongoose.isValidObjectId(customerId)) throw new apiError(400, 'Store credit requires a customer from this shop')
    const routing = accounting ? invoiceCashRouting(req.body) : undefined
    const requestHash = accounting ? createHash('sha256').update(JSON.stringify({userID: String(userID), quotationId: String(quotationId), customerId, paidAmount, cashRouting: routing,
        ...(creditMinor ? {creditAmount: moneyMajor(creditMinor)} : {})})).digest('hex') : ''

    if (!quotationId) {
        throw new apiError(400, 'Quotation ID is required')
    }
    
    let quotation = await Order.findOne({_id: quotationId, shopId})
    
    if (!quotation) {
        throw new apiError(404, 'Quotation is not found')
        
    }

    if (paidAmount === undefined || isNaN(paidAmount) || typeof paidAmount !== 'number' || paidAmount < 0 || paidAmount > quotation.totalPrice) {
        throw new apiError(400, 'REQUIRED VALID PAID AMOUNT')
    }

    const isValid = typeof quotation == 'object'
                    && Array.isArray(quotation.items)
                    && quotation.items.length !== 0
                    && quotation.type === 'QUOTATION'
                    && quotation.status == 'DRAFT'


    if (!isValid && !accounting) {
        throw new apiError(400, 'Array of products are required')
    }

    const session = await mongoose.startSession()

    session.startTransaction(accounting ? {readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}} : undefined)

    try {
    await claimAccountingShop(req.user, session);
        if (accounting) {
            const replay = await InvoiceAdjustment.findOne({shopId, kind: 'SALE', requestKey}).session(session)
            if (replay) {
                if (replay.requestHash !== requestHash || String(replay.createdBy) !== String(userID)) throw new apiError(409, 'Request key already used')
                const saved = await Order.findOne({_id: replay.orderId, shopId}).session(session)
                if (!saved) throw new apiError(409, 'Recorded conversion requires reconciliation')
                await session.abortTransaction()
                return res.status(200).json(new apiResponse(200, {createOrder: saved}, 'Conversion already recorded'))
            }
            quotation = await Order.findOne({_id: quotationId, shopId, type: 'QUOTATION', status: 'DRAFT'}).session(session)
            if (!quotation || !quotation.items.length) throw new apiError(409, 'Quotation already converted or unavailable')
        }


        let processedItems: IOrderItems[] = []

        for (const item of quotation.items) {

            const order = await Product.findOneAndUpdate(
            {_id: item.productId,
            stockQuantity: {$gte: item.quantity},
            shopId: quotation.shopId},
            {
                $inc: {stockQuantity: -item.quantity},


            },
            {
                new: true,
                session
            }
        )

        if (!order) {
            throw new apiError(400, 'COULD NOT UPDATE QUOTATION TO ORDER')
        }


        
        
        processedItems.push({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            ...(item.sellingPrice!==undefined?{sellingPrice:item.sellingPrice}:{}), ...(item.itemDiscount!==undefined?{itemDiscount:item.itemDiscount}:{}),
            name: order.name,
            brand: order.brand,
            unit: order.unit
        })
        
    }


    let due = quotation.totalPrice - paidAmount
    const paymentRecordId = new mongoose.Types.ObjectId()
    let recordedPaidAmount = paidAmount
    if (creditMinor) {
        const settledMinor = safeMinor(moneyMinor(paidAmount) + creditMinor)
        const totalMinor = moneyMinor(quotation.totalPrice)
        if (settledMinor > totalMinor) throw new apiError(400, 'Cash and credit cannot exceed invoice total')
        recordedPaidAmount = moneyMajor(settledMinor)
        due = moneyMajor(totalMinor - settledMinor)
    }
  
    if (due > 0 && !customerId) {
        throw new apiError(400, "Customer ID is required");
        
    }


    const invoiceNo = await nextReference(shopId,'INV',Order,session,'invoiceNo')
    
    
        const [createOrder] = await Order.create([{
            type: 'INVOICE',
            items: processedItems,
            discountAmount: quotation.discountAmount,
            discountType: quotation.discountType,
            discountValue: quotation.discountValue,
            subtotal: quotation.subtotal,
            totalPrice: quotation.totalPrice,
            paidAmount: recordedPaidAmount,
            ...(accounting ? {accountingMode: accountingMode(), settlementState: {cashNetMinor: moneyMinor(paidAmount), creditNetMinor: creditMinor, openingCashMinor: moneyMinor(paidAmount), openingCreditMinor: creditMinor}} : {}),
            amountDue: due,
            customerId,
            status: 'PENDING',
            createdBy: userID,
            createdByName: req.user.username,
            saleType: quotation.saleType,
            shopId: quotation.shopId,
            invoiceNo
            
            
            
        }], {session})
        
        if (!createOrder) {
            throw new apiError(400, 'Insufficient stock for products')
        }
        if (creditMinor) await changeStoreCredit(customerId, createOrder, -creditMinor, 'CREDIT_REDEEMED', req.user, paymentRecordId, session)
        
        for (const item of processedItems) {
            
            await StockLog.create([{
                
                productId: item.productId,
                quantityDelta: -item.quantity,
                reason: 'Order Sold',
                referenceId: createOrder._id,
                createdBy: userID,
                saleType: quotation.saleType,
                shopId,
                invoiceNo

        }], {session})
            
        }

        quotation.status = 'CONVERTED'
        await quotation.save({session})


        if (customerId) {

            const customer = await Customer.findOneAndUpdate(
                {_id: customerId, shopId: quotation.shopId},

                {
                    $inc: {
                        remainingMoney: due
                    }
                },
                {new: true, session}
            )

            if (!customer) {
                throw new apiError(400, "Required Valid Customer ID");
                
            }

            await CustomerLedger.create([{
                customerId,
                amount: due,
                description: 'PURCHASE',
                createdBy: userID,
                referenceId: createOrder._id,
                shopId: quotation.shopId,
                invoiceNo


            }], {session})
        }

        if (accounting) await recordIntegratedSale(req.user, createOrder, {requestKey, requestHash, routing: routing!, sourceQuotationId: String(quotationId), eventId: paymentRecordId}, session)
        await session.commitTransaction()

        return res.status(201)
        .json(
            new apiResponse(
                201,
                {
                    createOrder
                },
                'Order Created Successfully'
            )
        )



        
        
    } catch (error) {
 if (accounting) {
     if (session.inTransaction()) await session.abortTransaction().catch(() => {})
     throwAccountingTransactionError(error)
 } else await session.abortTransaction()
    if (error instanceof apiError) {
        throw error

    }else{

        throw new apiError(500, `Could not fetch the data ${error}`)
    }
    } finally {

        session.endSession()
    }









})







export const viewStockLog = asyncHandler(async(req: Request, res: Response) => {

    // fetch productID reason startDate endDate page and limit from http
    // validate that any of them must be used to check
    // make filter object and put the data that req provided
    // search according to the filter provided


    const {productId, reason, startDate, endDate, page = 1, limit = 10 } = req.query

    const {shopId} = req.user

    let filter: Record<string, any>= {}

    filter.shopId = shopId

    let pageNum = Math.max(1, Number(page) || 1)
    let pageLimit = Math.max(1, Number(limit) || 10)

    if(productId) {
        filter.productId = productId
    }
    if (reason) {
        filter.reason = reason
    }
    if (startDate || endDate) {
        filter.createdAt = {}
        if (startDate) {
            filter.createdAt.$gte = new Date(startDate as string)
        }
        if (endDate) {
            filter.createdAt.$lte = new Date(endDate as string)
        }
        
    }
   

    let skip: number = (pageNum - 1) * pageLimit

    
        const [logs, logCount] = await Promise.all([
            StockLog.find(filter)
            .populate('productId', 'name brand retailPrice')
            .sort({createdAt: -1,})        
            .skip(skip)
            .limit(pageLimit),

            StockLog.countDocuments(filter)
        ])


    let totalPages = Math.ceil(logCount / pageLimit)

    return res.status(200)
    .json(
        new apiResponse(
            200,
            {
                logs,
                pagination: {
                    logCount,
                    totalPages,
                    currentPage: pageNum,
                    limit: pageLimit,
                    
                }
            },
            'Stock Log retreived Successfully'
        )
    )











})






// Resolve legacy attribution only within the invoice's shop, without saving it.
async function withCreatorName(order: IOrder) {
    const result = typeof order.toObject === 'function' ? order.toObject() : {...order};
    if (!result.createdByName?.trim()) {
        const creator = result.createdBy
            ? await User.findOne({_id: result.createdBy, shopId: result.shopId}).select('username')
            : null;
        result.createdByName = creator?.username || undefined;
    }
    return result;
}

export const getInvoices = asyncHandler(async (req: Request, res: Response) => {
    const {page, limit, skip, escapedSearch} = listQuery(req.query);
    const invoiceNo = req.query.invoiceNo;
    const customerId = req.query.customerId;
    if (customerId !== undefined) {
        if (typeof customerId !== 'string' || !mongoose.isValidObjectId(customerId)) throw new apiError(400, 'Select a valid customer');
        if (!await Customer.exists({_id: customerId, shopId: req.user.shopId})) throw new apiError(404, 'Customer not found in shop');
    }
    if (invoiceNo !== undefined && (typeof invoiceNo !== 'string' || invoiceNo.length > 100)) {
        throw new apiError(400, 'Invoice number must be a string of at most 100 characters');
    }
    const filter = {
        shopId: req.user.shopId,
        type: 'INVOICE' as const,
        ...(customerId !== undefined ? {customerId} : {}),
        ...(escapedSearch ? {invoiceNo: {$regex: escapedSearch, $options: 'i'}} : {}),
        ...(invoiceNo !== undefined ? {invoiceNo} : {})
    };
    const [orders, orderCount] = await Promise.all([
        Order.find(filter).sort({createdAt: -1, _id: -1}).skip(skip).limit(limit),
        Order.countDocuments(filter)
    ]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(new apiResponse(200, {
        orders: await Promise.all(orders.map(withCreatorName)),
        pagination: {orderCount, totalPages: Math.ceil(orderCount / limit), currentPage: page, limit}
    }, 'Invoices fetched successfully'));
});

export const getInvoice = asyncHandler(async (req: Request, res: Response) => {
    if (typeof req.params.orderId !== 'string' || !mongoose.isValidObjectId(req.params.orderId)) {
        throw new apiError(400, 'Valid order ID required');
    }
    const session = await mongoose.startSession(); session.startTransaction();
    try {
    const order = await Order.findOne({_id: req.params.orderId, shopId: req.user.shopId, type: 'INVOICE'}).session(session)
        .populate({path: 'items.productId', match: {shopId: req.user.shopId}, select: 'name brand unit'})
        .populate({path: 'customerId', match: {shopId: req.user.shopId}, select: 'name phoneNo address'});
    if (!order) throw new apiError(404, 'Invoice not found');
    const raw = typeof order.toObject === 'function' ? order.toObject({depopulate: true}) : {...order};
    const eligibility = await invoiceEligibility(raw, session);
    const result = await withCreatorName(order);
    result.items = result.items.map((item: any, index: number) => ({...item, lineId: item.lineId ?? `legacy-${index}`}));
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(new apiResponse(200, {order: result, originalSnapshot: result.originalSnapshot ?? null, eligibility}, 'Invoice fetched successfully'));
    } finally {await session.abortTransaction(); await session.endSession();}
});
