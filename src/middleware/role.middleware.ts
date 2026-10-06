import type { Request, Response, NextFunction } from "express";
import { apiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Shop } from "../models/shop.model.js";
import type { IUser } from "../models/user.model.js";

export const SHOP_DEACTIVATED_MESSAGE = "Shop has been deactivated. Contact administrator.";

// Missing legacy fields mean active; only an explicit false blocks access.
export const getShopSession = async (user: IUser) => {
    if (user.role === "ADMIN") return {shopActive: true};
    const shop = await Shop.findById(user.shopId);
    if (!shop) throw new apiError(404, "Shop not found");
    return {
        shopActive: shop.isActive !== false,
        shopName: shop.name,
        shopAddress: shop.address,
        shopContactNo: shop.contactNo,
        ...(user.role === "OWNER" ? {subscriptionExpiry: shop.subscriptionExpiry ?? null} : {})
    };
};

export const getShopActive = async (user: IUser): Promise<boolean> =>
    (await getShopSession(user)).shopActive;

export const verifyShopUser = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !["OWNER", "CASHIER"].includes(req.user.role) || !req.user.shopId) {
        throw new apiError(403, "Shop access required");
    }
    const shop = await Shop.findById(req.user.shopId);
    if (!shop) throw new apiError(404, "Shop not found");
    if (shop.isActive === false) {
        throw new apiError(403, SHOP_DEACTIVATED_MESSAGE);
    }
    if (!shop.subscriptionActive || !shop.subscriptionExpiry || shop.subscriptionExpiry <= new Date()) {
        throw new apiError(403, "Subscription expired or inactive");
    }
    next();
});

export const verifyOwner = (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== "OWNER" || !req.user.shopId) {
        throw new apiError(403, "Owner access required");
    }
    next();
};
