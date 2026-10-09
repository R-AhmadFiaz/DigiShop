import { useState } from "react";
import { api, query } from "../../api/client";
import { useDebounce, useLoad } from "../../api/hooks";
import { literalSearch } from "../../api/sale";
import {
  Empty,
  Field,
  Modal,
  money,
  Notice,
  PageTitle,
} from "../../components/Common";
export default function Products() {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [editing, setEditing] = useState(null),
    [showCategories, setShowCategories] = useState(false),
    [success, setSuccess] = useState("");
  const term = useDebounce(search),
    products = useLoad(
      "/products/search-product" +
        query({ search: literalSearch(term), category }),
    ),
    categories = useLoad("/categories/");
  return (
    <>
      <PageTitle title="Products">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setEditing({})}
        >
          Add product
        </button>
      </PageTitle>
      <Notice success={success} />
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input
          className="form-control search-input"
          aria-label="Search products"
          placeholder="Product or brand"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="form-select w-auto"
          aria-label="Category filter"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.data?.categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={() => setShowCategories(!showCategories)}
        >
          {showCategories ? "Hide categories" : "Categories"}
        </button>
        <button
          className="btn btn-outline-secondary btn-sm"
          disabled={products.loading}
          onClick={products.reload}
        >
          Refresh
        </button>
      </div>
      <Notice error={categories.error} />
      {showCategories && (
        <CategoryManager
          categories={categories.data?.categories || []}
          onSaved={categories.reload}
        />
      )}
      <section className="panel">
        <Notice error={products.error} loading={products.loading} />
        {products.data?.product.length > 0 ? (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Product / brand</th>
                  <th>Category</th>
                  <th>Unit</th>
                  <th className="text-end">Stock</th>
                  <th className="text-end">Cost</th>
                  <th className="text-end">Retail</th>
                  <th className="text-end">Wholesale</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {products.data.product.map((p) => (
                  <tr key={p._id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small className="d-block text-body-secondary">
                        {p.brand}
                      </small>
                    </td>
                    <td>{p.category?.name || "-"}</td>
                    <td>{p.unit}</td>
                    <td className="text-end">{p.stockQuantity}</td>
                    <td className="text-end">{money(p.costPrice)}</td>
                    <td className="text-end">{money(p.retailPrice)}</td>
                    <td className="text-end">{money(p.wholesalePrice)}</td>
                    <td>
                      <button
                        className="btn btn-outline-secondary btn-sm"
                        onClick={() => setEditing(p)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !products.loading &&
          !products.error && (
            <Empty>No products found. Add your first product to start.</Empty>
          )
        )}
      </section>
      {editing && (
        <ProductForm
          product={editing}
          categories={categories.data?.categories || []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSuccess(editing._id ? "Product updated." : "Product created.");
            products.reload();
          }}
        />
      )}
    </>
  );
}
function CategoryManager({ categories, onSaved }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function submit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/categories/create-category", {
        method: "POST",
        body: Object.fromEntries(new FormData(form)),
      });
      form.reset();
      setSuccess("Category added.");
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel mb-3">
      <h2 className="h6">Categories</h2>
      <p className="text-body-secondary">
        {categories.map((c) => c.name).join(" | ") || "No categories yet."}
      </p>
      <Notice error={error} success={success} />
      <form className="d-flex gap-2 flex-wrap" onSubmit={submit}>
        <input
          name="name"
          className="form-control search-input"
          aria-label="New category name"
          placeholder="Category name"
          required
          maxLength={80}
          disabled={busy}
        />
        <input
          name="description"
          className="form-control search-input"
          aria-label="Category description"
          placeholder="Description (optional)"
          maxLength={200}
          disabled={busy}
        />
        <button
          type="submit"
          className="btn btn-outline-primary"
          disabled={busy}
        >
          {busy ? "Saving..." : "Add category"}
        </button>
      </form>
    </section>
  );
}
function ProductForm({ product, categories, onClose, onSaved }) {
  const edit = Boolean(product._id),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    for (const key of [
      "costPrice",
      "retailPrice",
      "wholesalePrice",
      "stockQuantity",
      "minStockThreshold",
    ])
      if (key in body) body[key] = Number(body[key]);
    if (
      Object.values(body).some(
        (v) => typeof v === "number" && (!Number.isFinite(v) || v < 0),
      )
    ) {
      setError("Prices and quantities must be zero or greater.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        edit ? "/products/" + product._id : "/products/create-product",
        { method: edit ? "PATCH" : "POST", body },
      );
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={edit ? "Edit " + product.name : "Add product"}
      onClose={onClose}
      busy={busy}
    >
      <Notice error={error} />
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <>
              <div className="row g-2">
                <div className="col-7">
                  <Field label="Product name">
                    <input
                      className="form-control"
                      name="name"
                      defaultValue={product.name ?? ""}
                      required
                      maxLength={120}
                    />
                  </Field>
                </div>
                <div className="col-5">
                  <Field label="Brand">
                    <input
                      className="form-control"
                      name="brand"
                      defaultValue={product.brand ?? ""}
                      required
                      maxLength={80}
                    />
                  </Field>
                </div>
              </div>
              <div className="row g-2">
                <div className="col-7">
                  <Field label="Category">
                    <select
                      className="form-select"
                      name="category"
                      required
                      defaultValue={product.category?._id ?? product.category ?? ""}
                    >
                      <option value="" disabled>
                        Select category
                      </option>
                      {categories.map((c) => (
                        <option key={c._id} value={c._id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {!categories.length && (
                    <p className="text-warning small">
                      Add a category in Products first.
                    </p>
                  )}
                </div>
                <div className="col-5">
                  <Field label="Unit">
                    <input
                      className="form-control"
                      list="shop-units"
                      name="unit"
                      defaultValue={product.unit ?? "pcs"}
                      required
                    />
                    <datalist id="shop-units">
                      <option value="pcs">Pieces</option>
                      <option value="box">Box</option>
                      <option value="meter">Meter</option>
                    </datalist>
                  </Field>
                </div>
              </div>
              <Field label="Description">
                <input
                  className="form-control"
                  name="description"
                  defaultValue={product.description ?? ""}
                  maxLength={300}
                />
              </Field>
          </>
          <div className="row g-2">
            {[
              ["costPrice", "Cost price"],
              ["retailPrice", "Retail price"],
              ["wholesalePrice", "Wholesale price"],
              ["minStockThreshold", "Low stock threshold"],
              ...(!edit ? [["stockQuantity", "Opening stock"]] : []),
            ].map(([name, label]) => (
              <div className="col-6" key={name}>
                <Field label={label}>
                  <input
                    className="form-control"
                    name={name}
                    type="number"
                    min="0"
                    step="any"
                    defaultValue={product[name] ?? 0}
                    required
                  />
                </Field>
              </div>
            ))}
          </div>
          {edit && (
            <p className="small text-body-secondary">
              Use Stock to adjust inventory with a reason.
            </p>
          )}
          <button
            className="btn btn-primary mt-2"
            type="submit"
            disabled={!edit && !categories.length}
          >
            {busy ? "Saving..." : "Save product"}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
