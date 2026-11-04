import {Link} from 'react-router-dom';
import {useEffect,useRef} from 'react';
import {RecordFacts} from './RecordTable';
import {pakistanTime,pkr} from '../api/purchases';
import {formatSignedMinor} from './customerActivityFormat';

const minor=value=>Number.isSafeInteger(value)?pkr(value):'Unavailable';
const positive=value=>Number.isSafeInteger(value)&&value>0;

export default function CustomerActivityDetails({event,customerName,onClose}){
  const panel=useRef(null);
  useEffect(()=>{panel.current?.focus({preventScroll:true});},[]);
  const type=event.type,refund=type==='REFUND'||positive(event.details?.cashRefundMinor),isReturn=type==='RETURN';
  const accountRecords=(event.accounts??[]).filter(account=>['CASH','BANK'].includes(account.kind));
  const items=[];
  if(customerName||event.customerName)items.push(['Customer',customerName||event.customerName]);
  items.push(['Date',event.occurredAt?pakistanTime(event.occurredAt):'Recorded date unavailable']);
  if(type==='PAYMENT')items.push(['Payment received',minor(event.details?.cashReceivedMinor||event.amountMinor)]);
  else if(refund)items.push(['Amount refunded',minor(positive(event.details?.cashRefundMinor)?event.details.cashRefundMinor:event.amountMinor)]);
  else if(isReturn)items.push(['Return amount',minor(event.amountMinor)]);
  else if(type==='CREDIT'){
    const before=items.length;
    if(positive(event.details?.creditIssuedMinor))items.push(['Credit issued',minor(event.details.creditIssuedMinor)]);
    if(positive(event.details?.creditRedeemedMinor))items.push(['Credit used',minor(event.details.creditRedeemedMinor)]);
    if(positive(event.details?.creditRestoredMinor))items.push(['Credit restored',minor(event.details.creditRestoredMinor)]);
    if(items.length===before)items.push(['Store credit change',minor(event.amountMinor)]);
  }else items.push(['Amount',minor(event.amountMinor)]);
  if(event.orderId)items.push(['Related invoice',<Link to={'/owner/sales/'+event.orderId}>{event.invoiceNo||'View invoice'}</Link>]);
  else if(event.reference)items.push(['Reference',event.reference]);
  if(type==='PAYMENT'||refund)items.push([refund?'Refund method':'Receiving account',accountRecords.length?accountRecords.map(account=>account.name).join(', '):'Unavailable in recorded source']);
  items.push(['Debt effect',formatSignedMinor(event.debtEffectMinor)]);
  items.push(['Store-credit effect',formatSignedMinor(event.creditEffectMinor)]);
  if(event.details?.actor)items.push(['Recorded by',event.details.actor]);
  const note=event.details?.reason;
  if(note&&/^[A-Z_]+$/.test(note)===false)items.push(['Note',note]);
  const accounts=[...new Map(accountRecords.filter(account=>account._id).map(account=>[String(account._id),account])).values()];
  const transactions=[...new Set(event.transactionIds??[])];
  return <aside ref={panel} tabIndex={-1} className="customer-record-inspector" aria-label={`${event.activity} details`} onKeyDown={eventKey=>{if(eventKey.key==='Escape'){eventKey.preventDefault();eventKey.stopPropagation();onClose();}}}>
    <div className="customer-record-inspector-heading"><h3 className="h6 mb-0">{event.activity}</h3><button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose} aria-label="Close record details">Close</button></div>
    <RecordFacts items={items}/>
    {isReturn&&event.details?.products?.length>0&&<div className="customer-return-lines"><h4 className="small fw-semibold mb-1">Returned products</h4><ul className="small mb-0">{event.details.products.map((item,index)=><li key={`${item.productId}-${index}`}>{item.name} · {item.quantity} · {item.condition==='RESTOCK'?'Restocked':item.condition==='DAMAGED'?'Damaged':'Condition unavailable'}</li>)}</ul></div>}
    <div className="customer-record-links">
      {transactions.map(id=><Link key={id} to={'/owner/accounts/transactions?sourceId='+id}>View financial transaction</Link>)}
      {accounts.map(account=><Link key={account._id} to={'/owner/accounts/transactions?account='+account._id}>View {account.name} statement</Link>)}
    </div>
  </aside>;
}
