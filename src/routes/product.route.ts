import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { adjustStock, createProduct, lowStock, searchProduct, updateProduct } from '../controllers/product.controller.js';
import { checkSubscription } from '../middleware/subscription.middleware.js';

const productRouter = Router()

productRouter.route('/create-product').post(verifyJWT, checkSubscription, createProduct)
productRouter.route('/search-product').get(verifyJWT, searchProduct)
productRouter.route('/:id').patch(verifyJWT, updateProduct)
productRouter.route('/:id/adjust-stock').patch(verifyJWT, adjustStock)
productRouter.route('/low-stock').get(verifyJWT, lowStock)

export {productRouter}