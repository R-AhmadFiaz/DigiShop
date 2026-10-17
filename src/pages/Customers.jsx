import RecordTable from '../components/RecordTable';
import { useState } from "react";
import { Link } from 'react-router-dom';
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
  return <><Notice loading={result.loading} error={result.error}/>{result.data && <><p className="record-balance">Outstanding debt: PKR {money(result.data.debtMinor / 100)}</p><p className="record-balance">Available store credit: PKR {money(result.data.storeCreditMinor / 100)}</p><p className={result.data.reconciled?'text-success':'text-warning'}>{result.data.reconciled?'Balances match the recorded invoices and customer history.':'Balances need review. No financial records have been changed.'}</p>{!result.data.reconciled&&<><p>Review the original invoices, payments and credit records before confirming any opening. Do not enter these balances again as a new sale or investment.</p><ul>{result.data.issues?.map((issue,i)=><li key={i}>{issue.code.replaceAll('_',' ').toLowerCase()}</li>)}</ul><p>Unverified historical balances remain blocked. No automatic repair or duplicate opening is permitted.</p></>}</>}</>;
}
function CustomerInvoices({customer}) {
  const [page,setPage]=useState(1);
  const invoices=useLoad('/orders/'+query({customerId:customer._id,page,limit:10}));
  return <section className="mt-3"><h3 className="h6">Invoices and payments</h3><p className="small text-body-secondary">Choose an unpaid invoice to receive money. Each payment reduces that invoice and this customer debt; it is not a new sale.</p><Notice loading={invoices.loading} error={invoices.error}/>
    {invoices.data&&<><RecordTable label="Customer invoice register" rows={invoices.data.orders} columns={[
 {key:'date',label:'Date',render:o=>o.createdAt?new Date(o.createdAt).toLocaleString('en-PK',{timeZone:'Asia/Karachi'}):'Unavailable'},
 {key:'invoiceNo',label:'Invoice'}, {key:'total',label:'Bill total',numeric:true,render:o=>money(o.totalPrice)},
 {key:'settled',label:'Paid / settled',numeric:true,render:o=>money(o.paidAmount)},
 {key:'due',label:'Customer owes',numeric:true,render:o=>money(o.amountDue)},
 {key:'open',label:'Payment',render:order=><Link className="btn btn-sm btn-outline-primary" to={'/owner/sales/'+order._id}>{order.amountDue>0&&order.status!=='CANCELLED'?'Receive Payment':'View invoice'}</Link>}
 ]} empty="No linked invoices found. Any unmatched historical debt needs review; do not create a new sale to collect it."/><Pagination pagination={invoices.data.pagination} onPage={setPage}/></>}
  </section>;
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
        {customers.data&&<RecordTable label="Customer Khata accounts" rows={customers.data.customers} columns={[
 {key:'name',label:'Name'},{key:'phoneNo',label:'Phone'},{key:'address',label:'Address',render:c=>c.address||'—'},
 {key:'debt',label:'Customer owes us',numeric:true,render:c=>money(c.remainingMoney)},
 {key:'credit',label:'Store credit',numeric:true,render:c=>money((c.storeCreditBalanceMinor??0)/100)}
 ]} onOpen={user.role==='OWNER'?setSelected:undefined} detailLabel={c=>c.remainingMoney>0?'Receive Payment':'Balance details'} empty="No customers found."/>}
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
      {selected && <Modal title={selected.name + ' — balances'} onClose={()=>setSelected(null)}><CustomerBalances customer={selected}/><CustomerInvoices customer={selected}/></Modal>}
    </>
  );
}
