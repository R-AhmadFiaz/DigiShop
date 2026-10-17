import { useState } from 'react';
import { Link } from 'react-router-dom';
import { query } from '../api/client';
import { useDebounce, useLoad } from '../api/hooks';
import { activity, pakistanTime, pkr } from '../api/purchases';
import { Empty, Field, Modal, Notice, Pagination } from './Common';
import RecordTable, {RecordFacts} from './RecordTable';

const types=['MANUAL','OPENING','REVERSAL','INVOICE_RECEIPT','INVOICE_REFUND','TRANSFER','SUPPLIER_OPENING','PURCHASE_RECEIPT','SUPPLIER_PAYMENT','SUPPLIER_RETURN','SUPPLIER_REFUND','SUPPLIER_CREDIT_APPLICATION','SUPPLIER_REVERSAL','EXPENSE','EXPENSE_REVERSAL','CAPITAL_CONTRIBUTION','CAPITAL_WITHDRAWAL','CAPITAL_REVERSAL'];
function Source({event}){
  const doc=event.sourceDocument;
  return doc?.orderId?<Link to={'/owner/sales/'+doc.orderId}>{doc.invoiceNo||'View invoice'}</Link>:doc?.purchaseOrderId?<Link to={'/owner/purchases/'+doc.purchaseOrderId}>{doc.reference||doc.purchaseReference||'View purchase'}</Link>:<span>{doc?.reference||event.source?.referenceId||activity(event.eventType)}{doc?.purchaseReference&&<Link className="d-block" to={'/owner/purchases?reference='+encodeURIComponent(doc.purchaseReference)}>Find {doc.purchaseReference}</Link>}</span>;
}
function Detail({eventId,accountId,onClose}){
  const result=useLoad(accountId?'/accounts/financial/'+accountId+'/history/'+eventId:'/accounts/transactions/'+eventId),event=result.data?.transaction;
  return <Modal title="Transaction details" onClose={onClose}><Notice loading={result.loading} error={result.error}/>{event&&<>
    <h3 className="h6">{activity(event.eventType)} · {pkr(event.amountMinor)}</h3><RecordFacts items={[["Source",<Source event={event}/>],["Transaction date (Pakistan)",pakistanTime(event.occurredAt)],["Recorded (Pakistan)",pakistanTime(event.recordedAt)],["Recorded by",(event.actor?.name||'Unavailable')+(event.actor?.role?' ('+activity(event.actor.role)+')':'')],["Note",event.reason]]}/>{event.reversalOf&&<p>This is a linked reversal of an earlier transaction.</p>}{event.reversedBy?.length>0&&<p>This transaction has a linked reversal.</p>}{result.data.originalTransaction&&<p>Original: <Source event={result.data.originalTransaction}/></p>}
    <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Account</th><th>Money received / paid</th></tr></thead><tbody>{event.postings.map(p=><tr key={p.accountId}><td>{p.account?.name||'Unavailable'}</td><td>{p.moneyInMinor>0?'Money in '+pkr(p.moneyInMinor):p.moneyOutMinor>0?'Money out '+pkr(p.moneyOutMinor):'No cash movement'}</td></tr>)}</tbody></table></div>
    {event.businessAction?.items?.length>0&&<ul>{event.businessAction.items.map((i,index)=><li key={index}>{i.name||'Product'}: {i.quantity} units {Number.isSafeInteger(i.unitCostMinor)?'at '+pkr(i.unitCostMinor):''}</li>)}</ul>}
    <details><summary>Accounting details (optional)</summary><p className="text-body-secondary">Debit and credit are bookkeeping entries, not necessarily cash received or paid.</p><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{event.postings.map(p=><tr key={p.accountId}><td>{p.account?.name||'Unavailable'}</td><td>{pkr(p.debitMinor)}</td><td>{pkr(p.creditMinor)}</td></tr>)}</tbody></table></div></details>
  </>}</Modal>;
}
export default function TransactionHistory({accountId,name}){
  const [search,setSearch]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[type,setType]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState(null);
  const term=useDebounce(search),filters={q:term,page,limit:20,from:from?from+'T00:00:00.000Z':undefined,to:to?to+'T00:00:00.000Z':undefined,type};
  const result=useLoad((accountId?'/accounts/financial/'+accountId+'/history':'/accounts/transactions')+query(filters));
  const data=result.data,entries=accountId?data?.transactions:data?.entries;
  const posting=e=>e.accountPosting||e.postings?.find(p=>String(p.accountId)===accountId);
  return <section className="panel mt-3"><h2 className="h5">{accountId?(name||'Selected account')+' transactions':'Recorded transactions'}</h2><p className="text-body-secondary">Recorded transactions only; unchecked old records may be missing. Times shown are Pakistan time. Date filters use UTC (5 hours behind Pakistan); Before excludes that day.</p>
    <div className="row g-2 mb-3"><div className="col-md-6"><Field label="Search transactions"><input className="form-control" placeholder="Reference, activity or actor" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field></div><div className="col-md-3"><Field label="From (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></Field></div><div className="col-md-3"><Field label="Before (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></Field></div></div>
    <Field label="Transaction type"><select className="form-select" value={type} onChange={e=>{setType(e.target.value);setPage(1);}}><option value="">All types</option>{(data?.coverage?.records==='CUSTOMER_LEDGER'?['PURCHASE','CANCELLATION','PAYMENT','ADJUSTMENT','CREDIT_ISSUED','CREDIT_REDEEMED','CREDIT_RESTORED']:types).map(t=><option key={t} value={t}>{activity(t)}</option>)}</select></Field>
    <Notice loading={result.loading}/>{result.error&&<p role="alert" className="alert alert-warning">History unavailable: {result.error}</p>}
    {!accountId&&data&&<p className="small text-body-secondary">Each row is one event, not necessarily cash received or paid. Open its details to see the affected accounts.</p>}
    {data&&<>{accountId&&<><p className="record-balance">Current account balance: <strong>{pkr(data.balanceMinor)}</strong></p><p>{Number.isSafeInteger(data.rangeOpeningBalanceMinor)?'Balance at start: '+pkr(data.rangeOpeningBalanceMinor):'Opening balance unavailable'} · {Number.isSafeInteger(data.rangeClosingBalanceMinor)?'Balance at end: '+pkr(data.rangeClosingBalanceMinor):'Closing balance unavailable'}</p><p className="small text-body-secondary">These are changes to the selected account. Debt and credit changes are not cash movements.</p></>}
      <RecordTable label={accountId?'Account statement':'Business transaction register'} rows={entries||[]} columns={[
        {key:'date',label:'Date (Pakistan)',render:e=><>{pakistanTime(e.occurredAt||e.recordedAt)}{!e.occurredAt&&<small className="d-block">Recorded date only</small>}</>},
        {key:'action',label:'Action',render:e=>activity(e.eventType)},
        {key:'reference',label:'Reference',render:e=><Source event={e}/>},
        ...(accountId?[
          {key:'added',label:'Balance added (+)',numeric:true,render:e=>{const v=posting(e)?.balanceDeltaMinor;return Number.isSafeInteger(v)?v>0?pkr(v):'—':'Unavailable';}},
          {key:'reduced',label:'Balance reduced (−)',numeric:true,render:e=>{const v=posting(e)?.balanceDeltaMinor;return Number.isSafeInteger(v)?v<0?pkr(-v):'—':'Unavailable';}},
          {key:'balance',label:'Balance',numeric:true,render:e=>Number.isSafeInteger(e.runningBalanceMinor)?pkr(e.runningBalanceMinor):'Unavailable for this search'}
        ]:[{key:'amount',label:'Event amount',numeric:true,render:e=>pkr(e.amountMinor)}]),
        {key:'actor',label:'Recorded by',render:e=>e.actor?.name||'Unavailable'}
      ]} onOpen={e=>setSelected(e.eventId)} detailLabel="View transaction" empty="No posted transactions found."/>
      <Pagination pagination={data.pagination} onPage={setPage}/>
    </>}{selected&&<Detail eventId={selected} accountId={accountId} onClose={()=>setSelected(null)}/>}
  </section>;
}
