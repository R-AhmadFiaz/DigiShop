import type { Request, Response, NextFunction } from "express";
import { apiError } from "../utils/apiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { Shop } from "../models/shop.model.js";
import {accountingContext, enforceAccountingWrite, preparationPath} from '../utils/accountingActivation.js';
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
    const path = req.originalUrl.split('?')[0]!.replace(/\/$/, '');
    const activation = path.startsWith('/api/v2/accounts/activation');
    const preparation = req.user.role === 'OWNER' && preparationPath(path);
    const state=shop.accounting?.state ?? 'DISABLED';
    const mutation=!['GET','HEAD','OPTIONS'].includes(req.method);
    const financial=/^\/api\/v2\/(orders|purchases|accounts)(\/|$)/.test(path);
    // Printed customer-name corrections do not post money, stock or ledgers.
    const invoiceNameCorrection=/^\/api\/v2\/orders\/[a-f\d]{24}\/customer-display-name$/i.test(path);
    // Preparation freezes opening evidence. Emergency pause targets financial
    // workflows; it does not disable ordinary product management or read-only AI.
    if (!activation) enforceAccountingWrite(state, preparation, mutation && !invoiceNameCorrection &&
        (state==='PREPARING' ? !/^\/api\/v2\/ai(\/|$)/.test(path) : financial));
    accountingContext.run({shopId:String(shop._id),state:shop.accounting?.state ?? 'DISABLED',preparation}, () => next());
});

export const verifyOwner = (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== "OWNER" || !req.user.shopId) {
        throw new apiError(403, "Owner access required");
    }
    next();
};
