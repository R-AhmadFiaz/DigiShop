import { rateLimit } from 'express-rate-limit'

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? 5 : 100,
    message: 'Too many Login attampts, Try Again'
})

export {loginLimiter}

export const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: {success: false, message: 'Too many registration attempts. Please try again later.'}
})

export const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    message: {success: false, message: 'Too many session refresh attempts. Please try again later.'}
})

