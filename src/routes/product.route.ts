import { Router } from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { createProduct, searchProduct } from '../controllers/product.controller.js';

const productRouter = Router()

productRouter.route('/create-product').post(verifyJWT, createProduct)
productRouter.route('/search-product').get(verifyJWT, searchProduct)

export {productRouter}