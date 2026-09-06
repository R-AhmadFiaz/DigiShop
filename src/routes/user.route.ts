

import { registerUser } from "../controllers/user.controller.js";
import  express  from "express";

export const userRouter = express()

userRouter.route('/register').post(registerUser)
