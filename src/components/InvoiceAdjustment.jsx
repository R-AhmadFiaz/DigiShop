import { useRef, useState } from "react";
import { api, query } from "../api/client";
import { useDebounce, useLoad } from "../api/hooks";
import { literalSearch } from "../api/sale";
import { adjustmentBody, clearPending, journalKey, readPending, requestKey, savePending, uncertain } from "../api/invoice";
import { useAuth } from "../auth/AuthContext";
import { Field, money, Notice } from "./Common";
import CustomerPicker from "./CustomerPicker";
import { FinancialMovements } from "./InvoiceHistory";

function AddProducts({ saleType, onAdd, disabled }) {
  const [search, setSearch] = useState("");
  const term = useDebounce(search);
  const products = useLoad("/products/search-product" + query({ search: literalSearch(term) }));
  return <>
    <Field label="Add or exchange products" hint="New units use current prices, including another unit of a product already on this invoice.">
      <input className="form-control" placeholder="Search name or brand" value={search} maxLength={100} onChange={e => setSearch(e.target.value)} />
    </Field>
    <Notice error={products.error} loading={products.loading} />
    <div className="product-results" style={{ maxHeight: 220 }}>
      {products.data?.product.map(product => <button key={product._id} type="button" className="product-result" disabled={disabled || search !== term || (saleType === "WHOLESALE" && !product.wholesalePrice)} onClick={() => onAdd(product)}>
        <span>{product.name}<small>{product.brand} · Stock {product.stockQuantity}</small></span>
        <span>{money(saleType === "WHOLESALE" ? product.wholesalePrice : product.retailPrice)}<small>Add</small></span>
      </button>)}
    </div>
  </>;
}

export function InvoiceCustomerBalance({ customer }) {
  // Reuse the existing shop-scoped customer list. Match the immutable invoice
  // customer exactly, never substitute the first search result.
  const customers = useLoad("/customers/" + query({ search: customer.phoneNo || customer.name, limit: 100 }));
  const current = customers.data?.customers.find(value => value._id === customer._id);
  return <div className="mb-3">
    <strong>{customer.name}</strong> {customer.phoneNo}
    <Notice error={customers.error} loading={customers.loading} />
    {current ? <p className="small mb-0">Customer outstanding debt: {money(current.remainingMoney)} · Available store credit: {money((current.storeCreditBalanceMinor ?? 0) / 100)}</p> : !customers.loading && <p className="small">Current customer balances are unavailable. The server will verify settlement.</p>}
  </div>;
}

