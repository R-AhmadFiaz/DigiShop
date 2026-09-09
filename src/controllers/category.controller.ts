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

    if (!name || name.trim() == "") {
        throw new apiError(400, 'Name is Missing')
    }

    const trimmedName = name.trim()
    
    const slug = generateSlug(name)
    
    if (!slug) {
        throw new apiError(400, 'Name is Missing')
    }

    const isValid = await Category.findOne({
        $or: [{name}, {slug}]
    })

    if (isValid) {
        throw new apiError(404, 'name and slug already exist in memory')
    }

    const category = await Category.create({
        name: trimmedName,
        description,
        slug
    }) 

    return res.status(200)
    .json(
        new apiResponse(
            200,
            {category},
            'Category is created Successfully'
        )
    )




})