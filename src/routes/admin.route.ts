import { Router } from "express";

import { verifyJWT } from "../middleware/auth.middleware.js";
import { verifyAdmin } from "../middleware/admin.middleware.js";
import { getAllShops, activateShop, extendShopSubscription, deactivateShop, reactivateShop, deleteShop } from "../controllers/admin.controller.js";

export const adminRouter = Router();
adminRouter.route("/shops/:id").delete(verifyJWT, verifyAdmin, deleteShop);

adminRouter.route("/shops/:id/deactivate").patch(verifyJWT, verifyAdmin, deactivateShop);
adminRouter.route("/shops/:id/reactivate").patch(verifyJWT, verifyAdmin, reactivateShop);

adminRouter.route("/shops").get(
    verifyJWT,
    verifyAdmin,
    getAllShops
);

adminRouter.route("/shops/:id/activate").patch(
    verifyJWT,
    verifyAdmin,
    activateShop
);

adminRouter.route("/shops/:id/extend").patch(
    verifyJWT,
    verifyAdmin,
    extendShopSubscription
);