export default function InvoiceAdjustment({ order, mode, onSaved, onClose }) {
  const { user } = useAuth();
  const storageKey = journalKey(user, `invoice-${order._id}`);
  const [pending, setPending] = useState(() => readPending(storageKey));
  const [key] = useState(requestKey);
  const [returns, setReturns] = useState({});
  const [additions, setAdditions] = useState([]);
  const [discountType, setDiscountType] = useState(order.discountType || "NONE");
  const [discountValue, setDiscountValue] = useState(String(order.discountValue ?? 0));
  const [reason, setReason] = useState("");
  const [recipient, setRecipient] = useState(null);
  const [funds, setFunds] = useState({ cashReceivedAmount: "0", creditRedeemedAmount: "0", cashRefundAmount: "0", creditIssueAmount: "0" });
  const [routing,setRouting]=useState({receiptAccountId:'',refundAccountId:''});
  const paymentAccounts=useLoad('/orders/payment-accounts');
  const [preview, setPreview] = useState(null);
  const [reviewBody, setReviewBody] = useState(null);
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [cashReceivedConfirmed, setCashReceivedConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const endpoint = `/orders/${order._id}/${mode}`;
  const locked = busy || !!pending;
  const title = { adjustments: "Adjust invoice", payments: "Receive invoice payment", cancellations: "Cancel invoice" }[mode];
  function invalidate() { setPreview(null); setReviewBody(null); setCashConfirmed(false); setCashReceivedConfirmed(false); }
  async function previewChange() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); invalidate();
    try {
      const body = adjustmentBody({ order, mode, key, reason, returns, additions, discountType, discountValue, funds, recipient });
      if(paymentAccounts.loading||paymentAccounts.error||typeof paymentAccounts.data?.accountingEnabled!=='boolean')throw new Error(paymentAccounts.error||'Wait for payment accounts to load.');
      if(paymentAccounts.data.accountingEnabled){
        for(const [amount,field,label] of [[body.cashReceivedAmount,'receiptAccountId','receiving'],[body.cashRefundAmount,'refundAccountId','refund']]){
          if(amount>0){
            if(!paymentAccounts.data.accounts.some(a=>a._id===routing[field]))throw new Error('Select the '+label+' cash/bank account.');
            body[field]=routing[field];
          }
        }
      }
      const result = await api(endpoint + "/preview", { method: "POST", body });
      setPreview(result); setReviewBody(body);
    } catch (e) { setError(e.message + (e.status === 409 ? " Reload the invoice before trying again." : "")); }
    finally { lock.current = false; setBusy(false); }
  }
  async function commit(request = pending) {
    if (lock.current) return;
    const recovering = !!pending;
    lock.current = true; setBusy(true); setError("");
    try {
      // Persist BEFORE sending; if tab reloads after a lost response, never mint
      // a second key. Retry uses the exact body and token below.
      savePending(storageKey, request); setPending(request);
      const result = await api(request.endpoint, { method: "POST", body: request.body });
      if (!result?.event?._id || result.event.requestKey !== request.body.requestKey)
        throw new Error("The operation response is incomplete. Check whether saved before doing anything else.");
      clearPending(storageKey); setPending(null); onSaved();
    } catch (e) {
      if (!uncertain(e) && !recovering) { clearPending(storageKey); setPending(null); invalidate(); }
      setError(uncertain(e) || recovering ? "The result is not confirmed. Do not repeat the cash handover. Check whether saved, or retry this exact request. " + e.message : e.message + " Do not repeat any cash handover. Review a fresh preview before confirming again.");
    } finally { lock.current = false; setBusy(false); }
  }
  async function recover() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await api(`/orders/${order._id}/history` + query({ requestKey: pending.body.requestKey, limit: 1 }));
      if (result.history.length) { clearPending(storageKey); setPending(null); onSaved(); }
      else setError("No completed record found yet. Retry the same request; do not repeat any cash handover.");
    } catch (e) { setError(e.message); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="panel mt-3 no-print" aria-label={title}>
    <div className="d-flex justify-content-between mb-3"><h2 className="h5">{title}</h2><button className="btn btn-outline-secondary btn-sm" disabled={busy || !!pending} onClick={onClose}>Close</button></div>
    <Notice error={error} />
    {pending ? <div role="status"><p>A financial request is awaiting confirmation. Its exact request is retained for this browser tab. Do not create another operation or repeat cash movement.</p><div className="d-flex gap-2"><button className="btn btn-primary" disabled={busy} onClick={recover}>Check whether saved</button><button className="btn btn-outline-primary" disabled={busy} onClick={() => commit()}>Retry same request</button></div></div> : <>
      <fieldset disabled={locked} onChange={invalidate}>
        {mode === "cancellations" && <p>Cancel this pending invoice and restock its remaining units. Review the refund and debt settlement below before confirming. Use a full return instead for damaged products.</p>}
        {mode === "adjustments" && <>
          <h3 className="h6">Return existing units at their original prices</h3>
          <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Product</th><th>On invoice</th><th>Original price</th><th>Return quantity</th><th>Condition</th></tr></thead><tbody>
            {order.items.map(line => <tr key={line.lineId}><td>{line.name || line.productId?.name || "Product unavailable"}</td><td>{line.quantity}</td><td>{money(line.unitPrice)}</td><td><input className="form-control form-control-sm" style={{ width: 95 }} aria-label={`Return quantity for ${line.name || line.productId?.name}`} type="number" min="0" max={line.quantity} step="1" value={returns[line.lineId]?.quantity ?? "0"} onChange={e => setReturns(current => ({ ...current, [line.lineId]: { disposition: "RESTOCK", ...current[line.lineId], quantity: e.target.value } }))} /></td><td><select className="form-select form-select-sm" aria-label={`Return condition for ${line.name || line.productId?.name}`} value={returns[line.lineId]?.disposition || "RESTOCK"} onChange={e => setReturns(current => ({ ...current, [line.lineId]: { quantity: "0", ...current[line.lineId], disposition: e.target.value } }))}><option value="RESTOCK">Restock</option><option value="DAMAGED">Damaged / unsellable</option></select></td></tr>)}
          </tbody></table></div>
          <button className="btn btn-outline-secondary btn-sm mb-3" onClick={() => { invalidate(); setReturns(Object.fromEntries(order.items.map(line => [line.lineId, { quantity: String(line.quantity), disposition: returns[line.lineId]?.disposition || "RESTOCK" }]))); }}>Return all remaining units</button>
          <AddProducts saleType={order.saleType} disabled={locked} onAdd={product => { invalidate(); setAdditions(current => current.some(i => i._id === product._id) ? current.map(i => i._id === product._id ? { ...i, quantity: Number(i.quantity) + 1 } : i) : [...current, { ...product, quantity: 1 }]); }} />
          {additions.map(line => <div className="d-flex flex-wrap gap-2 align-items-center my-2" key={line._id}><span>{line.name} · Current price {money(order.saleType === "WHOLESALE" ? line.wholesalePrice : line.retailPrice)}</span><input className="form-control form-control-sm w-auto" type="number" min="1" step="1" aria-label={`Added quantity for ${line.name}`} value={line.quantity} onChange={e => setAdditions(current => current.map(i => i._id === line._id ? { ...i, quantity: e.target.value } : i))} /><button className="btn btn-outline-secondary btn-sm" onClick={() => { invalidate(); setAdditions(current => current.filter(i => i._id !== line._id)); }}>Remove addition</button></div>)}
          <div className="row g-2 mt-3"><div className="col-sm-6"><Field label="Revised discount"><select className="form-select" value={discountType} onChange={e => setDiscountType(e.target.value)}><option value="NONE">No discount</option><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option></select></Field></div>{discountType !== "NONE" && <div className="col-sm-6"><Field label={discountType === "PERCENTAGE" ? "Discount percent" : "Fixed discount"}><input className="form-control" type="number" min="0" step="0.01" value={discountValue} onChange={e => setDiscountValue(e.target.value)} /></Field></div>}</div>
        </>}
        <Field label="Reason"><input className="form-control" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></Field>
        <h3 className="h6 mt-3">Payments and refunds (PKR)</h3>
        <p className="small text-body-secondary">Debt is reduced first. Credit-funded refunds return to store credit automatically. Preview shows the remaining amount to allocate between cash refund and new store credit.</p>
        <div className="row g-2">
          {Object.entries({ cashReceivedAmount: "Additional cash received", ...(order.customerId ? { creditRedeemedAmount: "Store credit to redeem" } : {}), ...(mode !== "payments" ? { cashRefundAmount: "Cash to refund", creditIssueAmount: "Refund as store credit" } : {}) }).map(([field, label]) => <div className="col-sm-6" key={field}><Field label={label}><input className="form-control" type="number" min="0" step="0.01" value={funds[field]} onChange={e => setFunds(current => ({ ...current, [field]: e.target.value }))} /></Field></div>)}
        </div>
        <Notice loading={paymentAccounts.loading} error={paymentAccounts.error}/>
        {paymentAccounts.data?.accountingEnabled&&[[funds.cashReceivedAmount,'receiptAccountId','Receive into'],[funds.cashRefundAmount,'refundAccountId','Refund from']].map(([amount,field,label])=>Number(amount)>0&&<Field key={field} label={label}><select aria-label={label} className="form-select" value={routing[field]} onChange={e=>setRouting(current=>({...current,[field]:e.target.value}))}><option value="">Choose cash or bank</option>{paymentAccounts.data.accounts.map(account=><option key={account._id} value={account._id}>{account.name}</option>)}</select></Field>)}
      </fieldset>
      {!order.customerId && mode !== "payments" && Number(funds.creditIssueAmount) > 0 && !order.creditRecipientId && <fieldset disabled={locked}><p>Store-credit recipient (original invoice stays anonymous)</p><CustomerPicker value={recipient} onChange={value => { invalidate(); setRecipient(value); }} required /></fieldset>}
      {order.creditRecipientId && !order.customerId && <p className="small">Store credit will go to the previously recorded recipient. The original invoice remains anonymous.</p>}
      <button className="btn btn-primary mt-3" disabled={busy} onClick={previewChange}>{busy ? "Checking..." : "Preview changes"}</button>
      {preview && <div className="border rounded p-3 mt-3" aria-label="Server preview">
        <h3 className="h6">Review server-confirmed changes</h3>
        <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Revised product</th><th>Quantity</th><th>Unit price</th></tr></thead><tbody>{preview.proposed.items.map((line, index) => <tr key={line.lineId || index}><td>{line.name || "Product unavailable"}</td><td>{line.quantity}</td><td>{money(line.unitPrice)}</td></tr>)}</tbody></table></div>
        <p className="small">Revised subtotal: {money(preview.proposed.subtotalMinor / 100)} · Discount: {money(preview.proposed.discountMinor / 100)} · Net settled: {money(preview.proposed.settledMinor / 100)}</p>
        <p>Total: {money(preview.before.totalMinor / 100)} → <strong>{money(preview.proposed.totalMinor / 100)}</strong><br />Outstanding: {money(preview.before.dueMinor / 100)} → <strong>{money(preview.proposed.dueMinor / 100)}</strong></p>
        {(preview.movements || []).map((movement, index) => {
          const line = movement.kind === "RETURN" ? order.items.find(i => i.lineId === movement.lineId) : additions.find(i => i._id === String(movement.productId));
          return <p className="small mb-1" key={index}>{movement.kind === "RETURN" ? "Return" : "Add"}: {line?.name || line?.productId?.name || "Product unavailable"} · {movement.quantity} × {money(movement.unitPriceMinor / 100)} · {movement.disposition === "DAMAGED" ? "Damaged, no sellable stock increase" : `Sellable stock change: ${movement.stockDelta > 0 ? "+" : ""}${movement.stockDelta}`}</p>;
        })}
        <p className="small mt-2">Refund required: {money(preview.requirements.refundMinor / 100)} · Credit automatically restored: {money(preview.requirements.creditRestoreMinor / 100)} · Cash-funded amount to allocate: {money(preview.requirements.cashRefundMaximumMinor / 100)}</p>
        {preview.settlement && <FinancialMovements financial={preview.settlement} />}
        <Notice error={preview.validationMessage} />
        {preview.canSubmit && <>
          {preview.settlement.cashRefundMinor > 0 && <label className="d-block my-2"><input type="checkbox" className="form-check-input me-2" checked={cashConfirmed} onChange={e => setCashConfirmed(e.target.checked)} />I have handed {money(preview.settlement.cashRefundMinor / 100)} cash to the customer.</label>}
          {preview.settlement.cashReceivedMinor > 0 && <label className="d-block my-2"><input type="checkbox" className="form-check-input me-2" checked={cashReceivedConfirmed} onChange={e => setCashReceivedConfirmed(e.target.checked)} />I have received {money(preview.settlement.cashReceivedMinor / 100)} cash.</label>}
          <button className={`btn ${mode === "cancellations" ? "btn-danger" : "btn-primary"} mt-2`} disabled={busy || (preview.settlement.cashRefundMinor > 0 && !cashConfirmed) || (preview.settlement.cashReceivedMinor > 0 && !cashReceivedConfirmed)} onClick={() => commit({ endpoint, body: { ...reviewBody, confirmationToken: preview.confirmationToken } })}>Confirm {mode === "cancellations" ? "cancellation" : mode === "payments" ? "payment" : "adjustment"}</button>
        </>}
      </div>}
    </>}
  </section>;
}
