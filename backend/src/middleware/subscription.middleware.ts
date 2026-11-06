import { type Request, type Response, type NextFunction } from "express";
import { Shop } from "../models/shop.model.js";
import { apiError } from "../utils/apiError.js";

export const checkSubscription = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const { shopId } = req.user;

    const shop = await Shop.findById(shopId);

    if (!shop) {
        throw new apiError(404, "Shop not found");
    }

    if (
        !shop.subscriptionActive ||
        !shop.subscriptionExpiry ||
        shop.subscriptionExpiry <= new Date()
    ) {
        throw new apiError(403, "Subscription expired or inactive");
    }

    next();
};