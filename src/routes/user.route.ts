

import { registerUser, loginUser } from "../controllers/user.controller.js";
import  express  from "express";
import { upload } from "../middleware/multer.middleware.js";

export const userRouter = express()

userRouter.route('/register').post(upload.single("avatar"),registerUser)
userRouter.route('/login').post(loginUser)
