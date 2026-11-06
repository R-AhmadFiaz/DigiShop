import mongoose from 'mongoose';
import {createHash} from 'node:crypto';
import {Order} from '../models/order.model.js';
import {Shop} from '../models/shop.model.js';
import {Customer} from '../models/customer.model.js';
import {InvoiceCustomerNameCorrection} from '../models/invoiceCustomerNameCorrection.model.js';
import {apiError} from '../utils/apiError.js';
import {apiResponse} from '../utils/apiResponse.js';
import {asyncHandler} from '../utils/asyncHandler.js';

export function normalizeInvoiceDisplayName(value: unknown): string {
    if (typeof value !== 'string') throw new apiError(400, 'Enter a valid customer name');
    const name = value.normalize('NFC').trim();
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
        throw new apiError(400, 'Customer name must be 1 to 120 characters');
    }
    return name;
}

export function invoiceCustomerDisplayUpdate(name: string) {
    return {$set: {customerDisplayName: name}, $inc: {customerDisplayRevision: 1}};
}

function validRequestKey(value: unknown): value is string {
    return typeof value === 'string' && /^[\w-]{8,100}$/.test(value);
}

export const correctInvoiceCustomerDisplayName = asyncHandler(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !mongoose.isValidObjectId(req.params.orderId) || !validRequestKey(body.requestKey) ||
        typeof body.expectedName !== 'string' || body.expectedName.length > 500 ||
        !Number.isSafeInteger(body.expectedDisplayRevision) || body.expectedDisplayRevision < 0) {
        throw new apiError(400, 'Invalid customer name correction');
    }
    const newName = normalizeInvoiceDisplayName(body.name);
    const expectedName = body.expectedName.normalize('NFC').trim();
    const actor = req.user;
    const shopId = actor.shopId;
    const orderId = String(req.params.orderId);
    const requestHash = createHash('sha256').update(JSON.stringify({
        shopId: String(shopId), orderId, actorId: String(actor._id), expectedName, expectedDisplayRevision: body.expectedDisplayRevision, newName
    })).digest('hex');
    const session = await mongoose.startSession();
    let responseData: any;
    try {
        session.startTransaction({readConcern: {level: 'snapshot'}, writeConcern: {w: 'majority'}});
        const shop = await Shop.findOne({_id: shopId, ownerId: actor._id}).session(session);
        if (!shop) throw new apiError(403, 'Owner shop access required');
        if (shop.isActive === false) throw new apiError(403, 'Shop has been deactivated. Contact administrator.');
        if (!shop.subscriptionActive || !shop.subscriptionExpiry || shop.subscriptionExpiry <= new Date()) {
            throw new apiError(403, 'Subscription expired or inactive');
        }
        const prior = await InvoiceCustomerNameCorrection.findOne({shopId, orderId, requestKey: body.requestKey}).session(session);
        if (prior) {
            if (prior.requestHash !== requestHash) throw new apiError(409, 'Request key already used for different details');
            const eventData: any = prior.toObject();
            delete eventData.requestHash;
            responseData = {orderId, customerDisplayName: prior.newName, event: eventData, replayed: true};
        } else {
            const order = await Order.findOne({_id: orderId, shopId, type: 'INVOICE'}).session(session);
            if (!order) throw new apiError(404, 'Invoice not found');
            let masterName = '';
            if (order.customerId) {
                const customer = await Customer.findOne({_id: order.customerId, shopId}).select('name').session(session);
                masterName = customer?.name ?? '';
            }
            const previousName = order.customerDisplayName ?? masterName;
            if (previousName !== expectedName) throw new apiError(409, 'Customer name changed; refresh the invoice and try again');
            if (previousName === newName) throw new apiError(400, 'Enter a different customer name');
            const revisionBefore = order.customerDisplayRevision ?? 0;
            if (revisionBefore !== body.expectedDisplayRevision) throw new apiError(409, 'Customer name changed; refresh the invoice and try again');
            const revisionClause = revisionBefore === 0
                ? {$or: [{customerDisplayRevision: 0}, {customerDisplayRevision: {$exists: false}}]}
                : {customerDisplayRevision: revisionBefore};
            const updated = await Order.findOneAndUpdate(
                {_id: order._id, shopId, type: 'INVOICE', ...revisionClause},
                invoiceCustomerDisplayUpdate(newName),
                {new: true, runValidators: true, session}
            );
            if (!updated) throw new apiError(409, 'Customer name changed; refresh the invoice and try again');
            const [event] = await InvoiceCustomerNameCorrection.create([{
                shopId, orderId: order._id, invoiceNo: order.invoiceNo, requestKey: body.requestKey, requestHash,
                previousName, newName, customerId: order.customerId, actorId: actor._id,
                actorName: actor.username, recordedAt: new Date(), revisionBefore, revisionAfter: revisionBefore + 1
            }], {session});
            if (!event) throw new apiError(500, 'Customer name history could not be recorded');
            const eventData: any = event.toObject();
            delete eventData.requestHash;
            responseData = {orderId, customerDisplayName: newName, event: eventData, replayed: false};
        }
        await session.commitTransaction();
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(new apiResponse(200, responseData, 'Invoice customer name updated'));
    } catch (error: any) {
        if (session.inTransaction()) await session.abortTransaction().catch(() => {});
        if (error?.code === 11000) {
            const prior = await InvoiceCustomerNameCorrection.findOne({shopId, orderId, requestKey: body.requestKey}).lean();
            if (prior) {
                if (prior.requestHash !== requestHash) throw new apiError(409, 'Request key already used for different details');
                delete (prior as any).requestHash;
                res.setHeader('Cache-Control', 'no-store');
                return res.status(200).json(new apiResponse(200, {orderId, customerDisplayName: prior.newName, event: prior, replayed: true}, 'Invoice customer name updated'));
            }
            throw new apiError(409, 'Invoice changed; refresh the customer name and try again');
        }
        if (error?.code === 112 || error?.name === 'VersionError' || error?.hasErrorLabel?.('TransientTransactionError')) {
            throw new apiError(409, 'Invoice changed; refresh the customer name and try again');
        }
        throw error;
    } finally {
        await session.endSession();
    }
});
