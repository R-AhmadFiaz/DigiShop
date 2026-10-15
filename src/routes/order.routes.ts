import { verifyOwner, verifyShopUser } from "../middleware/role.middleware.js";

import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { getInvoices, getInvoice, cancelOrder, createOrder, createQuotation, updateOrderStatus, updateQuotationToInvoice, viewStockLog } from "../controllers/order.controller.js";
import { checkSubscription } from "../middleware/subscription.middleware.js";
import {invoiceMutation, invoicePreview, getInvoiceHistory, getSalesSummary} from '../controllers/invoiceAdjustment.controller.js';

export const orderRouter = Router()

orderRouter.route('/create-order').post(verifyJWT, verifyShopUser, checkSubscription, createOrder)
orderRouter.route('/:orderId/cancel').patch(verifyJWT, verifyShopUser, verifyOwner, cancelOrder)
orderRouter.route('/:orderId/status').patch(verifyJWT, verifyShopUser, updateOrderStatus)
orderRouter.route('/quotation').post(verifyJWT, verifyShopUser, createQuotation)
orderRouter.route('/:quotationId').patch(verifyJWT, verifyShopUser, updateQuotationToInvoice)
orderRouter.route('/stocklogs').get(verifyJWT, verifyShopUser, verifyOwner, viewStockLog)
orderRouter.route('/sales-summary').get(verifyJWT, verifyShopUser, verifyOwner, getSalesSummary)
orderRouter.route('/:orderId/history').get(verifyJWT, verifyShopUser, verifyOwner, getInvoiceHistory)
orderRouter.route('/:orderId/adjustments/preview').post(verifyJWT, verifyShopUser, verifyOwner, invoicePreview('ADJUSTMENT'))
orderRouter.route('/:orderId/adjustments').post(verifyJWT, verifyShopUser, verifyOwner, invoiceMutation('ADJUSTMENT'))
orderRouter.route('/:orderId/payments/preview').post(verifyJWT, verifyShopUser, verifyOwner, invoicePreview('PAYMENT'))
orderRouter.route('/:orderId/payments').post(verifyJWT, verifyShopUser, verifyOwner, invoiceMutation('PAYMENT'))
orderRouter.route('/:orderId/cancellations/preview').post(verifyJWT, verifyShopUser, verifyOwner, invoicePreview('CANCELLATION'))
orderRouter.route('/:orderId/cancellations').post(verifyJWT, verifyShopUser, verifyOwner, invoiceMutation('CANCELLATION'))





orderRouter.route("/").get(verifyJWT, verifyShopUser, verifyOwner, getInvoices)
orderRouter.route("/:orderId").get(verifyJWT, verifyShopUser, verifyOwner, getInvoice)
