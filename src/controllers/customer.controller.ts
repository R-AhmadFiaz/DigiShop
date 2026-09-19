import { type Request, type Response } from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import { Customer } from "../models/customer.model.js";
import { apiResponse } from "../utils/apiResponse.js";

export const createCustomer = asyncHandler(async(req: Request, res: Response) => {
    const {name, phoneNo, address = ""} = req.body

    if (!name || name.trim() == "" || !phoneNo || phoneNo.length > 11 || phoneNo.length < 11 || !/^[0-9]+$/.test(phoneNo)) {
        throw new apiError(400, 'Required Valid Name and Phone number')
    }

    

    const customer = await Customer.create({
        name,
        phoneNo,
        address,
        remainingMoney: 0
    })


    return res.status(201)
    .json(
        new apiResponse(
            201,
            {customer},
            'customer created successfully'
        )
    )
    
    
})