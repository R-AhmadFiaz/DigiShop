import RecordTable, {RecordFacts} from "../../components/RecordTable";
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { activity, minorAmount, pakistanTime, pkr } from '../../api/purchases';
import { Empty, Field, Notice, PageTitle, Pagination } from '../../components/Common';
import PurchaseTable from '../../components/PurchaseTable';
import SupplierAction from '../../components/SupplierAction';
import SupplierOpening from '../../components/SupplierOpening';

function PaymentEntry({account,balance,prepare,locked}){
  const result=useLoad('/accounts/financial/'+account._id),[error,setError]=useState('');
  function submit(e){e.preventDefault();if(locked)return;try{const fields=new FormData(e.currentTarget),amountMinor=minorAmount(fields.get('amount'));if(amountMinor<=0||amountMinor>balance)throw new Error('Enter a positive payment no greater than the outstanding payable.');setError('');prepare({path:'/accounts/suppliers/'+account.supplierId+'/payments',title:'Confirm supplier payment',confirmLabel:'Confirm payment sent',summary:'Pay '+account.supplierName+' ? '+pkr(amountMinor)+' from '+account.name+'\nReference: '+fields.get('reference')+'\nConfirm this payment has actually been sent to the supplier. Payments are applied at supplier level.',body:{requestKey:crypto.randomUUID(),accountId:account._id,amountMinor,reference:fields.get('reference'),reason:fields.get('reason'),occurredAt:new Date().toISOString()}});}catch(e){setError(e.message);}}
  return <form onSubmit={submit}><Notice loading={result.loading} error={error||result.error}/>{result.data&&<p>Available in {account.name}: {pkr(result.data.balanceMinor)}</p>}<fieldset disabled={locked||!Number.isSafeInteger(result.data?.balanceMinor)}>
    <Field label="Payment amount (PKR)"><input name="amount" className="form-control" type="number" min="0.01" step="0.01" required/></Field><Field label="Payment reference"><input name="reference" className="form-control" required maxLength={50} pattern="[A-Za-z0-9][A-Za-z0-9/_-]*"/></Field><Field label="Payment note"><input name="reason" className="form-control" required maxLength={300}/></Field><button className="btn btn-primary" type="submit">Review supplier payment</button>
  </fieldset></form>;
}
function SupplierPayment({supplierId,supplierName,balance,onChanged}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState(null);
  const accounts=useLoad('/accounts/financial'+query({q:useDebounce(search),page,limit:20}));
  return <SupplierAction onChanged={()=>{setSelected(null);onChanged();}}>{({prepare,locked})=>balance===null?null:balance===0?<p className="text-body-secondary">No supplier payment is due.</p>:<section className="panel mb-3"><h2 className="h5">Pay supplier</h2><p className="text-body-secondary">Choose where the money was paid from. This pays the supplier; it does not add stock.</p>
    <Field label="Find payment account"><input className="form-control" maxLength={100} disabled={locked} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(null);}}/></Field><Notice loading={accounts.loading} error={accounts.error}/>
    <Field label="Payment account"><select className="form-select" disabled={locked} value={selected?._id||''} onChange={e=>setSelected(accounts.data.entries.find(a=>a._id===e.target.value)||null)}><option value="">Choose cash or bank</option>{accounts.data?.entries.filter(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false&&a.cashCutoverId).map(a=><option key={a._id} value={a._id}>{a.name}</option>)}</select></Field>
    {accounts.data&&!accounts.data.entries.some(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false&&a.cashCutoverId)&&<p>No prepared cash or bank accounts on this page. Accounting setup is required before payment.</p>}<Pagination pagination={accounts.data?.pagination} onPage={p=>{setPage(p);setSelected(null);}}/>
    {selected&&<PaymentEntry key={selected._id} account={{...selected,supplierId,supplierName}} balance={balance} prepare={prepare} locked={locked}/>}
  </section>}</SupplierAction>;
}
function SupplierCredit({supplierId,supplierName,balance,onChanged}){
  const [mode,setMode]=useState('REFUND'),[error,setError]=useState('');
  const accounts=useLoad('/orders/payment-accounts');
  function submit(event,prepare){
    event.preventDefault();try{
      const fields=new FormData(event.currentTarget),amountMinor=minorAmount(fields.get('amount'));
      if(amountMinor<=0||amountMinor>balance.creditMinor)throw new Error('Enter an amount within the available supplier credit.');
      if(mode==='CREDIT_APPLICATION'&&amountMinor>balance.balanceMinor)throw new Error('Credit application cannot exceed outstanding payable.');
      const refund=mode==='REFUND';setError('');prepare({path:'/accounts/suppliers/'+supplierId+(refund?'/refunds':'/credit-applications'),title:refund?'Confirm supplier refund received':'Confirm supplier credit application',confirmLabel:refund?'Confirm money received':'Confirm credit applied',summary:supplierName+' — '+pkr(amountMinor)+'\n'+(refund?'Confirm this money has actually arrived in the selected cash/bank account. This is not sales revenue.':'This reduces supplier credit and outstanding payable. No cash moves.'),body:{requestKey:crypto.randomUUID(),reference:fields.get('reference'),reason:fields.get('reason'),occurredAt:new Date().toISOString(),amountMinor,...(refund?{accountId:fields.get('accountId')} : {}),confirmation:refund?'CONFIRM SUPPLIER REFUND RECEIVED':'CONFIRM SUPPLIER CREDIT APPLICATION'}});
    }catch(e){setError(e.message);}
  }
  return <SupplierAction operation={'supplier-credit-'+supplierId} onChanged={onChanged}>{({prepare,locked})=><section className="panel mb-3"><h2 className="h5">Use supplier credit</h2>
    <p>Supplier owes us: <strong>{pkr(balance.creditMinor)}</strong>. Use this amount for a refund or to reduce what you owe, not both.</p>
    {balance.creditMinor>0?<form onSubmit={e=>submit(e,prepare)}><fieldset disabled={locked}><Notice error={error}/>
      <Field label="What happened?"><select aria-label="Credit action" className="form-select" value={mode} onChange={e=>setMode(e.target.value)}><option value="REFUND">Supplier refunded money</option><option value="CREDIT_APPLICATION">Use supplier credit to reduce what we owe</option></select></Field>
      {mode==='REFUND'&&<><Notice loading={accounts.loading} error={accounts.error}/><Field label="Refund received into"><select aria-label="Refund account" name="accountId" className="form-select" required disabled={!accounts.data}><option value="">Choose cash or bank</option>{accounts.data?.accounts?.map(a=><option key={a._id} value={a._id}>{a.name}</option>)}</select></Field></>}
      <Field label="Credit amount (PKR)"><input name="amount" className="form-control" type="number" min="0.01" step="0.01" required/></Field>
      <Field label="Credit transaction reference"><input name="reference" className="form-control" maxLength={50} pattern="[A-Za-z0-9][A-Za-z0-9/_-]*" required/></Field>
      <Field label="Credit transaction note"><input name="reason" className="form-control" maxLength={300} required/></Field>
      <button className="btn btn-primary" disabled={mode==='REFUND'&&!accounts.data} type="submit">Review supplier credit</button>
    </fieldset></form>:<p className="text-body-secondary">No supplier credit is available.</p>}
  </section>}</SupplierAction>;
}
function Correction({event,supplierId,onChanged,onClose}){
  function submit(e,prepare){e.preventDefault();const fields=new FormData(e.currentTarget);prepare({path:'/accounts/suppliers/'+supplierId+'/settlements/'+event._id+'/reverse',title:'Confirm supplier correction',confirmLabel:'Confirm actual reversal',summary:event.reference+' — '+pkr(event.amountMinor)+'\nThis keeps the original record and posts its exact inverse. Confirm that any money or goods have actually been restored. Consumed return credit must be restored first.',body:{requestKey:crypto.randomUUID(),reference:fields.get('reference'),reason:fields.get('reason'),occurredAt:new Date().toISOString(),confirmation:'CONFIRM SUPPLIER REVERSAL'}});}
  return <SupplierAction operation={'supplier-correction-'+supplierId} onChanged={()=>{onClose();onChanged();}}>{({prepare,locked})=><form className="mt-3" onSubmit={e=>submit(e,prepare)}><fieldset disabled={locked}><h3 className="h6">Correct {event.reference}</h3><Field label="Correction reference"><input name="reference" className="form-control" pattern="[A-Za-z0-9][A-Za-z0-9/_-]*" required maxLength={50}/></Field><Field label="Correction reason"><input name="reason" className="form-control" required maxLength={300}/></Field><button className="btn btn-outline-danger me-2" type="submit">Review correction</button><button className="btn btn-outline-secondary" type="button" onClick={onClose}>Close correction</button></fieldset></form>}</SupplierAction>;
}
export default function SupplierDetails(){
  const {supplierId}=useParams(),[purchasePage,setPurchasePage]=useState(1),[historyPage,setHistoryPage]=useState(1),[correction,setCorrection]=useState(null);
  const entity=useLoad('/accounts/entities/'+supplierId),balance=useLoad('/accounts/suppliers/'+supplierId+'/balance'),reconciliation=useLoad('/accounts/suppliers/'+supplierId+'/reconciliation');
  const purchases=useLoad('/purchases/'+query({supplierId,page:purchasePage,limit:10})),history=useLoad('/accounts/suppliers/'+supplierId+'/settlements'+query({page:historyPage,limit:20}));
  const ready=entity.data?.roles.includes('SUPPLIER')&&balance.data?.authoritative===true&&Number.isSafeInteger(balance.data.balanceMinor);
  const refresh=()=>{balance.reload();reconciliation.reload();history.reload();purchases.reload();};
  return <><PageTitle title={entity.data?.name||'Supplier Khata'}><Link className="btn btn-sm btn-outline-secondary" to="/owner/accounts/companies">Companies &amp; Suppliers</Link></PageTitle><Notice loading={entity.loading} error={entity.error}/>
    <section className="panel mb-3"><h2 className="h5">We owe supplier</h2><Notice loading={balance.loading}/>{ready?<><p className="record-balance fw-semibold">Outstanding: {pkr(balance.data.balanceMinor)}</p><Link to={'/owner/accounts/transactions?account='+balance.data.accountId}>Supplier Khata</Link></>:<p role="status" className="alert alert-warning">Supplier balance unavailable: {balance.error||'Finish this supplier starting-balance check.'} The balance is unknown, not zero.</p>}
      <Notice error={reconciliation.error}/>{reconciliation.data&&<><p>Starting balance: {reconciliation.data.cutover?'Confirmed at '+pakistanTime(reconciliation.data.cutover.cutoffAt)+' (Pakistan)':'Owner-confirmed setup required'}</p>{reconciliation.data.issues?.map((i,index)=><p className="text-warning" key={index}>{i.problem}</p>)}<p className="text-body-secondary">Old deliveries need checking before they can count towards supplier debt.</p></>}
    </section>
    <SupplierPayment supplierId={supplierId} supplierName={entity.data?.name} balance={ready?balance.data.balanceMinor:null} onChanged={refresh}/>
    {!ready&&entity.data?.roles.includes('SUPPLIER')&&<SupplierOpening supplierId={supplierId} onChanged={refresh}/>}
    {ready&&<><section className="panel mb-3"><h2 className="h5">Supplier credit and refunds</h2><p>Supplier owes us: <strong>{pkr(balance.data.creditMinor)}</strong></p><p>Refunds received (net of corrections): {pkr(balance.data.refundsReceivedMinor)} · Credit applied (net of corrections): {pkr(balance.data.creditAppliedMinor)}</p><p className="text-body-secondary">Supplier credit is separate from what we owe them. It is not cash until a refund is received.</p>{balance.data.creditAccountId&&<Link to={'/owner/accounts/transactions?account='+balance.data.creditAccountId}>Supplier credit statement</Link>}</section><SupplierCredit supplierId={supplierId} supplierName={entity.data?.name} balance={balance.data} onChanged={refresh}/></>}
    <section className="panel mb-3"><h2 className="h5">Purchases</h2><PurchaseTable result={purchases} onPage={setPurchasePage}/></section>
    <section className="panel"><h2 className="h5">Payments, returns and corrections</h2><Notice loading={history.loading}/>{history.error&&<p className="alert alert-warning">Payment history unavailable: {history.error}</p>}{history.data&&<><p className="text-body-secondary">Payments cover the supplier account, not individual deliveries. Credit used and refunds received cannot be used again.</p><RecordTable label="Supplier settlement register" rows={history.data.entries} columns={[
 {key:'date',label:'Date (Pakistan)',render:e=>pakistanTime(e.occurredAt)},
 {key:'action',label:'Action',render:e=>activity('SUPPLIER_'+e.kind)+(e.kind==='REVERSAL'&&e.originalKind?' of '+activity('SUPPLIER_'+e.originalKind):'')},
 {key:'reference',label:'Reference'},{key:'value',label:'Event amount',numeric:true,render:e=>pkr(e.amountMinor)},
 {key:'delivery',label:'Delivery',render:e=>e.receiptReference||'—'},
 {key:'correct',label:'Correction',render:e=>e.kind!=='REVERSAL'&&<button className="btn btn-outline-secondary btn-sm" onClick={()=>setCorrection(e)}>Correct</button>}
 ]} details={e=><RecordFacts items={[["Recorded by",e.createdByName||'Unavailable'],["Note",e.reason],["Part for what we owe",pkr(e.payableReductionMinor)],["Supplier credit portion",pkr(e.creditMovementMinor)],["Original action",e.originalKind?activity('SUPPLIER_'+e.originalKind):'—'],["Correction of",e.reversalOf||'—']]}/>} empty="No payments or returns recorded."/><Pagination pagination={history.data.pagination} onPage={setHistoryPage}/></>}</section>
    {ready&&correction&&<Correction event={correction} supplierId={supplierId} onChanged={refresh} onClose={()=>setCorrection(null)}/>}
  </>;
}
