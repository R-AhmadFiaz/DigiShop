import { Product, type IProduct } from "../models/product.model.js";
import { apiError } from "../utils/apiError.js";
import { apiResponse } from "../utils/apiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { type Request, type Response, type NextFunction } from "express";
import { generateSlug } from "../utils/generateSlug.js";
import { Category } from "../models/category.model.js";
import { StockLog } from "../models/stockLog.model.js";
import mongoose from "mongoose";


export const createProduct = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {

    const {name, description, brand, category, unit,
          costPrice, retailPrice, wholesalePrice, stockQuantity,
          minStockThreshold} = req.body

          const {shopId} = req.user

          if (!name || !brand || !category || !unit 
              || costPrice === null || costPrice === undefined
              || retailPrice === null || retailPrice === undefined
              || stockQuantity === null || stockQuantity === undefined
              || minStockThreshold === null) {
            throw new apiError(400, 'All Field are required')
          }

          const catExist = await Category.findOne({_id: category, shopId})

          if (!catExist) {
            throw new apiError(404, 'Category not Found')
          }

          

          const slug = generateSlug(`${name} ${brand}`)

          const productExist = await Product.findOne({slug, shopId})

          if (productExist) {
            throw new apiError(409, 'Prouct of this name already Exist')
          }

          const product = await Product.create({
            name: name.trim(),
            slug,
            description,
            brand,
            category,
            unit,
            costPrice,
            retailPrice,
            wholesalePrice,
            stockQuantity,
            minStockThreshold,
            shopId
          })

          return res.status(201)
          .json(
            new apiResponse(
                201,
                {product},
                'product is created successfully'

            
          ))







    
})

export const searchProduct = asyncHandler(async (req: Request, res: Response) => {

  const {search, category} = req.query

  const {shopId} = req.user

  let filter = {}

  if (search) {
    filter = {...filter,

      $or: [{name: {$regex: String(search), $options: 'i'}}, {brand: {$regex: String(search), $options: 'i'}}]
               
    }
  }

  if (category) {
    filter = {...filter, category: String(category)}
  }

  let productQuery = Product.find({...filter, shopId}).populate("category")

  if (req.user.role === "CASHIER") {
  productQuery = productQuery.select("-costPrice")
  }

  const product = await productQuery

  return res.status(200)
  .json(
    new apiResponse(
      200,
      {product},
      'Product is fetched successfully'
    )
  )


})

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {

  const {id} = req.params

  if (!id || id == undefined || typeof id !== 'string') {
    throw new apiError(400, 'Required Proper Id')
  }

  const {retailPrice, stockQuantity, minStockThreshold, costPrice, wholesalePrice} = req.body

  const {shopId} = req.user

  const product = await Product.findOne({_id: id, shopId})

  if (!product) {
    throw new apiError(404, 'Product not Found')
  }

  if (retailPrice !== undefined) {
    product.retailPrice = retailPrice
  }

  if (stockQuantity !== undefined) {
    product.stockQuantity = stockQuantity
  }

  if (minStockThreshold !== undefined) {
    product.minStockThreshold = minStockThreshold
  }

  if (costPrice !== undefined) {
    product.costPrice = costPrice
  }

  if (wholesalePrice !== undefined) {
    product.wholesalePrice = wholesalePrice
  }

  const updatedProduct = await product.save()

  await updatedProduct.populate("category")

  return res.status(200)
  .json(
    new apiResponse(
      200,
      {updatedProduct},
      'Product Updated Successfully'
    )
  )



})

export const adjustStock = asyncHandler(async (req: Request, res: Response) => {


  // take id for finding product and delta and reason from body
  // check the value is valid and given in req?
  // check if value is 0 so apply check on it
  // check Is product is in db 
  // fetch the stock of current product 
  // currentstock + value = value ? < 0 false
  // save the stock & reason back to document 
  // save the incomming update in stockLog doc and then save it
  // response

  const {id} = req.params
  const {quantityDelta, reason} = req.body
  const {shopId, _id: userID} = req.user

  if (quantityDelta == 0 || typeof quantityDelta !== 'number' || !Number.isFinite(quantityDelta) ) {
    throw new apiError(400, 'Required value')
  }

  if (!reason || typeof reason !== 'string' || reason.trim() == "" ) {
    throw new apiError(400, 'Required reason')
  }

  if (!id || id == undefined || typeof id !== 'string') {
    throw new apiError(400, 'Required Proper Id')
  }



  const product = await Product.findOne({_id: id, shopId})

  if (!product) {
    throw new apiError(404, 'Product not found')
  }

  // const currentStock = product.stockQuantity

  // const result = currentStock + quantityDelta

  // if (result < 0) {
  //   throw new apiError(400, 'Not enough stock')
  // }

  // product.stockQuantity = result

  // await product.save()

  // const stockLog = await StockLog.create({
  //   productId: product._id,
  //   quantityDelta,
  //   reason
  // })

  //                                      now do it with production level way

  const session = await mongoose.startSession()
  
  session.startTransaction()
  try {
    
  
    const updatestock = await Product.findOneAndUpdate(
      {
        _id: product._id,
        stockQuantity: { $gte: -quantityDelta},
        shopId
      },
      {
        $inc: {stockQuantity: quantityDelta}
      },
      {new: true, session}
  
    )
  
    if (updatestock == null ) {
  
     throw new apiError(400, 'Dont have enough stock')
    }
  
    const stockLog = await StockLog.create([{
      productId: product._id,
      quantityDelta,
      reason,
      createdBy: userID,
      shopId
    }], {session})

  await session.commitTransaction()

  return res.status(200)
  .json(
    new apiResponse(
      200,
      {updatestock, stockLog},
      'Stock is updated Successfully'
    )
  )

   } catch (error) {

    await session.abortTransaction()
    if (error instanceof apiError) {
      throw error
    } else {
      throw new apiError(500, 'Something Went Wrong')
    }
    
  } finally {

    await session.endSession()
  }


})

export const lowStock =  asyncHandler(async (req: Request, res: Response) => {

  // take the id of product (if i wanna chek for individual not recommended)
  // fetch the stockQuantity and lowStockThreshld 
  // check if stockQuantiy go elow the low stock 
  // sedn response


  const {shopId} = req.user
  const isStockLow = await Product.find({
    shopId,
    $expr: {
      $lte: ["$stockQuantity", "$minStockThreshold"]
    }
    
}).select(req.user.role === "CASHIER" ? "-costPrice" : "")

return res.status(200)
.json(
  new apiResponse(
    200,
    {"counts": (await isStockLow).length,
     "Products": isStockLow},
    'Stock is Checked Successfully'
  )
)



  
})
