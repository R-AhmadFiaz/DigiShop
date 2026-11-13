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
import CustomerFilter from "../../components/CustomerFilter";
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
          aria-keyshortcuts="F6"
          onClick={() => setTab("history")}
        >
          Invoice history
        </button>
      </div>}
      </div>
      <div hidden={tab !== "sale"} className="sales-screen-host">
        <POS screen active={tab === "sale"} onHistory={() => setTab("history")} />
      </div>
      {tab === "history" && <InvoiceHistory customerModule={customerModule}/>}
    </>
  );
}
function InvoiceHistory({customerModule=false}) {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") || "";
  const customerId=params.get('customerId')||'';
  const [chosen,setChosen]=useState(null);
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
    "/orders/" + query({ search: term, customerId:customerId||undefined, page, limit: 20, includeCustomer: customerModule ? "true" : undefined }),
  );
  const customerLabel=c=>c?c.name+' · '+c.phoneNo:'';
  const selectedName=chosen?.id===customerId?chosen.label:customerLabel(invoices.data?.orders.find(o=>String(o.customerId)===customerId)?.customerSummary);
  return (
    <>
      {customerModule&&<div className="row g-2 mb-3"><div className="col-md-6"><CustomerFilter label="Filter invoices by customer" value={customerId} selectedName={selectedName} onChange={(id,customer)=>{setChosen(customer?{id,label:customerLabel(customer)}:null);setParams(current=>{const next=new URLSearchParams(current);if(id)next.set('customerId',id);else next.delete('customerId');next.set('page','1');return next;},{replace:true});}}/></div></div>}
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
      <section className="panel fill-panel">
        <Notice error={invoices.error} loading={invoices.loading} />
        {invoices.data&&<RecordTable label="Sales invoice register" rows={invoices.data.orders} columns={[
 {key:'date',label:'Date',render:o=>dateText(o.createdAt)},
 {key:'invoice',label:'Invoice',render:o=><Link to={customerModule?'/owner/sales/'+o._id:'/owner/sales/'+o._id+'?'+params.toString()}>{o.invoiceNo||'View invoice'}</Link>},
 ...(customerModule?[{key:'customer',label:'Customer',render:o=>o.customerSummary?.name||(o.customerId?'Customer unavailable':'Walk-in customer')}]:[]),
 {key:'sale',label:'Sale',render:o=>o.saleType==='WHOLESALE'?'Wholesale':'Retail'},
 {key:'total',label:'Bill total',numeric:true,render:o=>money(o.totalPrice)},
 {key:'paid',label:'Paid / settled',numeric:true,render:o=>money(o.paidAmount)},
 {key:'due',label:'Customer owes',numeric:true,render:o=>money(o.amountDue)},
 {key:'status',label:'Status',render:o=>o.status.toLowerCase()}
 ]} empty="No invoices found."/>}
        <Pagination label="Invoices" pagination={invoices.data?.pagination} rows={invoices.data?.orders.length} onPage={setPage} />
      </section>
    </>
  );
}
