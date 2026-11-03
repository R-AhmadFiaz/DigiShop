export function invoiceCustomerDisplayName(order) {
  return order?.customerDisplayName ?? order?.customerId?.name ?? "";
}
