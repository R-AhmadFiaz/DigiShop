import { type Request, type Response, type NextFunction } from "express" 
import { apiError } from "../utils/apiError.js"
import { nextTick } from "node:process"

export const verifyAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'ADMIN') {
        throw new apiError(403, 'Admin Access Required')
    }
    
    next()
}