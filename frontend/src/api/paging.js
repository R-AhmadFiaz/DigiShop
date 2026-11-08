import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

// List position lives in the URL so Back, reload and shared links return to the
// same page and filters. Each list on a screen uses its own key.
export function useQueryParam(key, fallback = "") {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;
  const setValue = useCallback(
    (next, resets = []) =>
      setParams(
        () => {
          // Start from the live URL, not the last render: two updates in one event
          // (for example category then brand) must both survive.
          const result = new URLSearchParams(window.location.search);
          if (next === "" || next == null || String(next) === String(fallback)) result.delete(key);
          else result.set(key, String(next));
          for (const reset of resets) result.delete(reset);
          return result;
        },
        { replace: true },
      ),
    [key, fallback, setParams],
  );
  return [value, setValue];
}

export function pageNumber(value) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

export function usePageParam(key = "page") {
  const [value, setValue] = useQueryParam(key, "1");
  return [pageNumber(value), useCallback((page) => setValue(pageNumber(page)), [setValue])];
}

// The page to show after a response: past the end goes to the last page, and an
// empty list goes to page 1. Returns null when no correction is needed.
export function clampedPage(pagination) {
  if (!pagination || !Number.isSafeInteger(pagination.currentPage) || !Number.isSafeInteger(pagination.totalPages)) return null;
  const last = Math.max(1, pagination.totalPages);
  return pagination.currentPage > last ? last : null;
}

export function pageRange(pagination, rowsShown) {
  const { currentPage, limit } = pagination || {};
  // Endpoints name the total differently; all mean "matching records".
  const recordCount = pagination?.recordCount ?? pagination?.orderCount ?? pagination?.customerCount;
  if (![currentPage, limit, recordCount].every(Number.isSafeInteger) || recordCount < 1) return null;
  const first = (currentPage - 1) * limit + 1;
  if (first > recordCount) return null;
  return { first, last: Math.min(recordCount, first + (Number.isSafeInteger(rowsShown) ? rowsShown : limit) - 1), total: recordCount };
}
