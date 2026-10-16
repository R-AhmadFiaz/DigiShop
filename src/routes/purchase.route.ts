import {Router} from 'express';
import {verifyJWT} from '../middleware/auth.middleware.js';
import {verifyShopUser,verifyOwner} from '../middleware/role.middleware.js';
import {purchaseOperation} from '../controllers/purchase.controller.js';

export const purchaseRouter=Router();
purchaseRouter.use(verifyJWT,verifyShopUser,verifyOwner);
purchaseRouter.route('/').post(purchaseOperation('CREATE')).get(purchaseOperation('LIST'));
purchaseRouter.route('/:id').get(purchaseOperation('VIEW'));
purchaseRouter.route('/:id/confirm').post(purchaseOperation('CONFIRM'));
purchaseRouter.route('/:id/cancel').post(purchaseOperation('CANCEL'));
purchaseRouter.route('/:id/receipts').post(purchaseOperation('RECEIVE')).get(purchaseOperation('RECEIPTS'));
