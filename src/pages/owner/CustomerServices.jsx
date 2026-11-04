import {useRef,useState} from 'react';
import {Link,useParams,useSearchParams} from 'react-router-dom';
import CustomerActivityDetails from '../../components/CustomerActivityDetails';
import {formatBalanceChange,formatCustomerDate} from '../../components/customerActivityFormat';
import {query} from '../../api/client';
import {useDebounce,useLoad} from '../../api/hooks';
import {Field,money,Notice,PageTitle,Pagination} from '../../components/Common';
import RecordTable from '../../components/RecordTable';

const services={
  activity:{key:'HISTORY',title:'Customer activity',empty:'No customer activity matches these filters.'},
  payments:{key:'PAYMENTS',title:'Customer payments',empty:'No recorded customer payments match these filters.'},
  returns:{key:'RETURNS',title:'Customer returns & refunds',empty:'No recorded returns or refunds match these filters.'},
  credit:{key:'CREDIT',title:'Customer store credit',empty:'No recorded store-credit movements match these filters.'},
  history:{key:'HISTORY',title:'Customer activity history',empty:'No recorded customer activity matches these filters.'},
};
const dateParam=value=>value?`${value}T00:00:00.000Z`:undefined;

export default function CustomerServices(){
  const {service}=useParams(),config=services[service], [params,setParams]=useSearchParams(),[selected,setSelected]=useState(null);
  const opener=useRef(null),page=Math.max(1,Number(params.get('page'))||1),search=params.get('search')||'',customerId=params.get('customerId')||'',from=params.get('from')||'',to=params.get('to')||'',recordType=params.get('type')||config?.key;
  const closeDetail=()=>{setSelected(null);requestAnimationFrame(()=>opener.current?.focus());};
  const closeDetailOnEscape=event=>{if(event.key==='Escape'&&selected){event.preventDefault();closeDetail();}};
  const term=useDebounce(search),customers=useLoad('/customers/'+query({page:1,limit:100}));
  const result=useLoad('/accounts/customers/activity'+query({service:recordType,page,limit:20,q:term,customerId:customerId||undefined,from:dateParam(from),to:dateParam(to)}),!!config);
  if(!config)return <p role="alert" className="alert alert-warning">This customer service is unavailable.</p>;
  function update(values){setSelected(null);opener.current=null;setParams(current=>{for(const [key,value]of Object.entries(values)){if(value)current.set(key,value);else current.delete(key);}return current;},{replace:true});}
  const entries=result.data?.entries??[];
  const columns=[
    {key:'date',label:'Date',kind:'date',width:'18%',render:event=>formatCustomerDate(event.occurredAt)},
    {key:'activity',label:'Activity',width:'24%',render:event=><span>{event.activity}{event.customerName?` · ${event.customerName}`:''}{event.details?.legacy?' (legacy record)':''}</span>},
    {key:'reference',label:'Invoice / reference',kind:'reference',width:'17%',render:event=>event.orderId?<Link to={'/owner/sales/'+event.orderId}>{event.invoiceNo}</Link>:event.invoiceNo||'Unavailable'},
    {key:'amount',label:'Amount',numeric:true,width:'13%',render:event=>{const amount=recordType==='REFUNDS'?event.details?.cashRefundMinor:event.amountMinor;return Number.isSafeInteger(amount)?money(amount/100):'Unavailable';}},
    {key:'balance',label:'Balance change',numeric:true,width:'20%',render:event=><span className="customer-balance-change">{formatBalanceChange(event)}</span>},
  ];
  return <>
    <PageTitle title={config.title}/>
    <section className="panel customer-service-panel">
      <div className="row g-2 align-items-end mb-3">
        {service==='activity'&&<div className="col-md-3"><Field label="Record type"><select className="form-select" aria-label="Filter customer record type" value={recordType} onChange={event=>update({type:event.target.value,page:'1'})}><option value="HISTORY">All customer activity</option><option value="INVOICES">Invoices</option><option value="PAYMENTS">Payments</option><option value="RETURNS">Returns</option><option value="REFUNDS">Refunds</option><option value="CREDIT">Store credit</option></select></Field></div>}
        <div className="col-md-4"><Field label="Search customer, invoice or reference"><input className="form-control" aria-label="Search customer records" maxLength={100} value={search} onChange={event=>update({search:event.target.value,page:'1'})}/></Field></div>
        <div className="col-md-3"><Field label="Customer"><select className="form-select" aria-label="Filter customer records by customer" value={customerId} onChange={event=>update({customerId:event.target.value,page:'1'})}><option value="">All customers</option>{customerId&&result.data?.filterCustomer&&!customers.data?.customers.some(customer=>customer._id===customerId)&&<option value={customerId}>{result.data.filterCustomer.name} Â· {result.data.filterCustomer.phoneNo}</option>}{customers.data?.customers.map(customer=><option key={customer._id} value={customer._id}>{customer.name} Â· {customer.phoneNo}</option>)}</select></Field></div>
        <div className="col-md-2"><Field label="From"><input type="date" className="form-control" aria-label="Filter customer records from date" value={from} max={new Date().toISOString().slice(0,10)} onChange={event=>update({from:event.target.value,page:'1'})}/></Field></div>
        <div className="col-md-2"><Field label="Before"><input type="date" className="form-control" aria-label="Filter customer records before date" value={to} max={new Date().toISOString().slice(0,10)} onChange={event=>update({to:event.target.value,page:'1'})}/></Field></div>
      </div>
      <Notice loading={result.loading} error={result.error}/>
      {result.data&&<>
        {!result.data.coverage.complete&&<p role="alert" className="alert alert-warning py-2">{result.data.coverage.limitedBy==='RECORD_LIMIT'?'Only the latest 5,000 source records are included. Narrow the filters to inspect a smaller date range; this view does not claim complete coverage.':'Some source records or customer identities are unavailable. The displayed activity remains source-linked and no missing relationship has been guessed.'}</p>}
        {service==='credit'&&<p className="small text-body-secondary">Available credit is the customerâ€™s current recorded balance. Issued, used, and restored credit remain separate from customer debt.</p>}
        {service==='returns'&&<p className="small text-body-secondary">A product return and a cash refund are separate recorded events. Refund method is shown only when a source transaction records it.</p>}
        <div className={'customer-history-layout'+(selected?' with-detail':'')} onKeyDown={closeDetailOnEscape}><div className="customer-history-main">
          <RecordTable label={config.title} rows={entries} columns={columns} onOpen={event=>{opener.current=document.activeElement;setSelected(event);}} detailLabel="View" tableClassName="customer-activity-table" empty={config.empty} arrowNavigation/>
          <Pagination pagination={result.data.pagination} onPage={value=>update({page:String(value)})}/>
          <p className="small text-body-secondary mt-2 mb-0">Activity is source-linked. This filtered list does not calculate account balances.</p>
        </div>{selected&&<CustomerActivityDetails event={selected} onClose={closeDetail}/>}</div>
      </>}
    </section>
  </>;
}
