import express from "express";
import "dotenv/config";
import cookieParser from "cookie-parser";
import { userRouter } from './routes/user.route.js'
import { categoryRouter } from './routes/category.route.js'
import cors from "cors";

const app = express()

app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}))

app.use(express.urlencoded({extended: true, limit: '16kb'}))
app.use(express.json({limit: '16kb'}))
app.use(cookieParser())

app.use('/api/v2/users',userRouter)
app.use('/api/v2/category',categoryRouter)

export {app}