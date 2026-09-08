

import { registerUser, loginUser, refreshAccessToken,
         loggedOutUser, currentUser, changePassword }
          from "../controllers/user.controller.js";
import  express  from "express";
import { upload } from "../middleware/multer.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

export const userRouter = express()

userRouter.route('/register').post(upload.single("avatar"),registerUser)

userRouter.route('/login').post(loginUser)

userRouter.route('/logout').post(verifyJWT, loggedOutUser) 

userRouter.route('/refresh-token').post(refreshAccessToken)

userRouter.route('/current-user').post(verifyJWT, currentUser) 

userRouter.route('/change-password').post(verifyJWT, changePassword) 




