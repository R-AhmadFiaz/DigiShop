import { Fragment, useEffect, useRef, useState } from "react";
import { api, query } from "../api/client";
import { useLoad } from "../api/hooks";
import {matchingProducts,useProductSearch} from '../api/productSearch';
import ProductFilters from './ProductFilters';
import { adjustmentBody, amount, clearPending, invoiceEditChanges, journalKey, readPending, requestKey, savePending, uncertain } from "../api/invoice";
import { useAuth } from "../auth/AuthContext";
import { Field, money, Notice } from "./Common";
import CustomerPicker from "./CustomerPicker";
import { FinancialMovements } from "./InvoiceHistory";
import { paymentAccountState } from "../utils/invoiceCashAccount";

function OperationError({ error, reloadRequired, onReload }) {
  if (!error) return null;
  return <div className="alert alert-danger py-2 d-flex flex-wrap align-items-center justify-content-between gap-2" role="alert">
    <span>{error}</span>{reloadRequired&&<button type="button" className="btn btn-outline-danger btn-sm" onClick={onReload}>Reload invoice</button>}
  </div>;
}

function staleInvoiceError(error) {
  return error?.status === 409 && /invoice changed|reload it before continuing/i.test(error.message);
}

function CashAccountField({label, paymentAccounts, value, onChange, onRetry}) {
  const accounts = Array.isArray(paymentAccounts.data?.accounts) ? paymentAccounts.data.accounts : [];
  if (paymentAccounts.data?.accountingEnabled === false) return <p className="small text-body-secondary mb-0" role="status">Cash/bank accounting is off; no account selection is needed.</p>;
  const fieldId = label === 'Refund from' ? 'invoice-refund-account' : 'invoice-receipt-account';
  const loading = paymentAccounts.loading;
  const unavailable = !!paymentAccounts.error || (!loading&&!paymentAccounts.data);
  const empty = !loading && !unavailable && paymentAccounts.data?.accountingEnabled === true && accounts.length === 0;
  return <div className="smart-review-account-field">
    <Field label={label}><select id={fieldId} className="form-select" value={value} onChange={onChange} disabled={loading||unavailable||empty} aria-label={label} aria-required="true" aria-invalid={!value} aria-describedby={!value?'invoice-account-required':undefined}>
      <option value="">{loading?'Loading accounts…':unavailable?'Accounts unavailable':empty?'No active accounts':'Choose cash or bank'}</option>
      {accounts.map(account=><option key={account._id} value={account._id}>{account.name}</option>)}
    </select>
    {loading&&<span id="invoice-account-required" className="form-text" role="status">Loading cash and bank accounts…</span>}
    {unavailable&&<span id="invoice-account-required" className="form-text text-danger" role="alert">Could not load accounts. Retry the account list.</span>}
    {empty&&<span id="invoice-account-required" className="form-text text-danger" role="alert">No active cash/bank accounts. Set one up in Cash &amp; Bank.</span>}
    {!loading&&!unavailable&&!empty&&paymentAccounts.data?.accountingEnabled===true&&!value&&<span id="invoice-account-required" className="form-text">Choose an account to continue.</span>}
    {unavailable&&<button type="button" className="btn btn-link btn-sm p-0" onClick={onRetry}>Retry account list</button>}
    </Field>
  </div>;
}

