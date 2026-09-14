import { asyncHandler } from "../utils/asyncHandler.js";
import { type Request, type Response } from "express";
import { apiError } from "../utils/apiError.js";
import mongoose, { Schema } from "mongoose";
import { Product } from "../models/product.model.js";
import type { IOrder, IOrderItems } from "../models/order.model.js";
import { Order } from "../models/order.model.js";
import { apiResponse } from "../utils/apiResponse.js";
import { Session } from "node:inspector";
import { StockLog } from "../models/stockLog.model.js";
import { networkInterfaces } from "node:os";





export const createOrder = asyncHandler(async(req: Request, res: Response) => {
    // take product objects have product ids and quantity
    // check if array is valid
    // check if it have both id and quantity
    // activate sessionTransaction 
    // go to mongoose find and update the stock 
    // collect unit price 


    const { items } = req.body

    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new apiError(400, 'Array of items required!')
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



    const itemTotal = updatedproduct.retailPrice * item.quantity

    totalPrice += itemTotal

    processedItems.push({

        productId: updatedproduct._id,
        quantity: item.quantity,
        unitPrice: updatedproduct.retailPrice
        
    }) 

}

const [createOrder] = await Order.create([{
    items: processedItems,
    totalPrice,
    status: 'PENDING'

}], { session })

if (!createOrder) {
    throw new apiError(500, 'Could not create Order')
}

for (const item of processedItems) {

    await StockLog.create([{
        productId: item.productId,
        quantityDelta: -item.quantity,
        referenceId: createOrder._id,
        reason: 'Ordered Created',

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
    throw new apiError(409, `Could not fetch the data ${error}`)
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
        throw new apiError(500, `failed to cancel the order ${error}`)        
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
    // calculate it and store in variable
    // push all items in array and create the final response

    const {items} = req.body

    if (!items || !Array.isArray(items) || items.length == 0) {
        throw new apiError(400, 'Required Atleast one item To proceed')
    }

    for (const item of items) {
        
         if (!item || typeof item !== 'object' || typeof item.quantity !== 'number' || !item.productId  || item.quantity < 1) {
            throw new apiError(400, 'ALL fiels are required')
        }
    }
    
    let totalCost = 0
    let processedItems = []
    
    for (const item of items) {
        const product = await Product.findById(item.productId)
        
        if (!product) {
            throw new apiError(404, 'Product not found')
            
        }

        totalCost += product?.retailPrice * item.quantity

        processedItems.push({

            productId: product._id,
            quantity: item.quantity,
            unitPrice: item.retailPrice

        })
        
    }


    const quotation = await Order.create({

        type: 'QUOTATION',
        status: 'DRAFT',
        items: processedItems,
        totalPrice: totalCost,

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
                    && quotation.status == 'DRAFT'


    if (!isValid) {
        throw new apiError(400, 'Array of products are required')
    }

    const session = await mongoose.startSession()

    session.startTransaction()

    try {

        let totalCost = 0

        let processedItems: IOrderItems[] = []

        for (const item of quotation.items) {

            const order = await Product.findByIdAndUpdate(
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

        totalCost += item.quantity * item.unitPrice

        processedItems.push({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice
        })
            
        }

        const [createOrder] = Order.create({
            type: 'INVOICE',
            items: processedItems,
            totalPrice: totalCost,
            status: 'PENDING',
            

        })

        for (const item of processedItems) {

            await StockLog.create({

            productId: item.productId,
            quantityDelta: -item.quantity,
            reason: 'Order Sold',
            referenceId: createOrder._id

        })
            
        }

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
        session.abortTransaction()
        throw new apiError(500, `Could not fetch Quotation data: ${error}`)
    } finally {

        session.endSession()
    }









})