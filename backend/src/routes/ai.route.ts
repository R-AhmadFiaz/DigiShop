import { verifyShopUser } from "../middleware/role.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

import { aiQuery } from "../controllers/ai.controller.js";

import { receiveAIInput } from "../middleware/aiUpload.middleware.js";
import { aiUserLimiter, aiIpLimiter } from "../middleware/aiRateLimiter.middleware.js";

import { Router } from "express";

export const aiRouter = Router()

aiRouter.route('/query').post(verifyJWT, verifyShopUser, aiIpLimiter, aiUserLimiter, receiveAIInput, aiQuery)
