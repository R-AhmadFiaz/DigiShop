import mongoose from "mongoose";
import bcrypt from 'bcrypt'
import { type Request, type Response, type NextFunction } from "express"
import Jwt from "jsonwebtoken";
import type {SignOptions} from "jsonwebtoken";
import { apiError } from "../utils/apiError.js";

export interface IUserMethod {
    isPasswordCorrect(password: string): Promise<boolean>
}

const generateAccessAndRefreshToken = (req: Request, res: Response, next: NextFunction) => {



}



const userSchema = new mongoose.Schema(
    {
        username: {
            required: true,
            lowercase: true,
            type: String,
            unique: true,
            trim: true
        },
        email: {
            required: true,
            lowercase: true,
            type: String,
            unique: true
        },
        
        password: {
            required: true,
            type: String
        },

        role: {
            required: true,
            type: String,
            enum: ['CASHIER', 'ADMIN', 'OWNER']
        },
        avatar: {
            type: String
        },
        refreshToken: {
            type: String,
            required: true
        }
        
    },
    {timestamps: true})


userSchema.pre('save', async function (next) {

    if (!(this.isModified('password'))) return;

    this.password = await bcrypt.hash(this.password,10)


})


userSchema.methods.isPasswordCorrect = async function (password: string): Promise<boolean> {

    return await bcrypt.compare(password, this.password);

}

const accessTokenExpiry = process.env.ACCESS_TOKEN_EXPIRY as SignOptions["expiresIn"]

if(!accessTokenExpiry) throw new apiError(400, 'Could not get Access Token Expiry')

userSchema.methods.generateAccessToken = function() {

    return Jwt.sign({

        _id: this._id,
        email: this.email,
        username: this.username,
        role: this.role,
        avatar: this.avatar
    },
    process.env.ACCESS_TOKEN_SECRET as string,
        {
            expiresIn: accessTokenExpiry
        }
    )

}



const refreshTokenExpiry = process.env.ACCESS_TOKEN_EXPIRY as SignOptions["expiresIn"]

if(!refreshTokenExpiry) throw new apiError(400, 'Could not get Refresh Token Expiry')

userSchema.methods.generateRefreshToken = function() {

    return Jwt.sign({

        _id: this._id,

    },
    process.env.ACCESS_TOKEN_SECRET as string,
        {
            expiresIn: refreshTokenExpiry
        }
    )

}







export const User = mongoose.model('User', userSchema)