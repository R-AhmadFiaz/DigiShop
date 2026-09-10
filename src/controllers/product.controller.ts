import { Product } from "../models/product.model.js";
import { apiError } from "../utils/apiError.js";
import { apiResponse } from "../utils/apiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { type Request, type Response, type NextFunction } from "express";
import { generateSlug } from "../utils/generateSlug.js";
import { Category } from "../models/category.model.js";


export const createProduct = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {

    const {name, description, brand, category, unit,
          costPrice, retailPrice, wholesalePrice, stockQuantity,
          minStockThreshold} = req.body

          if (!name || !brand || !category || !unit || costPrice === null || retailPrice === null || retailPrice === undefined || stockQuantity === null || stockQuantity === undefined ||minStockThreshold === null) {
            throw new apiError(400, 'All Field are required')
          }

          const catExist = await Category.findById(category)

          if (!catExist) {
            throw new apiError(404, 'Category not Found')
          }

          

          const slug = generateSlug(`${name} ${brand}`)

          const productExist = await Product.findOne({slug})

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
            minStockThreshold
          })

          return res.status(201)
          .json(
            new apiResponse(
                201,
                {product},
                'product is created successfully'

            
          ))







    
})
