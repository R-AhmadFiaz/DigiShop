const base = (
  import.meta.env?.VITE_API_BASE_URL || "http://localhost:3000/api/v2"
).replace(/\/$/, "");
let refreshPromise = null;
let sessionVersion = 0;
let onSessionExpired = () => {};
let onShopDeactivated = () => {};
let onSubscriptionBlocked = () => {};
export function setSubscriptionBlockedHandler(handler) {
  onSubscriptionBlocked = handler;
}
export const SHOP_DEACTIVATED_MESSAGE =
  "Shop has been deactivated. Contact administrator.";
export function setShopDeactivatedHandler(handler) {
  onShopDeactivated = handler;
}
export function setSessionExpiredHandler(handler) {
  onSessionExpired = handler;
}
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
function authFailure(status, message) {
  return (
    (status === 401 && /access token|unauthorized access/i.test(message)) ||
    (status === 400 && /token is not provided|user is not found/i.test(message))
  );
}
function friendly(message, status) {
  if (/subscription/i.test(message))
    return "This shop needs an active subscription. Contact the platform administrator.";
  if (
    /stock is not enough|insufficient stock|not enough stock|enough stock|update quotation to order/i.test(
      message,
    )
  )
    return "There is not enough stock. Check quantities and try again.";
  if (/debt history|balance cannot safely|product missing/i.test(message))
    return "This invoice cannot be cancelled safely. Its stock or customer balance needs review.";
  if (/duplicate|already exist/i.test(message))
    return "An account or item with these details already exists.";
  if (status >= 500)
    return "The request could not be completed. Please try again. If it continues, contact your administrator.";
  if (/\b(id|schema|mongoose|cast|database)\b/i.test(message))
    return "The selected item is no longer available or is not valid. Refresh the list and try again.";
  return message && message.length < 220
    ? message
    : "The request could not be completed.";
}
async function send(endpoint, options) {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(body);
  }
  let response, text;
  const timeout = AbortSignal.timeout(options.timeout || 30000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  try {
    response = await fetch(base + endpoint, {
      method: options.method || "GET",
      body,
      headers,
      credentials: "include",
      signal,
    });
    text = await response.text();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      endpoint.startsWith("/orders/") &&
        options.method &&
        options.method !== "GET"
        ? "Cannot confirm this sale or change. It may have been saved. Ask the owner to check invoices before repeating it."
        : "Cannot reach the store service. Check your connection and try again.",
    );
  }
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      (response.ok && !Object.hasOwn(payload, "data"))
    )
      throw new Error("Unreadable response");
  } catch {
    if (response.ok)
      throw new ApiError(
        endpoint.startsWith("/orders/") &&
          options.method &&
          options.method !== "GET"
          ? "Cannot confirm this sale or change. It may have been saved. Ask the owner to check invoices before repeating it."
          : "The store service returned an unreadable response. Please try again.",
      );
    payload = {
      message:
        response.status === 429
          ? "Too many sign-in attempts. Please wait and try again."
          : "",
    };
  }
  return { response, payload };
}
export async function api(endpoint, options = {}) {
  const version = sessionVersion;
  let result = await send(endpoint, options);
  const message = result.payload.message || result.payload.messege || "";
  if (result.response.status === 403 && message === SHOP_DEACTIVATED_MESSAGE)
    onShopDeactivated();
  if (
    result.response.status === 403 &&
    message === "Subscription expired or inactive"
  )
    onSubscriptionBlocked();
  if (options.auth !== false && authFailure(result.response.status, message)) {
    if (sessionVersion === version) {
      if (!refreshPromise)
        refreshPromise = send("/users/refresh-token", { method: "POST" })
          .then(({ response }) => {
            if (!response.ok)
              throw new ApiError(
                "Your session has ended. Please sign in again.",
                response.status,
              );
            sessionVersion++;
          })
          .finally(() => {
            refreshPromise = null;
          });
      try {
        await refreshPromise;
      } catch {
        onSessionExpired();
        throw new ApiError(
          "Your session has ended. Please sign in again.",
          401,
        );
      }
    }
    result = await send(endpoint, options); // Exactly one retry. Never replay on ordinary network errors.
    if (
      result.response.status === 403 &&
      result.payload.message === "Subscription expired or inactive"
    )
      onSubscriptionBlocked();
    if (
      result.response.status === 403 &&
      result.payload.message === SHOP_DEACTIVATED_MESSAGE
    )
      onShopDeactivated();
    if (authFailure(result.response.status, result.payload.message || ""))
      onSessionExpired();
  }
  if (!result.response.ok)
    throw new ApiError(
      friendly(
        result.payload.message || result.payload.messege || "",
        result.response.status,
      ),
      result.response.status,
    );
  return result.payload.data;
}
export function query(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== "" && value != null) params.set(key, String(value));
  return params.size ? "?" + params : "";
}
