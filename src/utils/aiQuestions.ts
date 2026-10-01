import mongoose from "mongoose";
import type { IUser } from "../models/user.model.js";
import { Product } from "../models/product.model.js";
import { Customer } from "../models/customer.model.js";
import { Order } from "../models/order.model.js";
import { apiError } from "./apiError.js";

const actions = new Set(["checkStock", "retailPrice", "wholesalePrice", "lowStock", "sales", "compareSales", "unitsSold", "topProducts", "productRevenue", "customerBalance", "invoiceStatus", "costPrice", "profit", "purchaseHistory", "readOnly", "unsupported"]);
const cashierActions = new Set(["checkStock", "retailPrice", "wholesalePrice", "customerBalance", "readOnly", "unsupported"]);
export function boundedText(value: unknown, max: number, label: string): string {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new apiError(400, `${label} must be between 1 and ${max} characters.`);
    return value.trim();
}
export const literalRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function periodBounds(period: string, now = new Date()) {
    const year = now.getUTCFullYear(), month = now.getUTCMonth();
    if (period === "today") return {start: new Date(Date.UTC(year, month, now.getUTCDate())), end: new Date(Date.UTC(year, month, now.getUTCDate() + 1)), label: "today (UTC)"};
    const offset = period === "lastMonth" ? -1 : 0;
    return {start: new Date(Date.UTC(year, month + offset, 1)), end: new Date(Date.UTC(year, month + offset + 1, 1)), label: period === "lastMonth" ? "last month (UTC)" : "this month (UTC)"};
}
const money = (value: number) => `PKR ${value.toLocaleString("en-PK", {maximumFractionDigits: 2})}`;

