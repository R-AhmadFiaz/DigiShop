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
import { useAuth } from '../auth/AuthContext';
function CustomerBalances({ customer }) {
  const result = useLoad('/accounts/customers/' + customer._id + '/reconciliation');
  return <><Notice loading={result.loading} error={result.error}/>{result.data && <><p>Outstanding debt: PKR {money(result.data.debtMinor / 100)}</p><p>Available store credit: PKR {money(result.data.storeCreditMinor / 100)}</p><p className={result.data.reconciled?'text-success':'text-warning'}>{result.data.reconciled?'Balances match the recorded invoices and customer history.':'Balances need review. No financial records have been changed.'}</p></>}</>;
}
export default function Customers() {
  const {user} = useAuth();
  const [selected,setSelected] = useState(null);
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
                  {user.role==='OWNER' && <th/>}
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
                    {user.role==='OWNER' && <td><button className="btn btn-outline-secondary btn-sm" onClick={()=>setSelected(c)}>Balance details</button></td>}
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
      {selected && <Modal title={selected.name + ' — balances'} onClose={()=>setSelected(null)}><CustomerBalances customer={selected}/></Modal>}
    </>
  );
}
