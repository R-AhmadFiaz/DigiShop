import RecordTable, {RecordFacts} from "../../components/RecordTable";
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { query } from '../../api/client';
import { useLoad } from '../../api/hooks';
import { activity, minorAmount, pakistanTime, pkr } from '../../api/purchases';
import { Field, Notice, PageTitle, Pagination } from '../../components/Common';
import PurchaseTable from '../../components/PurchaseTable';
import SupplierAction from '../../components/SupplierAction';
import SupplierPayment from '../../components/SupplierPayment';
import SupplierOpening from '../../components/SupplierOpening';
import SupplierBalanceStatus from '../../components/SupplierBalanceStatus';
import TransactionHistory from '../../components/TransactionHistory';

function SupplierCredit({supplierId,supplierName,balance,onChanged}){
  const [mode,setMode]=useState('REFUND'),[error,setError]=useState('');
  const accounts=useLoad('/orders/payment-accounts');
  function submit(event,prepare){
    event.preventDefault();try{
      const fields=new FormData(event.currentTarget),amountMinor=minorAmount(fields.get('amount'));
      if(amountMinor<=0||amountMinor>balance.creditMinor)throw new Error('Enter an amount within the available supplier credit.');
      if(mode==='CREDIT_APPLICATION'&&amountMinor>balance.balanceMinor)throw new Error('Credit application cannot exceed outstanding payable.');
      const refund=mode==='REFUND';setError('');prepare({path:'/accounts/suppliers/'+supplierId+(refund?'/refunds':'/credit-applications'),title:refund?'Confirm supplier refund received':'Confirm supplier credit application',confirmLabel:refund?'Confirm money received':'Confirm credit applied',summary:supplierName+' — '+pkr(amountMinor)+'\n'+(refund?'Confirm this money has actually arrived in the selected cash/bank account. This is not sales revenue.':'This reduces supplier credit and outstanding payable. No cash moves.'),body:{requestKey:crypto.randomUUID(),reason:fields.get('reason'),occurredAt:new Date().toISOString(),amountMinor,...(refund?{accountId:fields.get('accountId')} : {}),confirmation:refund?'CONFIRM SUPPLIER REFUND RECEIVED':'CONFIRM SUPPLIER CREDIT APPLICATION'}});
    }catch(e){setError(e.message);}
  }
  return <SupplierAction operation={'supplier-credit-'+supplierId} onChanged={onChanged}>{({prepare,locked})=>(balance.creditMinor>0||locked)&&<details id="supplier-credit" className="action-disclosure" open={locked||undefined}><summary>Use supplier credit / record refund</summary>
    <p>Supplier owes us: <strong>{pkr(balance.creditMinor)}</strong>. Use this amount for a refund or to reduce what you owe, not both.</p>
    {balance.creditMinor>0?<form onSubmit={e=>submit(e,prepare)}><fieldset disabled={locked}><Notice error={error}/>
      <Field label="What happened?"><select aria-label="Credit action" className="form-select" value={mode} onChange={e=>setMode(e.target.value)}><option value="REFUND">Supplier refunded money</option><option value="CREDIT_APPLICATION">Use supplier credit to reduce what we owe</option></select></Field>
      {mode==='REFUND'&&<><Notice loading={accounts.loading} error={accounts.error}/><Field label="Refund received into"><select aria-label="Refund account" name="accountId" className="form-select" required disabled={!accounts.data}><option value="">Choose cash or bank</option>{accounts.data?.accounts?.map(a=><option key={a._id} value={a._id}>{a.name}</option>)}</select></Field></>}
      <Field label="Credit amount (PKR)"><input name="amount" className="form-control" type="number" min="0.01" step="0.01" required/></Field>

      <Field label="Credit transaction note"><input name="reason" className="form-control" maxLength={300} required/></Field>
      <button className="btn btn-primary" disabled={mode==='REFUND'&&!accounts.data} type="submit">Review supplier credit</button>
    </fieldset></form>:<p className="text-body-secondary">No supplier credit is available.</p>}
  </details>}</SupplierAction>;
}
function Correction({event,supplierId,onChanged,onClose}){
  function submit(e,prepare){e.preventDefault();const fields=new FormData(e.currentTarget);prepare({path:'/accounts/suppliers/'+supplierId+'/settlements/'+event._id+'/reverse',title:'Confirm supplier correction',confirmLabel:'Confirm actual reversal',summary:event.reference+' — '+pkr(event.amountMinor)+'\nThis keeps the original record and posts its exact inverse. Confirm that any money or goods have actually been restored. Consumed return credit must be restored first.',body:{requestKey:crypto.randomUUID(),reason:fields.get('reason'),occurredAt:new Date().toISOString(),confirmation:'CONFIRM SUPPLIER REVERSAL'}});}
  return <SupplierAction operation={'supplier-correction-'+supplierId} onChanged={()=>{onClose();onChanged();}}>{({prepare,locked})=><form className="mt-3" onSubmit={e=>submit(e,prepare)}><fieldset disabled={locked}><h3 className="h6">Correct {event.reference}</h3><Field label="Correction reason"><input name="reason" className="form-control" required maxLength={300}/></Field><button className="btn btn-outline-danger me-2" type="submit">Review correction</button><button className="btn btn-outline-secondary" type="button" onClick={onClose}>Close correction</button></fieldset></form>}</SupplierAction>;
}
export default function SupplierDetails(){
  const {supplierId}=useParams(),[purchasePage,setPurchasePage]=useState(1),[historyPage,setHistoryPage]=useState(1),[correction,setCorrection]=useState(null),[statementVersion,setStatementVersion]=useState(0);
  const entity=useLoad('/accounts/entities/'+supplierId),reconciliation=useLoad('/accounts/suppliers/'+supplierId+'/reconciliation');
  const balance=reconciliation;
  const purchases=useLoad('/purchases/'+query({supplierId,page:purchasePage,limit:10}));
  const ready=!!(entity.data?.roles.includes('SUPPLIER')&&balance.data?.authoritative===true&&balance.data?.cutover&&balance.data?.issues?.length===0&&Number.isSafeInteger(balance.data.balanceMinor));
  const history=useLoad('/accounts/suppliers/'+supplierId+'/settlements'+query({page:historyPage,limit:20}),ready);
  const refresh=()=>{setStatementVersion(v=>v+1);reconciliation.reload();history.reload();purchases.reload();};
  return <><PageTitle title={entity.data?.name||'Supplier Khata'}>{ready&&balance.data.balanceMinor>0&&<a className="btn btn-primary btn-sm" href="#supplier-payment" onClick={()=>{document.getElementById('supplier-payment').open=true;}}>Pay supplier</a>}{ready&&balance.data.creditMinor>0&&<a className="btn btn-outline-primary btn-sm" href="#supplier-credit" onClick={()=>{document.getElementById('supplier-credit').open=true;}}>Use supplier credit</a>}<a className="btn btn-outline-secondary btn-sm" href="#supplier-purchases">Purchases / Return Goods</a><Link className="btn btn-sm btn-outline-secondary" to="/owner/accounts/companies">Suppliers</Link></PageTitle><Notice loading={entity.loading||balance.loading} error={entity.error}/>
    {entity.data&&<div className="d-flex flex-wrap justify-content-between gap-2 mb-3"><span>{entity.data.phoneNo||'Phone not recorded'} · {entity.data.address||'Address not recorded'}</span><Link to={'/owner/accounts/companies?business='+supplierId}>Business setup (Advanced)</Link></div>}
    <section aria-label="Supplier balances">
      {ready?<dl className="balance-strip"><div><dt>We owe supplier</dt><dd>Outstanding: {pkr(balance.data.balanceMinor)}</dd></div><div><dt>Supplier credit</dt><dd>{pkr(balance.data.creditMinor)}</dd></div><div><dt>Starting balance</dt><dd className="fs-6">{reconciliation.data?.cutover?'Confirmed':'Checking...'}</dd></div></dl>:null}
      <SupplierBalanceStatus result={reconciliation.data} loading={reconciliation.loading} error={reconciliation.error}/>
    </section>
    {ready&&<TransactionHistory key={balance.data.accountId+'-'+statementVersion} accountId={balance.data.accountId} name={entity.data?.name} supplier/>}

    {ready&&<SupplierPayment supplierId={supplierId} supplierName={entity.data?.name} balance={balance.data.balanceMinor} onChanged={refresh}/>}
    {!ready&&reconciliation.data?.cutover===null&&entity.data?.roles.includes('SUPPLIER')&&<SupplierOpening supplierId={supplierId} onChanged={refresh} defaultOpen/>}
    {ready&&<><SupplierCredit supplierId={supplierId} supplierName={entity.data?.name} balance={balance.data} onChanged={refresh}/>
      <details className="context-help"><summary>Starting balance and credit history</summary><RecordFacts items={[["Starting balance",reconciliation.data?.cutover?'Confirmed at '+pakistanTime(reconciliation.data.cutover.cutoffAt)+' (Pakistan)':'Owner-confirmed setup required'],["Refunds received (net of corrections)",pkr(balance.data.refundsReceivedMinor)],["Credit applied (net of corrections)",pkr(balance.data.creditAppliedMinor)]]}/><p>Supplier credit is separate from what we owe them. It is not cash until a refund is received.</p>{balance.data.creditAccountId&&<Link to={'/owner/accounts/transactions?account='+balance.data.creditAccountId}>Supplier credit statement</Link>}</details></>}
    <section className="panel mb-3" id="supplier-purchases"><h2 className="h5">Purchases</h2><PurchaseTable result={purchases} onPage={setPurchasePage}/></section>
    {ready&&<details className="action-disclosure supplier-settlements" id="supplier-settlements"><summary>Payments, returns and corrections</summary><Notice loading={history.loading}/>{history.error&&<p className="alert alert-warning">Payment history unavailable: {history.error}</p>}{history.data&&<><RecordTable label="Supplier settlement register" rows={history.data.entries} columns={[
 {key:'date',label:'Date (Pakistan)',render:e=>pakistanTime(e.occurredAt)},
 {key:'action',label:'Action',render:e=>activity('SUPPLIER_'+e.kind)+(e.kind==='REVERSAL'&&e.originalKind?' of '+activity('SUPPLIER_'+e.originalKind):'')},
 {key:'reference',label:'Reference'},{key:'value',label:'Event amount',numeric:true,render:e=>pkr(e.amountMinor)},
 {key:'delivery',label:'Delivery',render:e=>e.receiptReference||'—'},
 {key:'correct',label:'Correction',render:e=>e.kind!=='REVERSAL'&&<button className="btn btn-outline-secondary btn-sm" onClick={()=>setCorrection(e)}>Correct</button>}
 ]} details={e=><RecordFacts items={[["Recorded by",e.createdByName||'Unavailable'],["Note",e.reason],["Part for what we owe",pkr(e.payableReductionMinor)],["Supplier credit portion",pkr(e.creditMovementMinor)],["Original action",e.originalKind?activity('SUPPLIER_'+e.originalKind):'—'],["Correction of",e.reversalOf||'—']]}/>} empty="No payments or returns recorded."/><Pagination pagination={history.data.pagination} onPage={setHistoryPage}/></>}</details>}
    {ready&&correction&&<Correction event={correction} supplierId={supplierId} onChanged={refresh} onClose={()=>setCorrection(null)}/>}
  </>;
}
