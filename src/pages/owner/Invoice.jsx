import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { journalKey, readPending } from "../../api/invoice";
import { useAuth } from "../../auth/AuthContext";
import { useLoad } from "../../api/hooks";
import { Notice, PageTitle } from "../../components/Common";
import Receipt, { receiptFrom } from "../../components/Receipt";
import InvoiceAdjustment, { InvoiceCustomerBalance } from "../../components/InvoiceAdjustment";
import InvoiceHistory, { EventDocument } from "../../components/InvoiceHistory";

export default function Invoice() {
  const [params] = useSearchParams();
  const { orderId } = useParams();
  const { user } = useAuth();
  const invoice = useLoad("/orders/" + orderId);
  const [mode, setMode] = useState(() => readPending(journalKey(user, `invoice-${orderId}`))?.endpoint.split("/").at(-1) || null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [view, setView] = useState("current"), [document, setDocument] = useState(null);
  async function delivered() {
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    try { await api(`/orders/${orderId}/status`, { method: "PATCH" }); setSuccess("Invoice marked delivered."); invoice.reload(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  const order = invoice.data?.order, eligibility = invoice.data?.eligibility;
  const original = invoice.data?.originalSnapshot;
  const shown = document?.after ? {
    ...order, items: document.after.items, subtotal: document.after.subtotalMinor / 100,
    discountAmount: document.after.discountMinor / 100, totalPrice: document.after.totalMinor / 100,
    paidAmount: document.after.settledMinor / 100, amountDue: document.after.dueMinor / 100,
    revision: document.revisionAfter, settlementState: undefined, returnState: undefined,
    status: document.kind === "CANCELLATION" ? "CANCELLED" : undefined,
  } : original && view === "original" ? { ...order, ...original, customerId: order.customerId, settlementState: undefined, revision: undefined, returnState: undefined } : order;
  return <>
    <div className="no-print"><PageTitle title="Invoice"><Link to={"/owner/sales?" + new URLSearchParams({ ...Object.fromEntries(params), view: "history" })} className="btn btn-outline-secondary btn-sm">Back to sales</Link></PageTitle>
      <Notice error={error || invoice.error} loading={invoice.loading} success={success} />
    </div>
    {order && <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print">
        <button className={`btn btn-sm ${view === "current" && !document ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => { setView("current"); setDocument(null); }}>Current invoice · Revision {eligibility?.revision ?? order.revision ?? 0}</button>
        {original && <button className={`btn btn-sm ${view === "original" && !document ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => { setView("original"); setDocument(null); }}>{original.source === "LEGACY_BASELINE" ? "Recorded legacy baseline" : "Original invoice"}</button>}
      </div>
      <Receipt receipt={receiptFrom(shown)} documentTitle={document ? "Adjustment / payment record" : view === "original" ? (original?.source === "LEGACY_BASELINE" ? "Recorded legacy baseline" : "Original invoice") : undefined}>
        {document && <EventDocument event={document} order={order} />}
      </Receipt>
      <div className="panel mt-3 no-print">
        {order.customerId && <InvoiceCustomerBalance key={`${orderId}-${eligibility?.revision}`} customer={order.customerId} />}
        <div className="d-flex flex-wrap gap-2">
          {eligibility?.adjustmentEligible && <button className="btn btn-primary" disabled={busy || !!mode} onClick={() => setMode("adjustments")}>Return / change invoice</button>}
          {eligibility?.paymentEligible && <button className="btn btn-outline-primary" disabled={busy || !!mode} onClick={() => setMode("payments")}>Receive payment</button>}
          {order.status === "PENDING" && <button className="btn btn-outline-primary" disabled={busy || !!mode} onClick={delivered}>{busy ? "Saving..." : "Mark delivered"}</button>}
          {eligibility?.cancellationEligible && <button className="btn btn-outline-danger" disabled={busy || !!mode} onClick={() => setMode("cancellations")}>Cancel invoice</button>}
          <button className="btn btn-outline-secondary" disabled={busy || !!mode} onClick={invoice.reload}>Refresh invoice</button>
        </div>
        {eligibility?.reason && <p className="small text-body-secondary mt-2 mb-0">{eligibility.reason}</p>}
        {!original && <p className="small text-body-secondary mt-2 mb-0">No original snapshot was recorded for this earlier invoice.</p>}
      </div>
      {mode && <InvoiceAdjustment key={`${orderId}-${mode}-${eligibility?.revision}`} order={order} mode={mode} onClose={() => { setMode(null); invoice.reload(); }} onSaved={() => { setMode(null); setDocument(null); setView("current"); setSuccess("Invoice updated. Financial and stock movements recorded."); invoice.reload(); }} />}
      <InvoiceHistory key={`${orderId}-${eligibility?.revision}`} order={order} onPrint={event => { setDocument(event); setView("current"); window.scrollTo(0, 0); }} />
    </>}
  </>;
}
