import { asyncHandler } from "../utils/asyncHandler.js";
import { apiResponse } from "../utils/apiResponse.js";
import { Shop } from "../models/shop.model.js";
import { apiError } from "../utils/apiError.js";
import mongoose, { isValidObjectId } from "mongoose";
import { User } from "../models/user.model.js";
import { Category } from "../models/category.model.js";
import { Product } from "../models/product.model.js";
import { Order } from "../models/order.model.js";
import { Customer } from "../models/customer.model.js";
import { StockLog } from "../models/stockLog.model.js";
import { CustomerLedger } from "../models/customerLedger.model.js";
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';
import {BusinessEntity} from '../models/businessEntity.model.js';
import {FinancialAccount} from '../models/financialAccount.model.js';
import {BusinessTransaction} from '../models/businessTransaction.model.js';
import {BusinessBrand, ProductBrandLink} from '../models/businessBrand.model.js';
import {PurchaseOrder} from '../models/purchaseOrder.model.js';
import {SupplierCutover} from '../models/supplierCutover.model.js';
import {GoodsReceipt} from '../models/goodsReceipt.model.js';

export const deleteShop = asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) throw new apiError(400, "Invalid shop selection");
    const shopId = String(id);
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const shop = await Shop.findById(id).session(session);
        if (!shop) throw new apiError(404, "Shop not found");
        if (shop.isActive !== false) throw new apiError(403, "Deactivate the shop before deleting it");

        // Acquire a write on the shop first. Concurrent reactivation conflicts
        // with this transaction rather than allowing an active shop to be deleted.
        const deleted = await Shop.deleteOne({_id: id, isActive: false}, {session});
        if (deleted.deletedCount !== 1) throw new apiError(409, "Shop access changed. Refresh and try again");
        // Existing permanent-shop deletion is the sole ledger deletion exception.
        await BusinessTransaction.collection.deleteMany({shopId: new mongoose.Types.ObjectId(shopId)}, {session});
        await SupplierCutover.collection.deleteMany({shopId:new mongoose.Types.ObjectId(shopId)},{session});
        await GoodsReceipt.collection.deleteMany({shopId:new mongoose.Types.ObjectId(shopId)},{session});
        await PurchaseOrder.deleteMany({shopId},{session});
        await FinancialAccount.deleteMany({shopId}, {session});
        await ProductBrandLink.deleteMany({shopId}, {session});
        await BusinessBrand.deleteMany({shopId}, {session});
        await BusinessEntity.deleteMany({shopId}, {session});
        await CustomerLedger.deleteMany({shopId}, {session});
        await InvoiceAdjustment.deleteMany({shopId}, {session});
        await StockLog.deleteMany({shopId}, {session});
        await Order.deleteMany({shopId}, {session});
        await Customer.deleteMany({shopId}, {session});
        await Product.deleteMany({shopId}, {session});
        await Category.deleteMany({shopId}, {session});
        await User.deleteMany({shopId, role: {$in: ["OWNER", "CASHIER"]}}, {session});
        await session.commitTransaction();
        return res.status(200).json(new apiResponse(200, {}, "Shop permanently deleted"));
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        await session.endSession();
    }
});

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
