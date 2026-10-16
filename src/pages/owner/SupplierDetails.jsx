import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { activity, minorAmount, pakistanTime, pkr } from '../../api/purchases';
import { Empty, Field, Notice, PageTitle, Pagination } from '../../components/Common';
import PurchaseTable from '../../components/PurchaseTable';
import SupplierAction from '../../components/SupplierAction';

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
  return <SupplierAction onChanged={()=>{setSelected(null);onChanged();}}>{({prepare,locked})=>balance===null?null:balance===0?<p className="text-body-secondary">No supplier payment is due.</p>:<section className="panel mb-3"><h2 className="h5">Pay supplier</h2><p className="text-body-secondary">Choose a prepared cash or bank account. Payment reduces cash/bank and supplier payable; it does not receive stock.</p>
    <Field label="Find payment account"><input className="form-control" maxLength={100} disabled={locked} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setSelected(null);}}/></Field><Notice loading={accounts.loading} error={accounts.error}/>
    <Field label="Payment account"><select className="form-select" disabled={locked} value={selected?._id||''} onChange={e=>setSelected(accounts.data.entries.find(a=>a._id===e.target.value)||null)}><option value="">Choose cash or bank</option>{accounts.data?.entries.filter(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false&&a.cashCutoverId).map(a=><option key={a._id} value={a._id}>{a.name}</option>)}</select></Field>
    {accounts.data&&!accounts.data.entries.some(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false&&a.cashCutoverId)&&<p>No prepared cash or bank accounts on this page. Accounting setup is required before payment.</p>}<Pagination pagination={accounts.data?.pagination} onPage={p=>{setPage(p);setSelected(null);}}/>
    {selected&&<PaymentEntry key={selected._id} account={{...selected,supplierId,supplierName}} balance={balance} prepare={prepare} locked={locked}/>}
  </section>}</SupplierAction>;
}
export default function SupplierDetails(){
  const {supplierId}=useParams(),[purchasePage,setPurchasePage]=useState(1),[historyPage,setHistoryPage]=useState(1);
  const entity=useLoad('/accounts/entities/'+supplierId),balance=useLoad('/accounts/suppliers/'+supplierId+'/balance'),reconciliation=useLoad('/accounts/suppliers/'+supplierId+'/reconciliation');
  const purchases=useLoad('/purchases/'+query({supplierId,page:purchasePage,limit:10})),history=useLoad('/accounts/suppliers/'+supplierId+'/settlements'+query({page:historyPage,limit:20}));
  const ready=entity.data?.roles.includes('SUPPLIER')&&balance.data?.authoritative===true&&Number.isSafeInteger(balance.data.balanceMinor);
  const refresh=()=>{balance.reload();reconciliation.reload();history.reload();purchases.reload();};
  return <><PageTitle title={entity.data?.name||'Supplier account'}><Link className="btn btn-sm btn-outline-secondary" to="/owner/accounts/companies">Companies &amp; Suppliers</Link></PageTitle><Notice loading={entity.loading} error={entity.error}/>
    <section className="panel mb-3"><h2 className="h5">Supplier payable</h2><Notice loading={balance.loading}/>{ready?<><p className="fs-5 fw-semibold">Outstanding: {pkr(balance.data.balanceMinor)}</p><Link to={'/owner/accounts/transactions?account='+balance.data.accountId}>Payable statement</Link></>:<p role="status" className="alert alert-warning">Payable unavailable: {balance.error||'Waiting for authoritative accounting.'} This is not a zero balance.</p>}
      <Notice error={reconciliation.error}/>{reconciliation.data&&<><p>Opening balance: {reconciliation.data.cutover?'Confirmed at '+pakistanTime(reconciliation.data.cutover.cutoffAt)+' (Pakistan)':'Owner-confirmed setup required'}</p>{reconciliation.data.issues?.map((i,index)=><p className="text-warning" key={index}>{i.problem}</p>)}<p className="text-body-secondary">Deferred delivery evidence is separate from posted debt. Customer debt and store credit remain separate.</p></>}
    </section>
    <SupplierPayment supplierId={supplierId} supplierName={entity.data?.name} balance={ready?balance.data.balanceMinor:null} onChanged={refresh}/>
    <section className="panel mb-3"><h2 className="h5">Purchases</h2><PurchaseTable result={purchases} onPage={setPurchasePage}/></section>
    <section className="panel"><h2 className="h5">Payments, returns and corrections</h2><Notice loading={history.loading}/>{history.error&&<p className="alert alert-warning">Settlement history unavailable: {history.error}</p>}{history.data&&<><p className="text-body-secondary">Payments are not allocated to individual deliveries. Return credit reduces payable; it is not cash received.</p><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Reference</th><th>Activity</th><th>Date (Pakistan)</th><th>Actor</th><th>Amount</th><th>Delivery</th></tr></thead><tbody>{history.data.entries.map(e=><tr key={e._id}><td>{e.reference}</td><td>{activity(e.kind)}{e.kind==='REVERSAL'?' (linked correction)':''}</td><td>{pakistanTime(e.occurredAt)}</td><td>{e.createdByName||'Unavailable'}</td><td>{pkr(e.amountMinor)}</td><td>{e.receiptReference||'—'}</td></tr>)}</tbody></table></div>{history.data.entries.length===0&&<Empty>No settlements recorded.</Empty>}<Pagination pagination={history.data.pagination} onPage={setHistoryPage}/></>}</section>
  </>;
}
