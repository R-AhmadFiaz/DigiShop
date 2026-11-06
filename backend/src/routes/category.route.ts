import { verifyOwner, verifyShopUser } from "../middleware/role.middleware.js";
import { Router } from 'express'
import {createCategory, getCategories} from '../controllers/category.controller.js'
import { verifyJWT } from '../middleware/auth.middleware.js'
import { checkSubscription } from '../middleware/subscription.middleware.js'

export const categoryRouter = Router()

categoryRouter
.route('/create-category')
.post(verifyJWT, verifyShopUser, verifyOwner, checkSubscription, createCategory)





categoryRouter
.route('/')
.get(
    verifyJWT, verifyShopUser,
    checkSubscription,
    getCategories
)