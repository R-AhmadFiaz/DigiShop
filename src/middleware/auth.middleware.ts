import type { Request, Response, NextFunction } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { apiError } from "../utils/apiError.js";
import  Jwt, { type JwtPayload }  from "jsonwebtoken";
import { User, type IUser } from "../models/user.model.js";

export const verifyJWT = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {

    try {
        const token = req.cookies?.accessToken || req.header('Authorization')?.replace("Bearer ", "")
    
    
        if (!token) {
            throw new apiError(400, 'Token is not provided')
        }
    
        const decodedToken = Jwt.verify(
            token,
            process.env.ACCESS_TOKEN_SECRET!
    
        ) as JwtPayload
    
        if (!decodedToken) {
            throw new apiError(401, 'Unauthorized access')
        }
    
        if (typeof decodedToken === "string" || !decodedToken._id) {
            throw new apiError(500, 'Wrong type of ID number')
        }
        
        const user = await User.findById(decodedToken._id).select("-password -refreshToken")
    
        if (!user) {
            throw new apiError(400, 'User is not found')
        }
    
        req.user = user as IUser
    
        next()
    
    } catch (error) {
        console.log(error || "expired access token");
        
    }


    
})