function AddProducts({ saleType, onAdd, disabled, searchInput, search, setSearch, category, setCategory, brand, setBrand, products, categories, highlight, setHighlight, suggestions, setSuggestions }) {
  const available=(products.data?.product||[]).filter(p=>{const price=saleType==='WHOLESALE'?p.wholesalePrice:p.retailPrice;return p.stockQuantity>0&&price!==null&&price!==undefined&&Number.isFinite(Number(price))&&(saleType!=='WHOLESALE'||Number(price)>0);});
  useEffect(()=>setHighlight(0),[search,category,brand,setHighlight]);
  return <>
    <ProductFilters search={search} searchRef={searchInput} searchProps={{role:'combobox','aria-autocomplete':'list','aria-keyshortcuts':'F2','aria-expanded':suggestions,'aria-controls':'invoice-edit-suggestions','aria-activedescendant':suggestions&&available[highlight]?'invoice-edit-option-'+available[highlight]._id:undefined,onKeyDown:e=>{
      if(e.isComposing||e.ctrlKey||e.altKey||e.metaKey)return;
      if(e.key==='Escape'){e.preventDefault();setSuggestions(false);return;}
      if(e.key==='Tab'){setSuggestions(false);return;}
      if(e.repeat&&e.key==='Enter'){e.preventDefault();return;}
      if(['ArrowDown','ArrowUp','Enter'].includes(e.key)){e.preventDefault();if(disabled||products.loading||!available.length)return;if(e.key==='Enter'){if(suggestions)onAdd(available[Math.min(highlight,available.length-1)]);return;}setSuggestions(true);const next=(highlight+(e.key==='ArrowDown'?1:-1)+available.length)%available.length;setHighlight(next);document.getElementById('invoice-edit-option-'+available[next]._id)?.scrollIntoView({block:'nearest'});}
    }}} onSearch={value=>{setSearch(value);setSuggestions(true);}} category={category} onCategory={value=>{setCategory(value);setSuggestions(true);}} brand={brand} onBrand={value=>{setBrand(value);setSuggestions(true);}} categories={categories.data?.categories} brands={products.brands} visibleSearchLabel="Add products" disabled={disabled}/>
    <Notice error={products.error||categories.error} loading={products.loading} />
    <div id="invoice-edit-suggestions" role="listbox" aria-label="Product suggestions" className="product-results" hidden={!suggestions}>
      {available.map((product,index) => <button key={product._id} id={'invoice-edit-option-'+product._id} type="button" role="option" aria-selected={index===highlight} tabIndex={-1} className={'product-result'+(index===highlight?' selected':'')} disabled={disabled || products.loading} onClick={() => {onAdd(product);setSearch('');setSuggestions(true);searchInput.current?.focus({preventScroll:true});}}>
        <span>{product.name}<small>{product.category?.name||'Category unavailable'} · {product.brand} · Stock {product.stockQuantity}</small></span>
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
  const [additions, setAdditions] = useState([]);
  const lineKey=(line,index)=>line.lineId||`legacy-${index}`;
  const [proposedQuantities,setProposedQuantities]=useState(()=>Object.fromEntries((order.items||[]).map((line,index)=>[lineKey(line,index),String(line.quantity)])));
  const [dispositions,setDispositions]=useState({});
  const [search,setSearch]=useState(''),[category,setCategory]=useState(''),[brand,setBrand]=useState(''),[highlight,setHighlight]=useState(0),[suggestions,setSuggestions]=useState(true);
  const catalog=useProductSearch({}),categories=useLoad('/categories/');
  const products={...catalog,data:catalog.data?{...catalog.data,product:matchingProducts(catalog.data.product,{search,category,brand})}:null};
  const [discountType, setDiscountType] = useState(order.discountType || "NONE");
  const [discountValue, setDiscountValue] = useState(String(order.discountValue ?? 0));
  const [reason, setReason] = useState("");
  const [recipient, setRecipient] = useState(null);
  const [funds, setFunds] = useState({ cashReceivedAmount: "0", creditRedeemedAmount: "0", cashRefundAmount: "0", creditIssueAmount: "0" });
  const [routing,setRouting]=useState({receiptAccountId:'',refundAccountId:''});
  const paymentAccounts=useLoad('/orders/payment-accounts');
  const [preview, setPreview] = useState(null);
  const [reviewBody, setReviewBody] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settlementMode, setSettlementMode] = useState('FULL');
  const [paymentSource, setPaymentSource] = useState('CASH');
  const [settlementAmount, setSettlementAmount] = useState('0');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const [splitRefundCash, setSplitRefundCash] = useState('0');
  const [cashConfirmed, setCashConfirmed] = useState(false);
  const [cashReceivedConfirmed, setCashReceivedConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reloadRequired, setReloadRequired] = useState(false);
  const lock = useRef(false);
  const searchInput=useRef(null),invoiceGrid=useRef(null),workspace=useRef(null),reviewDialog=useRef(null),reviewTrigger=useRef(null),reviewHeading=useRef(null),settlementAmountInput=useRef(null),quantityInputs=useRef({}),additionInputs=useRef({});
  const autoPreviewKey=useRef('');
  const previewSettlementRef=useRef(null);
  const settlementInputVersion=useRef(0);
  const [selectedRow,setSelectedRow]=useState(null),[focusAddition,setFocusAddition]=useState(null);
  const focusLine=id=>{
    const line=order.items.find((item,index)=>lineKey(item,index)===id);
    if(!line)return;setSelectedRow(id);invoiceGrid.current?.focus({preventScroll:true});
    requestAnimationFrame(()=>{const node=document.getElementById('invoice-edit-line-'+id);node?.scrollIntoView({block:'nearest'});});
  };
  const endpoint = `/orders/${order._id}/${mode}`;
  const locked = busy || !!pending;
  const title = { adjustments: "Return / change invoice", payments: "Receive invoice payment", cancellations: "Cancel invoice" }[mode];
  useEffect(()=>{
    const handler=e=>{
      if(e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||e.isComposing||e.repeat||busy||document.querySelector('dialog[open]')||!workspace.current?.getClientRects().length)return;
      if(e.key==='F2'){e.preventDefault();searchInput.current?.focus({preventScroll:true});searchInput.current?.select();setSuggestions(true);}
      else if(e.key==='F6'&&mode==='adjustments'){e.preventDefault();invoiceGrid.current?.focus({preventScroll:true});setSuggestions(false);}
    };
    window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler);
  },[busy,mode]);
  useEffect(()=>{if(focusAddition){const input=additionInputs.current[focusAddition];input?.focus({preventScroll:true});input?.select();input?.scrollIntoView({block:'nearest'});}},[focusAddition,additions]);
  useEffect(()=>{if(reviewOpen&&settlementMode==='PARTIAL'){settlementAmountInput.current?.focus({preventScroll:true});settlementAmountInput.current?.select();}},[reviewOpen,settlementMode]);
  useEffect(()=>{
    if(mode!=='adjustments')return;
    const root=workspace.current;if(!root)return;let frame;
    searchInput.current?.focus({preventScroll:true});
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      if(!root.getClientRects().length)return;
      const visibleBottom=(window.visualViewport?.offsetTop||0)+(window.visualViewport?.height||window.innerHeight);
      const workspaceElement=root.closest('.workspace');
      const bottomSpace=workspaceElement?parseFloat(getComputedStyle(workspaceElement).paddingBottom)||0:0;
      const height=Math.floor(visibleBottom-root.getBoundingClientRect().top-bottomSpace);
      if(height>0)root.style.setProperty('--invoice-editor-height',height+'px');
    });};
    const observer=new ResizeObserver(measure);const header=document.querySelector('.app-header');if(header)observer.observe(header);window.addEventListener('resize',measure);window.visualViewport?.addEventListener('resize',measure);measure();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);window.visualViewport?.removeEventListener('resize',measure);};
  },[mode]);
  function closeReview() {
    setReviewOpen(false); setReview(null); setPreview(null); setReviewBody(null);
    setCashConfirmed(false); setCashReceivedConfirmed(false);
    requestAnimationFrame(()=>reviewTrigger.current?.focus({preventScroll:true}));
  }
  useEffect(()=>{
    const dialog=reviewDialog.current;
    if(reviewOpen&&dialog&&!dialog.open){dialog.showModal();requestAnimationFrame(()=>reviewHeading.current?.focus({preventScroll:true}));}
    else if(!reviewOpen&&dialog?.open)dialog.close();
  },[reviewOpen]);
  function invalidate() { if (!reloadRequired) setError(""); setPreview(null); setReview(null); setReviewBody(null); setCashConfirmed(false); setCashReceivedConfirmed(false); }
  async function previewChange() {
    if (lock.current || reloadRequired) return;
    lock.current = true; setBusy(true); setError(""); invalidate();
    try {
      const edit=mode==='adjustments'?invoiceEditChanges({order,quantities:proposedQuantities,additions,dispositions,products:catalog.data?.product||[]}):null;
      if(edit&&!Object.keys(edit.returns).length&&!edit.additions.length&&discountType===(order.discountType||'NONE')&&Number(discountValue)===Number(order.discountValue??0))throw new Error('Change a quantity, add a product, or revise the discount before review.');
      const draftFunds=editor?{cashReceivedAmount:'0',creditRedeemedAmount:'0',cashRefundAmount:'0',creditIssueAmount:'0'}:funds;
      const body = adjustmentBody({ order, mode, key, reason, returns:edit?.returns??{}, additions:edit?.additions??additions, discountType, discountValue, funds:draftFunds, recipient });
      const result = await api(endpoint + "/preview", { method: "POST", body });
      setPreview(result); setReviewBody(body);
      if(editor){
        // A new draft review is a new preview generation, even when its
        // invoice revision and settlement choices match a previously closed
        // review. Do not let an old auto-preview signature suppress it.
        autoPreviewKey.current='';
        setReview(result);setPreview(null);
        const due=result.requirements?.dueMinor??0,refund=result.requirements?.cashRefundMaximumMinor??0;
        setSettlementMode('FULL');setPaymentSource('CASH');setSettlementAmount((due/100).toFixed(2));
        setRefundMethod('CASH');setSplitRefundCash((refund/100).toFixed(2));
        setCashConfirmed(false);setCashReceivedConfirmed(false);setReviewOpen(true);
      }
    } catch (e) {
      if (staleInvoiceError(e)) { setReloadRequired(true); setError("This invoice changed while you were editing. Reload it before continuing."); }
      else setError(e.message);
    }
    finally { lock.current = false; setBusy(false); }
  }
  async function previewSettlement() {
    if(lock.current||!review||!reviewBody||reloadRequired)return;
    const inputVersion=settlementInputVersion.current;
    lock.current=true;setBusy(true);setError("");setPreview(null);
    try{
      const due=review.requirements?.dueMinor??0,refund=review.requirements?.cashRefundMaximumMinor??0;
      const body={...reviewBody,cashReceivedAmount:0,creditRedeemedAmount:0,cashRefundAmount:0,creditIssueAmount:0};
      delete body.receiptAccountId;delete body.refundAccountId;
      if(due>0){
        if(settlementMode==='FULL'){
          if(paymentSource==='CASH')body.cashReceivedAmount=due/100;
          else body.creditRedeemedAmount=due/100;
        }else if(settlementMode==='PARTIAL'){
          const selected=amount(settlementAmount,paymentSource==='CASH'?'amount to collect':'store credit amount');
          if(selected<=0)throw new Error('Enter an amount greater than zero.');
          if(paymentSource==='CASH')body.cashReceivedAmount=selected;
          else body.creditRedeemedAmount=selected;
        }else if(settlementMode!=='LATER')throw new Error('Choose how to settle the amount due.');
        if(body.cashReceivedAmount+body.creditRedeemedAmount>due/100)throw new Error('The amount cannot be more than the balance due.');
        if(body.creditRedeemedAmount>(availableCredit/100))throw new Error('The selected amount exceeds this customer’s available store credit.');
        if(!order.customerId&&Math.round(body.cashReceivedAmount*100)!==due)throw new Error('Walk-in invoices must be fully paid.');
      }
      if(refund>0){
        if(refundMethod==='CASH')body.cashRefundAmount=refund/100;
        else if(refundMethod==='CREDIT')body.creditIssueAmount=refund/100;
        else if(refundMethod==='SPLIT'){
          body.cashRefundAmount=amount(splitRefundCash,'cash refund');
          body.creditIssueAmount=(refund/100)-body.cashRefundAmount;
          if(body.creditIssueAmount<0)throw new Error('Cash refund cannot exceed the amount to return.');
        } else throw new Error('Choose how to return the refundable amount.');
      }
      const needsCashRouting=body.cashReceivedAmount>0||body.cashRefundAmount>0;
      if(needsCashRouting&&(paymentAccounts.loading||paymentAccounts.error||!paymentAccounts.data))throw new Error('Cash and bank account settings are unavailable. Retry the account list before continuing.');
      if(needsCashRouting&&paymentAccounts.data.accountingEnabled===true){
        const accounts=Array.isArray(paymentAccounts.data.accounts)?paymentAccounts.data.accounts:[];
        for(const [value,field,label] of [[body.cashReceivedAmount,'receiptAccountId','receiving'],[body.cashRefundAmount,'refundAccountId','refund']]){
          if(value>0){
            const accountId=routing[field];
            if(!accounts.some(a=>String(a._id)===String(accountId)))throw new Error('Select the cash/bank account for '+label+' money.');
            body[field]=accountId;
          }
        }
      }
      const result=await api(endpoint+'/preview',{method:'POST',body});
      if(inputVersion!==settlementInputVersion.current)return;
      setReviewBody(body);setPreview(result);setCashConfirmed(false);setCashReceivedConfirmed(false);
    }catch(e){if(inputVersion!==settlementInputVersion.current)return;if(staleInvoiceError(e)){setReloadRequired(true);setError('This invoice changed while you were editing. Reload it before continuing.');}else setError(e.message);}
    finally{if(inputVersion!==settlementInputVersion.current)autoPreviewKey.current='';lock.current=false;setBusy(false);}
  }
  function retrySettlementPreview() {
    autoPreviewKey.current='';
    setError('');
    previewSettlementRef.current?.();
  }
  previewSettlementRef.current=previewSettlement;
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
      if (!uncertain(e) && !recovering) { clearPending(storageKey); setPending(null); setPreview(null); setCashConfirmed(false); setCashReceivedConfirmed(false); }
      if (staleInvoiceError(e)) { setReloadRequired(true); setError("This invoice changed while you were editing. Reload it before continuing."); }
      else setError(uncertain(e) || recovering ? "The result is not confirmed. Do not repeat the cash handover. Check whether saved, or retry this exact request. " + e.message : e.message + " Do not repeat any cash handover. Review a fresh preview before confirming again.");
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
  const editor=mode==='adjustments';
  const reviewData=review;
  const changedMovements=(reviewData?.movements||[]).map(movement=>{
    const original=movement.kind==='RETURN'?order.items.find((item,index)=>lineKey(item,index)===movement.lineId):null;
    const added=additions.find(item=>String(item._id)===String(movement.productId))||(catalog.data?.product||[]).find(item=>String(item._id)===String(movement.productId));
    return {...movement,name:original?.name||original?.productId?.name||added?.name||'Product unavailable'};
  });
  const returnCount=changedMovements.filter(movement=>movement.kind==='RETURN').length;
  const damagedReturnCount=changedMovements.filter(movement=>movement.kind==='RETURN'&&movement.disposition==='DAMAGED').length;
  const restockReturnCount=changedMovements.filter(movement=>movement.kind==='RETURN'&&movement.disposition==='RESTOCK').length;
  const dueMinor=reviewData?.requirements?.dueMinor??0;
  const refundMinor=reviewData?.requirements?.cashRefundMaximumMinor??0;
  const availableCredit=reviewData?.funding?.availableCreditMinor??0;
  const receiptAmount=settlementMode==='FULL'&&paymentSource==='CASH'?dueMinor/100:settlementMode==='PARTIAL'&&paymentSource==='CASH'?(Number(settlementAmount)||0):0;
  const refundCashAmount=refundMethod==='CASH'?refundMinor/100:refundMethod==='SPLIT'?(Number(splitRefundCash)||0):0;
  const receiptAccountState=paymentAccountState(paymentAccounts,routing.receiptAccountId,dueMinor>0&&receiptAmount>0&&paymentAccounts.data?.accountingEnabled!==false);
  const refundAccountState=paymentAccountState(paymentAccounts,routing.refundAccountId,refundMinor>0&&refundCashAmount>0&&paymentAccounts.data?.accountingEnabled!==false);
  const accountBlocked=['loading','unavailable','empty','choose'].includes(receiptAccountState)||['loading','unavailable','empty','choose'].includes(refundAccountState);
  const partialAmountMinor=Math.round((Number(settlementAmount)||0)*100);
  const settlementChoiceInvalid=dueMinor>0&&((settlementMode==='PARTIAL'&&(partialAmountMinor<=0||partialAmountMinor>dueMinor||(paymentSource==='CREDIT'&&partialAmountMinor>availableCredit)))||(settlementMode==='FULL'&&paymentSource==='CREDIT'&&availableCredit<dueMinor));
  const formatMinor=value=>money(Number(value||0)/100);
  const previewMessage=message=>{
    if(!message)return '';
    if(/Anonymous invoice must remain fully settled/i.test(message))return 'Walk-in invoices must be fully paid. Collect the full amount to continue.';
    if(/Refund allocation/i.test(message))return 'Choose how to return the full refundable amount.';
    if(/Insufficient store credit/i.test(message))return 'This customer does not have enough store credit.';
    if(/Payment exceeds outstanding/i.test(message))return 'The payment cannot be more than the balance due.';
    return 'The selected settlement could not be confirmed. Review the amount and payment account.';
  };
  const invalidateSettlement=()=>{settlementInputVersion.current++;setPreview(null);setCashConfirmed(false);setCashReceivedConfirmed(false);setError('');};
  useEffect(()=>{
    if(!reviewOpen||!review||preview||busy||reloadRequired||accountBlocked||settlementChoiceInvalid)return;
    const signature=JSON.stringify([review.revision,settlementMode,paymentSource,settlementAmount,refundMethod,splitRefundCash,routing.receiptAccountId,routing.refundAccountId]);
    if(autoPreviewKey.current===signature)return;
    const timer=setTimeout(()=>{autoPreviewKey.current=signature;previewSettlementRef.current?.();},220);
    return()=>clearTimeout(timer);
  },[reviewOpen,review,preview,busy,reloadRequired,accountBlocked,settlementChoiceInvalid,settlementMode,paymentSource,settlementAmount,refundMethod,splitRefundCash,routing.receiptAccountId,routing.refundAccountId]);
  const editPanel=<section ref={workspace} className="pos-unified invoice-editor no-print" aria-label="Edit invoice workspace">
    <div className="invoice-editor-heading"><h2 className="h6 mb-0">Edit invoice · {order.invoiceNo}</h2><button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy||!!pending} onClick={onClose}>Close</button></div>
    <OperationError error={error} reloadRequired={reloadRequired} onReload={onClose}/>
    {pending ? <div className="invoice-edit-pending" role="status"><p>The result is not confirmed. Do not repeat the cash handover. Check or retry the exact saved request.</p><button type="button" className="btn btn-primary me-2" disabled={busy} onClick={recover}>Check whether saved</button><button type="button" className="btn btn-outline-primary" disabled={busy} onClick={()=>commit()}>Retry same request</button></div> : <>
      <div className="invoice-editor-main">
        <div ref={invoiceGrid} className="table-responsive pos-lines invoice-edit-lines" tabIndex={0} role="group" aria-label="Invoice products" aria-keyshortcuts="F6" aria-activedescendant={selectedRow?`invoice-edit-line-${selectedRow}`:undefined} onKeyDown={e=>{
          if(e.target!==e.currentTarget||e.ctrlKey||e.altKey||e.metaKey||e.isComposing)return;
          if(!['ArrowDown','ArrowUp','Enter'].includes(e.key))return;e.preventDefault();const lines=order.items||[];if(!lines.length)return;
          const ids=lines.map((line,index)=>lineKey(line,index)),at=Math.max(0,ids.indexOf(selectedRow));
          if(e.key==='Enter'){const id=ids[at],input=quantityInputs.current[id];input?.focus({preventScroll:true});input?.select();input?.scrollIntoView({block:'nearest'});}
          else focusLine(ids[(at+(e.key==='ArrowDown'?1:-1)+ids.length)%ids.length]);
        }}>
          <table className="table table-sm cart-table"><colgroup><col className="invoice-col-product"/><col className="invoice-col-sold"/><col className="invoice-col-quantity"/><col className="invoice-col-rate"/><col className="invoice-col-discount"/><col className="invoice-col-total"/><col className="invoice-col-change"/></colgroup><thead><tr><th>Product</th><th className="invoice-number">Sold</th><th className="invoice-number">Quantity</th><th className="invoice-number">Unit rate</th><th className="invoice-number">Discount / unit</th><th className="invoice-number">Line total</th><th>Change</th></tr></thead><tbody>
            {(order.items||[]).map((line,index)=>{const id=lineKey(line,index),name=line.name||line.productId?.name||'Product unavailable',quantity=Number(proposedQuantities[id]??line.quantity),delta=quantity-line.quantity,addedProduct=(catalog.data?.product||[]).find(p=>String(p._id)===String(line.productId?._id??line.productId)),currentPrice=order.saleType==='WHOLESALE'?addedProduct?.wholesalePrice:addedProduct?.retailPrice,currentPriceAvailable=currentPrice!==null&&currentPrice!==undefined&&Number.isFinite(Number(currentPrice))&&(order.saleType!=='WHOLESALE'||Number(currentPrice)>0);return <Fragment key={id}>
              <tr id={'invoice-edit-line-'+id} className={selectedRow===id?'pos-row-selected':''} onFocus={()=>setSelectedRow(id)}>
                <td className="invoice-product-name">{name}</td><td className="invoice-number">{line.quantity}</td>
                <td><input ref={node=>quantityInputs.current[id]=node} className="form-control form-control-sm quantity" type="number" min="0" step="1" value={proposedQuantities[id]??line.quantity} aria-label={`Proposed quantity for ${name}`} onFocus={()=>setSelectedRow(id)} onChange={e=>{invalidate();setProposedQuantities(current=>({...current,[id]:e.target.value}));if(Number(e.target.value)>=line.quantity)setDispositions(current=>{const next={...current};delete next[id];return next;});}} /></td>
                <td className="invoice-number">{money(line.sellingPrice??line.unitPrice)}</td><td className="invoice-number">{money(line.itemDiscount??0)}</td><td className="invoice-number">{money(Number(line.unitPrice)*Math.min(Math.max(0,Number.isFinite(quantity)?quantity:0),line.quantity))}</td><td>{delta<0?`Return ${-delta}`:delta>0?`Add ${delta}`:'—'}</td>
              </tr>
              {delta>0&&<tr className="invoice-edit-added"><td className="invoice-product-name">{name}<small className="d-block text-body-secondary">Added · current price</small></td><td>—</td><td>{delta}</td><td className="invoice-number">{currentPriceAvailable?money(currentPrice):'Price unavailable'}</td><td>—</td><td className="invoice-number">{currentPriceAvailable?money(Number(currentPrice)*delta):'Unavailable'}</td><td>New stock −{delta}</td></tr>}
              {delta<0&&<tr className="invoice-edit-condition"><td colSpan="2">Returned units: {-delta}</td><td colSpan="2"><label className="visually-hidden" htmlFor={`return-condition-${id}`}>Condition of returned {name}</label><select id={`return-condition-${id}`} className="form-select form-select-sm" required aria-required="true" aria-label={`Condition of ${-delta} returned ${name}`} value={dispositions[id]||''} onChange={e=>{invalidate();setDispositions(current=>({...current,[id]:e.target.value}));}}><option value="">Choose condition</option><option value="RESTOCK">Restock (+{-delta} sellable)</option><option value="DAMAGED">Damaged (no stock increase)</option></select></td><td colSpan="3">Refund uses original sale price: {money(line.unitPrice)} each</td></tr>}
            </Fragment>;})}
            {additions.map(line=>{const price=order.saleType==='WHOLESALE'?line.wholesalePrice:line.retailPrice,amount=Number(line.quantity)*Number(price);return <tr key={line._key} className="invoice-edit-added"><td className="invoice-product-name">{line.name}<small className="d-block text-body-secondary">Added · current price</small></td><td>—</td><td><input ref={node=>additionInputs.current[line._key]=node} className="form-control form-control-sm quantity" type="number" min="1" step="1" value={line.quantity} aria-label={`Added quantity for ${line.name}`} onChange={e=>{invalidate();setAdditions(current=>current.map(i=>i._key===line._key?{...i,quantity:e.target.value}:i));}} /></td><td className="invoice-number">{money(price)}</td><td>—</td><td className="invoice-number">{Number.isFinite(amount)?money(amount):'Unavailable'}</td><td><button type="button" className="btn btn-outline-secondary btn-sm" onClick={()=>{invalidate();setAdditions(current=>current.filter(i=>i._key!==line._key));setFocusAddition(null);searchInput.current?.focus({preventScroll:true});}}>Remove</button></td></tr>;})}
          </tbody></table>
          {!order.items?.length&&!additions.length&&<p className="p-3">This invoice has no editable product lines.</p>}
        </div>
        <aside className="pos-search-panel invoice-edit-search" aria-label="Product search panel"><h3 className="h6 mb-2">Find a product (F2)</h3>
          <AddProducts saleType={order.saleType} disabled={locked} searchInput={searchInput} search={search} setSearch={setSearch} category={category} setCategory={setCategory} brand={brand} setBrand={setBrand} products={products} categories={categories} highlight={highlight} setHighlight={setHighlight} suggestions={suggestions} setSuggestions={setSuggestions} onAdd={product=>{invalidate();const line={...product,quantity:1,_key:crypto.randomUUID()};setAdditions(current=>[...current,line]);setFocusAddition(line._key);setSearch('');}} />
        </aside>
      </div>
      <fieldset disabled={locked} className="invoice-editor-checkout" onChange={invalidate}>
        <div className="invoice-checkout-summary">
          <div className="invoice-edit-customer"><strong>Customer</strong><span>{order.customerDisplayName||order.customerId?.name||'Walk-in customer'}</span></div>
          <div className="invoice-edit-discount"><Field label="Invoice discount"><select className="form-select" value={discountType} onChange={e=>setDiscountType(e.target.value)}><option value="NONE">No discount</option><option value="FIXED">Fixed amount</option><option value="PERCENTAGE">Percentage</option></select></Field>{discountType!=='NONE'&&<Field label={discountType==='PERCENTAGE'?'Discount percent':'Fixed discount'}><input className="form-control" type="number" min="0" step="0.01" value={discountValue} onChange={e=>setDiscountValue(e.target.value)}/></Field>}</div>
          <dl className="invoice-edit-finance" aria-live="polite"><div><dt>Invoice total</dt><dd>{money(order.totalPrice)}</dd></div><div><dt>Amount due</dt><dd>{money(order.amountDue)}</dd></div></dl>
        </div>
        <div className="invoice-editor-actions">
          <Field label="Reason (optional)"><input className="form-control" value={reason} maxLength={300} onChange={e=>setReason(e.target.value)} /></Field>
          <div className="invoice-edit-action"><Notice loading={catalog.loading} error={catalog.error}/><button ref={reviewTrigger} type="button" className="btn btn-primary" disabled={busy||reloadRequired||catalog.loading} onClick={previewChange}>{busy?'Checking…':'Review changes'}</button></div>
        </div>
      </fieldset>
      <dialog ref={reviewDialog} className="invoice-smart-review" aria-labelledby="invoice-smart-review-title"
        onCancel={event=>{event.preventDefault();if(!busy)closeReview();}}
        onClose={()=>{if(reviewOpen)setReviewOpen(false);}}
        onKeyDown={event=>{if(event.key==='Enter'&&event.target.matches('input[type="number"]'))event.preventDefault();}}>
        {reviewData&&<div className="invoice-smart-review-shell">
          <header className="invoice-smart-review-header"><h2 id="invoice-smart-review-title" ref={reviewHeading} tabIndex="-1">{order.invoiceNo} — Review invoice</h2><button type="button" className="btn-close" aria-label="Close review" disabled={busy} onClick={closeReview}/></header>
          <div className="invoice-smart-review-body">
            <section className="smart-review-summary" aria-label="Invoice summary">
              <div className="smart-review-metric"><span>Previous total</span><strong>{formatMinor(reviewData.before.totalMinor)}</strong></div>
              <div className="smart-review-metric smart-review-metric-updated"><span>Updated total</span><strong>{formatMinor(reviewData.proposed.totalMinor)}</strong></div>
              <div className="smart-review-metric"><span>Already paid</span><strong>{formatMinor((reviewData.funding?.cashNetMinor??0)+(reviewData.funding?.creditNetMinor??0))}</strong></div>
              {(reviewData.before.dueMinor>0||dueMinor>0)&&<div className="smart-review-dues"><span>Previous due <strong>{formatMinor(reviewData.before.dueMinor)}</strong></span><span>Updated due <strong>{formatMinor(dueMinor)}</strong></span></div>}
              {(reviewData.funding?.cashRefundedMinor>0||reviewData.funding?.creditIssuedMinor>0||reviewData.funding?.creditRedeemedMinor>0||reviewData.requirements?.creditRestoreMinor>0)&&<p className="smart-review-history">History: {reviewData.funding?.cashRefundedMinor>0?'Refunded '+formatMinor(reviewData.funding.cashRefundedMinor):''}{reviewData.funding?.creditIssuedMinor>0?' · Credit issued '+formatMinor(reviewData.funding.creditIssuedMinor):''}{reviewData.funding?.creditRedeemedMinor>0?' · Credit used '+formatMinor(reviewData.funding.creditRedeemedMinor):''}{reviewData.requirements?.creditRestoreMinor>0?' · Credit returned '+formatMinor(reviewData.requirements.creditRestoreMinor):''}</p>}
            </section>
            <div className="smart-review-lower">
              <section className="smart-review-settlement" aria-labelledby="smart-review-settlement-title">
                <h3 id="smart-review-settlement-title">Settlement</h3>
                {dueMinor>0?<>
                  <div className="smart-review-settlement-values" aria-live="polite">
                    <div><span>Amount to settle</span><strong>{formatMinor(dueMinor)}</strong></div>
                    <div><span>{paymentSource==='CREDIT'?'Credit applied':'Receive now'}</span><strong>{preview?.settlement?formatMinor(paymentSource==='CREDIT'?preview.settlement.creditRedeemedMinor:preview.settlement.cashReceivedMinor):'—'}</strong></div>
                    <div><span>Remaining</span><strong>{preview?.settlement?formatMinor(preview.settlement.dueMinor):'—'}</strong></div>
                  </div>
                  {!order.customerId?<p className="smart-review-walkin-note">Full payment required.</p>:<fieldset className="smart-review-mode" aria-label="Payment choice">
                    <legend className="visually-hidden">Payment choice</legend>
                    <label className={settlementMode==='FULL'?'selected':''}><input type="radio" name="settlement-mode" value="FULL" checked={settlementMode==='FULL'} onChange={()=>{invalidateSettlement();setSettlementMode('FULL');setSettlementAmount((dueMinor/100).toFixed(2));}}/><span>Full payment</span></label>
                    <label className={settlementMode==='PARTIAL'?'selected':''}><input type="radio" name="settlement-mode" value="PARTIAL" checked={settlementMode==='PARTIAL'} onChange={()=>{invalidateSettlement();setSettlementMode('PARTIAL');setSettlementAmount('');}}/><span>Partial payment</span></label>
                    <label className={settlementMode==='LATER'?'selected':''}><input type="radio" name="settlement-mode" value="LATER" checked={settlementMode==='LATER'} onChange={()=>{invalidateSettlement();setSettlementMode('LATER');}}/><span>Pay later</span></label>
                  </fieldset>}
                  {order.customerId&&settlementMode==='LATER'&&<p className="smart-review-balance-note">Remaining customer balance: <strong>{preview?.settlement?formatMinor(preview.settlement.dueMinor):formatMinor(dueMinor)}</strong></p>}
                  {order.customerId&&availableCredit>0&&settlementMode!=='LATER'&&<div className="smart-review-source"><label><input type="radio" name="payment-source" checked={paymentSource==='CREDIT'} onChange={()=>{invalidateSettlement();setPaymentSource('CREDIT');setSettlementAmount((Math.min(dueMinor,availableCredit)/100).toFixed(2));}}/> Store credit · {formatMinor(availableCredit)} available</label><label><input type="radio" name="payment-source" checked={paymentSource==='CASH'} onChange={()=>{invalidateSettlement();setPaymentSource('CASH');setSettlementAmount((dueMinor/100).toFixed(2));}}/> Cash / bank</label></div>}
                  {settlementMode==='PARTIAL'&&<div className="smart-review-payment-fields"><Field label={paymentSource==='CREDIT'?'Store credit to use':'Receive now'}><input ref={settlementAmountInput} className="form-control" type="number" min="0.01" max={(Math.min(dueMinor,paymentSource==='CREDIT'?availableCredit:dueMinor)/100).toFixed(2)} step="0.01" value={settlementAmount} aria-label={paymentSource==='CREDIT'?'Store credit to use':'Receive now'} onChange={event=>{invalidateSettlement();setSettlementAmount(event.target.value);}}/></Field>{paymentSource==='CASH'&&<CashAccountField label="Receive payment into" paymentAccounts={paymentAccounts} value={routing.receiptAccountId} onChange={event=>{invalidateSettlement();setRouting(current=>({...current,receiptAccountId:event.target.value}));}} onRetry={paymentAccounts.reload}/>}</div>}
                  {settlementMode==='FULL'&&paymentSource==='CASH'&&<CashAccountField label="Receive payment into" paymentAccounts={paymentAccounts} value={routing.receiptAccountId} onChange={event=>{invalidateSettlement();setRouting(current=>({...current,receiptAccountId:event.target.value}));}} onRetry={paymentAccounts.reload}/>}
                  {settlementMode==='FULL'&&paymentSource==='CREDIT'&&<p className="smart-review-balance-note">Full payment from store credit: <strong>{formatMinor(dueMinor)}</strong></p>}
                  {settlementChoiceInvalid&&<p className="small text-danger mb-0" role="alert">{settlementMode==='FULL'&&paymentSource==='CREDIT'?'Not enough store credit for full payment. Choose partial payment.':'Enter an amount within the balance and available store credit.'}</p>}
                </>:refundMinor>0?<>
                  <p className="smart-review-outcome">Amount to return <strong>{formatMinor(refundMinor)}</strong></p>
                  <label className="smart-review-choice"><input type="radio" name="refund-method" checked={refundMethod==='CASH'} onChange={()=>{invalidateSettlement();setRefundMethod('CASH');}}/> Refund money</label>
                  {refundCashAmount>0&&<div className="smart-review-cash-account"><CashAccountField label="Refund from" paymentAccounts={paymentAccounts} value={routing.refundAccountId} onChange={event=>{invalidateSettlement();setRouting(current=>({...current,refundAccountId:event.target.value}));}} onRetry={paymentAccounts.reload}/></div>}
                  {order.customerId&&<><label className="smart-review-choice"><input type="radio" name="refund-method" checked={refundMethod==='CREDIT'} onChange={()=>{invalidateSettlement();setRefundMethod('CREDIT');}}/> Issue store credit</label><label className="smart-review-choice"><input type="radio" name="refund-method" checked={refundMethod==='SPLIT'} onChange={()=>{invalidateSettlement();setRefundMethod('SPLIT');}}/> Split refund</label>{refundMethod==='SPLIT'&&<div className="smart-review-choice-detail"><Field label="Cash refund"><input className="form-control" type="number" min="0" max={(refundMinor/100).toFixed(2)} step="0.01" value={splitRefundCash} onChange={event=>{invalidateSettlement();setSplitRefundCash(event.target.value);}}/></Field><p className="small mb-0">Store credit: {formatMinor(Math.max(0,refundMinor-Math.round((Number(splitRefundCash)||0)*100)))}</p></div>}</>}
                </>:<p className="smart-review-outcome">No additional payment required</p>}
                {reviewData.validationMessage&&!(!order.customerId&&/Anonymous invoice must remain fully settled/i.test(reviewData.validationMessage))&&!preview?.canSubmit&&<p className="small text-warning-emphasis">{previewMessage(reviewData.validationMessage)}</p>}
                {preview?.validationMessage&&<p className="small text-danger" role="alert">{previewMessage(preview.validationMessage)}</p>}
                {error&&<div className="small text-danger" role="alert"><span>{error}</span>{reloadRequired&&<button type="button" className="btn btn-outline-danger btn-sm ms-2" onClick={onClose}>Reload invoice</button>}</div>}
                {!preview&&!error&&<p className="small text-body-secondary mb-0" id="smart-review-preview-status" role="status">{busy?'Checking settlement…':accountBlocked?'Choose an available cash/bank account to calculate the settlement.':settlementChoiceInvalid?'Enter a valid amount to calculate the settlement.':'Updating settlement…'}</p>}
              </section>
              <section className="smart-review-changes" aria-labelledby="smart-review-changes-title">
                <h3 id="smart-review-changes-title">Changes</h3>
                {changedMovements.length>3?<details><summary>{changedMovements.length} product changes{returnCount>0&&` · ${returnCount} returns (${restockReturnCount} restock, ${damagedReturnCount} damaged)`}</summary>{changedMovements.map((movement,index)=><p className="smart-review-change-row" key={index}><strong>{movement.kind==='RETURN'?'Return':'+'+movement.quantity}</strong><span>{movement.kind==='RETURN'?movement.quantity+' × ':''}{movement.name}</span><span>{formatMinor(movement.unitPriceMinor*movement.quantity)}</span>{movement.disposition&&<small>{movement.disposition==='DAMAGED'?'Damaged':'Restock'}</small>}</p>)}</details>:changedMovements.map((movement,index)=><p className="smart-review-change-row" key={index}><strong>{movement.kind==='RETURN'?'Return':'+'+movement.quantity}</strong><span>{movement.kind==='RETURN'?movement.quantity+' × ':''}{movement.name}</span><span>{formatMinor(movement.unitPriceMinor*movement.quantity)}</span>{movement.disposition&&<small>{movement.disposition==='DAMAGED'?'Damaged':'Restock'}</small>}</p>)}
                {reviewData.before.discountMinor!==reviewData.proposed.discountMinor&&<p className="smart-review-change-row"><strong>Discount</strong><span>{reviewData.before.discountType!==reviewData.proposed.discountType||reviewData.before.discountValue!==reviewData.proposed.discountValue?'Updated':'Applied'}</span><span>{formatMinor(reviewData.before.discountMinor)} → {formatMinor(reviewData.proposed.discountMinor)}</span></p>}
                {!changedMovements.length&&reviewData.before.discountMinor===reviewData.proposed.discountMinor&&<p className="small text-body-secondary mb-0">No product changes</p>}
              </section>
            </div>
          </div>
          <footer className="invoice-smart-review-footer">
            <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={closeReview}>Back to edit</button>
            <div className="invoice-smart-review-footer-confirm">
              {error&&!reloadRequired&&!accountBlocked&&!settlementChoiceInvalid&&!preview&&<button type="button" className="btn btn-outline-primary btn-sm" disabled={busy} onClick={retrySettlementPreview}>Retry preview</button>}
              <button type="button" className="btn btn-primary" disabled={busy||reloadRequired||!preview?.canSubmit} aria-describedby={!preview&&!error?'smart-review-preview-status':undefined} onClick={()=>preview?.canSubmit&&commit({endpoint,body:{...reviewBody,confirmationToken:preview.confirmationToken}})}>{busy?'Saving…':preview?.settlement?.cashReceivedMinor>0?`Confirm & receive ${formatMinor(preview.settlement.cashReceivedMinor)}`:preview?.settlement?.cashRefundMinor>0?`Confirm & refund ${formatMinor(preview.settlement.cashRefundMinor)}`:'Confirm changes'}</button>
            </div>
          </footer>
        </div>}
      </dialog>
      {!order.customerId&&Number(funds.creditIssueAmount)>0&&!order.creditRecipientId&&<div className="mt-2"><p>Store-credit recipient (invoice remains anonymous)</p><CustomerPicker value={recipient} onChange={value=>{invalidate();setRecipient(value);}} required/></div>}
      {order.creditRecipientId&&!order.customerId&&<p className="small">Store credit goes to the previously recorded recipient. The invoice remains anonymous.</p>}
      {!editor&&preview&&<div className="border rounded p-3 mt-2 invoice-edit-preview" aria-label="Server preview">
        <h3 className="h6">Check the final amounts</h3>
        <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Revised product</th><th>Quantity</th><th>Unit price</th></tr></thead><tbody>{preview.proposed.items.map((line, index) => <tr key={line.lineId || index}><td>{line.name || "Product unavailable"}</td><td>{line.quantity}</td><td>{money(line.unitPrice)}</td></tr>)}</tbody></table></div>
        <p className="small">Revised subtotal: {money(preview.proposed.subtotalMinor / 100)} · Discount: {money(preview.proposed.discountMinor / 100)} · Paid after refunds: {money(preview.proposed.settledMinor / 100)}</p>
        <p>Total: {money(preview.before.totalMinor / 100)} → <strong>{money(preview.proposed.totalMinor / 100)}</strong><br />Outstanding: {money(preview.before.dueMinor / 100)} → <strong>{money(preview.proposed.dueMinor / 100)}</strong></p>
        {(preview.movements || []).map((movement, index) => {
          const line = movement.kind === "RETURN" ? order.items.find((i,index) => lineKey(i,index) === movement.lineId) : additions.find(i => i._id === String(movement.productId)) || catalog.data?.product.find(i=>String(i._id)===String(movement.productId));
          return <p className="small mb-1" key={index}>{movement.kind === "RETURN" ? "Return" : "Add"}: {line?.name || line?.productId?.name || "Product unavailable"} · {movement.quantity} × {money(movement.unitPriceMinor / 100)} · {movement.disposition === "DAMAGED" ? "Damaged, no sellable stock increase" : `Sellable stock change: ${movement.stockDelta > 0 ? "+" : ""}${movement.stockDelta}`}</p>;
        })}
        <p className="small mt-2">Refund required: {money(preview.requirements.refundMinor / 100)} · Credit automatically restored: {money(preview.requirements.creditRestoreMinor / 100)} · Refund to split between money and store credit: {money(preview.requirements.cashRefundMaximumMinor / 100)}</p>
        {reviewBody?.receiptAccountId&&<p className="small mb-1">Receive into: {paymentAccounts.data?.accounts.find(a=>a._id===reviewBody.receiptAccountId)?.name||'Selected cash/bank account'}</p>}
        {reviewBody?.refundAccountId&&<p className="small mb-1">Refund from: {paymentAccounts.data?.accounts.find(a=>a._id===reviewBody.refundAccountId)?.name||'Selected cash/bank account'}</p>}
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
  if(editor)return editPanel;
  return <section className="panel mt-3 no-print" aria-label={title}>
    <div className="d-flex justify-content-between mb-3"><h2 className="h5">{title}</h2><button type="button" className="btn btn-outline-secondary btn-sm" disabled={busy||!!pending} onClick={onClose}>Close</button></div>
    <OperationError error={error} reloadRequired={reloadRequired} onReload={onClose}/>
    {pending?<div role="status"><p>We have not confirmed whether this saved. Check or retry the same request below. Do not take or give money again.</p><button type="button" className="btn btn-primary me-2" disabled={busy} onClick={recover}>Check whether saved</button><button type="button" className="btn btn-outline-primary" disabled={busy} onClick={()=>commit()}>Retry same request</button></div>:<>
      {mode==='cancellations'&&<p>Cancel this pending invoice and restock its remaining units. Review the refund and debt settlement below before confirming. Use a full return instead for damaged products.</p>}
      <fieldset disabled={locked} onChange={invalidate}>
        <Field label={mode==='payments'?'Payment note (Optional)':mode==='adjustments'?'Reason (optional)':'Reason'}><input className="form-control" value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></Field>
        <h3 className="h6 mt-3">Payments and refunds (PKR)</h3>
        <p className="small text-body-secondary">Returns reduce unpaid debt first. Payments made with store credit return to store credit. Check the refund split below before confirming.</p>
        <div className="row g-2">{Object.entries({cashReceivedAmount:'Money received now',...(order.customerId?{creditRedeemedAmount:'Use customer store credit'}:{}),...(mode!=='payments'?{cashRefundAmount:'Money to refund',creditIssueAmount:'Give customer store credit'}:{})}).map(([field,label])=><div className="col-sm-6" key={field}><Field label={label}><input className="form-control" type="number" min="0" step="0.01" value={funds[field]} onChange={e=>setFunds(current=>({...current,[field]:e.target.value}))}/></Field></div>)}</div>
        <Notice loading={paymentAccounts.loading} error={paymentAccounts.error}/>
        {paymentAccounts.data?.accountingEnabled&&[[funds.cashReceivedAmount,'receiptAccountId','Receive into'],[funds.cashRefundAmount,'refundAccountId','Refund from']].map(([amount,field,label])=>Number(amount)>0&&<Field key={field} label={label}><select aria-label={label} className="form-select" value={routing[field]||(paymentAccounts.data.accounts.length===1?paymentAccounts.data.accounts[0]._id:'')} onChange={e=>setRouting(current=>({...current,[field]:e.target.value}))}><option value="">Choose cash or bank</option>{paymentAccounts.data.accounts.map(account=><option key={account._id} value={account._id}>{account.name}</option>)}</select></Field>)}
      </fieldset>
      {!order.customerId&&mode!=='payments'&&Number(funds.creditIssueAmount)>0&&!order.creditRecipientId&&<div className="mt-2"><p>Store-credit recipient (original invoice stays anonymous)</p><CustomerPicker value={recipient} onChange={value=>{invalidate();setRecipient(value);}} required/></div>}
      {order.creditRecipientId&&!order.customerId&&<p className="small">Store credit will go to the previously recorded recipient. The original invoice remains anonymous.</p>}
      <button type="button" className="btn btn-primary mt-3" disabled={busy||reloadRequired} onClick={previewChange}>{busy?'Checking...':'Preview changes'}</button>
      {preview&&<div className="border rounded p-3 mt-3" aria-label="Server preview">
        <h3 className="h6">Check the final amounts</h3>
        <p>Total: {money(preview.before.totalMinor/100)} → <strong>{money(preview.proposed.totalMinor/100)}</strong><br/>Outstanding: {money(preview.before.dueMinor/100)} → <strong>{money(preview.proposed.dueMinor/100)}</strong></p>
        <p>Refund required: {money(preview.requirements.refundMinor/100)} · Credit automatically restored: {money(preview.requirements.creditRestoreMinor/100)} · Refund to split between money and store credit: {money(preview.requirements.cashRefundMaximumMinor/100)}</p>
        {preview.settlement&&<FinancialMovements financial={preview.settlement}/>}
        <Notice error={preview.validationMessage}/>
        {preview.canSubmit&&<>
          {preview.settlement.cashRefundMinor>0&&<label className="d-block my-2"><input type="checkbox" className="form-check-input me-2" checked={cashConfirmed} onChange={e=>setCashConfirmed(e.target.checked)}/>I have handed {money(preview.settlement.cashRefundMinor/100)} cash to the customer.</label>}
          {preview.settlement.cashReceivedMinor>0&&<label className="d-block my-2"><input type="checkbox" className="form-check-input me-2" checked={cashReceivedConfirmed} onChange={e=>setCashReceivedConfirmed(e.target.checked)}/>I have received {money(preview.settlement.cashReceivedMinor/100)} cash.</label>}
          <button type="button" className="btn btn-primary mt-2" disabled={busy||(preview.settlement.cashRefundMinor>0&&!cashConfirmed)||(preview.settlement.cashReceivedMinor>0&&!cashReceivedConfirmed)} onClick={()=>commit({endpoint,body:{...reviewBody,confirmationToken:preview.confirmationToken}})}>Confirm {mode==='cancellations'?'cancellation':'payment'}</button>
        </>}
      </div>}
    </>}
  </section>;
}
