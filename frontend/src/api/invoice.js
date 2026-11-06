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

// Translate the cashier's proposed quantities into the existing audited
// adjustment contract. Existing sold units keep their line identity and price;
// increases become separate additions, priced authoritatively by the server.
export function invoiceEditChanges({ order, quantities, additions = [], dispositions = {}, products = [] }) {
  const returns = {};
  const added = [];
  for (const [index, line] of (order.items || []).entries()) {
    const lineId = line.lineId || `legacy-${index}`;
    const raw = quantities[lineId] ?? line.quantity;
    if (String(raw).trim() === '') throw new Error(`Enter a whole quantity of zero or more for ${line.name || "this product"}.`);
    const next = Number(raw);
    if (!Number.isSafeInteger(next) || next < 0) throw new Error(`Enter a whole quantity of zero or more for ${line.name || "this product"}.`);
    const difference = next - line.quantity;
    if (difference < 0) {
      const disposition = dispositions[lineId];
      if (!['RESTOCK', 'DAMAGED'].includes(disposition)) throw new Error(`Choose the condition for returned ${line.name || "product"}.`);
      returns[lineId] = { quantity: String(-difference), disposition };
    } else if (difference > 0) {
      const productId = String(line.productId?._id ?? line.productId);
      const product = products.find(value => String(value._id) === productId);
      if (!product) throw new Error(`Current product pricing is unavailable for ${line.name || "this product"}. Refresh products before increasing its quantity.`);
      const price = order.saleType === 'WHOLESALE' ? product.wholesalePrice : product.retailPrice;
      if (price === null || price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0 || order.saleType === 'WHOLESALE' && Number(price) === 0) throw new Error(`A current ${order.saleType === 'WHOLESALE' ? 'wholesale' : 'retail'} price is unavailable for ${line.name || "this product"}.`);
      added.push({ _id: productId, quantity: difference });
    }
  }
  for (const line of additions) {
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Check the added quantities.");
    const price=order.saleType === 'WHOLESALE' ? line.wholesalePrice : line.retailPrice;
    if (price === null || price === undefined || !Number.isFinite(Number(price)) || Number(price) < 0 || order.saleType === 'WHOLESALE' && Number(price) === 0)
      throw new Error(`A current ${order.saleType === 'WHOLESALE' ? 'wholesale' : 'retail'} price is unavailable for ${line.name || "this product"}.`);
    added.push({ _id: String(line._id), quantity });
  }
  return { returns, additions: added };
}

export function adjustmentBody({ order, mode, key, reason, returns, additions, discountType, discountValue, funds, recipient }) {
  const userReason = typeof reason === "string" ? reason.trim() : "";
  if (mode === "cancellations" && !userReason) throw new Error("Enter a cancellation reason.");
  const body = {
    requestKey: key, expectedRevision: order.revision ?? 0,
    reason: mode === "adjustments" ? userReason : userReason || "Customer invoice payment",
    returns: mode === "adjustments" ? order.items.flatMap((line, index) => {
      const entry = returns[line.lineId || `legacy-${index}`];
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
