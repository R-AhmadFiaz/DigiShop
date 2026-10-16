import {Router} from 'express';
import {verifyJWT} from '../middleware/auth.middleware.js';
import {verifyShopUser, verifyOwner} from '../middleware/role.middleware.js';
import {businessAccounts} from '../controllers/businessAccounts.controller.js';

export const businessAccountsRouter = Router();
// CASHIER retains only the existing /orders/payment-accounts selector.
businessAccountsRouter.use(verifyJWT, verifyShopUser, verifyOwner);
businessAccountsRouter.route('/entities').get(businessAccounts('entities')).post(businessAccounts('createEntity'));
businessAccountsRouter.route('/entities/:id').get(businessAccounts('entity'));
businessAccountsRouter.route('/entities/:id/roles').patch(businessAccounts('roles'));
businessAccountsRouter.route('/entities/:id/customer').patch(businessAccounts('linkCustomer'));
businessAccountsRouter.route('/brands').get(businessAccounts('brands')).post(businessAccounts('createBrand'));
businessAccountsRouter.route('/brands/:id/entities').patch(businessAccounts('brandEntities'));
businessAccountsRouter.route('/products/:id/brand').get(businessAccounts('productLinks')).put(businessAccounts('linkProduct'));
businessAccountsRouter.route('/financial').get(businessAccounts('accounts')).post(businessAccounts('createAccount'));
businessAccountsRouter.route('/financial/:id').get(businessAccounts('account'));
businessAccountsRouter.route('/financial/:id/history').get(businessAccounts('history'));
businessAccountsRouter.route('/financial/:id/history/:entryId').get(businessAccounts('historyEntry'));
businessAccountsRouter.route('/transactions').get(businessAccounts('transactions'));
businessAccountsRouter.route('/transactions/:id').get(businessAccounts('transaction'));
businessAccountsRouter.route('/financial/:id/opening').post(businessAccounts('opening'));
businessAccountsRouter.route('/cutover/prepare').post(businessAccounts('cutover'));
businessAccountsRouter.route('/reconciliation').get(businessAccounts('reconcile'));
businessAccountsRouter.route('/customers/:id/reconciliation').get(businessAccounts('reconcileCustomer'));

businessAccountsRouter.route('/suppliers/:id/cutover-preview').get(businessAccounts('supplierPreview'));
businessAccountsRouter.route('/suppliers/:id/cutover').post(businessAccounts('supplierOpening'));
businessAccountsRouter.route('/suppliers/:id/reconciliation').get(businessAccounts('supplierReconcile'));
businessAccountsRouter.route('/suppliers/:id/balance').get(businessAccounts('supplierBalance'));

businessAccountsRouter.route('/suppliers/:id/payments').post(businessAccounts('supplierPayment'));
businessAccountsRouter.route('/suppliers/:id/returns').post(businessAccounts('supplierReturn'));
businessAccountsRouter.route('/suppliers/:id/settlements').get(businessAccounts('supplierSettlements'));
businessAccountsRouter.route('/suppliers/:id/settlements/:eventId/reverse').post(businessAccounts('supplierReverse'));
