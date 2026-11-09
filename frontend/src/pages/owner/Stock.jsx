import RecordTable, {RecordFacts} from '../../components/RecordTable';
import { activity } from '../../api/purchases';
import { useState } from "react";
import { api, query } from "../../api/client";
import { useLoad } from "../../api/hooks";
import {usePagedProducts,useProductSearch} from '../../api/productSearch';
import {usePageParam,useQueryParam} from '../../api/paging';
import ProductFilters from '../../components/ProductFilters';
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
  const [tabParam, setTabParam] = useQueryParam("tab", "overview"),
    tab = tabParam === "history" ? "history" : "overview",
    setTab = (value) => setTabParam(value),
    [search, setSearch] = useQueryParam("search"),
    [category, setCategory] = useQueryParam("category"),
    [brand, setBrand] = useQueryParam("brand"),
    [low, setLow] = useQueryParam("low"),
    lowOnly = low === "1",
    [page, setPage] = usePageParam(),
    [adjusting, setAdjusting] = useState(null),
    [success, setSuccess] = useState("");
  const products = usePagedProducts({search,category,brand,lowStock:lowOnly,page}),
    categories = useLoad("/categories/");
  const filtered = products.data?.product || [];
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
          <ProductFilters search={search} onSearch={value=>setSearch(value,["page"])} category={category} onCategory={value=>setCategory(value,["page","brand"])} brand={brand} onBrand={value=>setBrand(value,["page"])} categories={categories.data?.categories} brands={products.brands} searchLabel="Search stock" categoryLabel="Stock category filter" brandLabel="Stock brand filter">
            <label className="form-check-label">
              <input
                className="form-check-input me-2"
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => setLow(e.target.checked ? "1" : "", ["page"])}
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
          </ProductFilters>
          <section className="panel fill-panel">
            <Notice error={categories.error} />
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
                            Change stock
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
            <Pagination label="Stock levels" pagination={products.data?.pagination} rows={filtered.length} onPage={setPage} />
          </section>
        </>
      ) : (
        <StockHistory />
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
    <Modal title={"Change stock: " + product.name} onClose={onClose} busy={busy}>
      <p>
        Current stock: {product.stockQuantity} {product.unit}
      </p>
      <Notice error={error} />
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <Field
            label="Quantity to add or remove"
            hint="For example: 5 adds five; -5 removes five."
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
            {busy ? "Saving..." : "Save stock change"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
function StockHistory() {
  // The product filter needs every product; it is loaded only when this tab is open.
  const products = useProductSearch().data?.product || [];
  const [productId, setProductId] = useQueryParam("product"),
    [from, setFrom] = useQueryParam("from"),
    [to, setTo] = useQueryParam("to"),
    [page, setPage] = usePageParam("historyPage"),
    [filterError, setFilterError] = useState("");
  const filters = {
    productId,
    startDate: from ? new Date(from + "T00:00:00").toISOString() : "",
    endDate: to ? new Date(to + "T23:59:59.999").toISOString() : "",
  };
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
    setProductId(values.productId, ["historyPage"]);
    setFrom(values.startDate);
    setTo(values.endDate);
  }
  return (
    <section className="panel fill-panel">
      <form key={productId + from + to + products.length} className="row g-2 mb-3 align-items-end" onSubmit={filter}>
        <div className="col-md-4">
          <Field label="Product">
            <select name="productId" className="form-select" defaultValue={productId}>
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
            <input name="startDate" type="date" className="form-control" defaultValue={from} />
          </Field>
        </div>
        <div className="col-md-3">
          <Field label="To">
            <input name="endDate" type="date" className="form-control" defaultValue={to} />
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
      {logs.data&&<RecordTable label="Stock movement register" rows={logs.data.logs} columns={[
 {key:'date',label:'Date',render:l=>dateText(l.createdAt)},
 {key:'product',label:'Product',render:l=><>{l.productId?.name||'Product unavailable'}<small className="d-block text-body-secondary">{l.productId?.brand}</small></>},
 {key:'added',label:'Stock added (+)',numeric:true,render:l=>Number.isFinite(l.quantityDelta)?l.quantityDelta>0?'+'+l.quantityDelta:'—':'Unavailable'},
 {key:'removed',label:'Stock reduced (−)',numeric:true,render:l=>Number.isFinite(l.quantityDelta)?l.quantityDelta<0?l.quantityDelta:'—':'Unavailable'},
 {key:'action',label:'Action',render:l=>activity(l.reason)},
 {key:'invoice',label:'Reference',render:l=>l.reference||l.invoiceNo||'—'}
 ]} details={l=><RecordFacts items={[["Reason",l.reason],["Stock change",l.quantityDelta],["Purchase",l.purchaseReference||'—'],["Delivery",l.receivingReference||'—'],["Return handling",l.disposition||'—'],["Returned units",l.returnedQuantity??'Unavailable']]}/>} empty="No stock history found."/>}
      <Pagination label="Stock history" pagination={logs.data?.pagination} rows={logs.data?.logs?.length} onPage={setPage} />
    </section>
  );
}
