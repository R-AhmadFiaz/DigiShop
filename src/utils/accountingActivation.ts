import {AsyncLocalStorage} from 'node:async_hooks';
import type {ClientSession} from 'mongoose';
import {Shop} from '../models/shop.model.js';
import {apiError} from './apiError.js';

// Request-local, never a process-global current shop. Transaction writers re-read
// and claim the shop so a concurrent pause/activation cannot race a posting.
type Context = {shopId: string, state: string, preparation: boolean};
export const accountingContext = new AsyncLocalStorage<Context>();
export const productionAccountingPermitted = () => process.env.BUSINESS_ACCOUNTING_ENABLED === 'true' &&
    process.env.BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED === 'true' && process.env.NODE_ENV === 'production';
// Development posting is explicit and always tagged as integration data.
// NODE_ENV=production can never enter this path.
export const developmentAccountingPermitted = () => process.env.NODE_ENV !== 'production' &&
    process.env.DIGISHOP_ENV === 'development' && process.env.BUSINESS_ACCOUNTING_DEVELOPMENT_ENABLED === 'true';
export const accountingActivationPermitted = () => productionAccountingPermitted() || developmentAccountingPermitted() ||
    (process.env.NODE_ENV === 'test' && process.env.BUSINESS_ACCOUNTING_ENABLED === 'true');
export const productionPostingActive = () => productionAccountingPermitted() && accountingContext.getStore()?.state === 'ACTIVE';
export function accountingMode(): 'INTEGRATION_TEST' | 'LIVE' {
    return process.env.NODE_ENV === 'test' || developmentAccountingPermitted() ? 'INTEGRATION_TEST' : 'LIVE';
}
export function accountingAvailable() {
    if (process.env.NODE_ENV === 'test') return process.env.BUSINESS_ACCOUNTING_ENABLED === 'true';
    const context = accountingContext.getStore();
    return (productionAccountingPermitted() || developmentAccountingPermitted()) && !!context &&
        (context.state === 'ACTIVE' || (['PREPARING','PAUSED'].includes(context.state) && context.preparation));
}
export function preparationPath(path: string) {
    return /^\/api\/v2\/accounts\/(activation(?:\/.*)?|existing-setup(?:\/.*)?|cutover\/prepare|financial(?:\/[a-f\d]{24}(?:\/opening)?)?|suppliers\/[a-f\d]{24}\/cutover)$/.test(path);
}
export function enforceAccountingWrite(state: string, preparation: boolean, mutation: boolean) {
    if (process.env.NODE_ENV === 'test' || !mutation) return;
    if (state === 'PAUSED') throw new apiError(409, 'Accounting posting is paused. Contact the shop owner.');
    if (state === 'ACTIVE' && !productionAccountingPermitted() && !developmentAccountingPermitted()) throw new apiError(503, 'Accounting posting is paused by server configuration. No unposted sale was recorded.');
    if (state === 'PREPARING' && !preparation) throw new apiError(409, 'Accounting setup is in progress. Finish setup before recording business changes.');
}
export async function claimAccountingShop(actor: any, session: ClientSession, mutation = true): Promise<any> {
    if (process.env.NODE_ENV === 'test' || (process.env.NODE_ENV !== 'production' && (!accountingContext.getStore() || accountingContext.getStore()?.state === 'DISABLED'))) return;
    if (!session?.inTransaction()) throw new apiError(400, 'An active MongoDB transaction is required');
    const shop = await Shop.findOne({_id: actor.shopId, ...(actor.role === 'OWNER' ? {ownerId: actor._id} : {})}).session(session);
    if (!shop) throw new apiError(403, 'Owner shop access required');
    if (shop.isActive === false) throw new apiError(403, 'Shop has been deactivated. Contact administrator.');
    if (!shop.subscriptionActive || !shop.subscriptionExpiry || shop.subscriptionExpiry <= new Date()) throw new apiError(403, 'Subscription expired or inactive');
    const state = shop.accounting?.state ?? 'DISABLED', context = accountingContext.getStore();
    const preparation = !!context && context.shopId === String(shop._id) && context.preparation;
    if (mutation && process.env.NODE_ENV !== 'test' && state === 'ACTIVE' && (!context || context.shopId !== String(shop._id))) throw new apiError(409, 'Authenticated accounting context required');
    enforceAccountingWrite(state, preparation, mutation);
    if (context && context.shopId === String(shop._id) && context.state !== state) throw new apiError(409, 'Accounting state changed; reload before continuing');
    if (mutation && process.env.NODE_ENV !== 'test') {
        const claim = await Shop.updateOne({_id: shop._id}, {$inc: {accountingWriteRevision: 1}}, {session});
        if (claim.modifiedCount !== 1) throw new apiError(409, 'Shop changed; retry the identical request');
    }
    return shop;
}

export async function requireInvoiceCutover(order: any, session: ClientSession) {
    if (!productionAccountingPermitted() && !developmentAccountingPermitted()) return;
    const shop=await Shop.findById(order.shopId).session(session).lean();
    if(shop?.accounting?.strategy==='CLEAN_START'&&shop.accounting.activatedAt&&shop.accounting.cutoffAt&&order.createdAt<=shop.accounting.cutoffAt)
        throw new apiError(409,'Pre-start invoice is read-only under clean-start policy. Historical demo settlements cannot affect active accounts.');
}
