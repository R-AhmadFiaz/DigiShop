import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../api/hooks';
import { query } from '../../api/client';
import { activity, pkr, pakistanTime } from '../../api/purchases';
import { Field, Modal, Notice, PageTitle } from '../../components/Common';
import RecordTable from '../../components/RecordTable';
import { CustomerBalances, CustomerInvoices } from '../Customers';

export const reportCategories=['Sales','Expenses','Cash & Bank','Customers','Suppliers','Capital','Inventory'];

// Display total only: the complete report must confirm every account balance.
export function cashBankTotal(value){
  if(!value||!['POSTED','POSTED_TEST'].includes(value.status)||!Array.isArray(value.entries))return null;
  let sum=0n;
  for(const account of value.entries){
    if(!['POSTED','POSTED_TEST'].includes(account.status)||!Number.isSafeInteger(account.currentBalanceMinor))return null;
    sum+=BigInt(account.currentBalanceMinor);
  }
  return sum>BigInt(Number.MAX_SAFE_INTEGER)||sum<BigInt(Number.MIN_SAFE_INTEGER)?null:Number(sum);
}
function Table({label,headings,rows}){
  return <RecordTable label={label} rows={rows} rowKey={(_,i)=>i} columns={headings.map((h,i)=>({key:h==='Product'?'product':h,label:h,width:headings.length===2?(i===0?'65%':'35%'):h==='Product'?'45%':h==='Estimated current-cost value'?'25%':undefined,kind:h.startsWith('Date')?'date':h==='Reference'?'reference':undefined,numeric:/amount|total|quantity|value|balance|expense|opening|closing|movement|current|outstanding|credit|money|investment|withdrawal|capital/i.test(h),render:row=>row[i]}))} empty="No records."/>;
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
export function ReportOverview({d,range}){
  const cashTotal=cashBankTotal(d.cashBank);
  return <section aria-label="Business overview" className="report-overview">
    <h2 className="h6">Selected dates · {range.from.slice(0,10)} to {new Date(Date.parse(range.to)-86400000).toISOString().slice(0,10)}</h2>
    <dl className="report-overview-grid report-period">
      <Metric label="Net Sales" value={d.sales} amount={d.sales.revenueMinor}>{d.sales.coverageMessage&&<small className="text-warning-emphasis">Only sales after {pakistanTime(d.sales.financialStartAt)}. See Report Notes.</small>}{!!d.sales.excludedUntimedCancellations&&<small className="text-warning-emphasis">Older cancellations missing dates are excluded.</small>}</Metric>
      <Metric label="Operating Expenses" value={d.expenses} amount={d.expenses.netMinor}/>
    </dl>
    <div className="d-flex flex-wrap justify-content-between gap-1 mb-2"><h2 className="h6 mb-0">Current balances</h2><small className="text-body-secondary">Updated {pakistanTime(d.asOf)} (Pakistan time)</small></div>
    <dl className="report-overview-grid">
      <Metric label="Cash & Bank" value={d.cashBank} amount={cashTotal}>
        {cashTotal===null&&d.cashBank.status!=='UNAVAILABLE'&&<small className="text-warning-emphasis">Some account balances need setup.</small>}
        {!!d.cashBank.entries?.length&&<ul className="report-account-list">{d.cashBank.entries.map(a=><li key={a.id}><Link to={'/owner/accounts/transactions?account='+encodeURIComponent(a.id)}>{a.name}{a.active===false?' (inactive)':''}</Link><span>{a.status==='UNAVAILABLE'?'Unavailable':pkr(a.currentBalanceMinor)}</span></li>)}</ul>}
      </Metric>
      <Metric label="Customers Owe Us" value={d.customers} amount={d.customers.debtMinor}/>
      <Metric label="We Owe Suppliers" value={d.suppliers} amount={d.suppliers.totalMinor}/>
      <Metric label="Partner Capital" value={d.capital} amount={d.capital.balanceMinor}/>
      <Metric label="Estimated Stock Value" value={d.inventory} amount={d.inventory.referenceValueMinor}>{d.inventory.status!=='PROVISIONAL'&&<small className="text-warning-emphasis">Provisional — when available</small>}</Metric>
    </dl>
    <p className="small text-body-secondary mb-3">{d.profit.status==='UNAVAILABLE'?'Profit & Loss unavailable.':'Profit & Loss: see Report Notes.'} <a href="#report-notes" onClick={()=>{const notes=document.getElementById('report-notes');if(notes)notes.open=true;}}>View limitations</a></p>
  </section>;
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
      <p className="report-subtotal">Investment: {pkr(d.capital.contributionsMinor)} · Withdrawal: {pkr(d.capital.withdrawalsMinor)} · Remaining: {pkr(d.capital.balanceMinor)}</p>
      <Table label="Capital report" headings={['Partner','Investment','Withdrawal','Remaining capital']} rows={(d.capital.entries??[]).map(p=>[p.name,pkr(p.contributionsMinor),pkr(p.withdrawalsMinor),pkr(p.balanceMinor)])}/>
    </Report>;
    case 'Inventory':return <Report title="Inventory" value={d.inventory}>
      <p className="report-subtotal">Estimated Stock Value: <strong>{pkr(d.inventory.referenceValueMinor)}</strong></p>
      <Table label="Inventory report" headings={['Product','Quantity','Unit','Estimated current-cost value']} rows={(d.inventory.entries??[]).map(p=>[p.name,p.quantity,p.unit,pkr(p.referenceValueMinor)])}/>
      <p className="small text-warning-emphasis mt-2 mb-0">Current-cost estimate only — not historical cost or profit.</p>
    </Report>;
    default:return null;
  }
}
export function ReportNotes({d}){
  return <details className="context-help report-notes" id="report-notes"><summary>Report Notes</summary>
    <p>{d.coverage}</p><p>Selected dates use UTC day boundaries, not Pakistan midnight. Record timestamps are shown in Pakistan time.</p>
    <p>Customer debt and store credit are separate balances, not sales or physical cash. Partner money is not sales or profit. Supplier payments, purchases, customer refunds and capital withdrawals are not operating expenses.</p>
    {d.sales.coverageMessage&&<p>Sales cutoff: {pakistanTime(d.sales.financialStartAt)}. {d.sales.coverageMessage}</p>}
    {!!d.sales.excludedUntimedCancellations&&<p>{d.sales.excludedUntimedCancellations} old cancelled invoices excluded: cancellation dates were not recorded.</p>}
    {['sales','expenses','cashBank','customers','suppliers','capital','inventory'].filter(key=>d[key].message).map(key=><p key={key}>{key==='cashBank'?'Cash & Bank':key}: {d[key].message}</p>)}
    {(d.cashBank.entries??[]).filter(a=>a.message).map(a=><p key={a.id}>{a.name}: {a.message} <Link to={'/owner/accounts/transactions?account='+encodeURIComponent(a.id)}>Statement</Link></p>)}
    {(d.suppliers.entries??[]).filter(s=>s.message).map(s=><p key={s.id}>{s.name}: {s.message} <Link to={'/owner/accounts/suppliers/'+s.id}>Supplier Khata</Link></p>)}
    <h3 className="h6">Profit &amp; Loss — {d.profit.status==='UNAVAILABLE'?'Unavailable':'See supporting records'}</h3><p>{d.profit.message}</p>
    {d.profit.evidence&&<><p>Invoices in selected dates: {d.profit.evidence.invoicesInRange}. Purchase cost records: {d.profit.evidence.receiptCostRecordsInRange}. Quantity-only stock records: {d.profit.evidence.quantityOnlyStockRecordsInRange}.</p><p>Buying prices alone do not prove the cost of goods sold. Starting stock, stock changes and damaged returns need verified cost records before profit can be shown. Today's buying price is not used as historical cost.</p></>}
    {d.opening&&<p>Confirmed starting balances: {pakistanTime(d.opening.cutoffAt)} — historical, not current inventory value or profit. <Link to="/owner/existing-setup">View confirmed setup and opening equity</Link></p>}
  </details>;
}
export default function FinancialReports(){
  const today=new Date().toISOString().slice(0,10);
  const [from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today),[selected,setSelected]=useState('Sales'),[customer,setCustomer]=useState(null);
  const [range,setRange]=useState({from:today.slice(0,8)+'01T00:00:00.000Z',to:new Date(Date.parse(today+'T00:00:00.000Z')+86400000).toISOString()});
  const result=useLoad('/accounts/reports'+query(range)),d=result.data;
  function apply(event){event.preventDefault();setRange({from:from+'T00:00:00.000Z',to:new Date(Date.parse(to+'T00:00:00.000Z')+86400000).toISOString()});}
  return <><PageTitle title="Financial Reports"/>
    <form className="report-filters" onSubmit={apply}>
      <Field label="From"><input className="form-control" type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></Field>
      <Field label="To"><input className="form-control" type="date" min={from} value={to} onChange={e=>setTo(e.target.value)} required/></Field>
      <button className="btn btn-primary" disabled={result.loading}>Show Reports</button>
      <small className="text-body-secondary">Dates follow the shop’s reporting clock (UTC). Times below use Pakistan time.</small>
    </form><Notice loading={result.loading} error={result.error}/>
    {d&&<><ReportOverview d={d} range={range}/>
      <section className="panel mb-3" aria-label="Explore Reports"><h2 className="h6">Explore Reports</h2>
        <nav className="report-tabs" aria-label="Report categories">{reportCategories.map(name=><button key={name} type="button" aria-pressed={selected===name} aria-controls="selected-report" className={'btn btn-sm '+(selected===name?'btn-primary':'btn-outline-secondary')} onClick={()=>setSelected(name)}>{name}</button>)}</nav>
        <select className="form-select report-select" aria-label="Choose report" aria-controls="selected-report" value={selected} onChange={event=>setSelected(event.target.value)}>{reportCategories.map(name=><option key={name}>{name}</option>)}</select>
        <div id="selected-report"><ReportContent d={d} selected={selected} onCustomer={setCustomer}/></div>
      </section><ReportNotes d={d}/>
    </>}
    {customer&&<Modal wide title={customer.name+' — Customer Khata'} onClose={()=>setCustomer(null)}><CustomerBalances customer={{...customer,_id:customer.id}}/><CustomerInvoices customer={{...customer,_id:customer.id}}/></Modal>}
  </>;
}
