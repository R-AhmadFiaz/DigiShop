
import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { cancelOrder, createOrder, createQuotation, updateOrderStatus, updateQuotationStatus, viewStockLog } from "../controllers/order.controller.js";

export const orderRouter = Router()

orderRouter.route('/').post(verifyJWT, createOrder)
orderRouter.route('/:orderId/cancel').patch(verifyJWT, cancelOrder)
orderRouter.route('/:orderId/status').patch(verifyJWT, updateOrderStatus)
orderRouter.route('/:orderId/quotation').post(verifyJWT, createQuotation)
orderRouter.route('/quotations/:quotationId').patch(verifyJWT, updateQuotationStatus)
orderRouter.route('/stocklogs').get(verifyJWT, viewStockLog)




