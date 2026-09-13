
import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { cancelOrder, createOrder, updateOrderStatus } from "../controllers/order.controller.js";

export const orderRouter = Router()

orderRouter.route('/create-order').post(verifyJWT, createOrder)
orderRouter.route('/:orderId/cancel-order').patch(verifyJWT, cancelOrder)
orderRouter.route('/:orderId/update-order-status').patch(verifyJWT, updateOrderStatus)




