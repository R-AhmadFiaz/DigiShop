import { useState } from 'react';
import { Link } from 'react-router-dom';
import { query } from '../api/client';
import { useDebounce, useLoad } from '../api/hooks';
import { usePageParam, useQueryParam } from '../api/paging';
import { activity, pakistanTime, pkr } from '../api/purchases';
import { Empty, Field, Modal, Notice, Pagination } from './Common';
import RecordTable, {RecordFacts} from './RecordTable';

const types=['MANUAL','OPENING','REVERSAL','INVOICE_RECEIPT','INVOICE_REFUND','TRANSFER','SUPPLIER_OPENING','PURCHASE_RECEIPT','SUPPLIER_PAYMENT','SUPPLIER_RETURN','SUPPLIER_REFUND','SUPPLIER_CREDIT_APPLICATION','SUPPLIER_REVERSAL','EXPENSE','EXPENSE_REVERSAL','CAPITAL_CONTRIBUTION','CAPITAL_WITHDRAWAL','CAPITAL_REVERSAL'];
function Source({event,compact=false}){
  const doc=event.sourceDocument;
  return doc?.orderId?<Link to={'/owner/sales/'+doc.orderId}>{doc.reference||doc.invoiceNo||'View invoice'}</Link>:doc?.purchaseOrderId?<Link to={'/owner/purchases/'+doc.purchaseOrderId}>{doc.reference||doc.purchaseReference||'View purchase'}</Link>:<span>{doc?.reference||event.reference||(compact&&event.source?.referenceId?String(event.source.referenceId).slice(0,8)+'…':event.source?.referenceId)||activity(event.eventType)}{doc?.purchaseReference&&<Link className="d-block" to={'/owner/purchases?reference='+encodeURIComponent(doc.purchaseReference)}>Find {doc.purchaseReference}</Link>}</span>;
}
function Detail({eventId,accountId,onClose}){
  const result=useLoad(accountId?'/accounts/financial/'+accountId+'/history/'+eventId:'/accounts/transactions/'+eventId),event=result.data?.transaction;
  return <Modal title="Transaction details" onClose={onClose}><Notice loading={result.loading} error={result.error}/>{event&&<>
    <h3 className="h6">{activity(event.eventType)} · {pkr(event.amountMinor)}</h3><RecordFacts items={[["Source",<Source event={event}/>],["Transaction date (Pakistan)",pakistanTime(event.occurredAt)],["Recorded (Pakistan)",pakistanTime(event.recordedAt)],["Recorded by",(event.actor?.name||'Unavailable')+(event.actor?.role?' ('+activity(event.actor.role)+')':'')],["Note",event.reason]]}/>{event.reversalOf&&<p>This is a linked reversal of an earlier transaction.</p>}{event.reversedBy?.length>0&&<p>This transaction has a linked reversal.</p>}{result.data.originalTransaction&&<p>Original: <Source event={result.data.originalTransaction}/></p>}
    <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Account</th><th>Money received / paid</th></tr></thead><tbody>{event.postings.map(p=><tr key={p.accountId}><td>{p.account?.name||'Unavailable'}</td><td>{p.moneyInMinor>0?'Money in '+pkr(p.moneyInMinor):p.moneyOutMinor>0?'Money out '+pkr(p.moneyOutMinor):'No cash movement'}</td></tr>)}</tbody></table></div>
    {event.businessAction?.items?.length>0&&<ul>{event.businessAction.items.map((i,index)=><li key={index}>{i.name||'Product'}: {i.quantity} units {Number.isSafeInteger(i.unitCostMinor)?'at '+pkr(i.unitCostMinor):''}</li>)}</ul>}
    <details><summary>Accounting details (Optional)</summary><p className="text-body-secondary">Debit and credit are bookkeeping entries, not necessarily cash received or paid.</p><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{event.postings.map(p=><tr key={p.accountId}><td>{p.account?.name||'Unavailable'}</td><td>{pkr(p.debitMinor)}</td><td>{pkr(p.creditMinor)}</td></tr>)}</tbody></table></div></details>
  </>}</Modal>;
}
export default function TransactionHistory({accountId,name,supplier=false,sourceId}){
  // Statement filters and page live in the URL (st* keys) so Back and reload keep the position.
  const [search,setSearch]=useQueryParam('stSearch'),[from,setFrom]=useQueryParam('stFrom'),[to,setTo]=useQueryParam('stTo'),[type,setType]=useQueryParam('stType'),[page,setPage]=usePageParam('stPage'),[selected,setSelected]=useState(null);
  const term=useDebounce(search),filters={q:term,page,limit:20,from:from?from+'T00:00:00.000Z':undefined,to:to?to+'T00:00:00.000Z':undefined,type,sourceId:sourceId||undefined};
  const result=useLoad((accountId?'/accounts/financial/'+accountId+'/history':'/accounts/transactions')+query(filters));
  const data=result.data,entries=accountId?data?.transactions:data?.entries;
  const posting=e=>e.accountPosting||e.postings?.find(p=>String(p.accountId)===accountId);
  return <section className="panel mt-3 fill-panel"><h2 className="h5">{supplier?'Supplier transactions':accountId?(name||'Selected account')+' transactions':'Recorded transactions'}</h2>{!supplier&&<details className="context-help"><summary>About these records</summary><p>Recorded transactions only; unchecked old records may be missing. Times shown are Pakistan time. Date filters use UTC (5 hours behind Pakistan); Before excludes that day.</p></details>}
    <details className="context-help" open={!supplier}><summary>Search and date filters</summary>{supplier&&<p className="small">Dates use UTC, 5 hours behind Pakistan. Before excludes that day.</p>}<div className="row g-2 mb-3"><div className="col-md-4"><Field label="Search transactions"><input className="form-control" placeholder="Reference, activity or actor" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field></div><div className="col-md-2"><Field label="From (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></Field></div><div className="col-md-2"><Field label="Before (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></Field></div><div className="col-md-4"><Field label="Transaction type"><select className="form-select" value={type} onChange={e=>{setType(e.target.value);setPage(1);}}><option value="">All types</option>{(data?.coverage?.records==='CUSTOMER_LEDGER'?['PURCHASE','CANCELLATION','PAYMENT','ADJUSTMENT','CREDIT_ISSUED','CREDIT_REDEEMED','CREDIT_RESTORED']:types).map(t=><option key={t} value={t}>{activity(t)}</option>)}</select></Field></div></div></details>
    <Notice loading={result.loading}/>{result.error&&<p role="alert" className="alert alert-warning">History unavailable: {result.error}</p>}
    {!accountId&&data&&<p className="small text-body-secondary">Each row is one event, not necessarily cash received or paid. Open its details to see the affected accounts.</p>}
    {data&&<>{accountId&&<>{!supplier&&<p className="record-balance">Current account balance: <strong>{pkr(data.balanceMinor)}</strong></p>}{(!supplier||from||to)&&<p>{Number.isSafeInteger(data.rangeOpeningBalanceMinor)?'Balance at start: '+pkr(data.rangeOpeningBalanceMinor):'Opening balance unavailable'} · {Number.isSafeInteger(data.rangeClosingBalanceMinor)?'Balance at end: '+pkr(data.rangeClosingBalanceMinor):'Closing balance unavailable'}</p>}{!supplier&&<details className="context-help"><summary>How balances work</summary>These are changes to the selected account. Debt and credit changes are not cash movements.</details>}</>}
      <RecordTable label={accountId?'Account statement':'Business transaction register'} rows={entries||[]} columns={[
        {key:'date',label:'Date (Pakistan)',render:e=><>{pakistanTime(e.occurredAt||e.recordedAt)}{!e.occurredAt&&<small className="d-block">Recorded date only</small>}</>},
        {key:'action',label:'Action',render:e=><>{activity(e.eventType)}{supplier&&e.sourceDocument&&<small className="d-block"><Source event={e} compact/></small>}</>},
        ...(!supplier?[{key:'reference',label:'Reference',render:e=><Source event={e} compact/>}]:[]),
        ...(accountId?[
          {key:'added',label:supplier?'Debt added (+)':'Balance added (+)',numeric:true,render:e=>{const v=posting(e)?.balanceDeltaMinor;return Number.isSafeInteger(v)?v>0?pkr(v):'—':'Unavailable';}},
          {key:'reduced',label:supplier?'Debt reduced (−)':'Balance reduced (−)',numeric:true,render:e=>{const v=posting(e)?.balanceDeltaMinor;return Number.isSafeInteger(v)?v<0?pkr(-v):'—':'Unavailable';}},
          {key:'balance',label:supplier?'Running balance':'Balance',numeric:true,render:e=>Number.isSafeInteger(e.runningBalanceMinor)?pkr(e.runningBalanceMinor):'Unavailable for this search'}
        ]:[{key:'amount',label:'Event amount',numeric:true,render:e=>pkr(e.amountMinor)}]),
        ...(!supplier?[{key:'actor',label:'Recorded by',render:e=>e.actor?.name||'Unavailable'}]:[])
      ]} onOpen={e=>setSelected(e.eventId)} detailLabel={supplier?'Details':'View transaction'} empty="No posted transactions found."/>
      <Pagination label={supplier?'Supplier transactions':'Transactions'} pagination={data.pagination} rows={entries?.length} onPage={setPage}/>
    </>}{selected&&<Detail eventId={selected} accountId={accountId} onClose={()=>setSelected(null)}/>}
  </section>;
}
