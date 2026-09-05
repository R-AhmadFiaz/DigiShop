import { type Request, type Response, type NextFunction } from "express"
import { apiError } from "./apiError.js"
import type { RequestHandler } from "express-serve-static-core"

export const asyncHandler = (reqHandler: RequestHandler) => async (req: Request, res: Response, next: NextFunction): Promise <void> => {


    try {
        
        await reqHandler(req,res,next)


        
    } catch (error) {
        next(error)
    }

}