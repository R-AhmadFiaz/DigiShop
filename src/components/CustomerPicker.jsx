import { useState } from "react";
import { api, query } from "../api/client";
import { useDebounce, useLoad } from "../api/hooks";
import { Empty, Field, money, Notice, Pagination } from "./Common";
export function CustomerForm({ onSaved, onCancel, onBusy }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    event.stopPropagation();
    const form = event.currentTarget;
    setBusy(true);
    onBusy?.(true);
    setError("");
    try {
      const data = await api("/customers/create-customer", {
        method: "POST",
        body: Object.fromEntries(new FormData(form)),
      });
      onSaved(data.customer);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>
        <Notice error={error} />
        <Field label="Customer name">
          <input
            className="form-control"
            name="name"
            required
            maxLength={100}
          />
        </Field>
        <Field label="Phone number">
          <input
            className="form-control"
            name="phoneNo"
            type="tel"
            pattern="[0-9]{11}"
            maxLength={11}
            title="11 digits"
            required
          />
        </Field>
        <Field label="Address (Optional)">
          <input className="form-control" name="address" maxLength={200} />
        </Field>
        <div className="d-flex gap-2">
          <button className="btn btn-primary" type="submit">
            {busy ? "Saving..." : "Save customer"}
          </button>
          <button
            className="btn btn-outline-secondary"
            type="button"
            onClick={onCancel}
          >
            Back
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export default function CustomerPicker({
  value,
  onChange,
  required = false,
  expanded = false,
  onBusy,
}) {
  const [search, setSearch] = useState(""),
    [creating, setCreating] = useState(false),
    [page, setPage] = useState(1),
    [open, setOpen] = useState(false);
  const term = useDebounce(search);
  return (
    <div className="customer-picker">
      {value ? (
        <div className="d-flex justify-content-between align-items-center gap-2">
          <span>
            <strong>{value.name}</strong> | {value.phoneNo}
            <small className="d-block text-body-secondary">
              Outstanding debt: {money(value.remainingMoney)} · Store credit: {money((value.storeCreditBalanceMinor ?? 0) / 100)}
            </small>
          </span>
          <button
            className="btn btn-outline-secondary btn-sm"
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(true);
            }}
          >
            Change
          </button>
        </div>
      ) : !required && !expanded ? (
        <button
          className="btn btn-outline-secondary btn-sm"
          type="button"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide customers" : "Select customer"}
        </button>
      ) : null}
      {(open || required || expanded) && !value && (
        <div className="mt-2">
          {creating ? (
            <CustomerForm
              onBusy={onBusy}
              onCancel={() => setCreating(false)}
              onSaved={(customer) => {
                onChange(customer);
                setOpen(false);
                setCreating(false);
              }}
            />
          ) : (
            <>
              <div className="d-flex gap-2 mb-2">
                <input
                  className="form-control"
                  aria-label="Search customer by name or phone"
                  placeholder="Name or phone"
                  maxLength={100}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                />
                <button
                  className="btn btn-outline-secondary text-nowrap"
                  type="button"
                  onClick={() => setCreating(true)}
                >
                  New customer
                </button>
              </div>
              <CustomerResults
                term={term}
                page={page}
                setPage={setPage}
                onPick={(customer) => {
                  onChange(customer);
                  setOpen(false);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
function CustomerResults({ term, page, setPage, onPick }) {
  const { data, loading, error } = useLoad(
    "/customers/" + query({ search: term, page, limit: 5 }),
  );
  return (
    <>
      <Notice loading={loading} error={error} />
      {data?.customers.map((customer) => (
        <button
          key={customer._id}
          type="button"
          className="customer-result"
          onClick={() => onPick(customer)}
        >
          <span>
            {customer.name}
            <small>{customer.phoneNo}</small>
          </span>
          <span>Debt {money(customer.remainingMoney)}<small>Store credit {money((customer.storeCreditBalanceMinor ?? 0) / 100)}</small></span>
        </button>
      ))}
      {data?.customers.length === 0 && <Empty>No matching customers.</Empty>}
      <Pagination pagination={data?.pagination} onPage={setPage} />
    </>
  );
}
