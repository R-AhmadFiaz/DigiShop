import { listQuery } from "../utils/listQuery.js";
import { type Request, type Response } from "express";

import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import { Customer } from "../models/customer.model.js";
import { apiResponse } from "../utils/apiResponse.js";

export const createCustomer = asyncHandler(async(req: Request, res: Response) => {
    const {name, phoneNo, address = ""} = req.body

    const {shopId} = req.user

    if (!name || name.trim() == "" || !phoneNo || phoneNo.length > 11 || phoneNo.length < 11 || !/^[0-9]+$/.test(phoneNo)) {
        throw new apiError(400, 'Required Valid Name and Phone number')
    }

    

    const customer = await Customer.create({
        name,
        phoneNo,
        address,
        remainingMoney: 0,
        shopId
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

export const getCustomers = asyncHandler(async (req: Request, res: Response) => {
    const {page, limit, skip, escapedSearch} = listQuery(req.query);
    const filter = {
        shopId: req.user.shopId,
        ...(escapedSearch ? {$or: [
            {name: {$regex: escapedSearch, $options: 'i'}},
            {phoneNo: {$regex: escapedSearch, $options: 'i'}}
        ]} : {})
    };
    const [customers, customerCount] = await Promise.all([
        Customer.find(filter).select('_id name phoneNo address remainingMoney storeCreditBalanceMinor')
            .sort({name: 1, _id: 1}).skip(skip).limit(limit),
        Customer.countDocuments(filter)
    ]);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(new apiResponse(200, {
        customers,
        pagination: {customerCount, totalPages: Math.ceil(customerCount / limit), currentPage: page, limit}
    }, 'Customers fetched successfully'));
});
