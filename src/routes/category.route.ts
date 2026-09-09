import  express  from 'express'
import {createCategory} from '../controllers/category.controller.js'
import { verifyJWT } from '../middleware/auth.middleware.js'

export const categoryRouter = express()

categoryRouter.route('/create-category').post(verifyJWT, createCategory)

