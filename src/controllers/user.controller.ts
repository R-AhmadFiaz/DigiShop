import { type Request, type Response, type NextFunction } from "express" 
import mongoose from "mongoose"
import { User, type IUserMethod  } from "../models/user.model.js"
import { apiError } from "../utils/apiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { apiResponse } from "../utils/apiResponse.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"



const generateAccessAndRefreshToken = (user) => {


try {
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()
    
        user.refreshToken = refreshToken
    
        user.save({validateBeforeSave: false})
    
        return {accessToken, refreshToken}
} catch (error) {
    throw new apiError(500, 'Could not generate Access & Refresh tokens')
}



}




export const registerUser = asyncHandler( async(req: Request, res: Response, next: NextFunction) => {

    const {username, email, password, role} = req.body

    if(!(username && email && password && role)){
        throw new apiError(400,'All fields are required')
    }

    const existUser = await User.findOne({
        $or: [{username}, {email}]
    })

    if(existUser){

        throw new apiError(409, 'User with these credentials already exist')

    }

    const file = req.file as Express.Multer.File 

    if (!file) {
        throw new apiError(400, 'Cant access path')
    }

    const avatar = await uploadOnCloudinary(file.path)

   if (!avatar) {
    throw new apiError(500, 'Failed to Upload on Cloudinary')
   }

    const user = await User.create({
        username,
        email,
        password,
        role,
        avatar: avatar.url 
        

    })

    generateAccessAndRefreshToken(user)

    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    if(!createdUser) throw new apiError(404, 'cant create user in database')


    return res.status(201)
    .json(
        new apiResponse(
            201,
            createdUser,
            'User Created Successfully'
        )

    )




})


export const loginUser = asyncHandler( async(req: Request, res: Response, next: NextFunction) => {
    const {username, email, password} = req.body

    if ((!username && !email) || !password) {

        throw new apiError(400, 'Username/Email and Password is required')

    }

    const isUserFound = await User.findOne({
        $or: [{username}, {email}]
    })

    if(!isUserFound){

        throw new apiError(404, 'User not Found')

    }

    const isPasswordValid = await (isUserFound as typeof isUserFound & IUserMethod ).isPasswordCorrect(password)

    if(!isPasswordValid) {
        throw new apiError(401, 'Password is invalid')
    }

    const loggedInUser = await User.findById(isUserFound._id).select('-password -refreshToken' )
    // delete user.refreshToken

    return res.status(200)
    .json(
        new apiResponse(
            200,
            {user: loggedInUser},
            'login Successfully'
        )
    )

    

})