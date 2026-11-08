import { type Request, type Response, type NextFunction } from "express" 
import mongoose, { type HydratedDocument } from "mongoose"
import { User } from "../models/user.model.js"
import { apiError } from "../utils/apiError.js"
import { asyncHandler } from "../utils/asyncHandler.js"
import { apiResponse } from "../utils/apiResponse.js"
import { uploadOnCloudinary } from "../utils/cloudinary.js"
import type {IUser} from "../models/user.model.js"
import Jwt, { type JwtPayload }  from "jsonwebtoken"
import { Shop } from "../models/shop.model.js"
import { Order } from "../models/order.model.js"
import { getShopSession } from "../middleware/role.middleware.js"
import { unlink } from "node:fs/promises"
import { cashierPage, wantsPage } from "../utils/pagedLists.js"

const withAvatarCleanup = (handler: Parameters<typeof asyncHandler>[0]) =>
    asyncHandler(async (req, res, next) => {
        try {
            return await handler(req, res, next)
        } finally {
            if (req.file) await unlink(req.file.path).catch(error => {
                if (error.code !== 'ENOENT') console.error('Avatar temporary file cleanup failed')
            })
        }
    })

export const refreshAccessToken = asyncHandler( async (req: Request, res: Response, next: NextFunction) => {


    
        const incommingRefreshToken = req.cookies?.refreshToken || req.body?.refreshToken
    
        if (!incommingRefreshToken) {
            throw new apiError(400, 'Could not recieve Refresh Token')
        }
    
    
        const decodedRefreshToken = Jwt.verify(
            incommingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET as string
        ) as JwtPayload
    
        if (!decodedRefreshToken) {
            throw new apiError(401, 'Unauthorized access of refresh Token')
        }
    
    
    
        const user = await User.findById(decodedRefreshToken._id).select("-password")
    
        if (!user) {
            throw new apiError(400, 'Cant find user to refresh access token')
        }
    
        if (incommingRefreshToken !== user.refreshToken) {
            throw new apiError(401, 'Token is expired')
        }
    
    
        
        const {accessToken, refreshToken} =  await generateAccessAndRefreshToken(user)
        const {password: omittedPassword, refreshToken: omittedRefreshToken, ...safeUser} =
            typeof user.toObject === 'function' ? user.toObject() : user


        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production'
        }
    
        return res.status(200)
        .cookie('accessToken', accessToken, options)
        .cookie('refreshToken', refreshToken, options)
        .json(
            new apiResponse(
                200,
                {user: safeUser},
                'Tokens assign successfully'
            )
    
        )
  
    
    
    
})

export const generateAccessAndRefreshToken =  async (user: IUser, session?: mongoose.ClientSession) => {


try {
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()
    
        user.refreshToken = refreshToken
    
        await user.save({validateBeforeSave: false, session: session ?? null})
    
        return {accessToken, refreshToken}
} catch (error) {
    throw new apiError(500, 'Could not generate Access & Refresh tokens')
}



}


export const registerUser = withAvatarCleanup( async(req: Request, res: Response, next: NextFunction) => {

    const {username, email, password, shopName, contactNo, address} = req.body

    //check for shop credential

    if (typeof shopName !== 'string' || shopName == undefined ||
         shopName.trim() == '' || !/^[0-9]+$/.test(contactNo) || 
        contactNo.length !== 11 || address == undefined ||
        typeof address !== 'string' || address.trim() == '' ) {

        throw new apiError(400, "Required Valid credentials for register shop");
        
    }


    
    
    
    
    // check for user cedentials
    if(!(username && email && password)){
        throw new apiError(400,'All fields are required for register Owner')
    }

    const existUser = await User.findOne({
        $or: [{username}, {email}]
    })

    if(existUser){

        throw new apiError(409, 'User with these credentials already exist')

    }

    const session = await mongoose.startSession()

    session.startTransaction()



    try {


        // shop registration

        const [shop] = await Shop.create([{
            name: shopName,
            contactNo,
            address,
            subscriptionActive: false,
            subscriptionExpiry: null
        }], {session})

        if (!shop) {
            throw new apiError(500, "There is problem in shop creation");
            
        }




        
        
        
        
        
        

        // user registeration


        const file = req.file as Express.Multer.File 
    
        const avatar = file ? await uploadOnCloudinary(file.path) : null
    
       if (file && !avatar) {
        throw new apiError(500, 'Failed to Upload on Cloudinary')
       }
    
        const [user] = await User.create([{
            username,
            email,
            password,
            role: 'OWNER',
            avatar: avatar?.url, 
            shopId: shop._id
            
    
        }], {session})

        if (!user) {
            throw new apiError(500, 'Something is wrong in creating user in registeration')
        }
    
        const {accessToken, refreshToken} =  await generateAccessAndRefreshToken(user, session)
    
        const createdUser = await User.findById(user._id).select(
            "-password -refreshToken"
        ).session(session)
    
        if(!createdUser) throw new apiError(404, 'cant create user owner in database')


        await Shop.findByIdAndUpdate(
            shop._id,
            {
                $set: {ownerId: user?._id}
            },
            {new: true, session}
        )


        await session.commitTransaction()
        
    
            const options = {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production'
            }
    
        return res.status(201)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(
            new apiResponse(
                201,
                {...createdUser.toObject(), shopName: shop.name, shopAddress: shop.address, shopContactNo: shop.contactNo},
                'User Created Successfully'
            )
    
        )
    } catch (error) {

        await session.abortTransaction()

        if (error instanceof apiError) {
            throw error
        } else {
            throw new apiError(500, 'Something is wrong in Regsiter Owner Catch')
        }


        
    } finally {

        session.endSession()

    }




})

