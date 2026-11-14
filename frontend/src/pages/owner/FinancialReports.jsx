import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../api/hooks';
import { query } from '../../api/client';
import { activity, pkr, pakistanTime } from '../../api/purchases';
import { Modal, Notice } from '../../components/Common';
import RecordTable from '../../components/RecordTable';
import { CustomerAccountHistory } from '../Customers';
import {cashBankTotal} from '../../api/financialReports';
export {cashBankTotal} from '../../api/financialReports';

export const reportCategories=['Sales','Expenses','Cash & Bank','Customers','Suppliers','Capital','Inventory'];

function Table({label,headings,rows}){
  return <RecordTable label={label} rows={rows} rowKey={(_,i)=>i} columns={headings.map((h,i)=>({key:h==='Product'?'product':h,label:h,width:headings.length===2?(i===0?'65%':'35%'):h==='Product'?'45%':h==='Estimated current-cost value'?'25%':undefined,kind:h.startsWith('Date')?'date':h==='Reference'?'reference':undefined,numeric:/amount|total|quantity|value|balance|expense|opening|closing|movement|current|outstanding|credit|money|investment|contribution|withdrawal|capital/i.test(h),render:row=>row[i]}))} empty="No records."/>;
}
function Status({value}){
  return ['INCOMPLETE','PROVISIONAL'].includes(value?.status)?<small className="text-warning-emphasis">{value.status==='INCOMPLETE'?'Incomplete — needs review':'Provisional'}</small>:null;
}
function Metric({label,value,amount,children}){
  return <div className="report-metric"><dt>{label}</dt><dd>{value?.status==='UNAVAILABLE'?'Unavailable':pkr(amount)}</dd><Status value={value}/>{children}</div>;
}
function Report({title,value,children}){
  return <section className="report-content" aria-label={title}><div className="d-flex justify-content-between gap-2 mb-2"><h3 className="h5 mb-0">{title}</h3><Status value={value}/></div>
    {value.status==='UNAVAILABLE'?<p className="alert alert-warning mb-0">Unavailable: {value.message||'Confirmed records are not available.'}</p>:children}
  </section>;
}
// One compact row of the Current balances list: label left, amount right, any status note below.
function Balance({label,value,amount,badge,children}){
  return <div className="report-metric report-balance"><dt>{label}{badge&&<span className="badge report-badge">{badge}</span>}</dt><dd>{value?.status==='UNAVAILABLE'?'Unavailable':pkr(amount)}</dd>{!(badge&&value?.status==='PROVISIONAL')&&<Status value={value}/>}{children}</div>;
}
export function ReportOverview({d,range,onNotes}){
  const cashTotal=cashBankTotal(d.cashBank);
  return <div className="report-overview" role="region" aria-label="Business overview">
    <section className="panel report-card" aria-label="Selected dates">
      <h2 className="report-card-title">Selected dates · {range.from.slice(0,10)} to {new Date(Date.parse(range.to)-86400000).toISOString().slice(0,10)}</h2>
      <dl className="report-overview-grid report-period">
        <Metric label="Net Sales" value={d.sales} amount={d.sales.revenueMinor}/>
        <Metric label="Operating Expenses" value={d.expenses} amount={d.expenses.netMinor}/>
      </dl>
      {d.sales.coverageMessage&&<small className="report-amber-note">Only sales after {pakistanTime(d.sales.financialStartAt)}. See Report Notes.</small>}
      {!!d.sales.excludedUntimedCancellations&&<small className="report-amber-note">Older cancellations missing dates are excluded.</small>}
    </section>
    <section className="panel report-card" aria-labelledby="current-balances-title">
      <div className="report-card-head"><h2 className="report-card-title mb-0" id="current-balances-title">Current balances</h2><small className="text-body-secondary">Updated {pakistanTime(d.asOf)} (Pakistan time)</small></div>
      <dl className="report-balances">
        <Balance label="Cash & Bank" value={d.cashBank} amount={cashTotal}>
          {cashTotal===null&&d.cashBank.status!=='UNAVAILABLE'&&<small className="text-warning-emphasis">Some account balances need setup.</small>}
        </Balance>
        <Balance label="Customers Owe Us" value={d.customers} amount={d.customers.debtMinor}/>
        <Balance label="We Owe Suppliers" value={d.suppliers} amount={d.suppliers.totalMinor}/>
        <Balance label="Partner Capital" value={d.capital} amount={d.capital.balanceMinor}/>
        <Balance label="Estimated Stock Value" value={d.inventory} amount={d.inventory.referenceValueMinor} badge="Provisional"/>
      </dl>
      <p className="report-limits">{d.profit.status==='UNAVAILABLE'?'Profit & Loss unavailable.':'Profit & Loss: see Report Notes.'} <button type="button" className="btn btn-link" aria-controls="report-notes" onClick={e=>onNotes?.(e.currentTarget)}>View limitations</button></p>
    </section>
  </div>;
}
export function ReportContent({d,selected,onCustomer}){
  switch(selected){
    case 'Sales':return <Report title="Sales" value={d.sales}>
      <Table label="Sales report" headings={['Activity','Amount']} rows={[
        ['Sales before discounts',pkr(d.sales.originalGrossMinor)],['Original discounts',pkr(d.sales.originalDiscountsMinor)],
        ['Products added on adjustment dates',pkr(d.sales.additionsMinor)],['Products returned / cancelled before discount',pkr(d.sales.returnsMinor)],
        ['Discount changes on adjustment dates',pkr(d.sales.discountChangesMinor)],['Net Sales',<strong>{pkr(d.sales.revenueMinor)}</strong>]]}/>
      <p className="small text-body-secondary mt-2 mb-0">Sales are not the cash collected. Returns and changes follow their actual dates.</p>
    </Report>;
    case 'Expenses':return <Report title="Operating Expenses" value={d.expenses}>
      <p className="report-subtotal">Recorded: {pkr(d.expenses.spentMinor)} · Reversed: {pkr(d.expenses.reversedMinor)} · <strong>Total: {pkr(d.expenses.netMinor)}</strong></p>
      <Table label="Expense report" headings={['Category','Net expense']} rows={(d.expenses.categories??[]).map(c=>[c.name,pkr(c.totalMinor)])}/>
    </Report>;
    case 'Cash & Bank':return <Report title="Cash & Bank" value={d.cashBank}>
      <p className="report-subtotal">Current total: <strong>{pkr(cashBankTotal(d.cashBank))}</strong></p>
      <Table label="Cash & Bank report" headings={['Account','Opening','Closing','Net movement','Current balance','History']} rows={(d.cashBank.entries??[]).map(a=>[
        a.name+(a.active===false?' (inactive)':''),...['openingMinor','closingMinor','netMovementMinor'].map(key=>a.status==='UNAVAILABLE'||a.rangeAvailable===false?'Unavailable':pkr(a[key])),
        a.status==='UNAVAILABLE'?'Unavailable':pkr(a.currentBalanceMinor),<Link to={'/owner/accounts/transactions?account='+encodeURIComponent(a.id)}>Statement</Link>])}/>
      {(d.cashBank.entries??[]).some(a=>a.message)&&<p className="small text-warning-emphasis mt-2">Some selected-date statements are unavailable. See Report Notes.</p>}
      <p className="small text-body-secondary mt-2">Opening, closing and movement follow selected dates; current balances are today’s figures.</p>
      {(d.cashBank.entries??[]).filter(a=>a.status!=='UNAVAILABLE'&&a.transactions?.length).map(a=><details className="context-help" key={a.id}><summary>{a.name} — first five movements in selected dates</summary>
        <Table label={a.name+' report movements'} headings={['Date (Pakistan)','Activity','Reference','Money in','Money out']} rows={a.transactions.map(t=>[pakistanTime(t.occurredAt),activity(t.eventType),t.sourceDocument?.invoiceNo??t.sourceDocument?.reference??t.reason,pkr(t.accountPosting?.moneyInMinor),pkr(t.accountPosting?.moneyOutMinor)])}/>
      </details>)}
    </Report>;
    case 'Customers':return <Report title="Customers" value={d.customers}>
      <p className="report-subtotal">Outstanding: {pkr(d.customers.debtMinor)} · Store credit: {pkr(d.customers.storeCreditMinor)}</p>
      <Table label="Customer report" headings={['Customer','Outstanding balance','Store credit','History check','Khata']} rows={(d.customers.entries??[]).map(c=>[c.name,pkr(c.debtMinor),pkr(c.storeCreditMinor),c.reconciled?'Checked':'Needs review',<button type="button" className="btn btn-sm btn-outline-secondary" onClick={()=>onCustomer(c)}>Customer Khata</button>])}/>
    </Report>;
    case 'Suppliers':return <Report title="Suppliers" value={d.suppliers}>
      <p className="report-subtotal">Outstanding: {pkr(d.suppliers.totalMinor)} · Credit / refund due: {pkr(d.suppliers.creditMinor)}</p>
      <Table label="Supplier report" headings={['Supplier','Outstanding debt','Credit / refund due','Khata']} rows={(d.suppliers.entries??[]).map(s=>[s.name,s.status==='UNAVAILABLE'?'Unavailable':pkr(s.balanceMinor),s.status==='UNAVAILABLE'?'Unavailable':pkr(s.creditMinor),<Link to={'/owner/accounts/suppliers/'+s.id}>Supplier Khata</Link>])}/>
      <p className="small text-body-secondary mt-2 mb-0">Deferred receipts are not added to debt. Credit / refund due is one combined balance.</p>
    </Report>;
    case 'Capital':return <Report title="Partner Capital" value={d.capital}>
      <div className="d-flex flex-wrap justify-content-between gap-2 mb-2"><p className="report-subtotal mb-0">Contributions: {pkr(d.capital.contributionsMinor)} · Withdrawal: {pkr(d.capital.withdrawalsMinor)} · Net capital: {pkr(d.capital.balanceMinor)}</p><Link to="/owner/partners">Manage investors</Link></div>
      <Table label="Capital report" headings={['Registered investor','Contributions','Withdrawal','Net capital']} rows={(d.capital.entries??[]).map(p=>[p.name,pkr(p.contributionsMinor),pkr(p.withdrawalsMinor),pkr(p.balanceMinor)])}/>
      <p className="small text-body-secondary mt-2 mb-0">Only registered partners are listed. Figures include recorded corrections.</p>
    </Report>;
    case 'Inventory':return <Report title="Inventory" value={d.inventory}>
      <p className="report-subtotal">Estimated Stock Value: <strong>{pkr(d.inventory.referenceValueMinor)}</strong></p>
      <Table label="Inventory report" headings={['Product','Quantity','Unit','Estimated current-cost value']} rows={(d.inventory.entries??[]).map(p=>[p.name,p.quantity,p.unit,pkr(p.referenceValueMinor)])}/>
      <p className="small text-warning-emphasis mt-2 mb-0">Current-cost estimate only — not historical cost or profit.</p>
    </Report>;
    default:return null;
  }
}
export function ReportNotes({d,onClose}){
  return <aside className="report-notes report-notes-panel" id="report-notes" aria-labelledby="report-notes-title" tabIndex={-1}>
    <div className="report-notes-head"><h2 className="h6 mb-0" id="report-notes-title">Report Notes</h2>{onClose&&<button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose} aria-keyshortcuts="Escape">Close <kbd className="report-key">Esc</kbd></button>}</div>
    <p>{d.coverage}</p><p>Selected dates use UTC day boundaries: each report day runs from 5 am to 5 am Pakistan time, not local midnight. Record timestamps are shown in Pakistan time.</p>
    <p>Customer debt and store credit are separate balances, not sales or physical cash. Partner money is not sales or profit. Supplier payments, purchases, customer refunds and capital withdrawals are not operating expenses.</p>
    {d.sales.coverageMessage&&<p>Sales cutoff: {pakistanTime(d.sales.financialStartAt)}. {d.sales.coverageMessage}</p>}
    {!!d.sales.excludedUntimedCancellations&&<p>{d.sales.excludedUntimedCancellations} old cancelled invoices excluded: cancellation dates were not recorded.</p>}
    {['sales','expenses','cashBank','customers','suppliers','capital','inventory'].filter(key=>d[key].message).map(key=><p key={key}>{key==='cashBank'?'Cash & Bank':key}: {d[key].message}</p>)}
    {(d.cashBank.entries??[]).filter(a=>a.message).map(a=><p key={a.id}>{a.name}: {a.message} <Link to={'/owner/accounts/transactions?account='+encodeURIComponent(a.id)}>Statement</Link></p>)}
    {(d.suppliers.entries??[]).filter(s=>s.message).map(s=><p key={s.id}>{s.name}: {s.message} <Link to={'/owner/accounts/suppliers/'+s.id}>Supplier Khata</Link></p>)}
    <h3 className="h6">Profit &amp; Loss — {d.profit.status==='UNAVAILABLE'?'Unavailable':'See supporting records'}</h3><p>{d.profit.message}</p>
    {d.profit.evidence&&<><p>Invoices in selected dates: {d.profit.evidence.invoicesInRange}. Purchase cost records: {d.profit.evidence.receiptCostRecordsInRange}. Quantity-only stock records: {d.profit.evidence.quantityOnlyStockRecordsInRange}.</p><p>Buying prices alone do not prove the cost of goods sold. Starting stock, stock changes and damaged returns need verified cost records before profit can be shown. Today's buying price is not used as historical cost.</p></>}
    {d.opening&&<p>Confirmed starting balances: {pakistanTime(d.opening.cutoffAt)} — historical, not current inventory value or profit. <Link to="/owner/existing-setup">View confirmed setup and opening equity</Link></p>}
  </aside>;
}
const isoDay=date=>date.toISOString().slice(0,10);
// Quick ranges use the same UTC report days as the date fields (5 am to 5 am Pakistan time).
export function quickRange(kind,today){
  const [y,m]=today.split('-').map(Number);
  if(kind==='today')return [today,today];
  if(kind==='month')return [today.slice(0,8)+'01',today];
  return [isoDay(new Date(Date.UTC(y,m-2,1))),isoDay(new Date(Date.UTC(y,m-1,0)))];
}
const quickRanges=[['today','Today'],['month','This month'],['last','Last month']];
const shortcuts=[['Alt+F','From date'],['Alt+T','To date'],['Enter','Show reports'],['1–7','Switch report'],['N','Notes'],['PgUp/PgDn','Scroll report'],['Esc','Close panel']];
export default function FinancialReports(){
  const today=new Date().toISOString().slice(0,10);
  const [from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today),[selected,setSelected]=useState('Sales'),[customer,setCustomer]=useState(null);
  const [range,setRange]=useState({from:today.slice(0,8)+'01T00:00:00.000Z',to:new Date(Date.parse(today+'T00:00:00.000Z')+86400000).toISOString()});
  const [notesOpen,setNotesOpen]=useState(false);
  const result=useLoad('/accounts/reports'+query(range)),d=result.data;
  const fromInput=useRef(null),toInput=useRef(null),panel=useRef(null),notesButton=useRef(null),notesOpener=useRef(null),keys=useRef(null);
  function show(start,end){setRange({from:start+'T00:00:00.000Z',to:new Date(Date.parse(end+'T00:00:00.000Z')+86400000).toISOString()});}
  function apply(event){event.preventDefault();show(from,to);}
  function quick(kind){const [start,end]=quickRange(kind,today);setFrom(start);setTo(end);show(start,end);}
  const shownFrom=range.from.slice(0,10),shownTo=isoDay(new Date(Date.parse(range.to)-86400000));
  // Switching reports moves focus to the report panel so the next key (PgDn, Tab, a number) works at once.
  function choose(name,{focusPanel=true}={}){setSelected(name);if(focusPanel)requestAnimationFrame(()=>panel.current?.focus({preventScroll:true}));}
  function openNotes(opener){notesOpener.current=opener||notesButton.current;setNotesOpen(true);}
  function closeNotes(){setNotesOpen(false);const back=notesOpener.current?.isConnected?notesOpener.current:notesButton.current;requestAnimationFrame(()=>back?.focus());}
  function tabKeys(event){
    const index=reportCategories.indexOf(selected),last=reportCategories.length-1;
    const next={ArrowRight:index===last?0:index+1,ArrowLeft:index===0?last:index-1,Home:0,End:last}[event.key];
    if(next===undefined)return;
    event.preventDefault();choose(reportCategories[next],{focusPanel:false});requestAnimationFrame(()=>document.getElementById('report-tab-'+next)?.focus());
  }
  useEffect(()=>{panel.current?.scrollTo?.(0,0);},[selected]);
  useEffect(()=>{if(notesOpen)document.getElementById('report-notes')?.focus();},[notesOpen]);
  // Page shortcuts. Number keys, N and PgUp/PgDn are ignored while typing in a field; Alt+F/Alt+T work anywhere.
  useEffect(()=>{
    keys.current=event=>{
      if(event.defaultPrevented||event.ctrlKey||event.metaKey||customer)return;
      if(document.querySelector('dialog[open]:not(.navigation-drawer)')||event.target.closest?.('nav[aria-label="Main navigation"]'))return;
      if(event.altKey){
        const target={KeyF:fromInput,KeyT:toInput}[event.code];
        if(target&&!event.shiftKey){event.preventDefault();target.current?.focus();}
        return;
      }
      if(event.key==='Escape'&&notesOpen){event.preventDefault();closeNotes();return;}
      if(!d||event.target.closest?.('input,select,textarea,[contenteditable="true"]'))return;
      if(/^[1-7]$/.test(event.key)){event.preventDefault();choose(reportCategories[Number(event.key)-1]);return;}
      if(event.key==='n'||event.key==='N'){event.preventDefault();if(notesOpen)closeNotes();else openNotes(notesButton.current);return;}
      if((event.key==='PageDown'||event.key==='PageUp')&&panel.current&&!event.target.closest?.('#report-notes')){
        event.preventDefault();const p=panel.current;p.scrollBy({top:(event.key==='PageDown'?1:-1)*Math.max(40,p.clientHeight-40)});
      }
    };
  });
  useEffect(()=>{const listener=event=>keys.current?.(event);document.addEventListener('keydown',listener);return()=>document.removeEventListener('keydown',listener);},[]);
  return <div className="reports-screen">
    <form className="reports-datebar" onSubmit={apply} aria-label="Report dates">
      <h1>Financial Reports</h1>
      <label className="reports-date">From <input ref={fromInput} className="form-control form-control-sm" type="date" value={from} onChange={e=>setFrom(e.target.value)} required accessKey="f" aria-keyshortcuts="Alt+F"/></label>
      <label className="reports-date">To <input ref={toInput} className="form-control form-control-sm" type="date" min={from} value={to} onChange={e=>setTo(e.target.value)} required accessKey="t" aria-keyshortcuts="Alt+T"/></label>
      <button className="btn btn-primary btn-sm" disabled={result.loading}>Show reports</button>
      <div className="reports-quick" role="group" aria-label="Quick date ranges">{quickRanges.map(([kind,label])=>{const [start,end]=quickRange(kind,today);return <button key={kind} type="button" className="btn btn-sm btn-outline-secondary" aria-pressed={shownFrom===start&&shownTo===end} disabled={result.loading} onClick={()=>quick(kind)}>{label}</button>;})}</div>
      <small className="reports-datebar-note" title="Each report day runs from 5 am to 5 am Pakistan time (UTC dates). Record times use Pakistan time.">Report day runs 5 am–5 am Pakistan time</small>
    </form>
    <Notice loading={result.loading} error={result.error}/>
    {d&&<div className="reports-main">
      <div className="reports-side"><ReportOverview d={d} range={range} onNotes={openNotes}/></div>
      <section className="panel reports-detail" aria-label="Explore Reports">
        <div className="reports-tabbar">
          <div className="report-tabs" role="tablist" aria-label="Report categories" onKeyDown={tabKeys}>{reportCategories.map((name,i)=><button key={name} id={'report-tab-'+i} type="button" role="tab" aria-selected={selected===name} aria-controls="selected-report" tabIndex={selected===name?0:-1} aria-keyshortcuts={String(i+1)} className={'btn btn-sm '+(selected===name?'btn-primary':'btn-outline-secondary')} onClick={()=>choose(name)}><span className="report-tab-label">{name}</span><kbd className="report-key" aria-hidden="true">{i+1}</kbd></button>)}</div>
          <select className="form-select form-select-sm report-select" aria-label="Choose report" aria-controls="selected-report" value={selected} onChange={event=>choose(event.target.value,{focusPanel:false})}>{reportCategories.map(name=><option key={name}>{name}</option>)}</select>
          <button ref={notesButton} type="button" className={'btn btn-sm reports-notes-toggle '+(notesOpen?'btn-primary':'btn-outline-secondary')} aria-expanded={notesOpen} aria-controls="report-notes" aria-keyshortcuts="N" onClick={e=>notesOpen?closeNotes():openNotes(e.currentTarget)}>Report notes<kbd className="report-key" aria-hidden="true">N</kbd></button>
        </div>
        <div id="selected-report" ref={panel} className="report-panel" role="tabpanel" aria-labelledby={'report-tab-'+reportCategories.indexOf(selected)} tabIndex={0}><ReportContent d={d} selected={selected} onCustomer={setCustomer}/></div>
        {notesOpen&&<ReportNotes d={d} onClose={closeNotes}/>}
      </section>
    </div>}
    <ul className="reports-shortcuts" aria-label="Keyboard shortcuts">{shortcuts.map(([key,label])=><li key={key}><kbd className="report-key">{key}</kbd> {label}</li>)}</ul>
    {customer&&<Modal wide title={customer.name+' — Customer Khata'} onClose={()=>setCustomer(null)}><CustomerAccountHistory customer={{...customer,_id:customer.id}}/></Modal>}
  </div>;
}
