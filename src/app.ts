import express from "express";
import { type Response, type Request, type NextFunction, type Errback } from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import { userRouter } from './routes/user.route.js'
import { categoryRouter } from './routes/category.route.js'
import cors from "cors";
import { productRouter } from "./routes/product.route.js";
import { orderRouter } from "./routes/order.routes.js";
import { apiError } from "./utils/apiError.js";

const app = express()

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}))

app.use(express.urlencoded({extended: true, limit: '16kb'}))
app.use(express.json({limit: '16kb'}))
app.use(cookieParser())

app.use('/api/v2/users', userRouter)
app.use('/api/v2/categories', categoryRouter)
app.use('/api/v2/products', productRouter)
app.use('/api/v2/orders', orderRouter)

app.use((err: apiError, req: Request, res: Response, next: NextFunction) => {

    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Something Went Wrong' 
    })

})



export {app}

