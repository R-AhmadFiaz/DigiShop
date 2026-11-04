import RecordTable from '../components/RecordTable';
import { useRef, useState } from "react";
import { Link } from 'react-router-dom';
import CustomerActivityDetails from '../components/CustomerActivityDetails';
import {formatBalanceChange,formatCustomerDate} from '../components/customerActivityFormat';
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
export function CustomerBalances({ customer }) {
  const result = useLoad('/accounts/customers/' + customer._id + '/reconciliation');
  return <><Notice loading={result.loading} error={result.error}/>{result.data && <><dl className="balance-strip"><div><dt>Customer owes us</dt><dd>PKR {money(result.data.debtMinor / 100)}</dd></div><div><dt>Store credit</dt><dd>PKR {money(result.data.storeCreditMinor / 100)}</dd></div></dl><p className={result.data.reconciled?'text-success':'text-warning'}>{result.data.reconciled?'Balances checked.':'Balances need review. No financial records have been changed.'}</p>{!result.data.reconciled&&<><p>Review the original invoices, payments and credit records before confirming any opening. Do not enter these balances again as a new sale or investment.</p><ul>{result.data.issues?.map((issue,i)=><li key={i}>{issue.code.replaceAll('_',' ').toLowerCase()}</li>)}</ul><p>Unverified historical balances remain blocked. No automatic repair or duplicate opening is permitted.</p></>}</>}</>;
}
export function CustomerAccountHistory({customer}) {
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[type,setType]=useState(''),[selected,setSelected]=useState(null);
  const detailOpener=useRef(null);
  const resetDetail=()=>{setSelected(null);detailOpener.current=null;};
  const closeDetail=()=>{setSelected(null);requestAnimationFrame(()=>detailOpener.current?.focus());};
  const closeDetailOnEscape=event=>{if(event.key==='Escape'&&selected){event.preventDefault();closeDetail();}};
  const term=useDebounce(search),history=useLoad('/accounts/customers/'+customer._id+'/history'+query({page,limit:20,q:term||undefined,type:type||undefined}));
  const position=history.data?.position;
  return <section className="customer-account-history mt-3" aria-label="Customer account history">
    <h3 className="h6">Account activity</h3><Notice loading={history.loading} error={history.error}/>
    {history.data&&<>
      <dl className="balance-strip"><div><dt>Customer owes us</dt><dd>PKR {money(position.debtMinor/100)}</dd></div><div><dt>Available store credit</dt><dd>PKR {money(position.storeCreditMinor/100)}</dd></div></dl>
      {position.reconciled?<p className="text-success small customer-balance-status" role="status">Balances checked as of {position.asOf?new Date(position.asOf).toLocaleDateString('en-PK',{timeZone:'Asia/Karachi'}):'the latest account update'}.</p>:<div className="alert alert-warning py-2 customer-balance-status" role="alert"><span>Balances need review. No records have been changed.</span><details><summary>Review warning</summary><ul className="mb-0">{position.issues?.map((issue,i)=><li key={i}>{issue.code==='CUSTOMER_LEDGER_MISMATCH'?'Customer ledger does not match recorded account balances.':issue.code==='INVOICE_DEBT_MISMATCH'?'Invoice debt does not match the recorded balance.':issue.code==='CUSTOMER_INVOICE_TOTAL_MISMATCH'?'Invoice totals do not match the customer balance.':'Additional records need review.'}</li>)||<li>Reconciliation details unavailable.</li>}</ul></details></div>}
      {!history.data.coverage.complete&&<p className="alert alert-warning py-2" role="alert">{history.data.coverage.limitedBy==='RECORD_LIMIT'?'History is limited to the latest 5,000 source records. Contact an owner to review the complete account.':'Some source records could not be reconciled. Review the warnings and linked records; no running balance has been inferred.'}</p>}
      <div className={'customer-history-layout'+(selected?' with-detail':'')} onKeyDown={closeDetailOnEscape}><div className="customer-history-main">
      <div className="customer-history-filters"><input className="form-control form-control-sm" aria-label="Search customer activity" placeholder="Search activity or invoice" value={search} onChange={event=>{resetDetail();setSearch(event.target.value);setPage(1);}}/><select className="form-select form-select-sm" aria-label="Filter customer activity type" value={type} onChange={event=>{resetDetail();setType(event.target.value);setPage(1);}}><option value="">All activity</option><option value="INVOICE">Invoices</option><option value="PAYMENT">Payments</option><option value="RETURN">Returns</option><option value="REFUND">Refunds</option><option value="CREDIT">Store credit</option><option value="ADJUSTMENT">Adjustments</option><option value="LEGACY">Legacy records</option></select></div>
      <RecordTable label="Chronological customer account activity" rows={history.data.entries} columns={[
        {key:'date',label:'Date',kind:'date',width:'18%',render:event=>formatCustomerDate(event.occurredAt)},
        {key:'action',label:'Activity',width:'24%',render:event=><span>{event.activity}{event.details?.legacy?' (legacy record)':''}{event.details?.unmatchedAdjustment?' (source needs review)':''}</span>},
        {key:'invoice',label:'Invoice / reference',kind:'reference',width:'17%',render:event=>event.orderId?<Link to={'/owner/sales/'+event.orderId}>{event.invoiceNo}</Link>:event.invoiceNo||'Unavailable'},
        {key:'amount',label:'Amount',numeric:true,width:'13%',render:event=>Number.isSafeInteger(event.amountMinor)?money(event.amountMinor/100):'Unavailable'},
        {key:'balance',label:'Balance change',numeric:true,width:'20%',render:event=><span className="customer-balance-change">{formatBalanceChange(event)}</span>},
      ]} onOpen={event=>{detailOpener.current=document.activeElement;setSelected(event);}} detailLabel="View" tableClassName="customer-activity-table" empty="No recorded activity matches these filters." arrowNavigation/>
      <Pagination pagination={history.data.pagination} onPage={value=>{resetDetail();setPage(value);}}/>
      </div>{selected&&<CustomerActivityDetails event={selected} customerName={customer.name} onClose={closeDetail}/>}</div>
    </>}
  </section>;
}
export function CustomerInvoices({customer}) { return <CustomerAccountHistory customer={customer}/>; }
export default function Customers() {
  const {user} = useAuth();
  const [selected,setSelected] = useState(null);
  const detailOpener=useRef(null);
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [creating, setCreating] = useState(false),
    [success, setSuccess] = useState(""),
    [saving, setSaving] = useState(false);
  const term = useDebounce(search),
    customers = useLoad(
      "/customers/" + query({ search: term, page, limit: 20 }),
    );
  const openDetails=customer=>{detailOpener.current=document.activeElement;setSelected(customer);};
  const closeDetails=()=>{setSelected(null);requestAnimationFrame(()=>detailOpener.current?.focus());};
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
 ]} onOpen={user.role==='OWNER'?openDetails:undefined} detailLabel={c=>c.remainingMoney>0?'Receive Payment':'Balance details'} empty="No customers found."/>}
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
      {selected && <Modal wide title={selected.name} onClose={closeDetails}><div className="customer-account-workspace"><div className="customer-identity"><span>{selected.phoneNo||'Phone unavailable'}</span>{selected.address&&<span>{selected.address}</span>}</div><CustomerAccountHistory customer={selected}/></div></Modal>}
    </>
  );
}
