// Only request journals, never API responses. Survive a reload after a lost
// financial response; remove only after a confirmed result or definite rejection.
export const requestKey = () => crypto.randomUUID();
export const journalKey = (user, scope) =>
  `digishop:pending:${encodeURIComponent(user._id || user.email)}:${scope}`;
export function readPending(key) {
  try {
    const value = sessionStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null; // Cash-only checkout must still work when browser storage is disabled.
  }
}
export function savePending(key, request) {
  try {
    sessionStorage.setItem(key, JSON.stringify(request));
  } catch {
    // No request was sent: fail closed before any financial mutation.
    throw Object.assign(new Error("This browser cannot retain the payment request. Enable browser storage before recording this operation."), { status: 400 });
  }
}
export function clearPending(key) {
  try { sessionStorage.removeItem(key); } catch { /* Recovery remains an idempotent replay. */ }
}
export const uncertain = (error) => !error.status || error.status >= 500;
export function amount(value, label) {
  if (String(value).trim() === "") throw new Error(`Enter ${label}.`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100)) ||
      Math.abs(number * 100 - Math.round(number * 100)) > 0.000001)
    throw new Error(`${label} must be a nonnegative amount in rupees and paisa.`);
  return number;
}
export function adjustmentBody({ order, mode, key, reason, returns, additions, discountType, discountValue, funds, recipient }) {
  if (mode !== "payments" && !reason.trim()) throw new Error("Enter a reason.");
  const body = {
    requestKey: key, expectedRevision: order.revision ?? 0, reason: reason.trim() || "Customer invoice payment",
    returns: mode === "adjustments" ? order.items.flatMap((line) => {
      const entry = returns[line.lineId];
      if (!entry || entry.quantity === "" || Number(entry.quantity) === 0) return [];
      const quantity = Number(entry.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > line.quantity)
        throw new Error("Check the returned quantities.");
      return [{ lineId: line.lineId, quantity, disposition: entry.disposition }];
    }) : [],
    additions: mode === "adjustments" ? additions.map((line) => {
      const quantity = Number(line.quantity);
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Check the added quantities.");
      return { productId: line._id, quantity };
    }) : [],
  };
  if (mode === "adjustments") {
    body.discountType = discountType;
    body.discountValue = discountType === "NONE" ? 0 : amount(discountValue, "discount");
  }
  for (const [field, value] of Object.entries(funds)) body[field] = amount(value, "the payment or refund amount");
  if (recipient && body.creditIssueAmount > 0) body.creditRecipientId = recipient._id;
  return body;
}
