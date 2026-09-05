import mongoose from "mongoose";
import bcrypt from 'bcrypt'
import { type Request, type Response, type NextFunction } from "express"

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
        
    },
    {timestamps: true})


userSchema.pre('save', async function (next) {

    if (!(this.isModified('password'))) return;

    this.password = await bcrypt.hash(this.password,10)


})


userSchema.methods.isPasswordCorrect = async function (password: string): Promise<boolean> {

    return await bcrypt.compare(password, this.password);

}

export const User = mongoose.model('User', userSchema)