import { asyncHandler } from "../utils/asyncHandler.js";
import { type Request, type Response } from "express";
import { apiError } from "../utils/apiError.js";
import mongoose, { Schema } from "mongoose";
import { Product } from "../models/product.model.js";
import type { IOrder, IOrderItems } from "../models/order.model.js";
import { Order } from "../models/order.model.js";
import { apiResponse } from "../utils/apiResponse.js";





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


    const product = await Product.findById(item.productId)
    console.log(product);
    
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