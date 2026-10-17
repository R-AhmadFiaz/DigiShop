import RecordTable from '../components/RecordTable';
import { useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import {useLoad} from '../api/hooks';
import {useAuth} from '../auth/AuthContext';
import {clearPending,journalKey,readPending,requestKey,savePending,uncertain} from '../api/invoice';
import {
  dateText,
  Empty,
  Field,
  Modal,
  money,
  Notice,
  PageTitle,
} from "../components/Common";
import POS from "../components/POS";
import Receipt, { receiptFrom } from "../components/Receipt";
import CustomerPicker from "../components/CustomerPicker";
export default function Quotations() {
  const { quotations, setQuotations } = useOutletContext();
  const {user}=useAuth(),storageKey=journalKey(user,'quotation-conversion');
  const [tab, setTab] = useState("new"),
    [selected, setSelected] = useState(null),
    [converting, setConverting] = useState(()=>{const pending=readPending(storageKey);return pending?{order:{_id:pending.quotationId},products:[]}:null;});
  return (
    <>
      <PageTitle title="Quotations" />
      <p className="text-body-secondary no-print small">
        Reloading or signing out clears this quotation list.
      </p>
      <div className="screen-tabs no-print">
        <button
          className={tab === "new" ? "active" : ""}
          onClick={() => setTab("new")}
        >
          New quotation
        </button>
        <button
          className={tab === "session" ? "active" : ""}
          onClick={() => setTab("session")}
        >
          This session ({quotations.length})
        </button>
      </div>
      <div hidden={tab !== "new"}>
        <POS
          quotation
          onConvertQuotation={(id) =>
            setConverting(
              quotations.find(
                (draft) => draft.order._id === id && !draft.converted,
              ),
            )
          }
        />
      </div>
      {tab === "session" && (
        <>
          {selected ? (
            <>
              <Receipt receipt={selected} />
              <button
                className="btn btn-outline-secondary mt-3 no-print"
                onClick={() => setSelected(null)}
              >
                Back to quotations
              </button>
            </>
          ) : (
            <section className="panel">
              {quotations.length === 0 ? (
                <Empty>No quotations created in this session.</Empty>
              ) : (
                <RecordTable label="Quotation register" rows={quotations} rowKey={d=>d.order._id} columns={[
 {key:'date',label:'Created',render:d=>dateText(d.order.createdAt)},
 {key:'products',label:'Products',render:d=>d.receipt.lines.length+' product lines'},
 {key:'total',label:'Quoted total',numeric:true,render:d=>money(d.order.totalPrice)},
 {key:'status',label:'Status',render:d=>d.converted?'Converted':'Draft'},
 {key:'actions',label:'Actions',render:d=><div className="d-flex gap-2"><button className="btn btn-outline-secondary btn-sm" onClick={()=>setSelected(d.receipt)}>{d.converted?'View invoice':'View'}</button>{!d.converted&&<button className="btn btn-primary btn-sm" onClick={()=>setConverting(d)}>Make sale</button>}</div>}
 ]} details={d=><RecordTable label="Quotation products" rows={d.receipt.lines} rowKey={(_,i)=>i} columns={[{key:'name',label:'Product'},{key:'quantity',label:'Quantity',numeric:true},{key:'price',label:'Unit price',numeric:true,render:l=>money(l.unitPrice)}]}/>}/>
              )}
            </section>
          )}
        </>
      )}
      {converting && (
        <Convert
          storageKey={storageKey}
          draft={converting}
          onClose={() => setConverting(null)}
          onSaved={(receipt) => {
            setQuotations((current) =>
              current.map((draft) =>
                draft.order._id === converting.order._id
                  ? { ...draft, converted: true, receipt }
                  : draft,
              ),
            );
            setConverting(null);
            setSelected(receipt);
            setTab("session");
          }}
        />
      )}
    </>
  );
}
function Convert({ draft, onClose, onSaved, storageKey }) {
  const [pending,setPending]=useState(()=>readPending(storageKey));
  const [chosenReceiptAccountId,setReceiptAccountId]=useState('');
  const paymentAccounts=useLoad('/orders/payment-accounts');
  const receiptAccountId=chosenReceiptAccountId||(paymentAccounts.data?.accounts?.length===1?paymentAccounts.data.accounts[0]._id:'');
  const [paid, setPaid] = useState(String(draft.order.totalPrice)),
    [customer, setCustomer] = useState(null),
    [busy, setBusy] = useState(false),
    [customerBusy, setCustomerBusy] = useState(false),
    [error, setError] = useState("");
  const lock = useRef(false),
    amount = Number(paid),
    due = draft.order.totalPrice - amount;
  async function submit(e,retry=false) {
    e.preventDefault();
    if (lock.current || customerBusy) return;
    setError("");
    if (!retry&&(paid === "" || !Number.isFinite(amount) || amount < 0 || due < 0)) {
      setError("Enter a paid amount between zero and the quotation total.");
      return;
    }
    if (!retry&&due > 0 && !customer) {
      setError("Select a customer for this credit sale.");
      return;
    }
    if(!retry){
      if(paymentAccounts.loading||paymentAccounts.error||typeof paymentAccounts.data?.accountingEnabled!=='boolean'){setError(paymentAccounts.error||'Wait for payment accounts to load.');return;}
      if(paymentAccounts.data.accountingEnabled&&amount>0&&!paymentAccounts.data.accounts.some(a=>a._id===receiptAccountId)){setError('Select the cash or bank account receiving this payment.');return;}
    }
    lock.current = true;
    setBusy(true);
    try {
      const request=retry?pending:{quotationId:draft.order._id,body:{paidAmount:amount,requestKey:requestKey(),...(customer?{customerId:customer._id}:{}),...(paymentAccounts.data?.accountingEnabled&&amount>0?{receiptAccountId}:{})}};
      const journaled=retry||paymentAccounts.data?.accountingEnabled;
      if(journaled){savePending(storageKey,request);setPending(request);}
      const result = await api("/orders/" + request.quotationId, {
        method: "PATCH",
        body: request.body,
      });
      if(journaled&&(!result?.createOrder?._id||result.createOrder.type!=='INVOICE'||!Array.isArray(result.createOrder.items)||[result.createOrder.totalPrice,result.createOrder.paidAmount,result.createOrder.amountDue].some(value=>!Number.isFinite(value))))throw new Error('The sale response is incomplete. Retry the same conversion to confirm it.');
      if(journaled){clearPending(storageKey);setPending(null);}
      onSaved(receiptFrom(result.createOrder, draft.products, customer));
    } catch (e) {
      if(!uncertain(e)&&!retry){clearPending(storageKey);setPending(null);}
      setError(e.message);
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <Modal
      title="Convert quotation to sale"
      onClose={onClose}
      busy={busy || customerBusy || !!pending}
    >
      <Notice error={error} />
      {pending?<div role="status"><p>The conversion result is not confirmed. Do not collect money again or create another sale. Retry the exact saved request to retrieve its result safely.</p><button className="btn btn-primary" disabled={busy} onClick={e=>submit(e,true)}>{busy?'Checking...':'Retry same conversion'}</button></div>:<>
      <p>
        Total: <strong>{money(draft.order.totalPrice)}</strong>
      </p>
      <form id="convert-quotation" onSubmit={submit}>
        <fieldset disabled={busy}>
          <Field label="Amount paid">
            <input
              className="form-control"
              type="number"
              min="0"
              max={draft.order.totalPrice}
              step="any"
              value={paid}
              onChange={(e) => setPaid(e.target.value)}
              required
            />
          </Field>
          {paymentAccounts.data?.accountingEnabled&&amount>0&&<Field label="Payment account"><select aria-label="Conversion payment account" className="form-select" value={receiptAccountId} onChange={e=>setReceiptAccountId(e.target.value)}><option value="">Choose cash or bank</option>{paymentAccounts.data.accounts.map(account=><option key={account._id} value={account._id}>{account.name}</option>)}</select></Field>}
          <Notice loading={paymentAccounts.loading} error={paymentAccounts.error}/>
          <p>Amount due: {money(Math.max(0, due))}</p>
        </fieldset>
      </form>
      <fieldset disabled={busy}>
        <div className="mb-3">
          <p className="small">
            {due > 0 ? "Customer required" : "Customer (optional)"}
          </p>
          <CustomerPicker
            value={customer}
            onChange={setCustomer}
            required={due > 0}
            onBusy={setCustomerBusy}
          />
        </div>
        <button
          className="btn btn-primary"
          type="submit"
          form="convert-quotation"
          disabled={customerBusy || paymentAccounts.loading}
        >
          {busy ? "Saving..." : "Complete sale"}
        </button>
      </fieldset>
      </>}
    </Modal>
  );
}
