import RecordTable from '../../components/RecordTable';
import { Link, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { query } from "../../api/client";
import { useDebounce, useLoad } from "../../api/hooks";
import {
  dateText,
  Empty,
  money,
  Notice,
  PageTitle,
  Pagination,
} from "../../components/Common";
import POS from "../../components/POS";
export default function Sales({customerModule=false}) {
  const [params, setParams] = useSearchParams();
  const tab = customerModule||params.get("view") === "history" ? "history" : "sale";
  const setTab = (view) =>
    setParams((current) => {
      current.set("view", view);
      return current;
    });
  return (
    <>
      <div className="sales-toolbar">
      <PageTitle title="Sales" />
      {!customerModule&&<div className="screen-tabs no-print">
        <button
          className={tab === "sale" ? "active" : ""}
          onClick={() => setTab("sale")}
        >
          New sale
        </button>
        <button
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          Invoice history
        </button>
      </div>}
      </div>
      <div hidden={tab !== "sale"}>
        <POS />
      </div>
      {tab === "history" && <InvoiceHistory customerModule={customerModule}/>}
    </>
  );
}
function InvoiceHistory({customerModule=false}) {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") || "";
  const customerId=params.get('customerId')||'';
  const [customerSearch,setCustomerSearch]=useState('');
  const page = Math.max(1, Number(params.get("page")) || 1);
  const term = useDebounce(search);
  const setPage = (value) =>
    setParams(
      (current) => {
        current.set("page", value);
        return current;
      },
      { replace: true },
    );
  const invoices = useLoad(
    "/orders/" + query({ search: term, customerId:customerId||undefined, page, limit: 20 }),
  );
  const customerTerm=useDebounce(customerSearch),customers=useLoad('/customers/'+query({search:customerTerm,page:1,limit:100}),customerModule);
  return (
    <>
      {customerModule&&<div className="row g-2 mb-2"><div className="col-md-5"><label className="form-label d-block">Find customer<input className="form-control" aria-label="Search customers for invoice filter" value={customerSearch} onChange={event=>setCustomerSearch(event.target.value)} maxLength={100}/></label></div><div className="col-md-5"><label className="form-label d-block">Filter invoices by customer<select className="form-select" aria-label="Filter invoices by customer" value={customerId} onChange={e=>setParams(current=>{if(e.target.value)current.set('customerId',e.target.value);else current.delete('customerId');current.set('page','1');return current;},{replace:true})}><option value="">All customers</option>{customers.data?.customers.map(customer=><option key={customer._id} value={customer._id}>{customer.name} · {customer.phoneNo}</option>)}</select></label></div></div>}
      <input
        className="form-control search-input mb-3"
        aria-label="Search invoice number"
        placeholder="Invoice number"
        maxLength={100}
        value={search}
        onChange={(e) => {
          const value = e.target.value;
          setParams(
            (current) => {
              current.set("search", value);
              current.set("page", "1");
              return current;
            },
            { replace: true },
          );
        }}
      />
      <section className="panel">
        <Notice error={invoices.error} loading={invoices.loading} />
        {invoices.data&&<RecordTable label="Sales invoice register" rows={invoices.data.orders} columns={[
 {key:'date',label:'Date',render:o=>dateText(o.createdAt)},
 {key:'invoice',label:'Invoice',render:o=><Link to={customerModule?'/owner/sales/'+o._id:'/owner/sales/'+o._id+'?'+params.toString()}>{o.invoiceNo||'View invoice'}</Link>},
 ...(customerModule?[{key:'customer',label:'Customer',render:o=>customers.data?.customers.find(c=>c._id===o.customerId)?.name||'Customer unavailable'}]:[]),
 {key:'sale',label:'Sale',render:o=>o.saleType==='WHOLESALE'?'Wholesale':'Retail'},
 {key:'total',label:'Bill total',numeric:true,render:o=>money(o.totalPrice)},
 {key:'paid',label:'Paid / settled',numeric:true,render:o=>money(o.paidAmount)},
 {key:'due',label:'Customer owes',numeric:true,render:o=>money(o.amountDue)},
 {key:'status',label:'Status',render:o=>o.status.toLowerCase()}
 ]} empty="No invoices found."/>}
        <Pagination pagination={invoices.data?.pagination} onPage={setPage} />
      </section>
    </>
  );
}
