import {useEffect,useId,useRef,useState} from 'react';
import {api,query,ApiError} from '../api/client';
import {useDebounce,useLoad} from '../api/hooks';
import {pkr} from '../api/purchases';
import {paymentAmount,samePayable,verifiedPayable} from '../api/supplierPayment';
import {Field,Notice,Pagination} from './Common';
import SupplierAction from './SupplierAction';

function PaymentEntry({account,balance,prepare,locked,onChanged}){
  const result=useLoad('/accounts/financial/'+account._id),[error,setError]=useState(''),[checking,setChecking]=useState(false),lock=useRef(false);
  const form=useRef(null);
  useEffect(()=>{if(!result.loading&&result.data)form.current?.querySelector('input[name=amount]')?.focus();},[result.loading,result.data]);
  async function submit(e){
    e.preventDefault();if(locked||lock.current)return;lock.current=true;setChecking(true);setError('');
    const fields=new FormData(e.currentTarget),trigger=e.nativeEvent.submitter||document.activeElement;
    try{
      const amountMinor=paymentAmount(fields.get('amount'),balance,result.data?.balanceMinor);
      const [snapshot,funds]=await Promise.all([api('/accounts/suppliers/'+account.supplierId+'/reconciliation'),api('/accounts/financial/'+account._id)]);
      if(!verifiedPayable(snapshot))throw Error('Confirm or review the previous supplier balance before paying.');
      if(snapshot.balanceMinor!==balance){onChanged();throw Error('The supplier balance changed. Check the updated amount and review again.');}
      paymentAmount(fields.get('amount'),snapshot.balanceMinor,funds.balanceMinor);
      prepare({path:'/accounts/suppliers/'+account.supplierId+'/payments',confirmationType:'supplier-payment',title:'Confirm supplier payment',confirmLabel:'Confirm payment',
        supplierName:account.supplierName,accountName:account.name,beforeMinor:snapshot.balanceMinor,afterMinor:snapshot.balanceMinor-amountMinor,
        snapshot:{cutover:{_id:snapshot.cutover._id},balanceMinor:snapshot.balanceMinor,creditMinor:snapshot.creditMinor},availableMinor:funds.balanceMinor,
        summary:'Confirm this payment has actually been sent to the supplier.',
        body:{requestKey:crypto.randomUUID(),accountId:account._id,amountMinor,reason:fields.get('reason'),occurredAt:new Date().toISOString()}},trigger);
    }catch(e){setError(e.message);}finally{lock.current=false;setChecking(false);}
  }
  return <form ref={form} onSubmit={submit}><Notice loading={result.loading} error={error||result.error}/>{result.error&&<button type="button" className="btn btn-outline-secondary btn-sm mb-2" onClick={result.reload}>Retry account balance</button>}{result.data&&<p className="small">Available in {account.name}: {pkr(result.data.balanceMinor)}</p>}
    <fieldset disabled={locked||checking||!Number.isSafeInteger(result.data?.balanceMinor)}>
      <Field label="Payment amount (PKR)"><input name="amount" aria-label="Payment amount (PKR)" className="form-control" type="number" min="0.01" step="0.01" max={balance/100} defaultValue={(balance/100).toFixed(2)} required/></Field>
      <Field label="Payment note (Optional)"><input name="reason" className="form-control" maxLength={300}/></Field>
      <button className="btn btn-primary" type="submit">{checking?'Checking balances...':'Review supplier payment'}</button>
    </fieldset>
  </form>;
}
export default function SupplierPayment({supplierId,supplierName,balance,onChanged,inline=false,onLockedChange,onRefresh=onChanged}){
  const controlId=useId();
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[selected,setSelected]=useState(null);
  const accounts=useLoad('/accounts/financial'+query({q:useDebounce(search),page,limit:20}),balance!==null&&balance>0);
  async function beforeConfirm(request){
    const [current,funds]=await Promise.all([api('/accounts/suppliers/'+supplierId+'/reconciliation'),api('/accounts/financial/'+request.body.accountId)]);
    if(!samePayable(current,request.snapshot)||funds.balanceMinor!==request.availableMinor)throw new ApiError('The supplier or account balance changed. Refresh current data and review the payment again.',409);
    paymentAmount(String(request.body.amountMinor/100),current.balanceMinor,funds.balanceMinor);
  }
  return <SupplierAction successMessage={inline?'':'Supplier payment recorded.'} operation={'supplier-payment-'+supplierId} legacyOperation="supplier-operation" requestPath={'/accounts/suppliers/'+supplierId+'/payments'} beforeConfirm={beforeConfirm} onRefresh={onRefresh} onLockedChange={onLockedChange} onChanged={()=>{setSelected(null);onChanged();}}>{({prepare,locked})=>balance===null||balance===0?null:<details data-supplier-payment id={inline?'quick-supplier-payment-'+controlId:'supplier-payment'} className="action-disclosure" open={inline||locked||undefined}><summary>Pay supplier</summary>
    <div className="mb-3"><label className="form-label" id={controlId+'-pay-from'}>Pay from (Cash / Bank)</label>
      <details className="border rounded p-2"><summary aria-labelledby={controlId+'-pay-from'} aria-disabled={locked} onClick={e=>{if(locked)e.preventDefault();}}>{selected?selected.name+' ('+selected.kind+')':'Choose cash or bank'}</summary>
        <div className="pt-2"><input aria-label="Search payment accounts" placeholder="Search account name" className="form-control mb-2" maxLength={100} disabled={locked} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();}}/><Notice loading={accounts.loading} error={accounts.error}/>
          {accounts.error&&<button type="button" className="btn btn-outline-secondary btn-sm" onClick={accounts.reload}>Retry account list</button>}
          {!accounts.loading&&!accounts.error&&accounts.data?.entries.filter(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false&&a.cashCutoverId).map(a=><button type="button" key={a._id} className="btn btn-outline-secondary w-100 text-start mb-1" aria-pressed={selected?._id===a._id} disabled={locked} onClick={e=>{setSelected(a);e.currentTarget.closest('details').open=false;}}>{a.name} ({a.kind})</button>)}
          {!accounts.loading&&accounts.data&&!accounts.data.entries.some(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false&&a.cashCutoverId)&&<p className="mb-2">No prepared cash or bank accounts found. Try another search or page, or prepare an account in Cash &amp; Bank.</p>}
          <Pagination pagination={accounts.data?.pagination} onPage={setPage}/>
        </div>
      </details>
    </div>
    {selected&&<PaymentEntry key={selected._id+'-'+balance} account={{...selected,supplierId,supplierName}} balance={balance} prepare={prepare} locked={locked} onChanged={onRefresh}/>}
  </details>}</SupplierAction>;
}
