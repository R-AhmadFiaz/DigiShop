import { rateLimit } from 'express-rate-limit'

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Too many Login attampts, Try Again'
})

export {loginLimiter}

