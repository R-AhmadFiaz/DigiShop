import { rateLimit } from "express-rate-limit";
const message = {success: false, message: "Too many assistant questions. Please wait a few minutes and try again."};
export const aiUserLimiter = rateLimit({windowMs: 5 * 60 * 1000, limit: 30, keyGenerator: req => String(req.user._id), standardHeaders: "draft-8", legacyHeaders: false, message});
export const aiIpLimiter = rateLimit({windowMs: 5 * 60 * 1000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false, message});
