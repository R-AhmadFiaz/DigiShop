import { rateLimit } from 'express-rate-limit'

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === "production" ? 5 : 100,
    message: 'Too many Login attampts, Try Again'
})

export {loginLimiter}

