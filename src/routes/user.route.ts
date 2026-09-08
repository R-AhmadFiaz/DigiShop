

import { registerUser, loginUser, refreshAccessToken, loggedOutUser } from "../controllers/user.controller.js";
import  express  from "express";
import { upload } from "../middleware/multer.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const userRouter = express()

userRouter.route('/register').post(upload.single("avatar"),registerUser)
userRouter.route('/login').post(loginUser)
userRouter.route('/refresh-token').post(verifyJWT,refreshAccessToken)
userRouter.route('/logged-Out').post(verifyJWT, loggedOutUser)
