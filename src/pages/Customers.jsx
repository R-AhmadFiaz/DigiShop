import { useState } from "react";
import { query } from "../api/client";
import { useDebounce, useLoad } from "../api/hooks";
import {
  Empty,
  Modal,
  money,
  Notice,
  PageTitle,
  Pagination,
} from "../components/Common";
import { CustomerForm } from "../components/CustomerPicker";
export default function Customers() {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [success, setSuccess] = useState(""),
    [saving, setSaving] = useState(false);
  const term = useDebounce(search),
    customers = useLoad(
      "/customers/" + query({ search: term, page, limit: 20 }),
    );
  return (
    <>
      <PageTitle title="Customers">
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setCreating(true)}
        >
          Add customer
        </button>
      </PageTitle>
      <Notice success={success} />
      <input
        className="form-control search-input mb-3"
        aria-label="Search customer by name or phone"
        placeholder="Customer name or phone"
        maxLength={100}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <section className="panel">
        <Notice error={customers.error} loading={customers.loading} />
        {customers.data?.customers.length > 0 ? (
          <div className="table-responsive">
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th className="text-end">Outstanding debt</th>
                  <th className="text-end">Store credit</th>
                </tr>
              </thead>
              <tbody>
                {customers.data.customers.map((c) => (
                  <tr key={c._id}>
                    <td>{c.name}</td>
                    <td>{c.phoneNo}</td>
                    <td>{c.address || "-"}</td>
                    <td className="text-end">{money(c.remainingMoney)}</td>
                    <td className="text-end">{money((c.storeCreditBalanceMinor ?? 0) / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !customers.loading &&
          !customers.error && <Empty>No customers found.</Empty>
        )}
        <Pagination pagination={customers.data?.pagination} onPage={setPage} />
      </section>
      {creating && (
        <Modal
          title="Add customer"
          busy={saving}
          onClose={() => setCreating(false)}
        >
          <CustomerForm
            onBusy={setSaving}
            onCancel={() => setCreating(false)}
            onSaved={(customer) => {
              setCreating(false);
              setSuccess(customer.name + " added.");
              customers.reload();
            }}
          />
        </Modal>
      )}
    </>
  );
}
