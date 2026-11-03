import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../../api/client";
import { journalKey, readPending } from "../../api/invoice";
import { useAuth } from "../../auth/AuthContext";
import { useLoad } from "../../api/hooks";
import { Notice, PageTitle } from "../../components/Common";
import Receipt, { receiptFrom } from "../../components/Receipt";
import InvoiceAdjustment, { InvoiceCustomerBalance } from "../../components/InvoiceAdjustment";
import InvoiceHistory, { EventDocument } from "../../components/InvoiceHistory";
import { invoiceCustomerDisplayName } from "../../utils/invoiceCustomerName";

function InvoiceCustomerName({ order, reload }) {
  const currentName = invoiceCustomerDisplayName(order);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const editButton = useRef(null);
  const input = useRef(null);
  const requestKey = useRef(null);
  useEffect(() => { if (!editing) setValue(currentName); }, [currentName, editing]);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  function close() {
    setEditing(false); setValue(currentName); setError(""); requestKey.current = null;
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  }
  async function save(event) {
    event.preventDefault();
    const name = value.trim().normalize("NFC");
    if (!name || name.length > 120 || [...name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
      setError("Enter a customer name up to 120 characters."); return;
    }
    if (name === currentName) { close(); return; }
    if (busy) return;
    setBusy(true); setError(""); setSuccess("");
    requestKey.current ||= crypto.randomUUID();
    try {
      await api(`/orders/${order._id}/customer-display-name`, { method: "PATCH", body: {
        name, expectedName: currentName, expectedDisplayRevision: order.customerDisplayRevision ?? 0, requestKey: requestKey.current,
      } });
      requestKey.current = null; setEditing(false); setSuccess("Customer name updated.");
      reload(); requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="invoice-customer-name no-print" aria-label="Invoice customer name">
    <div className="invoice-customer-current"><span className="invoice-customer-label">Customer</span><strong>{currentName || "Walk-in customer"}</strong></div>
    {!editing ? <button ref={editButton} type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setValue(currentName); setError(""); setSuccess(""); setEditing(true); }}>Edit name</button> :
      <form className="invoice-customer-edit" onSubmit={save} onKeyDown={event => { if (!busy && event.key === "Escape") { event.preventDefault(); close(); } }}>
        <fieldset disabled={busy} className="invoice-customer-fields">
        <label className="visually-hidden" htmlFor="invoice-customer-display-name">Customer name on invoice</label>
        <input ref={input} id="invoice-customer-display-name" className="form-control form-control-sm" maxLength={120} value={value} onChange={event => { setValue(event.target.value); if (requestKey.current && event.target.value.trim().normalize("NFC") !== currentName) requestKey.current = null; }} />
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy} onClick={close}>Cancel</button>
        </fieldset>
      </form>}
    {error && <p className="invoice-customer-feedback text-danger" role="alert">{error}</p>}
    {success && <p className="invoice-customer-feedback text-success" role="status">{success}</p>}
  </div>;
}

export default function Invoice() {
  const [params] = useSearchParams();
  const { orderId } = useParams();
  const { user } = useAuth();
  const invoice = useLoad("/orders/" + orderId);
  const [mode, setMode] = useState(() => readPending(journalKey(user, `invoice-${orderId}`))?.endpoint.split("/").at(-1) || null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [view, setView] = useState("current"), [document, setDocument] = useState(null);
  const editButton=useRef(null),wasEditing=useRef(false);
  useEffect(()=>{
    if(wasEditing.current&&mode!=="adjustments")requestAnimationFrame(()=>editButton.current?.focus({preventScroll:true}));
    wasEditing.current=mode==="adjustments";
  },[mode]);
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
    revision: document.revisionAfter, customerDisplayName: undefined, settlementState: undefined, returnState: undefined,
    status: document.kind === "CANCELLATION" ? "CANCELLED" : undefined,
  } : original && view === "original" ? { ...order, ...original, customerId: order.customerId, customerDisplayName: original.customerDisplayName, settlementState: undefined, revision: undefined, returnState: undefined } : order;
  return <>
    <div className="no-print"><PageTitle title="Invoice"><Link to={"/owner/sales?" + new URLSearchParams({ ...Object.fromEntries(params), view: "history" })} className="btn btn-outline-secondary btn-sm">Back to sales</Link></PageTitle>
      <Notice error={error || invoice.error} loading={invoice.loading} success={success} />
    </div>
    {order && <>{mode === "adjustments" ? <InvoiceAdjustment key={`${orderId}-${mode}-${eligibility?.revision}`} order={order} mode={mode} onClose={() => { setMode(null); invoice.reload(); }} onSaved={() => { setMode(null); setDocument(null); setView("current"); setSuccess("Invoice updated. Financial and stock movements recorded."); invoice.reload(); }} /> : <>
      <div className="d-flex flex-wrap gap-2 mb-3 no-print">
        <button className={`btn btn-sm ${view === "current" && !document ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => { setView("current"); setDocument(null); }}>Current invoice · Revision {eligibility?.revision ?? order.revision ?? 0}</button>
        {original && <button className={`btn btn-sm ${view === "original" && !document ? "btn-primary" : "btn-outline-secondary"}`} onClick={() => { setView("original"); setDocument(null); }}>{original.source === "LEGACY_BASELINE" ? "Recorded legacy baseline" : "Original invoice"}</button>}
      </div>
      <InvoiceCustomerName key={`${orderId}-customer-name`} order={order} reload={invoice.reload} />
      <Receipt receipt={receiptFrom(shown)} documentTitle={document ? "Adjustment / payment record" : view === "original" ? (original?.source === "LEGACY_BASELINE" ? "Recorded legacy baseline" : "Original invoice") : undefined}>
        {document && <EventDocument event={document} order={order} />}
      </Receipt>
      <div className="panel mt-3 no-print">
        {order.customerId && <InvoiceCustomerBalance key={`${orderId}-${eligibility?.revision}`} customer={order.customerId} />}
        <div className="d-flex flex-wrap gap-2">
          {eligibility?.adjustmentEligible && <button ref={editButton} className="btn btn-primary" disabled={busy || !!mode} onClick={() => setMode("adjustments")}>Edit Invoice</button>}
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
    </>}</>}
  </>;
}
