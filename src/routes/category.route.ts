import { Router } from 'express'
import {createCategory} from '../controllers/category.controller.js'
import { verifyJWT } from '../middleware/auth.middleware.js'
import { checkSubscription } from '../middleware/subscription.middleware.js'

export const categoryRouter = Router()

categoryRouter.route('/create-category').post(verifyJWT, checkSubscription, createCategory)

