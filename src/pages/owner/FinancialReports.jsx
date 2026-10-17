import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../api/hooks';
import { query } from '../../api/client';
import { pkr, pakistanTime } from '../../api/purchases';
import { Field, Notice, PageTitle } from '../../components/Common';
import RecordTable from '../../components/RecordTable';

function Report({title,value,children}){
  return <section className="panel mb-3"><div className="d-flex justify-content-between align-items-baseline gap-2"><h2 className="h5">{title}</h2>{['INCOMPLETE','PROVISIONAL'].includes(value.status)&&<span className="small text-warning-emphasis">{value.status==='INCOMPLETE'?'Incomplete — needs review':'Provisional'}</span>}</div>
    {value.status==='UNAVAILABLE'?<><p className="mb-1">Unavailable</p><details className="context-help"><summary>Why unavailable?</summary>{value.message}</details></>:children}
  </section>;
}
function Table({headings,rows}){
  return <RecordTable label={headings.join(' / ')} rows={rows} rowKey={(_,i)=>i} columns={headings.map((h,i)=>({key:h,label:h,kind:h.startsWith('Date')?'date':h==='Reference'?'reference':undefined,numeric:/amount|total|quantity|price|cost|balance|expense|opening|closing|movement|current|outstanding|credit|money|capital/i.test(h),render:row=>row[i]}))} empty="No records."/>;
}
function Metric({label,value,amount,children}){
  const available=value?.status!=='UNAVAILABLE'&&Number.isSafeInteger(amount);
  return <div><dt>{label}</dt><dd>{children??(available?pkr(amount):'Unavailable')}</dd>{['PROVISIONAL','INCOMPLETE'].includes(value?.status)&&<small className="text-warning-emphasis">{value.status==='INCOMPLETE'?'Incomplete — needs review':'Provisional'}</small>}</div>;
}
export default function FinancialReports(){
  const today=new Date().toISOString().slice(0,10);
  const [from,setFrom]=useState(today.slice(0,8)+'01'),[to,setTo]=useState(today);
  const [range,setRange]=useState({from:today.slice(0,8)+'01T00:00:00.000Z',to:new Date(Date.parse(today+'T00:00:00.000Z')+86400000).toISOString()});
  const result=useLoad('/accounts/reports'+query(range)),d=result.data;
  function apply(event){event.preventDefault();setRange({from:from+'T00:00:00.000Z',to:new Date(Date.parse(to+'T00:00:00.000Z')+86400000).toISOString()});}
  return <><PageTitle title="Reports"/>
    <form className="d-flex flex-wrap align-items-end gap-3 mb-3" onSubmit={apply}>
      <Field label="From (UTC)"><input className="form-control" type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></Field>
      <Field label="Through (UTC)"><input className="form-control" type="date" min={from} value={to} onChange={e=>setTo(e.target.value)} required/></Field>
      <button className="btn btn-primary mb-3" disabled={result.loading}>Show reports</button>
    </form><Notice loading={result.loading} error={result.error}/>
    {d&&<>
      <h2 className="h6">Selected dates — {range.from.slice(0,10)} to {new Date(Date.parse(range.to)-86400000).toISOString().slice(0,10)} (UTC)</h2>
      <dl className="report-totals"><Metric label="Net sales" value={d.sales} amount={d.sales.revenueMinor}/><Metric label="Expenses" value={d.expenses} amount={d.expenses.netMinor}/></dl>
      <h2 className="h6">Current balances <small className="text-body-secondary">Updated {pakistanTime(d.asOf)} (Pakistan time)</small></h2>
      <dl className="report-totals">
        <Metric label="Cash & Bank" value={d.cashBank}>{d.cashBank.status==='UNAVAILABLE'?'Unavailable':d.cashBank.entries?.length?d.cashBank.entries.map(a=><small key={a.id}>{a.name}: {a.status==='UNAVAILABLE'?'Unavailable':pkr(a.currentBalanceMinor)}</small>):'No accounts'}</Metric>
        <Metric label="Customers owe us" value={d.customers} amount={d.customers.debtMinor}/>
        <Metric label="We owe suppliers" value={d.suppliers} amount={d.suppliers.totalMinor}/>
        <Metric label="Partner capital" value={d.capital} amount={d.capital.balanceMinor}/>
        <Metric label="Inventory estimate — provisional" value={d.inventory} amount={d.inventory.referenceValueMinor}/>
      </dl>
      {d.profit.status==='UNAVAILABLE'&&<p className="small"><a href="#profit-loss">Profit &amp; Loss unavailable</a></p>}
      <details className="context-help"><summary>Report notes</summary><p>{d.coverage}</p><p>Sales are not the cash collected. Customer debt and store credit are separate balances, not sales or physical cash. Partner money is not sales or profit.</p><p>Supplier payments, purchases, customer refunds and capital withdrawals are not operating expenses.</p></details>
      {d.sales.coverageMessage&&<div className="alert alert-warning">Sales exclude invoices before the confirmed starting point: {pakistanTime(d.sales.financialStartAt)}.<details><summary>Coverage details</summary>{d.sales.coverageMessage}</details></div>}
      <Report title="Sales in selected dates" value={d.sales}>
        <Table headings={['Activity','Amount']} rows={[
          ['Original sales before discounts',pkr(d.sales.originalGrossMinor)],['Original discounts',pkr(d.sales.originalDiscountsMinor)],['Products added on adjustment dates',pkr(d.sales.additionsMinor)],['Products returned / cancelled before discount',pkr(d.sales.returnsMinor)],['Discount changes on adjustment dates',pkr(d.sales.discountChangesMinor)],['Sales after discounts and returns',<strong>{pkr(d.sales.revenueMinor)}</strong>]]}/>
        {!!d.sales.excludedUntimedCancellations&&<p className="text-warning-emphasis">{d.sales.excludedUntimedCancellations} old cancelled invoices excluded: cancellation dates were not recorded.</p>}
      </Report>
      <Report title="Operating expenses in selected dates" value={d.expenses}>
        <p className="small">Recorded: {pkr(d.expenses.spentMinor)} — Reversed: {pkr(d.expenses.reversedMinor)}</p>
        <Table headings={['Category','Net expense']} rows={(d.expenses.categories??[]).map(c=>[c.name,pkr(c.totalMinor)])}/>
      </Report>
      <Report title="Cash & Bank" value={d.cashBank}>
        <Table headings={['Account','Opening','Closing','Net movement','Current','History']} rows={(d.cashBank.entries??[]).map(a=>[a.name+(a.active===false?' (inactive)':''),pkr(a.openingMinor),pkr(a.closingMinor),pkr(a.netMovementMinor),a.status==='UNAVAILABLE'?'Unavailable':pkr(a.currentBalanceMinor),<Link to={'/owner/accounts/transactions?account='+encodeURIComponent(a.id)}>Statement</Link>])}/>
        <details className="context-help"><summary>Selected-date account details</summary><p>Opening and closing follow the selected dates; Current is today's balance.</p>{(d.cashBank.entries??[]).filter(a=>a.message).map(a=><p key={a.id}>{a.name}: {a.message}</p>)}
          {(d.cashBank.entries??[]).filter(a=>a.status!=='UNAVAILABLE').map(a=><details key={a.id}><summary>{a.name} — first five movements in selected dates</summary><Table headings={['Date (Pakistan)','Activity','Reference','Money in','Money out']} rows={(a.transactions??[]).map(t=>[pakistanTime(t.occurredAt),t.eventType.replaceAll('_',' '),t.sourceDocument?.invoiceNo??t.sourceDocument?.reference??t.reason,pkr(t.accountPosting?.moneyInMinor),pkr(t.accountPosting?.moneyOutMinor)])}/></details>)}
        </details>
      </Report>
      <Report title="Customer balances — current" value={d.customers}>
        <p className="small">Available store credit: {pkr(d.customers.storeCreditMinor)}</p><Table headings={['Customer','Outstanding','Store credit','History check']} rows={(d.customers.entries??[]).map(c=>[c.name,pkr(c.debtMinor),pkr(c.storeCreditMinor),c.reconciled?'Checked':'Needs review'])}/>
      </Report>
      <Report title="Supplier debt — current" value={d.suppliers}>
        <p className="small">Supplier credit / refund due: {pkr(d.suppliers.creditMinor)}</p><Table headings={['Supplier','Outstanding','Credit / refund due','Details']} rows={(d.suppliers.entries??[]).map(s=>[s.name,s.status==='UNAVAILABLE'?'Unavailable':pkr(s.balanceMinor),pkr(s.creditMinor),<Link to={'/owner/accounts/suppliers/'+s.id}>Supplier Khata</Link>])}/>
        <details className="context-help"><summary>Supplier balance coverage</summary>Deferred receipts are not added.{(d.suppliers.entries??[]).filter(s=>s.message).map(s=><p key={s.id}>{s.name}: {s.message}</p>)}</details>
      </Report>
      <Report title="Partner capital — current" value={d.capital}><p className="small">Money added: {pkr(d.capital.contributionsMinor)} — Money taken out: {pkr(d.capital.withdrawalsMinor)}</p>
        <Table headings={['Partner','Money added','Money taken out','Capital']} rows={(d.capital.entries??[]).map(p=>[p.name,pkr(p.contributionsMinor),pkr(p.withdrawalsMinor),pkr(p.balanceMinor)])}/>
      </Report>
      <Report title="Inventory — current quantities and reference estimate" value={d.inventory}>
        <Table headings={['Product','Quantity','Unit','Current-cost estimate']} rows={(d.inventory.entries??[]).map(p=>[p.name,p.quantity,p.unit,pkr(p.referenceValueMinor)])}/><details className="context-help"><summary>About the provisional estimate</summary>{d.inventory.message}</details>
      </Report>
      <div id="profit-loss"><Report title="Profit & Loss" value={d.profit}/></div>
      {d.profit.evidence&&<details className="context-help"><summary>Why profit is not available</summary><p>Invoices in selected dates: {d.profit.evidence.invoicesInRange}. Purchase cost records: {d.profit.evidence.receiptCostRecordsInRange}. Quantity-only stock records: {d.profit.evidence.quantityOnlyStockRecordsInRange}.</p><p>Buying prices alone do not prove the cost of goods sold. Starting stock, stock changes and damaged returns need verified cost records before profit can be shown. Today's buying price is not used as historical cost.</p></details>}
      {d.opening&&<details className="context-help"><summary>Confirmed starting balances</summary><p>Historical opening at {pakistanTime(d.opening.cutoffAt)} — not current inventory value or profit.</p><Link to="/owner/existing-setup">View confirmed setup and opening equity</Link></details>}
    </>}
  </>;
}