export const createStaff =  withAvatarCleanup( async(req: Request, res: Response, next: NextFunction) => {
    // fetch the user from req.user
    // check is this user role is 'owner'
    // create the user set his role to cashier

    const user = req.user


    if (user.role !== 'OWNER') {
        throw new apiError(403, 'Required Owner to Create staff')
    }

    const {username, email, password} = req.body

    if (!username || !email || !password) {
        throw new apiError(400, 'Required All Fields')
    }

    const file = req.file as Express.Multer.File

    const avatar = file ? await uploadOnCloudinary(file.path) : null

    const userCreate = await User.create({
        username, 
        email,
        password,
        role: 'CASHIER',
        avatar: avatar?.url,
        shopId: user.shopId
    })


    const cashier = await User.findById(userCreate._id).select("-password -refreshToken")

    return res.status(201)
    .json(
        new apiResponse(
            201,
            {
                cashier
            },
            'Cashier Account Created Successfully'
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

    const isPasswordValid = await isUserFound.isPasswordCorrect(password)

    if(!isPasswordValid) {
        throw new apiError(401, 'Password is invalid')

    }

    const {accessToken, refreshToken} = await generateAccessAndRefreshToken(isUserFound)

    if(!accessToken || !refreshToken) throw new apiError(500, 'Cant assign tokens')

    

    const loggedInUser = await User.findById(isUserFound._id).select('-password -refreshToken' )
    // delete user.refreshToken

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production'
    }

    return res.status(200)
    .cookie('accessToken', accessToken, options)
    .cookie('refreshToken', refreshToken, options)
    .json(
        new apiResponse(
            200,
            {user: loggedInUser, ...await getShopSession(isUserFound)},
            'login Successfully'
        )
    )

    

})


export const loggedOutUser = asyncHandler( async(req: Request, res: Response, next: NextFunction) => {

    if (!req.user?._id) {
        throw new apiError(400, 'Could not access the login user')
    }


    await User.findByIdAndUpdate(
        req.user._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            new: true

        }

    )

    const options = {
        httpOnly: true,
        secure: true
    }


    return res.status(200)
    .clearCookie("accessToken",options)
    .clearCookie("refreshToken",options)
    .json(
        new apiResponse(
            200,
            {username: req.user.username, email: req.user.email},
            'Logged Out Successfully'
        )
    )

})

export const currentUser = asyncHandler(async(req: Request, res: Response, next: NextFunction) => {
    return res.status(200)
    .json(

        new apiResponse(
        200,
        {user: req.user, ...await getShopSession(req.user)},
        'View User Detail'

    )) 
})

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
    const {username, email} = req.body
    if (typeof username !== 'string' || username.trim() === '' ||
        typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw new apiError(400, 'Required valid username and email')
    }
    const normalizedUsername = username.trim().toLowerCase()
    const normalizedEmail = email.trim().toLowerCase()
    const existing = await User.findOne({
        _id: {$ne: req.user._id}, $or: [{username: normalizedUsername}, {email: normalizedEmail}]
    })
    if (existing) throw new apiError(409, 'Username or email already exists')
    let user
    try {
        user = await User.findByIdAndUpdate(req.user._id,
            {$set: {username: normalizedUsername, email: normalizedEmail}},
            {new: true, runValidators: true}).select('-password -refreshToken')
    } catch (error) {
        if ((error as {code?: number}).code === 11000) throw new apiError(409, 'Username or email already exists')
        throw error
    }
    if (!user) throw new apiError(404, 'User not found')
    return res.status(200).json(new apiResponse(200,
        {user, ...await getShopSession(user)}, 'Account updated successfully'))
})

export const listCashiers = asyncHandler(async (req: Request, res: Response) => {
    if (wantsPage(req.query)) return res.status(200).json(new apiResponse(200, await cashierPage(req.user, req.query), 'Cashiers fetched successfully'))
    const cashiers = await User.find({shopId: req.user.shopId, role: 'CASHIER'}).select('username email').sort({username: 1})
    return res.status(200).json(new apiResponse(200, {cashiers}, 'Cashiers fetched successfully'))
})

