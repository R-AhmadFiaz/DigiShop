import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLoad } from '../../api/hooks';
import { query } from '../../api/client';
import { pkr, pakistanTime } from '../../api/purchases';
import { Field, Notice, PageTitle } from '../../components/Common';

function Report({ title, value, children }) {
  return <section className="panel mb-3"><h2 className="h5">{title}</h2>
    {value.status === 'UNAVAILABLE' ? <p className="text-body-secondary mb-0">Unavailable: {value.message}</p> : <>{['INCOMPLETE','PROVISIONAL'].includes(value.status) && <p className="text-warning-emphasis">{value.status === 'INCOMPLETE' ? 'Incomplete — some history needs review.' : 'Provisional — read the limitations below.'}</p>}{children}</>}
  </section>;
}
function Table({ headings, rows }) {
  return rows.length ? <div className="table-responsive"><table className="table table-sm"><thead><tr>{headings.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div> : <p className="text-body-secondary">No records.</p>;
}
export default function FinancialReports() {
  const today = new Date().toISOString().slice(0,10);
  const [from,setFrom] = useState(today.slice(0,8)+'01'), [to,setTo] = useState(today);
  const [range,setRange] = useState({from:today.slice(0,8)+'01T00:00:00.000Z',to:new Date(Date.parse(today+'T00:00:00.000Z')+86400000).toISOString()});
  const result = useLoad('/accounts/reports'+query(range)), d = result.data;
  function apply(event) { event.preventDefault(); setRange({from:from+'T00:00:00.000Z',to:new Date(Date.parse(to+'T00:00:00.000Z')+86400000).toISOString()}); }
  return <>
    <PageTitle title="Financial Reports"/>
    <form className="d-flex flex-wrap align-items-end gap-3 mb-3" onSubmit={apply}>
      <Field label="From (UTC)"><input className="form-control" type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></Field>
      <Field label="Through (UTC)"><input className="form-control" type="date" min={from} value={to} onChange={e=>setTo(e.target.value)} required/></Field>
      <button className="btn btn-primary mb-3" disabled={result.loading}>Show reports</button>
    </form>
    <Notice loading={result.loading} error={result.error}/>
    {d && <>
      <p className="text-body-secondary">{d.coverage} Updated {pakistanTime(d.asOf)} (Pakistan time).</p>
      <Report title="Sales in selected dates" value={d.sales}>
        <p>Revenue is invoice value after discounts and returns, including credit sales. It is not cash collected.</p>
        <Table headings={['Activity','Amount']} rows={[
          ['Original sales before discounts',pkr(d.sales.originalGrossMinor)],['Original discounts',pkr(d.sales.originalDiscountsMinor)],['Products added on adjustment dates',pkr(d.sales.additionsMinor)],['Products returned / cancelled before discount',pkr(d.sales.returnsMinor)],['Discount changes on adjustment dates',pkr(d.sales.discountChangesMinor)],['Net revenue',<strong>{pkr(d.sales.revenueMinor)}</strong>]]}/>
        {!!d.sales.excludedUntimedCancellations && <p className="text-warning-emphasis">{d.sales.excludedUntimedCancellations} old cancelled invoices excluded: cancellation dates were not recorded.</p>}
      </Report>
      <Report title="Operating expenses in selected dates" value={d.expenses}>
        <p>Recorded: {pkr(d.expenses.spentMinor)} · Reversed: {pkr(d.expenses.reversedMinor)} · Net expenses: <strong>{pkr(d.expenses.netMinor)}</strong></p>
        <Table headings={['Category','Net expense']} rows={(d.expenses.categories??[]).map(c=>[c.name,pkr(c.totalMinor)])}/>
        <p className="text-body-secondary">Supplier payments, purchases, customer refunds and capital withdrawals are not operating expenses.</p>
      </Report>
      <Report title="Cash & Bank" value={d.cashBank}>
        <p className="text-body-secondary">Prepared posted test journals only. Opening / closing amounts refer to the selected dates; current balance is as of this report. Movement includes transfers and capital, not just sales.</p>
        <Table headings={['Account','Opening','Closing','Net movement','Current','History']} rows={(d.cashBank.entries??[]).map(a=>[a.name+(a.active===false?' (inactive)':''),pkr(a.openingMinor),pkr(a.closingMinor),pkr(a.netMovementMinor),a.status==='UNAVAILABLE'?a.message:pkr(a.currentBalanceMinor),<Link to={'/owner/accounts/transactions?account='+encodeURIComponent(a.id)}>Statement</Link>])}/>
        {(d.cashBank.entries??[]).filter(a=>a.rangeAvailable===false).map(a=><p key={a.id} className="text-body-secondary">{a.name}: {a.message}</p>)}
        {(d.cashBank.entries??[]).filter(a=>a.status!=='UNAVAILABLE').map(a=><details key={a.id}><summary>{a.name} — first five movements in selected dates</summary><Table headings={['Date (Pakistan)','Activity','Reference','Money in','Money out']} rows={(a.transactions??[]).map(t=>[pakistanTime(t.occurredAt),t.eventType.replaceAll('_',' '),t.sourceDocument?.invoiceNo??t.sourceDocument?.reference??t.reason,pkr(t.accountPosting?.moneyInMinor),pkr(t.accountPosting?.moneyOutMinor)])}/></details>)}
      </Report>
      <Report title="Customer balances — current" value={d.customers}>
        <p>Outstanding debt: <strong>{pkr(d.customers.debtMinor)}</strong> · Available store credit: <strong>{pkr(d.customers.storeCreditMinor)}</strong>. These are separate balances, not sales or physical cash.</p>
        <Table headings={['Customer','Outstanding','Store credit','History check']} rows={(d.customers.entries??[]).map(c=>[c.name,pkr(c.debtMinor),pkr(c.storeCreditMinor),c.reconciled?'Reconciled':'Needs review'])}/>
      </Report>
      <Report title="Supplier payables — current" value={d.suppliers}>
        <p>Outstanding: <strong>{pkr(d.suppliers.totalMinor)}</strong> · Supplier credit / refund due: <strong>{pkr(d.suppliers.creditMinor)}</strong>. These are separate amounts. Deferred receipts are not added.</p>
        <Table headings={['Supplier','Outstanding','Credit / refund due','Details']} rows={(d.suppliers.entries??[]).map(s=>[s.name,s.status==='UNAVAILABLE'?s.message:pkr(s.balanceMinor),pkr(s.creditMinor),<Link to={'/owner/accounts/suppliers/'+s.id}>Supplier account</Link>])}/>
      </Report>
      <Report title="Partner capital — current" value={d.capital}>
        <p>Net contributions: {pkr(d.capital.contributionsMinor)} · Net withdrawals: {pkr(d.capital.withdrawalsMinor)} · Remaining: <strong>{pkr(d.capital.balanceMinor)}</strong></p>
        <Table headings={['Partner','Contributions','Withdrawals','Capital']} rows={(d.capital.entries??[]).map(p=>[p.name,pkr(p.contributionsMinor),pkr(p.withdrawalsMinor),pkr(p.balanceMinor)])}/>
        <p className="text-body-secondary">Capital is not revenue or profit. Reversals reduce their original contribution or withdrawal totals. Existing opening equity is not a partner investment.</p>
      </Report>
      <Report title="Inventory — current quantities and reference estimate" value={d.inventory}>
        <p>{d.inventory.message}</p><p>Reference estimate: <strong>{pkr(d.inventory.referenceValueMinor)}</strong></p>
        <Table headings={['Product','Quantity','Unit','Current-cost estimate']} rows={(d.inventory.entries??[]).map(p=>[p.name,p.quantity,p.unit,pkr(p.referenceValueMinor)])}/>
      </Report>
      {d.opening && <section className="panel mb-3"><h2 className="h5">Confirmed opening snapshot</h2><p>Historical opening at {pakistanTime(d.opening.cutoffAt)} — not current inventory value or profit.</p><Link to="/owner/existing-setup">View confirmed setup and opening equity</Link></section>}
      <Report title="Profit & Loss" value={d.profit}/>
      {d.profit.evidence&&<details className="panel mb-3"><summary>Why cost and profit need reconciliation</summary><p className="mt-2">Invoices in selected dates: {d.profit.evidence.invoicesInRange}. Purchase cost records: {d.profit.evidence.receiptCostRecordsInRange}. Quantity-only stock records: {d.profit.evidence.quantityOnlyStockRecordsInRange}.</p><p>Receipt costs do not prove the cost of units sold. Opening inventory, manual stock changes and damaged returns need a verified costed inventory cutover before gross or operating profit can be trusted. No historical costs have been filled from today's price.</p></details>}
    </>}
  </>;
}
