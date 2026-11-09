import mongoose from "mongoose";
import { apiError } from "./apiError.js";
import { listQuery } from "./listQuery.js";
import { Product } from "../models/product.model.js";
import { Category } from "../models/category.model.js";
import { Shop } from "../models/shop.model.js";
import { User, type IUser } from "../models/user.model.js";

// Opt-in server pagination. Callers that send neither page nor limit keep the
// original complete responses (POS, invoice editor and purchase creation rely on them).
export const wantsPage = (query: Record<string, unknown>) => query.page !== undefined || query.limit !== undefined;

const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const meta = (page: number, limit: number, recordCount: number) =>
    ({ currentPage: page, limit, recordCount, totalPages: Math.ceil(recordCount / limit) });
const text = (value: unknown, label: string) => {
    if (value === undefined || value === "") return "";
    if (typeof value !== "string" || value.length > 100) throw new apiError(400, `${label} must be text of at most 100 characters`);
    return value.trim();
};
const brandKey = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";

// Same semantics as the browser filter it replaces: every search word must appear
// (case-insensitive, literal) in the name, brand, description or category name.
export async function productPage(user: IUser, query: Record<string, unknown>, lowStockOnly = false) {
    const { page, limit, skip, escapedSearch } = listQuery(query);
    const shopId = user.shopId;
    const base: Record<string, unknown> = { shopId };
    const category = text(query.category, "Category");
    if (category) {
        if (!mongoose.isValidObjectId(category)) throw new apiError(400, "Invalid category");
        base.category = category;
    }
    const and: Record<string, unknown>[] = [];
    const words = escapedSearch.split(/\s+/).filter(Boolean);
    if (words.length) {
        const categories = await Category.find({ shopId }).select("_id name").lean();
        for (const word of words) {
            const pattern = new RegExp(word, "i");
            const categoryIds = categories.filter(c => pattern.test(c.name)).map(c => c._id);
            and.push({ $or: [{ name: pattern }, { brand: pattern }, { description: pattern }, ...(categoryIds.length ? [{ category: { $in: categoryIds } }] : [])] });
        }
    }
    const brand = text(query.brand, "Brand");
    if (brand) and.push({ brand: new RegExp("^\\s*" + literal(brand) + "\\s*$", "i") });
    if (lowStockOnly || query.lowStock === "true") and.push({ $expr: { $lte: ["$stockQuantity", "$minStockThreshold"] } });
    const filter = and.length ? { ...base, $and: and } : base;
    const hidden = user.role === "CASHIER" ? "-costPrice" : "";
    const [recordCount, product, brandValues] = await Promise.all([
        Product.countDocuments(filter),
        // The legacy unsorted queries were answered by the {shopId, slug} index, so users saw
        // slug (name/brand) order. Keep that order explicitly; _id makes pages stable.
        Product.find(filter).sort({ slug: 1, _id: 1 }).skip(skip).limit(limit).populate("category").select(hidden),
        Product.distinct("brand", base),
    ]);
    const brands = new Map<string, string>();
    for (const value of brandValues) { const key = brandKey(value); if (key && !brands.has(key)) brands.set(key, String(value).trim()); }
    return {
        product,
        pagination: meta(page, limit, recordCount),
        brands: [...brands].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label })),
    };
}

export async function cashierPage(user: IUser, query: Record<string, unknown>) {
    const { page, limit, skip } = listQuery(query);
    const filter = { shopId: user.shopId, role: "CASHIER" as const };
    const [recordCount, cashiers] = await Promise.all([
        User.countDocuments(filter),
        User.find(filter).select("username email").sort({ username: 1, _id: 1 }).skip(skip).limit(limit),
    ]);
    return { cashiers, pagination: meta(page, limit, recordCount) };
}

const DAY = 24 * 60 * 60 * 1000;
const NEVER = new Date(8640000000000000);
// Server version of the admin screen's ordering: expired first, then never
// activated, expiring within three days, active; then expiry, name and id.
export async function shopPage(query: Record<string, unknown>, now = new Date()) {
    const { page, limit, skip, escapedSearch } = listQuery(query);
    const soon = new Date(now.getTime() + 3 * DAY);
    const isDate = { $eq: [{ $type: "$subscriptionExpiry" }, "date"] };
    const pipeline: mongoose.PipelineStage[] = [
        { $lookup: { from: User.collection.name, localField: "ownerId", foreignField: "_id", as: "owner", pipeline: [{ $project: { username: 1, email: 1 } }] } },
        { $addFields: { ownerId: { $ifNull: [{ $first: "$owner" }, null] } } },
        { $project: { owner: 0 } },
    ];
    if (escapedSearch) {
        const fields = { $filter: { input: ["$name", "$contactNo", "$ownerId.username", "$ownerId.email"], cond: { $and: [{ $eq: [{ $type: "$$this" }, "string"] }, { $ne: ["$$this", ""] }] } } };
        const haystack = { $reduce: { input: fields, initialValue: "", in: { $cond: [{ $eq: ["$$value", ""] }, "$$this", { $concat: ["$$value", " ", "$$this"] }] } } };
        pipeline.push({ $match: { $expr: { $regexMatch: { input: haystack, regex: escapedSearch, options: "i" } } } });
    }
    pipeline.push(
        { $addFields: {
            _priority: { $switch: { branches: [
                { case: { $not: [isDate] }, then: 1 },
                { case: { $lte: ["$subscriptionExpiry", now] }, then: 0 },
                { case: { $lte: ["$subscriptionExpiry", soon] }, then: 2 },
            ], default: 3 } },
            _expiry: { $cond: [isDate, "$subscriptionExpiry", NEVER] },
        } },
        { $sort: { _priority: 1, _expiry: 1, name: 1, _id: 1 } },
        { $facet: { rows: [{ $skip: skip }, { $limit: limit }, { $project: { _priority: 0, _expiry: 0 } }], total: [{ $count: "n" }] } },
    );
    const [result] = await Shop.aggregate(pipeline).collation({ locale: "en" });
    return { shops: result?.rows ?? [], pagination: meta(page, limit, result?.total[0]?.n ?? 0) };
}
