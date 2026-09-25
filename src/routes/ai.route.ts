import { verifyJWT } from "../middleware/auth.middleware.js";

import { aiQuery } from "../controllers/ai.controller.js";

import { aiUpload } from "../middleware/aiUpload.middleware.js";

import { Router } from "express";
import { verify } from "node:crypto";

export const aiRouter = Router()

aiRouter.route('/query').post(verifyJWT, aiUpload.single("audio"), aiQuery)