import { type Request, type Response, type NextFunction } from "express"
import { apiError } from "./apiError.js"
import type { RequestHandler } from "express-serve-static-core"


type asyncReqHandler = (
    req: Request,
    res: Response,
    next: NextFunction
) => Promise<any>;

export const asyncHandler = (reqHandler: asyncReqHandler) => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(reqHandler(req, res, next)).catch((error) => next(error))

    }
}