

import { registerUser, loginUser, refreshAccessToken,
         loggedOutUser, currentUser, changePassword, 
         createStaff}
          from "../controllers/user.controller.js";
import  express  from "express";
import { upload } from "../middleware/multer.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { loginLimiter } from "../middleware/rateLimiter.middleware.js";

export const userRouter = express()

userRouter.route('/register').post(upload.single("avatar"), registerUser)

userRouter.route('/register-staff').post(verifyJWT, upload.single("avatar"), createStaff)

userRouter.route('/login').post(loginLimiter, loginUser)

userRouter.route('/logout').post(verifyJWT, loggedOutUser) 

userRouter.route('/refresh-token').post(refreshAccessToken)

userRouter.route('/current-user').post(verifyJWT, currentUser) 

userRouter.route('/change-password').post(verifyJWT, changePassword) 




