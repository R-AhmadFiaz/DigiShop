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
        {invoices.data?.orders.length > 0 ? (
          <div className="table-responsive">
            <table className="table table-sm align-middle">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Sale</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {invoices.data.orders.map((order) => (
                  <tr key={order._id}>
                    <td>
                      <Link to={order._id + "?" + params.toString()}>
                        {order.invoiceNo || "View invoice"}
                      </Link>
                    </td>
                    <td>{dateText(order.createdAt)}</td>
                    <td>
                      {order.saleType === "WHOLESALE" ? "Wholesale" : "Retail"}
                    </td>
                    <td>{money(order.totalPrice)}</td>
                    <td>{money(order.paidAmount)}</td>
                    <td>{money(order.amountDue)}</td>
                    <td>{order.status.toLowerCase()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          !invoices.loading &&
          !invoices.error && <Empty>No invoices found.</Empty>
        )}
        <Pagination pagination={invoices.data?.pagination} onPage={setPage} />
      </section>
    </>
  );
}
