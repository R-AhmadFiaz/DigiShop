import { asyncHandler } from "../utils/asyncHandler.js";
import { type Request, type Response } from "express";
import { apiError } from "../utils/apiError.js";
import mongoose, { Schema } from "mongoose";
import { Product } from "../models/product.model.js";
import type { IOrder, IOrderItems } from "../models/order.model.js";
import { Order } from "../models/order.model.js";
import { apiResponse } from "../utils/apiResponse.js";
import { StockLog } from "../models/stockLog.model.js";
import { start } from "node:repl";





export const createOrder = asyncHandler(async(req: Request, res: Response) => {
    // take product objects have product ids and quantity
    // check if array is valid
    // check if it have both id and quantity
    // activate sessionTransaction 
    // go to mongoose find and update the stock 
    // collect unit price 


    const { items, saleType, discountType = 'NONE', discountValue = 0} = req.body
    const {_id: userID} = req.user

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new apiError(400, 'Array of items required!')
    }

    if (!saleType || !['WHOLESALE', 'RETAIL'].includes(saleType)) {
        throw new apiError(400, 'REQUIRED VALID SALE TYPE')
    }

    if (!discountType || !['PERCENTAGE', 'FIXED'].includes(discountType)) {
        throw new apiError(400, 'REQUIRED VALID DISCOUNT TYPE')
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

session.startTransaction()

try {

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

    

   


    subtotal += itemTotal

    processedItems.push({

        productId: updatedproduct._id,
        quantity: item.quantity,
        unitPrice: saleType == 'WHOLESALE' ? updatedproduct.wholesalePrice! : updatedproduct.retailPrice

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

    totalPrice = subtotal - discountAmount

const [createOrder] = await Order.create([{
    items: processedItems,
    totalPrice,
    status: 'PENDING',
    createdBy: userID,
    saleType,
    discountAmount,
    discountValue,
    subtotal



}], { session })

if (!createOrder) {
    throw new apiError(500, 'Could not create Order')
}

for (const item of processedItems) {

    await StockLog.create([{
        productId: item.productId,
        quantityDelta: -item.quantity,
        referenceId: createOrder._id,
        createdBy: userID,
        reason: 'Ordered Created',
        saleType,


    }],{session})
    
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
    await session.abortTransaction()
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
    // fetch the order id from parameter
    // check it in mongo db 
    // check its must be pending state
    // start session transaction
    // use atomic db operation to restok back
    // transition status to cancel

    const {orderId} = req.params

    if (!orderId) {
        throw new apiError(400, 'Could not recieve Order')
    }

    const session = await mongoose.startSession()
    session.startTransaction()
    
    
    
    
    try {
        
        
        const orderInDb = await Order.findById(orderId).session(session)

        if (orderInDb?.type === 'QUOTATION') {
            throw new apiError(400, 'Quotation is not allowed to be cancel')
        }

        if (!orderInDb || orderInDb.status !== 'PENDING') {
            throw new apiError(404, 'No Order of this id found')
        }
        
        
        for (const item of orderInDb.items) {
            await Product.findOneAndUpdate(
                
                    {_id: item.productId},
                    {
                        $inc: {stockQuantity: item.quantity}
                    },
                    {
                        new: true,
                        session
                    }
                
            )

             await StockLog.create([{
                productId: item.productId,
                quantityDelta: item.quantity,
                reason: 'Order get cancelled',
                referenceId: orderInDb._id
        }], {session})

        }


        
        
        

        orderInDb.status = 'CANCELLED'

        await orderInDb.save({session})

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

        throw new apiError(409, `Could not fetch the data ${error}`)
    }      
    } finally {
        session.endSession()
    }


   
    






    
    
})


export const updateOrderStatus = asyncHandler(async(req: Request, res: Response) => {

    const {orderId} = req.params
    
    if (!orderId) {
        throw new apiError(400, 'Doesnt get Order ID')
    }

    const order = await Order.findById(orderId)

    if (!order) {
        throw new apiError(404, 'Order not found')
    }

    if (order.status !== 'PENDING') {
        throw new apiError(401, 'Required to be Pending to change status')
    }

    order.status = 'DELIVERED'
    await order.save()

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

    const {items, discountValue = 0, discountType = 'NONE', saleType} = req.body

    if (!items || !Array.isArray(items) || items.length == 0) {
        throw new apiError(400, 'Required Atleast one item To proceed')
    }

    if (!saleType || !['WHOLESALE', 'RETAIL'].includes(saleType)) {
        throw new apiError(400, 'SALE TYPE IS REQUIRED')
    }

    for (const item of items) {
        
         if (!item || typeof item !== 'object' || typeof item.quantity !== 'number' || !item.productId  || item.quantity < 1) {
            throw new apiError(400, 'ALL fields are required')
        }
    }
    
    let itemTotal = 0
    let totalCost = 0
    let processedItems = []
    let subtotal = 0
    let discountAmount = 0
    
    for (const item of items) {
        const product = await Product.findById(item.productId)
        
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

        subtotal += itemTotal

        processedItems.push({

            productId: product._id,
            quantity: item.quantity,
            unitPrice: saleType === 'WHOLESALE' ? product.wholesalePrice! : product.retailPrice

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
        saleType

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

export const updateQuotationStatus = asyncHandler(async(req: Request, res: Response) => {
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
    const {_id: userID} = req.user

    if (!quotationId) {
        throw new apiError(400, 'Quotation ID is required')
    }
    
    const quotation = await Order.findById(quotationId)
    
    if (!quotation) {
        throw new apiError(404, 'Quotation is not found')
        
    }

    const isValid = typeof quotation == 'object'
                    && Array.isArray(quotation.items)
                    && quotation.items.length !== 0
                    && quotation.type === 'QUOTATION'
                    && quotation.status == 'DRAFT'


    if (!isValid) {
        throw new apiError(400, 'Array of products are required')
    }

    const session = await mongoose.startSession()

    session.startTransaction()

    try {


        let processedItems: IOrderItems[] = []

        for (const item of quotation.items) {

            const order = await Product.findOneAndUpdate(
            {_id: item.productId,
            stockQuantity: {$gte: item.quantity}},
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
            unitPrice: item.unitPrice
        })
        
    }
  

        const [createOrder] = await Order.create([{
            type: 'INVOICE',
            items: processedItems,
            discountAmount: quotation.discountAmount,
            discountType: quotation.discountType,
            subtotal: quotation.subtotal,
            totalPrice: quotation.totalPrice,
            status: 'PENDING',
            createdBy: userID,
            saleType: quotation.saleType
            
            
            
        }], {session})
        
        if (!createOrder) {
            throw new apiError(400, 'Insufficient stock for products')
        }
        
        for (const item of processedItems) {
            
            await StockLog.create([{
                
                productId: item.productId,
                quantityDelta: -item.quantity,
                reason: 'Order Sold',
                referenceId: createOrder._id,
                createdBy: userID,
                saleType: quotation.saleType

        }], {session})
            
        }

        quotation.status = 'CONVERTED'
        await quotation.save({session})

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
 await session.abortTransaction()
    if (error instanceof apiError) {
        throw error

    }else{

        throw new apiError(409, `Could not fetch the data ${error}`)
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

    let filter: Record<string, any>= {}

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
                                .sort({createdAt: -1})        
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




