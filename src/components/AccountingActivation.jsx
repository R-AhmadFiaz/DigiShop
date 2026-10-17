import {useState} from 'react';
import {api} from '../api/client';
import {useLoad} from '../api/hooks';
import {requestKey} from '../api/invoice';
import {minorAmount,pakistanTime} from '../api/purchases';
import {Field,Notice} from './Common';
import SupplierAction from './SupplierAction';

const root='/accounts/activation';
export default function AccountingActivation({onChanged}){
  const status=useLoad(root),accounts=useLoad('/accounts/financial?limit=100');
  const [strategy,setStrategy]=useState(''),[reason,setReason]=useState(''),[confirmation,setConfirmation]=useState('');
  const [preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const state=status.data?.state,revision=status.data?.revision;
  const selectedStrategy=strategy||status.data?.strategy||'CLEAN_START';
  function changed(){setPreview(null);setConfirmation('');status.reload();accounts.reload();onChanged?.();}
  async function review(){if(busy)return;setBusy(true);setError('');try{setPreview(await api(root+'/preview',{method:'POST',body:{}}));}catch(e){setError(e.message);setPreview(null);}finally{setBusy(false);}}
  function prepareAction(prepare,operation,phrase,extra={}){
    if(!reason.trim()||confirmation!==phrase){setError('Enter a reason and type '+phrase+' exactly.');return;}
    setError('');prepare({path:root+'/'+operation,title:operation==='pause'?'Pause financial posting':'Confirm accounting change',summary:operation==='prepare'?'Business changes will be temporarily blocked while you review and confirm your opening setup. Existing records will not be deleted or cleared.':operation==='pause'?'Financial posting will stop. Existing records remain intact. Unposted sales will not be permitted.':'The server will recheck the reviewed records before changing accounting.',body:{requestKey:requestKey(),expectedRevision:revision,reason:reason.trim(),confirmation,...extra}});
  }
  return <section className="panel mb-4" id="accounting-activation" aria-label="Accounting activation">
    <h2 className="h5">Accounting activation</h2><Notice loading={status.loading} error={status.error||error}/>
    {status.data&&<SupplierAction operation="accounting-activation" onChanged={changed}>{({prepare,locked})=><>
      <p><strong>Status: {state}</strong>{status.data.cutoffAt&&<> · Opening cutoff: {pakistanTime(status.data.cutoffAt)}</>}</p>
      {!status.data.permitted&&<div className="alert alert-warning">Production accounting permission is disabled on the server. No automatic activation or balance reset is performed.</div>}
      {state==='DISABLED'&&<p>Choose a clean start only for verified zero customer debt and credit, with reviewed zero supplier opening debt. Otherwise choose reconciliation to carry forward explicitly verified balances. Nothing is cleared automatically.</p>}
      {['DISABLED','PREPARING'].includes(state)&&selectedStrategy==='CLEAN_START'&&<p className="text-warning-emphasis">Clean start keeps pre-start invoices for reference but locks their payments, refunds and adjustments. Choose reconciliation if those invoices represent real obligations.</p>}
      {state==='PREPARING'&&<p className="alert alert-warning">Business changes are temporarily blocked. Complete the opening setup below, then review activation readiness here. Unexplained demo balances must be reconciled; they are never silently removed.</p>}
      {['PREPARING','PAUSED'].includes(state)&&<button className="btn btn-outline-primary mb-3" disabled={busy||locked||!status.data.permitted} onClick={review}>{busy?'Checking...':'Review activation readiness'}</button>}
      {preview&&<div className="mb-3" aria-label="Activation readiness"><strong>{preview.ready?'Ready for explicit confirmation':'Setup needs attention'}</strong><ul>{preview.blockers.map(b=><li key={b}>{b}</li>)}</ul><p className="text-body-secondary">Preview expires {pakistanTime(preview.expiresAt)}. Existing customer balances remain in their existing ledger. Openings are not sales or partner investments.</p></div>}
      <fieldset disabled={locked||busy}>
        {['DISABLED','PREPARING'].includes(state)&&<Field label="Starting point (changes allowed only before opening confirmation)"><select className="form-select" value={selectedStrategy} onChange={e=>setStrategy(e.target.value)}><option value="CLEAN_START">Clean start — verified zero historical debts/credits</option><option value="RECONCILE">Reconcile — explicitly retain verified existing balances</option></select></Field>}
        <Field label="Reason"><input className="form-control" maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
        <Field label={state==='PREPARING'?'Type ACTIVATE ACCOUNTING to activate, or PREPARE ACCOUNTING to revise the starting point':'Type '+(state==='DISABLED'?'PREPARE ACCOUNTING':state==='ACTIVE'?'PAUSE ACCOUNTING':'ACTIVATE ACCOUNTING')+' to confirm'}><input className="form-control" autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></Field>
        {state==='DISABLED'&&<button className="btn btn-primary" disabled={!status.data.permitted} onClick={()=>prepareAction(prepare,'prepare','PREPARE ACCOUNTING',{strategy:selectedStrategy})}>Begin reviewed setup</button>}
        {state==='PREPARING'&&<button className="btn btn-outline-secondary me-2" disabled={!status.data.permitted} onClick={()=>prepareAction(prepare,'prepare','PREPARE ACCOUNTING',{strategy:selectedStrategy})}>Revise starting point</button>}
        {state==='ACTIVE'&&<button className="btn btn-outline-danger" onClick={()=>prepareAction(prepare,'pause','PAUSE ACCOUNTING')}>Pause financial posting</button>}
        {['PREPARING','PAUSED'].includes(state)&&<button className="btn btn-primary" disabled={!preview?.ready||!status.data.permitted} onClick={()=>prepareAction(prepare,state==='PAUSED'?'resume':'confirm','ACTIVATE ACCOUNTING',{previewToken:preview.previewToken,expiresAt:preview.expiresAt})}>{state==='PAUSED'?'Resume accounting':'Activate accounting'}</button>}
      </fieldset>
      {state==='ACTIVE'&&<Enrollment accounts={accounts.data?.entries??[]} revision={revision} onChanged={changed}/>}
      <details className="mt-3"><summary>Activation audit history</summary><ul>{status.data.history.map(event=><li key={event._id}>{pakistanTime(event.recordedAt)} · {event.operation} · {event.actorName} · {event.reason}</li>)}</ul></details>
    </>}</SupplierAction>}
  </section>;
}
function Enrollment({accounts,revision,onChanged}){
  const [error,setError]=useState('');
  return <SupplierAction operation="accounting-enrollment" onChanged={onChanged}>{({prepare,locked})=><form className="mt-4" onSubmit={e=>{
    e.preventDefault();if(locked)return;setError('');
    try{const values=Object.fromEntries(new FormData(e.currentTarget));if(values.confirmation!=='ENROLL ACCOUNT')throw new Error('Type ENROLL ACCOUNT exactly.');prepare({path:root+'/enroll',title:'Enroll cash/bank account',summary:'Confirm the actual money already held in this new account. This is an opening balance, not sales revenue or a new partner investment.',body:{...values,amountMinor:minorAmount(values.amount),expectedRevision:revision,requestKey:requestKey()}});}catch(err){setError(err.message);}
  }}><h3 className="h6">Prepare an additional cash/bank account</h3><Notice error={error}/><fieldset disabled={locked}>
    <Field label="Unused account"><select name="accountId" className="form-select" required><option value="">Select account</option>{accounts.filter(a=>['CASH','BANK'].includes(a.kind)&&a.isActive!==false&&!a.cashCutoverId).map(a=><option key={a._id} value={a._id}>{a.name}</option>)}</select></Field>
    <Field label="Verified opening money (PKR)"><input name="amount" className="form-control" type="number" min="0" step="0.01" required/></Field>
    <Field label="Reason / evidence"><input name="reason" className="form-control" maxLength={300} required/></Field>
    <Field label="Type ENROLL ACCOUNT"><input name="confirmation" className="form-control" required/></Field>
    <button className="btn btn-outline-primary">Review account enrollment</button>
  </fieldset></form>}</SupplierAction>;
}
