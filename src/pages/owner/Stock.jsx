import { useState } from "react";
import { api, query } from "../../api/client";
import { useLoad } from "../../api/hooks";
import {
  dateText,
  Empty,
  Field,
  Modal,
  Notice,
  PageTitle,
  Pagination,
} from "../../components/Common";
export default function Stock() {
  const products = useLoad("/products/search-product"),
    [tab, setTab] = useState("overview"),
    [search, setSearch] = useState(""),
    [lowOnly, setLowOnly] = useState(false),
    [adjusting, setAdjusting] = useState(null),
    [success, setSuccess] = useState("");
  const all = products.data?.product || [],
    filtered = all.filter(
      (p) =>
        (!lowOnly || p.stockQuantity <= p.minStockThreshold) &&
        (p.name + " " + p.brand).toLowerCase().includes(search.toLowerCase()),
    );
  return (
    <>
      <PageTitle title="Stock" />
      <div className="screen-tabs no-print">
        <button
          className={tab === "overview" ? "active" : ""}
          onClick={() => setTab("overview")}
        >
          Stock levels
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          Stock history
        </button>
      </div>
      <Notice success={success} />
      {tab === "overview" ? (
        <>
          <div className="d-flex flex-wrap gap-3 align-items-center mb-3">
            <input
              className="form-control search-input"
              aria-label="Search stock"
              placeholder="Product or brand"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="form-check-label">
              <input
                className="form-check-input me-2"
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
              />
              Low stock only
            </label>
            <button
              className="btn btn-outline-secondary btn-sm"
              disabled={products.loading}
              onClick={products.reload}
            >
              Refresh
            </button>
          </div>
          <section className="panel">
            <Notice error={products.error} loading={products.loading} />
            {filtered.length > 0 ? (
              <div className="table-responsive">
                <table className="table table-sm align-middle">
                  <thead>
                    <tr>
                      <th>Product / brand</th>
                      <th>Stock</th>
                      <th>Low stock at</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p._id}>
                        <td>
                          {p.name}
                          <small className="d-block text-body-secondary">
                            {p.brand}
                          </small>
                        </td>
                        <td>
                          {p.stockQuantity} {p.unit}
                        </td>
                        <td>{p.minStockThreshold}</td>
                        <td>
                          {p.stockQuantity <= p.minStockThreshold ? (
                            <span className="text-warning">Low stock</span>
                          ) : (
                            "In stock"
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setAdjusting(p)}
                          >
                            Adjust
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              !products.loading &&
              !products.error && <Empty>No matching stock.</Empty>
            )}
          </section>
        </>
      ) : (
        <StockHistory products={all} />
      )}
      {adjusting && (
        <Adjustment
          product={adjusting}
          onClose={() => setAdjusting(null)}
          onSaved={() => {
            setAdjusting(null);
            products.reload();
            setSuccess("Stock adjusted and recorded.");
          }}
        />
      )}
    </>
  );
}
function Adjustment({ product, onClose, onSaved }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget)),
      delta = Number(values.quantityDelta);
    if (
      !Number.isFinite(delta) ||
      delta === 0 ||
      product.stockQuantity + delta < 0
    ) {
      setError("Enter a nonzero change that leaves stock at zero or greater.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/products/" + product._id + "/adjust-stock", {
        method: "PATCH",
        body: { quantityDelta: delta, reason: values.reason.trim() },
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={"Adjust " + product.name} onClose={onClose} busy={busy}>
      <p>
        Current stock: {product.stockQuantity} {product.unit}
      </p>
      <Notice error={error} />
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <Field
            label="Quantity change"
            hint="Positive to add stock; negative to remove stock."
          >
            <input
              className="form-control"
              name="quantityDelta"
              type="number"
              step="any"
              required
            />
          </Field>
          <Field label="Reason">
            <input
              className="form-control"
              name="reason"
              required
              maxLength={200}
              placeholder="Received delivery, damaged goods..."
            />
          </Field>
          <button className="btn btn-primary" type="submit">
            {busy ? "Saving..." : "Save adjustment"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
function StockHistory({ products }) {
  const [filters, setFilters] = useState({}),
    [page, setPage] = useState(1),
    [filterError, setFilterError] = useState("");
  const logs = useLoad(
    "/orders/stocklogs" + query({ ...filters, page, limit: 20 }),
  );
  function filter(e) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    setFilterError("");
    if (
      values.startDate &&
      values.endDate &&
      values.startDate > values.endDate
    ) {
      setFilterError("The end date must be on or after the start date.");
      return;
    }
    if (values.startDate)
      values.startDate = new Date(values.startDate + "T00:00:00").toISOString();
    if (values.endDate)
      values.endDate = new Date(values.endDate + "T23:59:59.999").toISOString();
    setPage(1);
    setFilters(values);
  }
  return (
    <section className="panel">
      <form className="row g-2 mb-3 align-items-end" onSubmit={filter}>
        <div className="col-md-4">
          <Field label="Product">
            <select name="productId" className="form-select">
              <option value="">All products</option>
              {products.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} | {p.brand}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="col-md-3">
          <Field label="From">
            <input name="startDate" type="date" className="form-control" />
          </Field>
        </div>
        <div className="col-md-3">
          <Field label="To">
            <input name="endDate" type="date" className="form-control" />
          </Field>
        </div>
        <div className="col-md-2">
          <button
            className="btn btn-outline-secondary mb-2"
            disabled={logs.loading}
            type="submit"
          >
            Filter
          </button>
        </div>
      </form>
      <Notice error={filterError || logs.error} loading={logs.loading} />
      {logs.data?.logs.length > 0 ? (
        <div className="table-responsive">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Product</th>
                <th>Change</th>
                <th>Reason</th>
                <th>Invoice</th>
              </tr>
            </thead>
            <tbody>
              {logs.data.logs.map((log) => (
                <tr key={log._id}>
                  <td>{dateText(log.createdAt)}</td>
                  <td>
                    {log.productId?.name || "Product unavailable"}
                    <small className="d-block text-body-secondary">
                      {log.productId?.brand}
                    </small>
                  </td>
                  <td
                    className={
                      log.quantityDelta > 0
                        ? "text-success"
                        : "text-body-secondary"
                    }
                  >
                    {log.quantityDelta > 0 ? "+" : ""}
                    {log.quantityDelta}
                  </td>
                  <td>
                    {log.reason === "Ordered Created"
                      ? "Sale"
                      : log.reason === "Order Sold"
                        ? "Quotation sale"
                        : log.reason === "Order get cancelled"
                          ? "Cancelled sale"
                          : log.reason}
                  </td>
                  <td>{log.invoiceNo || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !logs.loading && !logs.error && <Empty>No stock history found.</Empty>
      )}
      <Pagination pagination={logs.data?.pagination} onPage={setPage} />
    </section>
  );
}
