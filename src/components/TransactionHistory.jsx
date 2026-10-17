import { useState } from 'react';
import { Link } from 'react-router-dom';
import { query } from '../api/client';
import { useDebounce, useLoad } from '../api/hooks';
import { activity, pakistanTime, pkr } from '../api/purchases';
import { Empty, Field, Modal, Notice, Pagination } from './Common';

const types=['MANUAL','OPENING','REVERSAL','INVOICE_RECEIPT','INVOICE_REFUND','TRANSFER','SUPPLIER_OPENING','PURCHASE_RECEIPT','SUPPLIER_PAYMENT','SUPPLIER_RETURN','SUPPLIER_REFUND','SUPPLIER_CREDIT_APPLICATION','SUPPLIER_REVERSAL','EXPENSE','EXPENSE_REVERSAL','CAPITAL_CONTRIBUTION','CAPITAL_WITHDRAWAL','CAPITAL_REVERSAL'];
function Source({event}){
  const doc=event.sourceDocument;
  return doc?.orderId?<Link to={'/owner/sales/'+doc.orderId}>{doc.invoiceNo||'View invoice'}</Link>:doc?.purchaseOrderId?<Link to={'/owner/purchases/'+doc.purchaseOrderId}>{doc.reference||doc.purchaseReference||'View purchase'}</Link>:<span>{doc?.reference||event.reason||activity(event.eventType)}{doc?.purchaseReference&&<Link className="d-block" to={'/owner/purchases?reference='+encodeURIComponent(doc.purchaseReference)}>Find {doc.purchaseReference}</Link>}</span>;
}
function Detail({eventId,accountId,onClose}){
  const result=useLoad(accountId?'/accounts/financial/'+accountId+'/history/'+eventId:'/accounts/transactions/'+eventId),event=result.data?.transaction;
  return <Modal title="Transaction details" onClose={onClose}><Notice loading={result.loading} error={result.error}/>{event&&<>
    <h3 className="h6">{activity(event.eventType)} · {pkr(event.amountMinor)}</h3><p><Source event={event}/></p><p>Effective: {pakistanTime(event.occurredAt)} (Pakistan)<br/>Recorded: {pakistanTime(event.recordedAt)} (Pakistan)<br/>Recorded by: {event.actor?.name||'Unavailable'} {event.actor?.role?'('+activity(event.actor.role)+')':''}</p>
    <p>{event.reason}</p>{event.reversalOf&&<p>This is a linked reversal of an earlier transaction.</p>}{event.reversedBy?.length>0&&<p>This transaction has a linked reversal.</p>}{result.data.originalTransaction&&<p>Original: <Source event={result.data.originalTransaction}/></p>}
    <div className="table-responsive"><table className="table table-sm"><thead><tr><th>Account</th><th>Debit</th><th>Credit</th><th>Cash/bank movement</th></tr></thead><tbody>{event.postings.map(p=><tr key={p.accountId}><td>{p.account?.name||'Unavailable'}</td><td>{pkr(p.debitMinor)}</td><td>{pkr(p.creditMinor)}</td><td>{p.moneyInMinor>0?'Money in '+pkr(p.moneyInMinor):p.moneyOutMinor>0?'Money out '+pkr(p.moneyOutMinor):'No cash movement'}</td></tr>)}</tbody></table></div>
    {event.businessAction?.items?.length>0&&<ul>{event.businessAction.items.map((i,index)=><li key={index}>{i.name||'Product'}: {i.quantity} units {Number.isSafeInteger(i.unitCostMinor)?'at '+pkr(i.unitCostMinor):''}</li>)}</ul>}
    <p className="text-body-secondary">Debit and credit are accounting effects. Only cash/bank postings represent money received or paid.</p>
  </>}</Modal>;
}
export default function TransactionHistory({accountId,name}){
  const [search,setSearch]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[type,setType]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState(null);
  const term=useDebounce(search),filters={q:term,page,limit:20,from:from?from+'T00:00:00.000Z':undefined,to:to?to+'T00:00:00.000Z':undefined,type};
  const result=useLoad((accountId?'/accounts/financial/'+accountId+'/history':'/accounts/transactions')+query(filters));
  const data=result.data,entries=accountId?data?.transactions:data?.entries;
  return <section className="panel mt-3"><h2 className="h5">{accountId?(name||'Selected account')+' transactions':'Posted transactions'}</h2><p className="text-body-secondary">Posted accounting records only; historical and deferred evidence may be excluded. Dates below use Pakistan time. Date filters use UTC; Before excludes that date.</p>
    <div className="row g-2 mb-3"><div className="col-md-6"><Field label="Search transactions"><input className="form-control" placeholder="Reference, activity or actor" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field></div><div className="col-md-3"><Field label="From (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={from} onChange={e=>{setFrom(e.target.value);setPage(1);}}/></Field></div><div className="col-md-3"><Field label="Before (UTC)"><input type="date" className="form-control" max={new Date().toISOString().slice(0,10)} value={to} onChange={e=>{setTo(e.target.value);setPage(1);}}/></Field></div></div>
    <Field label="Transaction type"><select className="form-select" value={type} onChange={e=>{setType(e.target.value);setPage(1);}}><option value="">All types</option>{(data?.coverage?.records==='CUSTOMER_LEDGER'?['PURCHASE','CANCELLATION','PAYMENT','ADJUSTMENT','CREDIT_ISSUED','CREDIT_REDEEMED','CREDIT_RESTORED']:types).map(t=><option key={t} value={t}>{activity(t)}</option>)}</select></Field>
    <Notice loading={result.loading}/>{result.error&&<p role="alert" className="alert alert-warning">History unavailable: {result.error}</p>}
    {data&&<>{accountId&&<p>{Number.isSafeInteger(data.rangeOpeningBalanceMinor)?'Period opening: '+pkr(data.rangeOpeningBalanceMinor):'Opening balance unavailable'} · {Number.isSafeInteger(data.rangeClosingBalanceMinor)?'Period closing: '+pkr(data.rangeClosingBalanceMinor):'Closing balance unavailable'}</p>}
      <div className="table-responsive"><table className="table table-sm align-middle"><thead><tr><th>Reference</th><th>Activity</th><th>Date (Pakistan)</th><th>Actor</th><th>Amount</th>{accountId&&<th>Running balance</th>}<th/></tr></thead><tbody>{entries?.map(e=><tr key={e.eventId}><td><Source event={e}/></td><td>{activity(e.eventType)}</td><td>{pakistanTime(e.occurredAt||e.recordedAt)}{!e.occurredAt&&<small className="d-block">Recorded date only</small>}</td><td>{e.actor?.name||'Unavailable'}</td><td>{pkr(e.amountMinor)}</td>{accountId&&<td>{Number.isSafeInteger(e.runningBalanceMinor)?pkr(e.runningBalanceMinor):'Unavailable for this search'}</td>}<td><button className="btn btn-sm btn-outline-secondary" onClick={()=>setSelected(e.eventId)}>View transaction</button></td></tr>)}</tbody></table></div>
      {!entries?.length&&<Empty>No posted transactions found.</Empty>}<Pagination pagination={data.pagination} onPage={setPage}/>
    </>}{selected&&<Detail eventId={selected} accountId={accountId} onClose={()=>setSelected(null)}/>}
  </section>;
}
