import { asyncHandler } from "../utils/asyncHandler.js";
import { apiResponse } from "../utils/apiResponse.js";
import { Shop } from "../models/shop.model.js";
import { apiError } from "../utils/apiError.js";
import { isValidObjectId } from "mongoose";

const setShopAccess = (isActive: boolean) => asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) throw new apiError(400, "Invalid shop selection");
    const shop = await Shop.findByIdAndUpdate(
        id, {$set: {isActive}}, {new: true, runValidators: true}
    );
    if (!shop) throw new apiError(404, "Shop not found");
    return res.status(200).json(new apiResponse(200, {shop},
        isActive ? "Shop reactivated successfully" : "Shop deactivated successfully"));
});

export const deactivateShop = setShopAccess(false);
export const reactivateShop = setShopAccess(true);

export const getAllShops = asyncHandler(async (req, res) => {

    const shops = await Shop.find()
        .populate("ownerId", "username email");

    return res.status(200).json(
        new apiResponse(
            200,
            { shops },
            "Shops fetched successfully"
        )
    );
});

export const activateShop = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const shop = await Shop.findByIdAndUpdate(
        id,
        {
            subscriptionActive: true,
            subscriptionExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        { new: true }
    );

    if (!shop) {
        throw new apiError(404, "Shop not found");
    }

    return res.status(200).json(
        new apiResponse(
            200,
            { shop },
            "Shop activated successfully"
        )
    );
});

export const extendShopSubscription = asyncHandler(async (req, res) => {
    const { id } = req.params;

    const shop = await Shop.findById(id);

    if (!shop) {
        throw new apiError(404, "Shop not found");
    }

    const currentExpiry =
        shop.subscriptionExpiry && shop.subscriptionExpiry > new Date()
            ? shop.subscriptionExpiry
            : new Date();

    shop.subscriptionActive = true;
    shop.subscriptionExpiry = new Date(
        currentExpiry.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    await shop.save();

    return res.status(200).json(
        new apiResponse(
            200,
            { shop },
            "Subscription extended successfully"
        )
    );
});
