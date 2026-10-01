import { verifyOwner, verifyShopUser } from "../middleware/role.middleware.js";

import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { getInvoices, getInvoice, cancelOrder, createOrder, createQuotation, updateOrderStatus, updateQuotationToInvoice, viewStockLog } from "../controllers/order.controller.js";
import { checkSubscription } from "../middleware/subscription.middleware.js";

export const orderRouter = Router()

orderRouter.route('/create-order').post(verifyJWT, verifyShopUser, checkSubscription, createOrder)
orderRouter.route('/:orderId/cancel').patch(verifyJWT, verifyShopUser, verifyOwner, cancelOrder)
orderRouter.route('/:orderId/status').patch(verifyJWT, verifyShopUser, updateOrderStatus)
orderRouter.route('/quotation').post(verifyJWT, verifyShopUser, createQuotation)
orderRouter.route('/:quotationId').patch(verifyJWT, verifyShopUser, updateQuotationToInvoice)
orderRouter.route('/stocklogs').get(verifyJWT, verifyShopUser, verifyOwner, viewStockLog)





orderRouter.route("/").get(verifyJWT, verifyShopUser, verifyOwner, getInvoices)
orderRouter.route("/:orderId").get(verifyJWT, verifyShopUser, verifyOwner, getInvoice)
