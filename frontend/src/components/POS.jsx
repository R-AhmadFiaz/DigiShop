import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import { useLoad } from "../api/hooks";
import { lineRate, salePayment, saleTotals, validateSale } from "../api/sale";
import {useProductSearch} from '../api/productSearch';
import ProductFilters from './ProductFilters';
import { clearPending, journalKey, readPending, requestKey, savePending, uncertain } from "../api/invoice";
import { useAuth } from "../auth/AuthContext";
import { Empty, Field, Modal, money, Notice } from "./Common";
import CustomerPicker from "./CustomerPicker";
import Receipt, { receiptFrom } from "./Receipt";
const saleShortcuts=[['F2','Search'],['↑ ↓','Choose product'],['Enter','Add'],['F3','Price list'],['F4','Sale lines'],['+ −','Quantity'],['Del','Remove line'],['F7','Discount'],['F8','Amount paid'],['F9','Customer'],['F10','Complete sale'],['F6','Invoice history'],['Esc','Back to search']];
// screen: the Sales > New sale layout (one screen, keyboard-first). Cashier POS and Quotations keep the default layout.
export default function POS({ quotation = false, onConvertQuotation, screen = false, active = true, onHistory }) {
  const { setQuotations, drafts } = useOutletContext();
  const { user } = useAuth();
  const storageKey = journalKey(user, "pos-credit");
  const [pending, setPending] = useState(() => quotation ? null : readPending(storageKey));
  const draftKey = quotation ? "quotation" : "sale";
  const savedDraft = drafts.current[draftKey] || {};
  const [search, setSearch] = useState(savedDraft.search ?? ""),
    [category, setCategory] = useState(savedDraft.category ?? ""),
    [brand, setBrand] = useState(savedDraft.brand ?? ""),
    [cart, setCart] = useState(savedDraft.cart ?? []),
    [saleType, setSaleType] = useState(savedDraft.saleType ?? "RETAIL"),
    [discountType, setDiscountType] = useState(
      savedDraft.discountType ?? "NONE",
    ),
    [discountValue, setDiscountValue] = useState(
      savedDraft.discountValue ?? "0",
    ),
    [paid, setPaid] = useState(savedDraft.paid ?? null),
    [credit, setCredit] = useState(savedDraft.credit ?? "0"),
    [chosenReceiptAccountId, setReceiptAccountId] = useState(savedDraft.receiptAccountId ?? ""),
    [customer, setCustomer] = useState(savedDraft.customer ?? null),
    [busy, setBusy] = useState(false),
    [customerBusy, setCustomerBusy] = useState(false),
    [error, setError] = useState(""),
    [receipt, setReceipt] = useState(savedDraft.receipt ?? null);
  const workspace=useRef(null),invoiceGrid=useRef(null),paymentInput=useRef(null),editingRow=useRef(null);
  const [selectedRow,setSelectedRow]=useState(null),[removeRow,setRemoveRow]=useState(null),[confirmSale,setConfirmSale]=useState(false);
  const [customerOpen,setCustomerOpen]=useState(false);
  const lock = useRef(false),searchInput=useRef(null),itemInputs=useRef({});
  const saleTypeSelect=useRef(null),discountSelect=useRef(null),typedQuantity=useRef(null);
  const [highlight,setHighlight]=useState(0),[suggestions,setSuggestions]=useState(true),[focusItem,setFocusItem]=useState(null);
  useEffect(()=>{if(focusItem){const field=itemInputs.current[focusItem.id]?.quantity;field?.focus();field?.select();}},[focusItem]);
  useEffect(()=>{
    const shortcut=e=>{
      if(screen){screenShortcut(e);return;}
      if(e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||e.isComposing||e.repeat||busy||customerBusy||document.querySelector('dialog[open]')||!searchInput.current?.getClientRects().length)return;
      if(e.key==='F2'){e.preventDefault();searchInput.current.focus({preventScroll:true});searchInput.current.select();setSuggestions(true);}
      else if(e.key==='F4'&&!quotation){e.preventDefault();paymentInput.current?.focus({preventScroll:true});paymentInput.current?.select();}
      else if(e.key==='F6'){e.preventDefault();editingRow.current=null;focusGrid(selectedRow);setSuggestions(false);}
      else if(e.key==='F10'&&!quotation){e.preventDefault();const message=checkoutError();if(message)setError(message);else {setError('');setConfirmSale(true);}}
    };
    // New sale screen: F2 search, F3 price list, F4 sale lines, F6 invoice history, F7 discount, F8 amount paid,
    // F9 customer, F10 or Ctrl+Enter complete sale, Esc back to search. F5 (reload) is left to the browser.
    const screenShortcut=e=>{
      if(e.altKey||e.metaKey||e.isComposing||busy||customerBusy||document.querySelector('dialog[open]')||!searchInput.current?.getClientRects().length)return;
      const checkout=()=>{const message=checkoutError();if(message)setError(message);else {setError('');setConfirmSale(true);}};
      if(e.ctrlKey){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!e.repeat)checkout();}return;}
      if(e.shiftKey)return;
      const focus=node=>{node?.focus({preventScroll:true});if(node?.tagName==='INPUT')node.select();};
      const action={F2:()=>focus(searchInput.current),F3:()=>focus(saleTypeSelect.current),F4:()=>{editingRow.current=null;typedQuantity.current=null;focusGrid(cart[0]?._id);},F6:()=>onHistory?.(),F7:()=>focus(discountSelect.current),F8:()=>focus(paymentInput.current),F9:()=>setCustomerOpen(true),F10:checkout}[e.key];
      if(action){e.preventDefault();if(!e.repeat)action();return;}
      if(e.key==='Escape'&&!e.defaultPrevented&&!e.target.closest?.('nav[aria-label="Main navigation"]')){e.preventDefault();focus(searchInput.current);}
    };
    window.addEventListener('keydown',shortcut);return()=>window.removeEventListener('keydown',shortcut);
  });
  // Returning to the New sale tab puts the cursor back in product search.
  useEffect(()=>{if(screen&&active)requestAnimationFrame(()=>{if(searchInput.current?.getClientRects().length&&!document.querySelector('dialog[open]'))searchInput.current.focus({preventScroll:true});});},[screen,active]);
  useEffect(()=>{
    const root=workspace.current;if(!root||quotation||screen)return;
    let frame;
    const measure=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!root.getClientRects().length)return;const height=Math.floor(window.innerHeight-(root.getBoundingClientRect().top+window.scrollY)-24);const value=height+'px';if(root.style.getPropertyValue('--pos-height')!==value)root.style.setProperty('--pos-height',value);});};
    const observer=new ResizeObserver(measure);observer.observe(root);if(root.parentElement)observer.observe(root.parentElement);const header=document.querySelector('.app-header');if(header)observer.observe(header);
    window.addEventListener('resize',measure);measure();return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',measure);};
  },[quotation,screen,receipt,pending]);
  const products = useProductSearch({search,category,brand});
  const availableProducts=(products.data?.product??[]).filter(p=>(!category||(p.category?._id??p.category)===category)&&(quotation||p.stockQuantity>0)&&(saleType!=='WHOLESALE'||p.wholesalePrice));
  const categories = useLoad("/categories/");
  const paymentAccounts = useLoad("/orders/payment-accounts");
  const receiptAccountId = chosenReceiptAccountId || (paymentAccounts.data?.accounts?.length === 1 ? paymentAccounts.data.accounts[0]._id : '');
  const totals = saleTotals(cart, saleType, discountType, discountValue),
    creditAmount = quotation ? 0 : Number(credit),
    payment = salePayment(paid, creditAmount > 0 ? Math.max(0, Math.round((totals.total - creditAmount) * 100) / 100) : totals.total),
    paidAmount = payment.amount,
    due = Number.isFinite(paidAmount)
      ? creditAmount > 0 ? Math.max(0, Math.round((totals.total - paidAmount - creditAmount) * 100) / 100) : Math.max(0, totals.total - paidAmount)
      : 0;
  useEffect(() => {
    if (!cart.length || pending) return; // A submitted credit sale has a durable tab journal.
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [cart.length, pending]);
  useEffect(() => {
    drafts.current[draftKey] = {
      search,
      category,
      brand,
      cart,
      saleType,
      discountType,
      discountValue,
      paid,
      credit,
      receiptAccountId,
      customer,
      receipt,
    };
  }, [
    drafts,
    draftKey,
    search,
    category,
    brand,
    cart,
    saleType,
    discountType,
    discountValue,
    paid,
    credit,
    receiptAccountId,
    customer,
    receipt,
  ]);
  function add(product) {
    // Keep only counter fields in the cart, even if a response contains extra data.
    const {
      _id,
      name,
      brand,
      unit,
      stockQuantity,
      retailPrice,
      wholesalePrice,
    } = product;
    const counterProduct = {
      _id,
      name,
      brand,
      unit,
      stockQuantity,
      retailPrice,
      wholesalePrice,
    };
    setError("");
    editingRow.current=null;setSelectedRow(product._id);typedQuantity.current=null;
    // New sale screen: the cursor stays in search with its text selected, ready for the next product.
    if(screen)requestAnimationFrame(()=>{searchInput.current?.focus({preventScroll:true});searchInput.current?.select();document.getElementById('pos-row-'+product._id)?.scrollIntoView({block:'nearest'});});
    else {setFocusItem({id:product._id});setSearch("");setSuggestions(false);}
    setCart((current) => {
      const existing = current.find((p) => p._id === product._id);
      return existing
        ? current.map((p) =>
            p._id === product._id
              ? { ...p, quantity: Number(p.quantity) + 1 }
              : p,
          )
        : [...current, { ...counterProduct, quantity: 1 }];
    });
  }
  function focusGrid(id) {
    const row=cart.find(p=>p._id===id)||cart[0];
    setSelectedRow(row?._id??null);invoiceGrid.current?.focus({preventScroll:true});
    if(row)document.getElementById('pos-row-'+row._id)?.scrollIntoView({block:'nearest'});
  }
  function beginEdit(line) {
    if(editingRow.current?.id!==line._id)editingRow.current={id:line._id,quantity:line.quantity,unitPrice:line.unitPrice,itemDiscount:line.itemDiscount};
    setSelectedRow(line._id);
  }
  function closeRemoval() {
    setRemoveRow(null);
    requestAnimationFrame(()=>focusGrid(selectedRow));
  }
  function checkoutError() {
    const validation = validateSale(
      cart,
      saleType,
      discountType,
      discountValue,
      paidAmount,
      customer,
      quotation,
      creditAmount,
    );
    if(validation)return validation;
    if (!quotation) {
      if (paymentAccounts.loading || paymentAccounts.error || typeof paymentAccounts.data?.accountingEnabled !== 'boolean') {
        return paymentAccounts.error || 'Wait for payment accounts to load before completing the sale.';
      }
      if (paymentAccounts.data.accountingEnabled && paidAmount > 0 && !paymentAccounts.data.accounts.some(a => a._id === receiptAccountId)) {
        return 'Select the cash or bank account receiving this payment.';
      }
    }
    return '';
  }
  async function submit(event, retry = false) {
    event.preventDefault();
    if (lock.current || customerBusy) return;
    setError('');
    const validation=retry?'':checkoutError();
    if(validation){setError(validation);return;}
    lock.current = true;
    setBusy(true);
    try {
      const body = retry ? pending.body : {
        items: cart.map((line) => ({
          productId: line._id,
          quantity: Number(line.quantity),
          ...(line.unitPrice!==undefined?{unitPrice:Number(line.unitPrice)}:{}),
          ...(line.itemDiscount!==undefined?{itemDiscount:Number(line.itemDiscount)}:{}),
        })),
        saleType,
        discountType,
        discountValue: discountType === "NONE" ? 0 : Number(discountValue),
        ...(!quotation
          ? { paidAmount, requestKey: requestKey(), ...(customer ? { customerId: customer._id } : {}), ...(creditAmount > 0 ? { creditAmount } : {}), ...(paymentAccounts.data?.accountingEnabled && paidAmount > 0 ? { receiptAccountId } : {}) }
          : {}),
      };
      const journaled = !quotation && (retry || paymentAccounts.data?.accountingEnabled || body.creditAmount > 0);
      if (journaled) {
        savePending(storageKey, { body });
        setPending({ body });
      }
      const result = await api(
        quotation ? "/orders/quotation" : "/orders/create-order",
        { method: "POST", body },
      );
      const order = quotation ? result.quotation : result;
      if (journaled && (!order?._id || order.type !== "INVOICE" || !Array.isArray(order.items) ||
          [order.totalPrice, order.paidAmount, order.amountDue].some(value => !Number.isFinite(value))))
        throw new Error("The sale response is incomplete. Retry the same sale to confirm it.");
      const saved = receiptFrom(order, cart, quotation ? null : customer);
      if (journaled) { clearPending(storageKey); setPending(null); }
      if (quotation)
        setQuotations((current) => [
          ...current,
          {
            order,
            receipt: saved,
            products: cart.map(({ _id, name, brand, unit }) => ({
              _id,
              name,
              brand,
              unit,
            })),
            converted: false,
          },
        ]);
      setReceipt(saved);
      setCart([]);
      setPaid(null);
      setCredit("0");
      setCustomer(null);
      setDiscountType("NONE");
      setDiscountValue("0");
      products.reload();
    } catch (e) {
      if (!uncertain(e) && !retry) { clearPending(storageKey); setPending(null); }
      setError(e.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  // Line fields: Enter moves quantity → price → discount, then back to search; Esc restores the line.
  function lineKeys(e,line,rate){
    if(e.key==='Escape'&&e.target.tagName==='INPUT'&&!e.isComposing){e.preventDefault();const saved=editingRow.current;if(saved?.id===line._id)setCart(rows=>rows.map(p=>p._id===line._id?{...p,quantity:saved.quantity,unitPrice:saved.unitPrice,itemDiscount:saved.itemDiscount}:p));editingRow.current=null;setError('');focusGrid(line._id);return;}
    if(e.repeat&&e.key==='Enter'){e.preventDefault();return;}if(e.key!=='Enter'||e.isComposing||e.ctrlKey||e.altKey||e.metaKey||e.target.tagName!=='INPUT')return;e.preventDefault();const fields=itemInputs.current[line._id],name=e.target.dataset.itemField;if(name==='quantity'){fields.price?.focus();fields.price?.select();}else if(name==='price'){fields.discount?.focus();fields.discount?.select();}else {const message=validateSale([line],saleType,'NONE',0,Math.round(rate.net*Number(line.quantity)*100)/100,null,quotation);if(message){setError(message);return;}editingRow.current=null;searchInput.current?.focus({preventScroll:true});searchInput.current?.select();setSuggestions(true);}
  }
  const setQuantity=(id,quantity)=>setCart(rows=>rows.map(p=>p._id===id?{...p,quantity}:p));
  function removeLine(line){
    const index=cart.findIndex(p=>p._id===line._id),remaining=cart.filter(p=>p._id!==line._id),next=remaining[Math.min(index,remaining.length-1)];
    setCart(remaining);setError('');typedQuantity.current=null;setSelectedRow(next?._id??null);
    requestAnimationFrame(()=>{if(next){invoiceGrid.current?.focus({preventScroll:true});document.getElementById('pos-row-'+next._id)?.scrollIntoView({block:'nearest'});}else {searchInput.current?.focus({preventScroll:true});searchInput.current?.select();}});
  }
  // New sale screen, sale lines focused: ↑/↓ select a line, + / − change its quantity, digits type a quantity, Delete removes it, Enter edits it.
  function screenGridKeys(e){
    if(e.target!==e.currentTarget||e.ctrlKey||e.altKey||e.metaKey||e.isComposing||!cart.length||busy)return;
    const index=Math.max(0,cart.findIndex(p=>p._id===selectedRow)),line=cart[index];
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();typedQuantity.current=null;focusGrid(cart[(index+(e.key==='ArrowDown'?1:-1)+cart.length)%cart.length]._id);}
    else if(e.key==='+'||e.key==='='||e.key==='-'){
      e.preventDefault();typedQuantity.current=null;const next=(Number(line.quantity)||0)+(e.key==='-'?-1:1);
      if(next<1)return;
      if(!quotation&&next>line.stockQuantity){setError('Only '+line.stockQuantity+' in stock for '+line.name+'.');return;}
      setError('');setQuantity(line._id,next);
    }
    else if(/^[0-9]$/.test(e.key)){
      // Digits typed within a second build one number (e.g. 1 then 2 = 12); a pause starts a new number.
      e.preventDefault();const now=Date.now(),typed=typedQuantity.current;
      const text=typed&&typed.id===line._id&&now-typed.time<1000?typed.text+e.key:e.key;
      typedQuantity.current={id:line._id,text,time:now};setError('');setQuantity(line._id,String(Number(text)));
    }
    else if(e.key==='Delete'){e.preventDefault();if(!e.repeat)removeLine(line);}
    else if(e.key==='Enter'){e.preventDefault();if(!e.repeat){typedQuantity.current=null;beginEdit(line);setFocusItem({id:line._id});}}
  }
  const filters=<ProductFilters search={search} searchRef={searchInput} searchProps={{id:screen?'sale-product-search':undefined,role:'combobox','aria-autocomplete':'list','aria-keyshortcuts':'F2','aria-expanded':screen||suggestions,'aria-controls':'pos-suggestions','aria-activedescendant':(screen||suggestions)&&availableProducts[highlight]?'pos-option-'+availableProducts[highlight]._id:undefined,onKeyDown:e=>{
          if(e.isComposing||e.ctrlKey||e.altKey||e.metaKey)return;if(e.repeat&&e.key==='Enter'){e.preventDefault();return;}
          if(e.key==='Tab'){setSuggestions(false);return;}
          if(e.key==='Escape'){e.preventDefault();if(screen)e.currentTarget.select();else setSuggestions(false);return;}
          if(['ArrowDown','ArrowUp','Enter'].includes(e.key)){e.preventDefault();if(busy||products.loading||!availableProducts.length)return;if(e.key==='Enter'){if(suggestions||screen)add(availableProducts[Math.min(highlight,availableProducts.length-1)]);return;}setSuggestions(true);const next=(highlight+(e.key==='ArrowDown'?1:-1)+availableProducts.length)%availableProducts.length;setHighlight(next);document.getElementById('pos-option-'+availableProducts[next]._id)?.scrollIntoView({block:'nearest'});}
        }}} onSearch={value=>{setSearch(value);setHighlight(0);setSuggestions(true);}} category={category} onCategory={value=>{setCategory(value);setHighlight(0);setSuggestions(true);}} brand={brand} onBrand={value=>{setBrand(value);setHighlight(0);setSuggestions(true);}} categories={categories.data?.categories} brands={products.brands} searchLabel="Search products by name or brand" categoryLabel="POS category filter" brandLabel="POS brand filter" autoFocus/>;
  if (pending && !receipt) return <section className="panel">
    <h2 className="h5">Confirm sale result</h2>
    <Notice error={error} />
    <p>The sale result is not yet confirmed. Do not collect cash again or start another sale. Retry the exact saved request to retrieve its result without recording the sale twice.</p>
    <button className="btn btn-primary" disabled={busy} onClick={event => submit(event, true)}>{busy ? "Checking..." : "Retry same sale"}</button>
  </section>;
  if (receipt)
    return (
      <>
        <div className="alert alert-success no-print" role="status">
          {quotation ? "Quotation saved for this session." : "Sale completed."}
        </div>
        <Receipt receipt={receipt} />
        {quotation && onConvertQuotation && (
          <button
            className="btn btn-primary mt-3 me-2 no-print"
            onClick={() => {
              onConvertQuotation(receipt._id);
              setReceipt(null);
            }}
          >
            Make sale
          </button>
        )}
        <button
          className="btn btn-primary mt-3 no-print"
          autoFocus={screen}
          onClick={() => {
            setReceipt(null);
            setSearch("");
          }}
        >
          {quotation ? "New quotation" : "Next sale"}
        </button>
      </>
    );
  const confirmDialog=confirmSale&&<Modal title="Confirm sale" busy={busy} onClose={()=>setConfirmSale(false)}>
          <p>Total: {money(totals.total)} | Amount paid: {money(paidAmount)} | Amount due: {money(due)}</p>
          <button type="button" className="btn btn-outline-secondary me-2" onClick={()=>setConfirmSale(false)}>Back to invoice</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={event=>{setConfirmSale(false);submit(event);}}>Confirm sale</button>
        </Modal>;
  const customerDialog=customerOpen&&<Modal title="Select customer" busy={customerBusy} onClose={()=>setCustomerOpen(false)}><CustomerPicker expanded value={customer} onChange={value=>{setCustomer(value);setCredit('0');if(value)setCustomerOpen(false);}} required={due>0} onBusy={setCustomerBusy}/></Modal>;
  if(screen){
    const results=(products.data?.product??[]).filter(p=>!category||(p.category?._id??p.category)===category);
    const lineCount=cart.length;
    return (
      <div ref={workspace} className="sale-screen" aria-label="Invoice entry workspace">
        <form id="sale-form" className="sale-form" noValidate onSubmit={submit}>
          <fieldset disabled={busy} className="sale-main">
            <aside className="panel sale-search" aria-label="Product search panel">
              <label className="sale-label" htmlFor="sale-product-search">Find a product <kbd>F2</kbd></label>
              {filters}
              <Notice error={categories.error} />
              <Notice error={products.error} loading={products.loading} />
              <div id="pos-suggestions" role="listbox" aria-label="Product suggestions" className="sale-results">
                {results.map(product=>{
                  const price=saleType==='WHOLESALE'?product.wholesalePrice:product.retailPrice;
                  const out=product.stockQuantity<1,noPrice=saleType==='WHOLESALE'&&!product.wholesalePrice;
                  const selected=availableProducts[highlight]?._id===product._id;
                  return <button type="button" key={product._id} id={'pos-option-'+product._id} role="option" aria-selected={selected} tabIndex={-1}
                    className={'sale-result'+(selected?' selected':'')+(out?' is-out':'')} disabled={busy||products.loading||out||noPrice} onClick={()=>add(product)}>
                    <span className="sale-result-name">
                      <strong>{product.name}</strong>
                      <small>{product.category?.name||'Category unavailable'} · {product.brand} · {product.unit} · Stock {product.stockQuantity}</small>
                    </span>
                    <span className="sale-result-price">
                      {noPrice?'No wholesale price':money(price)}
                      {out&&<span className="badge sale-out">Out of stock</span>}
                    </span>
                  </button>;
                })}
                {products.data?.product.length===0&&<Empty>No matching products.</Empty>}
              </div>
            </aside>
            <div className="sale-right">
              <section className="panel sale-cart" aria-labelledby="sale-cart-title">
                <div className="sale-cart-head">
                  <h2 id="sale-cart-title" className="h6 mb-0">Current sale</h2>
                  <span className="sale-count" aria-live="polite">{lineCount} {lineCount===1?'item':'items'}</span>
                  <label className="sale-pricelist">Price list <kbd>F3</kbd>
                    <select ref={saleTypeSelect} className="form-select form-select-sm" aria-keyshortcuts="F3" value={saleType} onChange={e=>setSaleType(e.target.value)}>
                      <option value="RETAIL">Retail</option>
                      <option value="WHOLESALE">Wholesale</option>
                    </select>
                  </label>
                </div>
                <div className="pos-error" role="status"><Notice error={error} /></div>
                <div ref={invoiceGrid} className="sale-lines" tabIndex={0} role="group" aria-label="Sale lines. Up and down arrows choose a line, plus and minus change its quantity, type a number to set it, Delete removes it, Enter edits it." aria-keyshortcuts="F4" aria-activedescendant={selectedRow&&cart.some(p=>p._id===selectedRow)?'pos-row-'+selectedRow:undefined} onKeyDown={screenGridKeys}>
                  <table className="table table-sm cart-table sale-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Qty</th>
                        <th className="text-end">Unit rate</th>
                        <th>Disc/unit</th>
                        <th className="text-end">Line total</th>
                        <th><span className="visually-hidden">Remove</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map(line=>{
                        const rate=lineRate(line,saleType),price=rate.price;
                        const rowError=validateSale([line],saleType,'NONE',0,Math.round(rate.net*Number(line.quantity)*100)/100,null,quotation);
                        const step=delta=>{const next=(Number(line.quantity)||0)+delta;if(next<1)return;if(next>line.stockQuantity){setError('Only '+line.stockQuantity+' in stock for '+line.name+'.');return;}setError('');setQuantity(line._id,next);};
                        return (
                          <tr key={line._id} id={'pos-row-'+line._id} className={selectedRow===line._id?'sale-line-selected':''} onFocus={()=>beginEdit(line)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))editingRow.current=null;}} onKeyDown={e=>lineKeys(e,line,rate)}>
                            <td>
                              {line.name}
                              <small className="text-body-secondary ms-2">{line.brand}</small>
                              {rowError&&<small role="status" className="d-block text-danger">{rowError}</small>}
                            </td>
                            <td>
                              <div className="sale-qty">
                                <button type="button" className="btn btn-outline-secondary btn-sm" tabIndex={-1} aria-label={'Decrease quantity of '+line.name} disabled={Number(line.quantity)<=1} onClick={()=>step(-1)}>−</button>
                                <input className="form-control form-control-sm quantity" aria-invalid={!!rowError} data-item-field="quantity" ref={node=>{(itemInputs.current[line._id]??={}).quantity=node;}} aria-label={'Quantity for '+line.name} type="number" min="1" step="1" max={line.stockQuantity} value={line.quantity} onChange={e=>setQuantity(line._id,e.target.value)}/>
                                <button type="button" className="btn btn-outline-secondary btn-sm" tabIndex={-1} aria-label={'Increase quantity of '+line.name} onClick={()=>step(1)}>+</button>
                              </div>
                            </td>
                            <td><input className="form-control form-control-sm item-rate" aria-label={'Selling price for '+line.name} aria-invalid={!!rowError} data-item-field="price" ref={node=>{(itemInputs.current[line._id]??={}).price=node;}} type="number" min="0" step="0.01" value={line.unitPrice??price} onChange={e=>setCart(rows=>rows.map(p=>p._id===line._id?{...p,unitPrice:e.target.value}:p))}/></td>
                            <td><input className="form-control form-control-sm item-rate" aria-label={'Discount per unit for '+line.name} aria-invalid={!!rowError} data-item-field="discount" ref={node=>{(itemInputs.current[line._id]??={}).discount=node;}} type="number" min="0" step="0.01" max={price} value={line.itemDiscount??0} onChange={e=>setCart(rows=>rows.map(p=>p._id===line._id?{...p,itemDiscount:e.target.value}:p))}/></td>
                            <td className="text-end sale-amount">{money(Number(line.quantity)*rate.net)}</td>
                            <td><button type="button" className="btn btn-outline-danger btn-sm" aria-label={'Remove '+line.name} onClick={()=>removeLine(line)}>×</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!cart.length&&<p className="sale-empty">No items yet. Press <kbd>F2</kbd>, type a product name, then <kbd>Enter</kbd>.</p>}
                </div>
              </section>
              <section className="panel sale-pay" aria-label="Payment">
                <div className="sale-pay-row">
                  <label className="sale-field">
                    <span>Discount <kbd>F7</kbd></span>
                    <select ref={discountSelect} className="form-select" aria-keyshortcuts="F7" value={discountType} onChange={e=>{setDiscountType(e.target.value);setDiscountValue('0');}}>
                      <option value="NONE">No discount</option>
                      <option value="FIXED">Fixed amount</option>
                      <option value="PERCENTAGE">Percentage</option>
                    </select>
                  </label>
                  {discountType!=='NONE'&&<label className="sale-field sale-field-narrow">
                    <span>{discountType==='PERCENTAGE'?'Percent':'Amount'}</span>
                    <input className="form-control" type="number" min="0" step="any" max={discountType==='PERCENTAGE'?100:totals.subtotal} value={discountValue} onChange={e=>setDiscountValue(e.target.value)}/>
                  </label>}
                  <div className="sale-field">
                    <span id="sale-customer-label">Customer <kbd>F9</kbd></span>
                    <button type="button" className="btn btn-outline-secondary sale-customer" aria-labelledby="sale-customer-label sale-customer-name" aria-keyshortcuts="F9" onClick={()=>setCustomerOpen(true)}><span id="sale-customer-name">{customer?customer.name:'Walk-in customer'}</span></button>
                  </div>
                  <label className="sale-field">
                    <span>Amount paid <kbd>F8</kbd></span>
                    <input className="form-control" type="number" step="any" min="0" max={Math.max(0,totals.total-creditAmount)} ref={paymentInput} aria-keyshortcuts="F8" value={payment.value} onChange={e=>setPaid(e.target.value)}/>
                  </label>
                  {paymentAccounts.data?.accountingEnabled&&paidAmount>0&&<label className="sale-field">
                    <span>Payment account</span>
                    <select aria-label="Payment account" className="form-select" value={receiptAccountId} onChange={e=>setReceiptAccountId(e.target.value)}>
                      <option value="">Choose account</option>
                      {paymentAccounts.data.accounts.map(a=><option key={a._id} value={a._id}>{a.name}</option>)}
                    </select>
                  </label>}
                  {customer&&<label className="sale-field sale-field-narrow">
                    <span>Store credit</span>
                    <input className="form-control" type="number" min="0" step="0.01" max={Math.min(totals.total,(customer.storeCreditBalanceMinor??0)/100)} value={credit} onChange={e=>setCredit(e.target.value)}/>
                  </label>}
                  <div className={'sale-due'+(due>0?' owing':'')}><span>Amount due</span><strong>{money(due)}</strong></div>
                  <div className="sale-grand"><span>Total</span><strong>{money(totals.total)}</strong></div>
                </div>
                <Notice error={paymentAccounts.error} />
                <p className="sale-hint">
                  {creditAmount>0?'Amount paid is the cash received, excluding the store credit used.':'Enter less than the total to record a credit sale.'}
                  {due>0&&!customer&&' A credit sale needs a customer (F9).'}
                  {customer&&<> Debt: {money(customer.remainingMoney)} · Store credit available: {money((customer.storeCreditBalanceMinor??0)/100)}.</>}
                </p>
                <button className="btn btn-primary w-100 sale-complete" type="submit" aria-keyshortcuts="F10 Control+Enter" disabled={busy || customerBusy || !cart.length || (!quotation && paymentAccounts.loading)}>
                  {busy?'Saving...':<>Complete sale <kbd>F10</kbd></>}
                </button>
              </section>
            </div>
          </fieldset>
        </form>
        <ul className="sale-shortcuts" aria-label="Keyboard shortcuts">
          {saleShortcuts.map(([key,label])=><li key={key}><kbd>{key}</kbd> {label}</li>)}
        </ul>
        {confirmDialog}
        {customerDialog}
      </div>
    );
  }
  return (
    <div ref={workspace} className={"pos-grid pos-unified"+(!quotation?" pos-billing":"")} aria-label="Invoice entry workspace">
        <form id="sale-form" noValidate onSubmit={submit}>
          <fieldset disabled={busy}>
            <div className="pos-invoice-heading d-flex align-items-center justify-content-between">
              <h2 className="h6 mb-0">
                {quotation ? "Quotation" : "Current sale"}
              </h2>
              <select
                className="form-select w-auto"
                aria-label="Sale type"
                value={saleType}
                onChange={(e) => setSaleType(e.target.value)}
              >
                <option value="RETAIL">Retail</option>
                <option value="WHOLESALE">Wholesale</option>
              </select>
            </div>
            <div className="pos-error" role="status"><Notice error={error} /></div>
            <div ref={invoiceGrid} className="table-responsive pos-lines" tabIndex={0} role="group" aria-label="Invoice items" aria-keyshortcuts="F6" aria-activedescendant={selectedRow&&cart.some(p=>p._id===selectedRow)?'pos-row-'+selectedRow:undefined} onKeyDown={e=>{
              if(e.target!==e.currentTarget||e.ctrlKey||e.altKey||e.metaKey||e.isComposing)return;
              if(!['ArrowDown','ArrowUp','Enter','Delete'].includes(e.key))return;
              e.preventDefault();if(!cart.length||busy||e.repeat&&['Enter','Delete'].includes(e.key))return;
              const index=Math.max(0,cart.findIndex(p=>p._id===selectedRow)),line=cart[index];
              if(e.key==='ArrowDown'||e.key==='ArrowUp')focusGrid(cart[(index+(e.key==='ArrowDown'?1:-1)+cart.length)%cart.length]._id);
              else if(e.key==='Enter'){beginEdit(line);setFocusItem({id:line._id});}
              else setRemoveRow(line);
            }}>
              <table className="table table-sm cart-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th className="text-end">Unit rate</th>
                    <th>Discount / unit</th>
                    <th className="text-end">Line total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cart.map((line) => {
                    const rate=lineRate(line,saleType),price=rate.price;
                    const rowError=validateSale([line],saleType,'NONE',0,Math.round(rate.net*Number(line.quantity)*100)/100,null,quotation);
                    return (
                      <tr key={line._id} id={'pos-row-'+line._id} className={selectedRow===line._id?'pos-row-selected':''} onFocus={()=>beginEdit(line)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))editingRow.current=null;}} onKeyDown={e=>lineKeys(e,line,rate)}>
                        <td>
                          {line.name}
                          {rowError&&<small role="status" className="d-block text-danger">{rowError}</small>}
                          <small className="d-block text-body-secondary">
                            {line.brand}
                          </small>
                        </td>
                        <td>
                          <input
                            className="form-control form-control-sm quantity" aria-invalid={!!rowError} data-item-field="quantity" ref={node=>{(itemInputs.current[line._id]??={}).quantity=node;}}
                            aria-label={"Quantity for " + line.name}
                            type="number"
                            min="1"
                            step="1"
                            max={quotation ? undefined : line.stockQuantity}
                            value={line.quantity}
                            onChange={(e) =>
                              setCart((current) =>
                                current.map((p) =>
                                  p._id === line._id
                                    ? { ...p, quantity: e.target.value }
                                    : p,
                                ),
                              )
                            }
                          />
                        </td>
                        <td><input className="form-control form-control-sm item-rate" aria-label={'Selling price for '+line.name} aria-invalid={!!rowError} data-item-field="price" ref={node=>{(itemInputs.current[line._id]??={}).price=node;}} type="number" min="0" step="0.01" value={line.unitPrice??price} onChange={e=>setCart(rows=>rows.map(p=>p._id===line._id?{...p,unitPrice:e.target.value}:p))}/></td>
                        <td><input className="form-control form-control-sm item-rate" aria-label={'Discount per unit for '+line.name} aria-invalid={!!rowError} data-item-field="discount" ref={node=>{(itemInputs.current[line._id]??={}).discount=node;}} type="number" min="0" step="0.01" max={price} value={line.itemDiscount??0} onChange={e=>setCart(rows=>rows.map(p=>p._id===line._id?{...p,itemDiscount:e.target.value}:p))}/></td>
                        <td className="text-end">
                          {money(Number(line.quantity) * rate.net)}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            aria-label={"Remove " + line.name}
                            onClick={()=>{setCart(rows=>rows.filter(p=>p._id!==line._id));setError('');searchInput.current?.focus();searchInput.current?.select();setSuggestions(true);}}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}

                </tbody>
              </table>
            </div>
            <aside className="pos-search-panel" aria-label="Product search panel"><h3 className="h6 mb-2">Find a product (F2)</h3>
        {filters}
        <Notice error={categories.error} />
        <Notice error={products.error} loading={products.loading} />
        <div id="pos-suggestions" role="listbox" aria-label="Product suggestions" className="product-results" hidden={!suggestions}>
          {products.data?.product.filter((p) => !category || (p.category?._id ?? p.category) === category).map((product) => {
            const price =
              saleType === "WHOLESALE"
                ? product.wholesalePrice
                : product.retailPrice;
            return (
              <button
                type="button"
                className={'product-result'+(availableProducts[highlight]?._id===product._id?' selected':'')}
                tabIndex={-1} role="option" aria-selected={availableProducts[highlight]?._id===product._id} id={'pos-option-'+product._id}
                key={product._id}
                disabled={
                  busy ||
                  products.loading ||
                  (!quotation && product.stockQuantity < 1) ||
                  (saleType === "WHOLESALE" && !product.wholesalePrice)
                }
                onClick={() => add(product)}
              >
                <span>
                  <strong>{product.name}</strong>
                  <small>
                    {product.category?.name || 'Category unavailable'} | {product.brand} | {product.unit} | Stock{" "}
                    {product.stockQuantity}
                  </small>
                </span>
                <span className="text-end">
                  {saleType === "WHOLESALE" && !price
                    ? "No wholesale price"
                    : money(price)}
                  <small>Add</small>
                </span>
              </button>
            );
          })}
          {products.data?.product.length === 0 && (
            <Empty>No matching products.</Empty>
          )}
        </div>

            </aside>
            <div className={"pos-payments"+(customer&&!quotation?" has-credit":"")}>
            <div className="row g-2 mt-2">
              <div className={discountType === "NONE" ? "col-12" : "col-7"}>
                <Field label="Discount">
                  <select
                    className="form-select"
                    value={discountType}
                    onChange={(e) => {
                      setDiscountType(e.target.value);
                      setDiscountValue("0");
                    }}
                  >
                    <option value="NONE">No discount</option>
                    <option value="FIXED">Fixed amount</option>
                    <option value="PERCENTAGE">Percentage</option>
                  </select>
                </Field>
              </div>
              {discountType !== "NONE" && (
                <div className="col-5">
                  <Field
                    label={discountType === "PERCENTAGE" ? "Percent" : "Amount"}
                  >
                    <input
                      className="form-control"
                      type="number"
                      min="0"
                      step="any"
                      max={
                        discountType === "PERCENTAGE" ? 100 : totals.subtotal
                      }
                      disabled={discountType === "NONE" || busy}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                    />
                  </Field>
                </div>
              )}
            </div>
            <div className="sale-total">
              <span>Total</span>
              <strong>{money(totals.total)}</strong>
            </div>
            {!quotation && (
              <>
                <Field
                  label="Amount paid"
                  hint={creditAmount > 0 ? "Cash received, excluding the store credit used below." : "Enter a smaller amount for a credit sale."}
                >
                  <input
                    className="form-control"
                    type="number"
                    step="any"
                    min="0"
                    max={Math.max(0, totals.total - creditAmount)}
                    ref={paymentInput} aria-keyshortcuts="F4" value={payment.value}
                    onChange={(e) => setPaid(e.target.value)}
                  />
                </Field>
                {paymentAccounts.data?.accountingEnabled && paidAmount > 0 && <Field label="Payment account">
                  <select aria-label="Payment account" className="form-select" value={receiptAccountId} onChange={e => setReceiptAccountId(e.target.value)}>
                    <option value="">Choose account</option>
                    {paymentAccounts.data.accounts.map(a => <option key={a._id} value={a._id}>{a.name}</option>)}
                  </select>
                </Field>}
                <Notice error={paymentAccounts.error} />
                {customer && <Field label="Store credit to use (Optional)" hint={`Available: ${money((customer.storeCreditBalanceMinor ?? 0) / 100)}. The server verifies the balance at checkout.`}>
                  <input className="form-control" type="number" min="0" step="0.01" max={Math.min(totals.total, (customer.storeCreditBalanceMinor ?? 0) / 100)} value={credit} onChange={e => setCredit(e.target.value)} />
                </Field>}
                <div className="d-flex justify-content-between mb-3">
                  <span>Amount due</span>
                  <strong className={due > 0 ? "text-warning" : ""}>
                    {money(due)}
                  </strong>
                </div>
              </>
            )}
            </div>
          </fieldset>
        </form>
        {removeRow&&<Modal title="Remove invoice item?" onClose={closeRemoval}>
          <p>Remove {removeRow.name} from this invoice?</p>
          <button type="button" className="btn btn-outline-secondary me-2" onClick={closeRemoval}>Keep item</button>
          <button type="button" className="btn btn-danger" onClick={()=>{const remaining=cart.filter(p=>p._id!==removeRow._id);setCart(remaining);setRemoveRow(null);setError('');setSelectedRow(remaining[0]?._id??null);requestAnimationFrame(()=>{if(remaining.length){invoiceGrid.current?.focus({preventScroll:true});document.getElementById('pos-row-'+remaining[0]._id)?.scrollIntoView({block:'nearest'});}else searchInput.current?.focus({preventScroll:true});});}}>Remove item</button>
        </Modal>}
        {confirmDialog}
        <fieldset disabled={busy} className="pos-checkout">
          {!quotation && (
            <div className="mb-3">
              <p className="small mb-2">
                {due > 0
                  ? "Customer required for credit sale"
                  : "Customer (Optional)"}
              </p>
              <button type="button" className="btn btn-outline-secondary" onClick={()=>setCustomerOpen(true)}>{customer?customer.name:'Select customer'}</button>
              {customer&&<small className="text-body-secondary d-block">Debt: {money(customer.remainingMoney)} | Store credit: {money((customer.storeCreditBalanceMinor??0)/100)}</small>}
              {customerDialog}
            </div>
          )}
          <button
            className="btn btn-primary w-100"
            type="submit"
            form="sale-form"
            disabled={busy || customerBusy || !cart.length || (!quotation && paymentAccounts.loading)}
          >
            {busy
              ? "Saving..."
              : quotation
                ? "Create quotation"
                : "Complete sale"}
          </button>
        </fieldset>
    </div>
  );
}
