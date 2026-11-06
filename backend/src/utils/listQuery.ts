import { apiError } from "./apiError.js";

export const listQuery = (query: Record<string, unknown>) => {
    const page = Number(query.page ?? 1);
    const limit = Number(query.limit ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger((page - 1) * limit)) {
        throw new apiError(400, "Page must be a positive integer; limit must be 1-100");
    }
    const search = query.search ?? "";
    if (typeof search !== "string" || search.length > 100) {
        throw new apiError(400, "Search must be a string of at most 100 characters");
    }
    // Literal search: user input must not become a regular expression.
    const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {page, limit, skip: (page - 1) * limit, escapedSearch};
};
