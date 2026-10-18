import { displayName } from "../utils/identity";
import { useAuth } from "../auth/AuthContext";
import { dateText, money } from "./Common";
export function receiptFrom(order, products = [], customer = null) {
  return {
    ...order,
    customer:
      customer ||
      (typeof order.customerId === "object" ? order.customerId : null),
    lines: order.items.map((item) => {
      const product =
        typeof item.productId === "object"
          ? item.productId
          : products.find((p) => p._id === item.productId);
      return {
        ...item,
        name: item.name || product?.name || "Product unavailable",
        brand: item.brand ?? product?.brand ?? "",
        unit: item.unit ?? product?.unit ?? "",
      };
    }),
  };
}
export default function Receipt({ receipt, documentTitle, children }) {
  const user = useAuth()?.user;
  return (
    <section
      className="receipt"
      aria-label={
        receipt.type === "QUOTATION" ? "Quotation" : "Invoice receipt"
      }
    >
      {user?.shopName && (
        <div className="receipt-shop">
          <h2>{user.shopName}</h2>
          {user.shopAddress && <p>{user.shopAddress}</p>}
          {user.shopContactNo && <p>Phone: {user.shopContactNo}</p>}
        </div>
      )}
      <div className="receipt-heading">
        {documentTitle && <p><strong>{documentTitle}</strong></p>}
        <h2 className="h5">
          {receipt.type === "QUOTATION"
            ? receipt.invoiceNo || "Quotation"
            : receipt.invoiceNo || "Invoice"}
        </h2>
        <p>
          {dateText(receipt.createdAt)} |{" "}
          {receipt.saleType === "WHOLESALE" ? "Wholesale" : "Retail"}
        </p>
        <p>
          {receipt.type === "QUOTATION" ? "Created by" : "Sold by"}:{" "}
          {displayName(receipt.createdByName || "") || "Unavailable"}
        </p>
        {receipt.status && <p>Status: {receipt.status.toLowerCase()}</p>}
        {receipt.revision > 0 && <p>Revision: {receipt.revision}{receipt.returnState === "FULL" ? " · Fully returned" : receipt.returnState === "PARTIAL" ? " · Partially returned" : ""}</p>}
        {receipt.customer && (
          <p>
            Customer: {receipt.customer.name}{" "}
            {receipt.customer.phoneNo && " | " + receipt.customer.phoneNo}
          </p>
        )}
      </div>
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Product</th>
            <th className="text-end">Qty</th>
            <th className="text-end">Price</th>
            <th className="text-end">Total</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr key={index}>
              <td>
                {line.name}
                <small className="d-block text-body-secondary">
                  {line.brand}
                </small>
              </td>
              <td className="text-end">
                {line.quantity} {line.unit}
              </td>
              <td className="text-end">{money(line.unitPrice)}</td>
              <td className="text-end">
                {money(line.quantity * line.unitPrice)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="receipt-totals">
        <dt>Subtotal</dt>
        <dd>{money(receipt.subtotal)}</dd>
        <dt>Discount</dt>
        <dd>{money(receipt.discountAmount)}</dd>
        <dt>Total</dt>
        <dd>
          <strong>{money(receipt.totalPrice)}</strong>
        </dd>
        {receipt.type !== "QUOTATION" && (
          <>
            <dt>{receipt.settlementState || receipt.revision > 0 ? "Net amount settled" : "Amount paid"}</dt>
            <dd>{money(receipt.paidAmount)}</dd>
            <dt>
              {receipt.status === "CANCELLED" && receipt.cancellationMode !== "SETTLED"
                ? "Original amount due"
                : "Amount due"}
            </dt>
            <dd>{money(receipt.amountDue)}</dd>
            {receipt.settlementState && <>
              <dt>Net cash settlement</dt><dd>{money(receipt.settlementState.cashNetMinor / 100)}</dd>
              <dt>Net store-credit settlement</dt><dd>{money(receipt.settlementState.creditNetMinor / 100)}</dd>
            </>}
          </>
        )}
      </dl>
      {children}
      <button
        className="btn btn-outline-secondary no-print"
        onClick={() => window.print()}
      >
        Print {receipt.type === "QUOTATION" ? "quotation" : "receipt"}
      </button>
    </section>
  );
}
