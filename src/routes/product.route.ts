import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { adjustStock, createProduct, searchProduct, updateProduct } from '../controllers/product.controller.js';

const productRouter = Router()

productRouter.route('/create-product').post(verifyJWT, createProduct)
productRouter.route('/search-product').get(verifyJWT, searchProduct)
productRouter.route('/:id').patch(verifyJWT, updateProduct)
productRouter.route('/:id/adjust-stock').patch(verifyJWT, adjustStock)

export {productRouter}