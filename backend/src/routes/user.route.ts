

import { registerUser, loginUser, refreshAccessToken,
         loggedOutUser, currentUser, changePassword, 
         createStaff, updateProfile, updateShopDetails, listCashiers, updateCashier, resetCashierPassword, deleteCashier}
          from "../controllers/user.controller.js";
import  express  from "express";
import { upload } from "../middleware/multer.middleware.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { loginLimiter, registrationLimiter, refreshLimiter } from "../middleware/rateLimiter.middleware.js";
import { checkSubscription } from "../middleware/subscription.middleware.js";

import { verifyOwner, verifyShopUser } from "../middleware/role.middleware.js";

export const userRouter = express()

userRouter.route('/register').post(registrationLimiter, upload.single("avatar"), registerUser)

userRouter.route('/register-staff').post(verifyJWT, verifyShopUser, verifyOwner, upload.single("avatar"), createStaff)

userRouter.route('/login').post(loginLimiter, loginUser)

userRouter.route('/logout').post(verifyJWT, loggedOutUser) 

userRouter.route('/refresh-token').post(refreshLimiter, refreshAccessToken)

userRouter.route('/current-user').post(verifyJWT, currentUser) 

userRouter.route('/change-password').post(verifyJWT, changePassword) 
userRouter.route('/profile').patch(verifyJWT, updateProfile)
userRouter.route('/shop-details').patch(verifyJWT, verifyShopUser, verifyOwner, updateShopDetails)
userRouter.route('/cashiers').get(verifyJWT, verifyShopUser, verifyOwner, listCashiers)
userRouter.route('/cashiers/:id').patch(verifyJWT, verifyShopUser, verifyOwner, updateCashier).delete(verifyJWT, verifyShopUser, verifyOwner, deleteCashier)
userRouter.route('/cashiers/:id/reset-password').patch(verifyJWT, verifyShopUser, verifyOwner, resetCashierPassword)
