import Router from 'express';
import { verifyJWT } from '../middleware/auth.middleware.js';
import { createProduct } from '../controllers/product.controller.js';

const productRouter = Router()

productRouter.route('/create-product').post(verifyJWT, createProduct)

export {productRouter}