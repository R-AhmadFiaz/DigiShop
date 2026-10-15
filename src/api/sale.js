// null means untouched automatic payment; an empty string is a manual edit.
export function salePayment(paid, total) {
  const value = paid ?? total;
  return { value, amount: value === "" ? NaN : Number(value) };
}
export function saleTotals(cart, saleType, discountType, discountValue) {
  const subtotal = cart.reduce(
    (sum, line) =>
      sum +
      Number(
        saleType === "WHOLESALE" ? line.wholesalePrice : line.retailPrice,
      ) *
        Number(line.quantity),
    0,
  );
  const value = Number(discountValue === "" ? 0 : discountValue);
  const discount =
    discountType === "PERCENTAGE"
      ? (subtotal * value) / 100
      : discountType === "FIXED"
        ? value
        : 0;
  return { subtotal, discount, total: subtotal - discount };
}
export function validateSale(
  cart,
  saleType,
  discountType,
  discountValue,
  paidAmount,
  customer,
  quotation = false,
  creditAmount = 0,
) {
  if (!cart.length) return "Add at least one product.";
  if (
    cart.some(
      (line) =>
        !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1,
    )
  )
    return "Quantities must be whole numbers greater than zero.";
  if (
    !quotation &&
    cart.some((line) => Number(line.quantity) > line.stockQuantity)
  )
    return "A quantity is greater than the available stock.";
  if (
    saleType === "WHOLESALE" &&
    cart.some(
      (line) =>
        !Number.isFinite(Number(line.wholesalePrice)) ||
        Number(line.wholesalePrice) <= 0,
    )
  )
    return "A product has no wholesale price. Use retail or remove that product.";
  const { subtotal, total } = saleTotals(
      cart,
      saleType,
      discountType,
      discountValue,
    ),
    value = Number(discountValue === "" ? 0 : discountValue);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (discountType === "PERCENTAGE" && value > 100) ||
    (discountType === "FIXED" && value > subtotal)
  )
    return "Check the discount amount.";
  if (!Number.isFinite(total) || total < 0) return "Check the sale total.";
  if (!quotation && (!Number.isFinite(creditAmount) || creditAmount < 0 || creditAmount > total))
    return "Check the store-credit amount.";
  if (!quotation && creditAmount > 0 && !customer)
    return "Select a customer to use store credit.";
  if (
    !quotation &&
    (!Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount + creditAmount > total + (creditAmount > 0 ? 0.0000001 : 0))
  )
    return "Amount paid must be between zero and the sale total.";
  if (!quotation && total - paidAmount - creditAmount > (creditAmount > 0 ? 0.0000001 : 0) && !customer)
    return "Select or create a customer for this credit sale.";
  return "";
}
export const literalSearch = (value) =>
  value.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
