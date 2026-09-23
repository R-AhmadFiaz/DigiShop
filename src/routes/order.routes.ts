
import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { cancelOrder, createOrder, createQuotation, updateOrderStatus, updateQuotationToInvoice, viewStockLog } from "../controllers/order.controller.js";

export const orderRouter = Router()

orderRouter.route('/create-order').post(verifyJWT, createOrder)
orderRouter.route('/:orderId/cancel').patch(verifyJWT, cancelOrder)
orderRouter.route('/:orderId/status').patch(verifyJWT, updateOrderStatus)
orderRouter.route('/quotation').post(verifyJWT, createQuotation)
orderRouter.route('/:quotationId').patch(verifyJWT, updateQuotationToInvoice)
orderRouter.route('/stocklogs').get(verifyJWT, viewStockLog)