export async function processQuestion(question: string, user: IUser, classify: (text: string) => Promise<unknown>, now = new Date()) {
    if (!["OWNER", "CASHIER"].includes(user.role) || !user.shopId) throw new apiError(403, "Shop access required");
    const raw = await classify(boundedText(question, 1000, "Question"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new apiError(502, "AI could not understand that question. Please rephrase it.");
    const intent = raw as Record<string, unknown>;
    if (typeof intent.action !== "string" || !actions.has(intent.action)) throw new apiError(400, "That question is not supported. The assistant can only read shop information.");
    const action = intent.action;
    // Classification never grants permissions or determines query scope.
    if (user.role === "CASHIER" && !cashierActions.has(action)) throw new apiError(403, "This information is available only to the shop owner.");
    const response = (answer: string, data: unknown = []) => ({action, question, answer, data});
    if (action === "readOnly") return response("I can only read and analyze shop information. I cannot make changes.");
    if (action === "profit") return response("Accurate historical profit is not currently available because sale-time costs were not recorded.");
    if (action === "purchaseHistory") return response("Complete customer purchase history is not available because some sales have no recorded customer.");
    if (action === "unsupported") return response("Please ask about stock, prices, customer balances or supported shop summaries.");
    const shopId = user.shopId;
    if (["checkStock", "retailPrice", "wholesalePrice", "costPrice", "lowStock"].includes(action)) {
        const field = action === "retailPrice" ? "retailPrice" : action === "wholesalePrice" ? "wholesalePrice" : action === "costPrice" ? "costPrice" : "stockQuantity";
        const filter = action === "lowStock" ? {shopId, $expr: {$lte: ["$stockQuantity", "$minStockThreshold"]}} : {shopId, $or: ["name", "brand"].map(key => ({[key]: {$regex: literalRegex(boundedText(intent.product, 100, "Product")), $options: "i"}}))};
        const products = await Product.find(filter).select(`name brand unit ${field}`).sort({name: 1, _id: 1}).limit(20).maxTimeMS(5000).lean();
        const rows = products.map(product => `${product.name}${product.brand ? ` (${product.brand})` : ""}: ${field === "stockQuantity" ? `${product.stockQuantity} ${product.unit}` : money(product[field] ?? 0)}`);
        return response(rows.length ? `${action === "lowStock" ? "Low stock" : field === "stockQuantity" ? "Available stock" : action === "costPrice" ? "Cost prices" : action === "retailPrice" ? "Retail prices" : "Wholesale prices"} (up to 20 matches):\n${rows.join("\n")}` : "No matching products found.", products);
    }
    if (action === "customerBalance") {
        const search = literalRegex(boundedText(intent.customer, 100, "Customer"));
        const customers = await Customer.find({shopId, $or: [{name: {$regex: search, $options: "i"}}, {phoneNo: {$regex: search, $options: "i"}}]}).select("name phoneNo remainingMoney").sort({name: 1, _id: 1}).limit(10).maxTimeMS(5000).lean();
        return response(customers.length ? `Customer balances (up to 10 matches):\n${customers.map(customer => `${customer.name} (${customer.phoneNo}): ${money(customer.remainingMoney)}`).join("\n")}` : "No matching customers found.", customers);
    }
    if (action === "invoiceStatus") {
        const invoiceNo = boundedText(intent.invoiceNo, 100, "Invoice number");
        const invoice = await Order.findOne({shopId, type: "INVOICE", invoiceNo}).select("invoiceNo status").maxTimeMS(5000).lean();
        return response(invoice ? `${invoice.invoiceNo}: ${invoice.status.toLowerCase()}.` : "Invoice not found.", invoice ? [invoice] : []);
    }
    const period = intent.period ?? "thisMonth";
    if (typeof period !== "string" || !["today", "thisMonth", "lastMonth"].includes(period)) throw new apiError(400, "Unsupported time period. Ask about today, this month or last month.");
    const bounds = periodBounds(period, now);
    const match = (range: ReturnType<typeof periodBounds>) => ({shopId: new mongoose.Types.ObjectId(String(shopId)), type: "INVOICE", status: {$in: ["PENDING", "DELIVERED"]}, createdAt: {$gte: range.start, $lt: range.end}});
    const total = async (range: ReturnType<typeof periodBounds>) => {
        const rows = await Order.aggregate([{$match: match(range)}, {$group: {_id: null, total: {$sum: "$totalPrice"}, invoices: {$sum: 1}}}]).option({maxTimeMS: 5000});
        return {total: rows[0]?.total ?? 0, invoices: rows[0]?.invoices ?? 0};
    };
    if (action === "sales") {
        const result = await total(bounds);
        return response(`Recorded sales ${bounds.label}: ${money(result.total)} across ${result.invoices} invoices. Includes credit sales; this is not cash collected.`, result);
    }
    if (action === "compareSales") {
        const [current, previous] = await Promise.all([total(periodBounds("thisMonth", now)), total(periodBounds("lastMonth", now))]);
        return response(`Recorded sales (UTC): this month ${money(current.total)}; last month ${money(previous.total)}; difference ${money(current.total - previous.total)}. The current month is still in progress. Includes credit sales, not cash collected.`, {current, previous});
    }
    let productIds: mongoose.Types.ObjectId[] | undefined;
    if (action === "unitsSold") {
        const search = literalRegex(boundedText(intent.product, 100, "Product"));
        const products = await Product.find({shopId, $or: [{name: {$regex: search, $options: "i"}}, {brand: {$regex: search, $options: "i"}}]}).select("_id").sort({_id: 1}).limit(20).maxTimeMS(5000).lean();
        productIds = products.map(product => product._id);
    }
    const rows = await Order.aggregate([
        {$match: match(bounds)}, {$unwind: "$items"},
        ...(productIds ? [{$match: {"items.productId": {$in: productIds}}}] : []),
        {$group: {_id: "$items.productId", quantity: {$sum: "$items.quantity"}, revenue: {$sum: {$multiply: ["$items.quantity", "$items.unitPrice"]}}}},
        {$lookup: {from: "products", let: {product: "$_id"}, pipeline: [{$match: {$expr: {$and: [{$eq: ["$_id", "$$product"]}, {$eq: ["$shopId", new mongoose.Types.ObjectId(String(shopId))]}]}}}, {$project: {_id: 0, name: 1, unit: 1}}], as: "product"}},
        {$project: {_id: 0, quantity: 1, revenue: 1, name: {$ifNull: [{$arrayElemAt: ["$product.name", 0]}, "Product unavailable"]}, unit: {$ifNull: [{$arrayElemAt: ["$product.unit", 0]}, "units"]}}},
        {$sort: action === "productRevenue" ? {revenue: -1, name: 1} : {quantity: -1, name: 1}}, {$limit: action === "unitsSold" ? 20 : 10}
    ]).option({maxTimeMS: 5000});
    const revenue = action === "productRevenue";
    return response(rows.length ? `${revenue ? "Gross product revenue before order discounts" : "Units sold"} ${bounds.label} (${action === "unitsSold" ? "up to 20 matches" : "top 10; quantities may use different units"}):\n${rows.map(row => `${row.name}: ${revenue ? money(row.revenue) : `${row.quantity} ${row.unit}`}`).join("\n")}` : "No matching recorded sales in this period.", rows);
}
