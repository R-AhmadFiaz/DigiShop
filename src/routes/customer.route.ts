import { verifyShopUser } from "../middleware/role.middleware.js";
import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";

import { createCustomer, getCustomers } from "../controllers/customer.controller.js";
import { checkSubscription } from "../middleware/subscription.middleware.js";

export const customerRouter = Router()

customerRouter.route('/create-customer').post(verifyJWT, verifyShopUser,checkSubscription, createCustomer)
customerRouter.route("/").get(verifyJWT, verifyShopUser, getCustomers)
