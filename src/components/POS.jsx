import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api, query } from "../api/client";
import { useDebounce, useLoad } from "../api/hooks";
import { literalSearch, salePayment, saleTotals, validateSale } from "../api/sale";
import { Empty, Field, money, Notice } from "./Common";
import CustomerPicker from "./CustomerPicker";
import Receipt, { receiptFrom } from "./Receipt";
export default function POS({ quotation = false, onConvertQuotation }) {
  const { setQuotations, drafts } = useOutletContext();
  const draftKey = quotation ? "quotation" : "sale";
  const savedDraft = drafts.current[draftKey] || {};
  const [search, setSearch] = useState(savedDraft.search ?? ""),
    [cart, setCart] = useState(savedDraft.cart ?? []),
    [saleType, setSaleType] = useState(savedDraft.saleType ?? "RETAIL"),
    [discountType, setDiscountType] = useState(
      savedDraft.discountType ?? "NONE",
    ),
    [discountValue, setDiscountValue] = useState(
      savedDraft.discountValue ?? "0",
    ),
    [paid, setPaid] = useState(savedDraft.paid ?? null),
    [customer, setCustomer] = useState(savedDraft.customer ?? null),
    [busy, setBusy] = useState(false),
    [customerBusy, setCustomerBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(savedDraft.receipt ?? null);
  const lock = useRef(false),
    term = useDebounce(search);
  const products = useLoad(
    "/products/search-product" + query({ search: literalSearch(term) }),
  );
  const totals = saleTotals(cart, saleType, discountType, discountValue),
    payment = salePayment(paid, totals.total),
    paidAmount = payment.amount,
    due = Number.isFinite(paidAmount)
      ? Math.max(0, totals.total - paidAmount)
      : 0;
  useEffect(() => {
    if (!cart.length) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [cart.length]);
  useEffect(() => {
    drafts.current[draftKey] = {
      search,
      cart,
      saleType,
      discountType,
      discountValue,
      paid,
      customer,
      receipt,
    };
  }, [
    drafts,
    draftKey,
    search,
    cart,
    saleType,
    discountType,
    discountValue,
    paid,
    customer,
    receipt,
  ]);
  function add(product) {
    // Keep only counter fields in the cart, even if a response contains extra data.
    const {
      _id,
      name,
      brand,
      unit,
      stockQuantity,
      retailPrice,
      wholesalePrice,
    } = product;
    const counterProduct = {
      _id,
      name,
      brand,
      unit,
      stockQuantity,
      retailPrice,
      wholesalePrice,
    };
    setError("");
    setCart((current) => {
      const existing = current.find((p) => p._id === product._id);
      return existing
        ? current.map((p) =>
            p._id === product._id
              ? { ...p, quantity: Number(p.quantity) + 1 }
              : p,
          )
        : [...current, { ...counterProduct, quantity: 1 }];
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (lock.current || customerBusy) return;
    setError("");
    const validation = validateSale(
      cart,
      saleType,
      discountType,
      discountValue,
      paidAmount,
      customer,
      quotation,
    );
    if (validation) {
      setError(validation);
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const body = {
        items: cart.map((line) => ({
          productId: line._id,
          quantity: Number(line.quantity),
        })),
        saleType,
        discountType,
        discountValue: discountType === "NONE" ? 0 : Number(discountValue),
        ...(!quotation
          ? { paidAmount, ...(customer ? { customerId: customer._id } : {}) }
          : {}),
      };
      const result = await api(
        quotation ? "/orders/quotation" : "/orders/create-order",
        { method: "POST", body },
      );
      const order = quotation ? result.quotation : result;
      const saved = receiptFrom(order, cart, quotation ? null : customer);
      if (quotation)
        setQuotations((current) => [
          ...current,
          {
            order,
            receipt: saved,
            products: cart.map(({ _id, name, brand, unit }) => ({
              _id,
              name,
              brand,
              unit,
            })),
            converted: false,
          },
        ]);
      setReceipt(saved);
      setCart([]);
      setPaid(null);
      setCustomer(null);
      setDiscountType("NONE");
      setDiscountValue("0");
      products.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (receipt)
    return (
      <>
        <div className="alert alert-success no-print" role="status">
          {quotation ? "Quotation saved for this session." : "Sale completed."}
        </div>
        <Receipt receipt={receipt} />
        {quotation && onConvertQuotation && (
          <button
            className="btn btn-primary mt-3 me-2 no-print"
            onClick={() => {
              onConvertQuotation(receipt._id);
              setReceipt(null);
            }}
          >
            Make sale
          </button>
        )}
        <button
          className="btn btn-primary mt-3 no-print"
          onClick={() => {
            setReceipt(null);
            setSearch("");
          }}
        >
          {quotation ? "New quotation" : "Next sale"}
        </button>
      </>
    );
  return (
    <div className="pos-grid">
      <section className="panel">
        <h2 className="h6">Find a product</h2>
        <input
          className="form-control mb-3"
          aria-label="Search products by name or brand"
          placeholder="Search name or brand"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              search === term &&
              !products.loading &&
              products.data?.product[0] &&
              !busy
            ) {
              e.preventDefault();
              const p = products.data.product[0];
              if (
                (quotation || p.stockQuantity >= 1) &&
                (saleType !== "WHOLESALE" || p.wholesalePrice)
              )
                add(p);
            }
          }}
        />
        <Notice error={products.error} loading={products.loading} />
        <div className="product-results">
          {products.data?.product.map((product) => {
            const price =
              saleType === "WHOLESALE"
                ? product.wholesalePrice
                : product.retailPrice;
            return (
              <button
                type="button"
                className="product-result"
                key={product._id}
                disabled={
                  busy ||
                  search !== term ||
                  (!quotation && product.stockQuantity < 1) ||
                  (saleType === "WHOLESALE" && !product.wholesalePrice)
                }
                onClick={() => add(product)}
              >
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {product.brand} | {product.unit} | Stock{" "}
                    {product.stockQuantity}
                  </small>
                </span>
                <span className="text-end">
                  {saleType === "WHOLESALE" && !price
                    ? "No wholesale price"
                    : money(price)}
                  <small>Add</small>
                </span>
              </button>
            );
          })}
          {products.data?.product.length === 0 && (
            <Empty>No matching products.</Empty>
          )}
        </div>
      </section>
      <section className="panel">
        <form id="sale-form" onSubmit={submit}>
          <fieldset disabled={busy}>
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h2 className="h6 mb-0">
                {quotation ? "Quotation" : "Current sale"}
              </h2>
              <select
                className="form-select w-auto"
                aria-label="Sale type"
                value={saleType}
                onChange={(e) => setSaleType(e.target.value)}
              >
                <option value="RETAIL">Retail</option>
                <option value="WHOLESALE">Wholesale</option>
              </select>
            </div>
            <Notice error={error} />
            <div className="table-responsive">
              <table className="table table-sm cart-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Qty</th>
                    <th className="text-end">Price</th>
                    <th className="text-end">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((line) => {
                    const price =
                      saleType === "WHOLESALE"
                        ? line.wholesalePrice
                        : line.retailPrice;
                    return (
                      <tr key={line._id}>
                        <td>
                          {line.name}
                          <small className="d-block text-body-secondary">
                            {line.brand}
                          </small>
                        </td>
                        <td>
                          <input
                            className="form-control form-control-sm quantity"
                            aria-label={"Quantity for " + line.name}
                            type="number"
                            min="1"
                            step="1"
                            max={quotation ? undefined : line.stockQuantity}
                            value={line.quantity}
                            onChange={(e) =>
                              setCart((current) =>
                                current.map((p) =>
                                  p._id === line._id
                                    ? { ...p, quantity: e.target.value }
                                    : p,
                                ),
                              )
                            }
                          />
                        </td>
                        <td className="text-end">{money(price)}</td>
                        <td className="text-end">
                          {money(Number(line.quantity) * Number(price))}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            aria-label={"Remove " + line.name}
                            onClick={() =>
                              setCart((current) =>
                                current.filter((p) => p._id !== line._id),
                              )
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!cart.length && <Empty>Search a product to start.</Empty>}
            <div className="row g-2 mt-2">
              <div className={discountType === "NONE" ? "col-12" : "col-7"}>
                <Field label="Discount">
                  <select
                    className="form-select"
                    value={discountType}
                    onChange={(e) => {
                      setDiscountType(e.target.value);
                      setDiscountValue("0");
                    }}
                  >
                    <option value="NONE">No discount</option>
                    <option value="FIXED">Fixed amount</option>
                    <option value="PERCENTAGE">Percentage</option>
                  </select>
                </Field>
              </div>
              {discountType !== "NONE" && (
                <div className="col-5">
                  <Field
                    label={discountType === "PERCENTAGE" ? "Percent" : "Amount"}
                  >
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      step="any"
                      max={
                        discountType === "PERCENTAGE" ? 100 : totals.subtotal
                      }
                      disabled={discountType === "NONE" || busy}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>
            <div className="sale-total">
              <span>Total</span>
              <strong>{money(totals.total)}</strong>
            </div>
            {!quotation && (
              <>
                <Field
                  label="Amount paid"
                  hint="Enter a smaller amount for a credit sale."
                >
                  <input
                    className="form-control"
                    type="number"
                    step="any"
                    min="0"
                    max={totals.total}
                    value={payment.value}
                    onChange={(e) => setPaid(e.target.value)}
                  />
                </Field>
                <div className="d-flex justify-content-between mb-3">
                  <span>Amount due</span>
                  <strong className={due > 0 ? "text-warning" : ""}>
                    {money(due)}
                  </strong>
                </div>
              </>
            )}
          </fieldset>
        </form>
        <fieldset disabled={busy}>
          {!quotation && (
            <div className="mb-3">
              <p className="small mb-2">
                {due > 0
                  ? "Customer required for credit sale"
                  : "Customer (optional)"}
              </p>
              <CustomerPicker
                value={customer}
                onChange={setCustomer}
                required={due > 0}
                onBusy={setCustomerBusy}
              />
            </div>
          )}
          <button
            className="btn btn-primary w-100"
            type="submit"
            form="sale-form"
            disabled={busy || customerBusy || !cart.length}
          >
            {busy
              ? "Saving..."
              : quotation
                ? "Create quotation"
                : "Complete sale"}
          </button>
        </fieldset>
      </section>
    </div>
  );
}
