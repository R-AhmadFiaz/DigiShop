import { verifyOwner, verifyShopUser } from "../middleware/role.middleware.js";
import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { adjustStock, createProduct, lowStock, searchProduct, updateProduct } from '../controllers/product.controller.js';
import { checkSubscription } from '../middleware/subscription.middleware.js';

const productRouter = Router()

productRouter.route('/create-product').post(verifyJWT, verifyShopUser, verifyOwner, checkSubscription, createProduct)
productRouter.route('/search-product').get(verifyJWT, verifyShopUser, searchProduct)
productRouter.route('/:id').patch(verifyJWT, verifyShopUser, verifyOwner, updateProduct)
productRouter.route('/:id/adjust-stock').patch(verifyJWT, verifyShopUser, verifyOwner, adjustStock)
productRouter.route('/low-stock').get(verifyJWT, verifyShopUser, lowStock)

export {productRouter}