import { useId, useRef, useState } from "react";
import { query } from "../api/client";
import { useDebounce, useLoad } from "../api/hooks";
import { Pagination } from "./Common";

// Searchable, server-paged customer filter. Replaces dropdowns that could only
// list the first 100 customers, so every customer in the shop can be chosen.
export default function CustomerFilter({ value, label = "Customer", selectedName, onChange }) {
  const id = useId(),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(0),
    input = useRef(null);
  const term = useDebounce(search.trim());
  const customers = useLoad("/customers/" + query({ search: term, page, limit: 10 }), open);
  const rows = customers.data?.customers ?? [];
  function choose(customer) {
    onChange(customer ? customer._id : "", customer);
    setOpen(false);
    setSearch("");
    setPage(1);
    input.current?.focus();
  }
  function keys(event) {
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); return; }
    if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); return; }
    if (event.key === "Enter") { if (rows[active]) choose(rows[active]); return; }
    setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))));
  }
  return (
    <div className="customer-filter position-relative" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <label className="form-label d-block mb-0" htmlFor={id}>{label}</label>
      <div className="d-flex gap-2">
        <input
          ref={input}
          id={id}
          className="form-control"
          role="combobox"
          aria-expanded={open}
          aria-controls={id + "-list"}
          aria-autocomplete="list"
          aria-activedescendant={open && rows[active] ? id + "-" + rows[active]._id : undefined}
          placeholder={value ? selectedName || "Selected customer" : "All customers — type name or phone"}
          maxLength={100}
          value={search}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setSearch(event.target.value); setPage(1); setActive(0); setOpen(true); }}
          onKeyDown={keys}
        />
        {value && (
          <button type="button" className="btn btn-outline-secondary btn-sm text-nowrap" onClick={() => choose(null)}>
            All customers
          </button>
        )}
      </div>
      {value && <small className="d-block text-body-secondary mt-1">Showing: {selectedName || "selected customer"}</small>}
      {open && (
        <div className="customer-filter-results border rounded bg-body p-2 mt-1" onMouseDown={(event) => event.preventDefault()}>
          {customers.loading && <p className="small text-body-secondary mb-1" role="status">Loading customers…</p>}
          {customers.error && <p className="small text-danger mb-1" role="alert">{customers.error}</p>}
          <ul id={id + "-list"} role="listbox" aria-label={label + " results"} className="list-unstyled mb-0">
            {rows.map((customer, index) => (
              <li key={customer._id} id={id + "-" + customer._id} role="option" aria-selected={index === active}>
                <button type="button" tabIndex={-1} className={"btn btn-sm w-100 text-start " + (index === active ? "btn-primary" : "btn-outline-secondary")} onClick={() => choose(customer)}>
                  {customer.name} · {customer.phoneNo}
                </button>
              </li>
            ))}
          </ul>
          {!customers.loading && customers.data && !rows.length && <p className="small mb-1">No customers match.</p>}
          <Pagination label="Customer results" pagination={customers.data?.pagination} rows={rows.length} onPage={setPage} />
          <button type="button" className="btn btn-link btn-sm px-0" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  );
}
