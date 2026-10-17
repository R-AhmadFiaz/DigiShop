import RecordTable from '../../components/RecordTable';
import { Link, useSearchParams } from "react-router-dom";
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
export default function Sales() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("view") === "history" ? "history" : "sale";
  const setTab = (view) =>
    setParams((current) => {
      current.set("view", view);
      return current;
    });
  return (
    <>
      <PageTitle title="Sales" />
      <div className="screen-tabs no-print">
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
      </div>
      <div hidden={tab !== "sale"}>
        <POS />
      </div>
      {tab === "history" && <InvoiceHistory />}
    </>
  );
}
function InvoiceHistory() {
  const [params, setParams] = useSearchParams();
  const search = params.get("search") || "";
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
    "/orders/" + query({ search: term, page, limit: 20 }),
  );
  return (
    <>
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
 {key:'invoice',label:'Invoice',render:o=><Link to={o._id+'?'+params.toString()}>{o.invoiceNo||'View invoice'}</Link>},
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
