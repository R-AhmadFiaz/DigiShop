import { Category } from "../models/category.model.js";
import { type Request, type Response, type NextFunction } from "express" 
import { apiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { apiResponse } from "../utils/apiResponse.js";
import { generateSlug } from "../utils/generateSlug.js";


export const createCategory = asyncHandler(async(req: Request, res: Response, next: NextFunction) => {
    // take the name and description
    // validate name field
    // generate slug of name
    // check is already in memory?
    // check the slug is empty?
    // create category

    const {name, description} = req.body

    const {shopId} = req.user

    if (typeof name !== 'string' || name.trim() == "") {
        throw new apiError(400, 'Name is Missing')
    }

    const trimmedName = name.trim()
    
    const slug = generateSlug(trimmedName)
    
    if (!slug) {
        throw new apiError(400, 'Name is Missing')
    }

    const isValid = await Category.findOne({
        shopId,
        $or: [{name: trimmedName}, {slug}]
    })

    if (isValid) {
        throw new apiError(409, 'This category name or an equivalent spelling is already used in your shop')
    }


    

    let category;
    try {
        category = await Category.create({
            name: trimmedName,
            description,
            slug,
            shopId
        })
    } catch (error: any) {
        if (error?.code === 11000) {
            if (error.keyPattern && !Object.hasOwn(error.keyPattern, 'shopId')) {
                throw new apiError(409, 'Category index configuration needs administrator maintenance. No category was created.')
            }
            throw new apiError(409, 'This category name or an equivalent spelling is already used in your shop')
        }
        throw error
    }

    return res.status(200)
    .json(
        new apiResponse(
            200,
            {category},
            'Category is created Successfully'
        )
    )




})




export const getCategories = asyncHandler(async (
    req: Request,
    res: Response
) => {

    const { shopId } = req.user

    const categories = await Category.find({
        shopId
    }).sort({ name: 1 })


    return res.status(200)
    .json(
        new apiResponse(
            200,
            { categories },
            'Categories fetched successfully'
        )
    )

})
