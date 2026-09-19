import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";

import { createCustomer } from "../controllers/customer.controller.js";

export const customerRouter = Router()

customerRouter.route('create-customer').post(verifyJWT, createCustomer)