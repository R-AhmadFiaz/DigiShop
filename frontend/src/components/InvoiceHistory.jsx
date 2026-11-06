import { Fragment, useState } from "react";
import {Link} from 'react-router-dom';
import { query } from "../api/client";
import { useLoad } from "../api/hooks";
import { dateText, money, Notice, Pagination } from "./Common";
import { displayName } from "../utils/identity";
import RecordTable, {RecordFacts} from './RecordTable';

export function FinancialMovements({ financial = {} }) {
  const labels = {
    salesDeltaMinor: "Invoice value change", debtDeltaMinor: "Outstanding debt change",
    cashReceivedMinor: "Cash received", cashRefundMinor: "Cash refunded",
    creditRedeemedMinor: "Store credit redeemed", creditIssuedMinor: "Store credit issued",
    creditRestoredMinor: "Credit-funded payment restored to credit",
  };
  return <dl className="receipt-totals">{Object.entries(labels).map(([field, label]) =>
    financial[field] ? <Fragment key={field}><dt>{label}</dt><dd>{money(financial[field] / 100)}</dd></Fragment> : null)}</dl>;
}
export function EventDocument({ event, order }) {
  const reason = event.reasonSource === 'SYSTEM' ? `${event.reason} (system description)` : event.reason;
  return <>
    <h3 className="h6">{event.kind.toLowerCase()} · Revision {event.revisionAfter}</h3>
    <RecordFacts items={[["Reference",event.reference||event.invoiceNo],["Date",dateText(event.occurredAt)],["Recorded by",displayName(event.createdByName)||"Unavailable"],["Reason",reason]]}/>
    <RecordTable label="Returned and added products" rowKey={(_,index)=>index} rows={(event.movements||[]).map((m,index)=>({...m,_id:index}))} columns={[
      {key:'kind',label:'Action',render:m=>m.kind==='RETURN'?'Returned':'Added'},
      {key:'name',label:'Product',render:movement=>{
      const line = [...(event.before?.items || []), ...(event.after?.items || []), ...(order.items || [])].find(i => i.lineId === movement.lineId);
      return line?.name||'Product unavailable';}},
      {key:'quantity',label:'Quantity',numeric:true},{key:'price',label:'Unit price',numeric:true,render:m=>money(m.unitPriceMinor/100)},
      {key:'stock',label:'Stock handling',render:m=>m.disposition==='DAMAGED'?'Damaged — not restocked':m.disposition==='RESTOCK'?'Restocked':'—'}
    ]} empty="No product movements."/>
    <FinancialMovements financial={event.financial} />
    {Array.isArray(event.transactionIds)&&event.transactionIds.length>0&&<div className="invoice-related-transactions"><strong>Related financial transactions</strong>{[...new Set(event.transactionIds.map(String))].map((id,index)=><Link key={id} to={'/owner/accounts/transactions?'+new URLSearchParams({sourceId:id})}>View financial transaction{event.transactionIds.length>1?' '+(index+1):''}</Link>)}</div>}
    {event.after && <p>Invoice total: {money(event.after.totalMinor / 100)} · Outstanding: {money(event.after.dueMinor / 100)}</p>}
  </>;
}
export default function InvoiceHistory({ order, onPrint }) {
  const [page, setPage] = useState(1);
  const history = useLoad(`/orders/${order._id}/history` + query({ page, limit: 10 }));
  return <section className="panel mt-3 no-print">
    <h2 className="h6">Adjustment and payment history</h2>
    <Notice error={history.error} loading={history.loading} />
    {history.data&&<RecordTable label="Invoice adjustment and payment register" rows={history.data.history} columns={[
      {key:'date',label:'Date',render:e=>dateText(e.occurredAt)},
      {key:'reference',label:'Reference',render:e=>e.reference||e.invoiceNo},
      {key:'action',label:'Action',render:e=>e.kind.toLowerCase()+' · Revision '+e.revisionAfter},
      {key:'received',label:'Money received (+)',numeric:true,render:e=>Number.isSafeInteger(e.financial?.cashReceivedMinor)?money(e.financial.cashReceivedMinor/100):'Unavailable'},
      {key:'refunded',label:'Money refunded (−)',numeric:true,render:e=>Number.isSafeInteger(e.financial?.cashRefundMinor)?money(e.financial.cashRefundMinor/100):'Unavailable'},
      {key:'due',label:'Invoice due after',numeric:true,render:e=>Number.isSafeInteger(e.after?.dueMinor)?money(e.after.dueMinor/100):'Unavailable'},
      {key:'print',label:'Print',render:event=><button className="btn btn-outline-secondary btn-sm" onClick={()=>onPrint(event)}>Open printable record</button>}
    ]} details={event=><EventDocument event={event} order={order}/>} empty="No recorded movements. Earlier payments are not inferred."/>}
    {history.data?.customerNameHistory?.length>0&&<div className="mt-3"><h3 className="h6">Customer name updates</h3><RecordTable label="Invoice customer name changes" rows={history.data.customerNameHistory} columns={[
      {key:'date',label:'Date',render:event=>dateText(event.recordedAt)},
      {key:'action',label:'Action',render:()=>"Customer name updated"},
      {key:'previous',label:'Previous name',render:event=>event.previousName||'Walk-in customer'},
      {key:'current',label:'New name',render:event=>event.newName},
      {key:'actor',label:'Updated by',render:event=>displayName(event.actorName)||'Unavailable'}
    ]} empty="No customer name changes."/></div>}
    <Pagination pagination={history.data?.pagination} onPage={setPage} />
  </section>;
}
