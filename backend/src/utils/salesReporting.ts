import mongoose from 'mongoose';
import {Order} from '../models/order.model.js';
import {InvoiceAdjustment} from '../models/invoiceAdjustment.model.js';

type Range = {start: Date, end: Date};
// Every union and lookup independently enforces shop scope. Untimed historical
// cancellations retain their old excluded behavior; their date is never guessed.
function originalRows(shopId: mongoose.Types.ObjectId, range: Range): any[] {
    return [
        {$match: {shopId, type: 'INVOICE', status: {$in: ['PENDING', 'DELIVERED', 'CANCELLED']}, createdAt: {$gte: range.start, $lt: range.end}}},
        {$lookup: {from: InvoiceAdjustment.collection.name, let: {invoice: '$_id'}, pipeline: [
            {$match: {shopId, kind: 'CANCELLATION', $expr: {$eq: ['$orderId', '$$invoice']}}}, {$limit: 1}, {$project: {_id: 1}}
        ], as: 'datedCancellation'}},
        {$set: {knownSale: {$or: [{$ne: ['$status', 'CANCELLED']},
            {$and: [{$eq: ['$cancellationMode', 'LEGACY']}, {$eq: [{$type: '$cancelledAt'}, 'date']}]},
            {$gt: [{$size: '$datedCancellation'}, 0]}]}}}
    ];
}
function datedEvents(shopId: mongoose.Types.ObjectId, range: Range): any[] {
    return [{$match: {shopId, kind: {$in: ['ADJUSTMENT', 'CANCELLATION']}, occurredAt: {$gte: range.start, $lt: range.end}}},
        {$lookup: {from: Order.collection.name, let: {invoice: '$orderId'}, pipeline: [
            {$match: {shopId, type: 'INVOICE', $expr: {$eq: ['$_id', '$$invoice']}}}, {$project: {_id: 1}}
        ], as: 'invoice'}}, {$match: {'invoice.0': {$exists: true}}}];
}
function legacyReversals(shopId: mongoose.Types.ObjectId, range: Range): any[] {
    return [{$match: {shopId, type: 'INVOICE', status: 'CANCELLED', cancellationMode: 'LEGACY',
        cancelledAt: {$gte: range.start, $lt: range.end}}}];
}
export async function salesSummary(shop: any, range: Range) {
    const shopId = new mongoose.Types.ObjectId(String(shop));
    const rows = await Order.aggregate([
        ...originalRows(shopId, range),
        {$project: {original: {$cond: ['$knownSale', {$ifNull: ['$originalSnapshot.totalPrice', '$totalPrice']}, 0]},
            adjustment: {$literal: 0}, invoiceCount: {$cond: ['$knownSale', 1, 0]},
            excluded: {$cond: ['$knownSale', 0, 1]}, eventCount: {$literal: 0}}},
        {$unionWith: {coll: InvoiceAdjustment.collection.name, pipeline: [...datedEvents(shopId, range),
            {$project: {original: {$literal: 0}, adjustment: {$divide: ['$financial.salesDeltaMinor', 100]},
                invoiceCount: {$literal: 0}, excluded: {$literal: 0}, eventCount: {$literal: 1}}}]}},
        {$unionWith: {coll: Order.collection.name, pipeline: [...legacyReversals(shopId, range),
            {$project: {original: {$literal: 0}, adjustment: {$multiply: [-1, {$ifNull: ['$originalSnapshot.totalPrice', '$totalPrice']}]},
                invoiceCount: {$literal: 0}, excluded: {$literal: 0}, eventCount: {$literal: 1}}}]}},
        {$group: {_id: null, originalSales: {$sum: '$original'}, adjustments: {$sum: '$adjustment'},
            invoices: {$sum: '$invoiceCount'}, adjustmentCount: {$sum: '$eventCount'}, legacyCancelledExcluded: {$sum: '$excluded'}}}
    ]).option({maxTimeMS: 5000, readConcern: {level: 'snapshot'}});
    const row = rows[0];
    const originalSales = row?.originalSales ?? 0, adjustments = row?.adjustments ?? 0;
    return {total: originalSales + adjustments, originalSales, adjustments, invoices: row?.invoices ?? 0,
        adjustmentCount: row?.adjustmentCount ?? 0, legacyCancelledExcluded: row?.legacyCancelledExcluded ?? 0,
        convention: 'UTC; recorded invoice value, including credit sales, not cash collected'};
}
export async function productSales(shop: any, range: Range, productIds: mongoose.Types.ObjectId[] | undefined,
    revenue: boolean, limit: number) {
    const shopId = new mongoose.Types.ObjectId(String(shop));
    return Order.aggregate([
        ...originalRows(shopId, range), {$match: {knownSale: true}},
        {$project: {items: {$ifNull: ['$originalSnapshot.items', '$items']}}}, {$unwind: '$items'},
        {$project: {productId: '$items.productId', name: '$items.name', unit: '$items.unit', quantity: '$items.quantity',
            revenue: {$multiply: ['$items.quantity', '$items.unitPrice']}}},
        {$unionWith: {coll: InvoiceAdjustment.collection.name, pipeline: [...datedEvents(shopId, range), {$unwind: '$movements'},
            {$project: {productId: '$movements.productId', quantity: {$multiply: ['$movements.quantity', {$cond: [{$eq: ['$movements.kind', 'RETURN']}, -1, 1]}]},
                revenue: {$multiply: ['$movements.quantity', {$divide: ['$movements.unitPriceMinor', 100]}, {$cond: [{$eq: ['$movements.kind', 'RETURN']}, -1, 1]}]}}}]}},
        {$unionWith: {coll: Order.collection.name, pipeline: [...legacyReversals(shopId, range),
            {$project: {items: {$ifNull: ['$originalSnapshot.items', '$items']}}}, {$unwind: '$items'},
            {$project: {productId: '$items.productId', name: '$items.name', unit: '$items.unit', quantity: {$multiply: [-1, '$items.quantity']},
                revenue: {$multiply: [-1, '$items.quantity', '$items.unitPrice']}}}]}},
        ...(productIds ? [{$match: {productId: {$in: productIds}}}] : []),
        {$group: {_id: '$productId', quantity: {$sum: '$quantity'}, revenue: {$sum: '$revenue'}, snapshotName: {$first: '$name'}, snapshotUnit: {$first: '$unit'}}},
        {$lookup: {from: 'products', let: {product: '$_id'}, pipeline: [
            {$match: {shopId, $expr: {$eq: ['$_id', '$$product']}}}, {$project: {_id: 0, name: 1, unit: 1}}
        ], as: 'product'}},
        {$project: {_id: 0, quantity: 1, revenue: 1, name: {$ifNull: ['$snapshotName', {$ifNull: [{$arrayElemAt: ['$product.name', 0]}, 'Product unavailable']}]},
            unit: {$ifNull: ['$snapshotUnit', {$ifNull: [{$arrayElemAt: ['$product.unit', 0]}, 'units']}]}}},
        {$sort: revenue ? {revenue: -1, name: 1} : {quantity: -1, name: 1}}, {$limit: limit}
    ]).option({maxTimeMS: 5000, readConcern: {level: 'snapshot'}});
}