export const updateCashier = asyncHandler(async (req: Request, res: Response) => {
    const {id} = req.params
    if (!mongoose.isValidObjectId(id)) throw new apiError(400, 'Invalid cashier selection')
    const {username, email} = req.body
    if (typeof username !== 'string' || username.trim() === '' ||
        typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        throw new apiError(400, 'Required valid username and email')
    }
    const cashier = await User.findOne({_id: String(id), shopId: req.user.shopId, role: 'CASHIER'})
    if (!cashier) throw new apiError(404, 'Cashier not found')
    const normalizedUsername = username.trim().toLowerCase()
    const normalizedEmail = email.trim().toLowerCase()
    const existing = await User.findOne({_id: {$ne: cashier._id}, $or: [{username: normalizedUsername}, {email: normalizedEmail}]})
    if (existing) throw new apiError(409, 'Username or email already exists')
    cashier.username = normalizedUsername
    cashier.email = normalizedEmail
    try {
        await cashier.save()
    } catch (error) {
        if ((error as {code?: number}).code === 11000) throw new apiError(409, 'Username or email already exists')
        throw error
    }
    return res.status(200).json(new apiResponse(200,
        {cashier: {_id: cashier._id, username: cashier.username, email: cashier.email}}, 'Cashier updated successfully'))
})

export const resetCashierPassword = asyncHandler(async (req: Request, res: Response) => {
    const {id} = req.params
    if (!mongoose.isValidObjectId(id)) throw new apiError(400, 'Invalid cashier selection')
    const {newPassword} = req.body
    if (typeof newPassword !== 'string' || newPassword.trim() === '') throw new apiError(400, 'Required valid new password')
    const cashier = await User.findOne({_id: String(id), shopId: req.user.shopId, role: 'CASHIER'})
    if (!cashier) throw new apiError(404, 'Cashier not found')
    cashier.password = newPassword
    cashier.refreshToken = undefined
    await cashier.save({validateBeforeSave: true})
    return res.status(200).json(new apiResponse(200, {}, 'Cashier password reset successfully'))
})

export const deleteCashier = asyncHandler(async (req: Request, res: Response) => {
    const {id} = req.params
    if (!mongoose.isValidObjectId(id)) throw new apiError(400, 'Invalid cashier selection')
    const shopId = req.user.shopId
    const session = await mongoose.startSession()
    session.startTransaction()
    try {
        const cashier = await User.findOne({_id: String(id), shopId, role: 'CASHIER'}).session(session)
        if (!cashier) throw new apiError(404, 'Cashier not found')
        // Delete first to acquire a write on the user, protecting the snapshot
        // against a concurrent username update. All writes roll back on failure.
        const deleted = await User.deleteOne({_id: cashier._id, shopId, role: 'CASHIER'}, {session})
        if (deleted.deletedCount !== 1) throw new apiError(409, 'Cashier changed. Refresh and try again')
        await Order.updateMany({shopId, createdBy: cashier._id,
            $or: [{createdByName: {$exists: false}}, {createdByName: null}, {createdByName: /^\s*$/}]},
            {$set: {createdByName: cashier.username}}, {session})
        await session.commitTransaction()
        return res.status(200).json(new apiResponse(200, {}, 'Cashier deleted successfully'))
    } catch (error) {
        await session.abortTransaction()
        throw error
    } finally {
        await session.endSession()
    }
})

export const updateShopDetails = asyncHandler(async (req: Request, res: Response) => {
    const {shopName, address, contactNo} = req.body
    if (typeof shopName !== 'string' || shopName.trim() === '' ||
        typeof address !== 'string' || address.trim() === '' ||
        typeof contactNo !== 'string' || !/^[0-9]{11}$/.test(contactNo)) {
        throw new apiError(400, 'Required valid shop name, address and 11-digit contact number')
    }
    const shop = await Shop.findOne({_id: req.user.shopId, ownerId: req.user._id})
    if (!shop) throw new apiError(404, 'Shop not found')
    const existing = await Shop.findOne({contactNo, _id: {$ne: shop._id}})
    if (existing) throw new apiError(409, 'Contact number already exists')
    shop.name = shopName.trim()
    shop.address = address.trim()
    shop.contactNo = contactNo
    try {
        await shop.save()
    } catch (error) {
        if ((error as {code?: number}).code === 11000) throw new apiError(409, 'Contact number already exists')
        throw error
    }
    return res.status(200).json(new apiResponse(200,
        {user: req.user, ...await getShopSession(req.user)}, 'Shop details updated successfully'))
})


export const changePassword = asyncHandler(async(req: Request, res: Response, next: NextFunction) => {

    const {oldPassword, newPassword} = req.body

    if(!oldPassword || !newPassword){
        throw new apiError(400, 'required all fields')
    }
    
    const user =  await User.findById(req.user?._id)
    
    if (!user) {
        
        throw new apiError(404, 'User not found')
    }

    const isPassCorrect = await user.isPasswordCorrect(oldPassword)
    
    if (!isPassCorrect) {
        throw new apiError(401, 'password is incorrect')
    }
    user.password = newPassword
    await user.save({validateBeforeSave: true})

    return res.status(200)
    .json(
        new apiResponse(
            200,
            {},
            'password is updated successfully'
        )
    )


})













