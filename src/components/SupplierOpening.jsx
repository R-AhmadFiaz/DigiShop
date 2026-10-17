import {useEffect,useState} from 'react';
import {api,query} from '../api/client';
import {useLoad} from '../api/hooks';
import {Field,Notice,Pagination} from './Common';
import {minorAmount,pkr,pakistanTime,accountName} from '../api/purchases';
import SupplierAction from './SupplierAction';

const accountLabels={SUPPLIER_PAYABLE:'Supplier balance account',PURCHASES_CLEARING:'Received-goods account',OPENING_EQUITY:'Starting-value account'};

// Uses the existing immutable supplier cutover; never backfills payments or receipts.
export default function SupplierOpening({supplierId,onChanged}){
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[page,setPage]=useState(1),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState({}),[savedAccounts,setSavedAccounts]=useState({}),[success,setSuccess]=useState('');
  const accounts=useLoad('/accounts/financial'+query({page,limit:100})),availability=useLoad('/orders/payment-accounts');
  const choices=[...new Map([...Object.values(savedAccounts),...(accounts.data?.entries??[])].map(a=>[a._id,a])).values()];
  useEffect(()=>{
    const controller=new AbortController();setPreview(null);setError('');
    (async()=>{let page=1,result,entries=[];do{result=await api('/accounts/suppliers/'+supplierId+'/cutover-preview'+query({page,limit:100}),{signal:controller.signal});if(result.pagination.totalPages>1)throw new Error('More than 100 historical deliveries require a separately reviewed reconciliation.');entries.push(...result.entries);page++;}while(page<=result.pagination.totalPages);if(!controller.signal.aborted)setPreview({...result,entries});})().catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[supplierId,version]);
  async function createAccount(kind){
    if(busy||!window.confirm('Create a '+accountLabels[kind].toLowerCase()+'? This creates no money or debt.'))return;
    setBusy(true);setError('');setSuccess('');try{const account=await api('/accounts/financial',{method:'POST',body:{kind,code:({SUPPLIER_PAYABLE:'AP_',PURCHASES_CLEARING:'RECEIVED_',OPENING_EQUITY:'EQUITY_'})[kind]+supplierId,name:kind.replaceAll('_',' '),...(kind==='SUPPLIER_PAYABLE'?{entityId:supplierId}:{})}});setSavedAccounts(rows=>({...rows,[account._id]:account}));setSelected(rows=>({...rows,[kind]:account._id}));setSuccess('Account selected. Review and confirm the starting balance next.');accounts.reload();}catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function submit(e,prepare){
    e.preventDefault();try{
      const fields=new FormData(e.currentTarget),otherOpeningMinor=minorAmount(fields.get('other')),reviews=preview.entries.map(r=>({receiptId:r._id,unpaidMinor:minorAmount(fields.get('unpaid-'+r._id)),reason:fields.get('review-'+r._id)}));
      if(reviews.some((r,i)=>r.unpaidMinor>preview.entries[i].totalMinor))throw new Error('An unpaid amount cannot exceed its delivery value.');
      const total=reviews.reduce((n,r)=>n+BigInt(r.unpaidMinor),BigInt(otherOpeningMinor));if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Opening exceeds safe money range.');
      const cutoffAt=new Date(fields.get('cutoff')+'+05:00').toISOString();setError('');
      prepare({path:'/accounts/suppliers/'+supplierId+'/cutover',title:'Confirm historical supplier opening',summary:preview.supplier.name+'\nVerified outstanding opening: '+pkr(Number(total))+'\nThis is existing debt, not a new purchase, payment or investment. Each old delivery remains unchanged. This opening is permanent; confirm external payments and every unpaid amount before continuing.',body:{requestKey:crypto.randomUUID(),confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt,payableAccountId:fields.get('SUPPLIER_PAYABLE'),offsetAccountId:fields.get('PURCHASES_CLEARING'),equityAccountId:fields.get('OPENING_EQUITY'),openingBalanceMinor:Number(total),otherOpeningMinor,reviews,evidenceDigest:preview.evidenceDigest,reason:fields.get('reason')}});
    }catch(e){setError(e.message);}
  }
  return <details className="panel mb-3"><summary>Set supplier starting balance</summary><p className="mt-3">First confirm what you already owe this supplier. For a new supplier with no old debt or deliveries, use Rs 0 below.</p><Notice loading={!preview&&!error} error={error} success={success}/>
    {preview&&!preview.cutover&&<><Notice loading={availability.loading} error={availability.error||accounts.error}/>{availability.data?.accountingEnabled!==true&&!availability.loading&&<p className="alert alert-warning">Finish money-record setup before confirming this balance.</p>}</>}
    {preview&&!preview.cutover&&preview.entries.length===0&&<SupplierAction operation={'new-supplier-opening-'+supplierId} onChanged={()=>{setVersion(v=>v+1);onChanged();}}>{({prepare,locked})=><form onSubmit={e=>{e.preventDefault();if(locked)return;prepare({path:'/accounts/suppliers/'+supplierId+'/cutover',title:'Confirm new supplier with zero opening debt',summary:preview.supplier.name+'\nOpening payable: PKR 0.00. Confirm nothing was owed before this start. This does not add stock or move money.',body:{requestKey:crypto.randomUUID(),confirmation:'CONFIRM SUPPLIER OPENING',enrollNewSupplier:true,cutoffAt:new Date().toISOString(),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:preview.evidenceDigest,reason:'Owner confirmed new supplier has no historical debt or deliveries'}});}}><fieldset disabled={locked||availability.data?.accountingEnabled!==true}><label className="form-check my-3"><input type="checkbox" className="form-check-input" required/>This is a new supplier. We owe no historical balance and have no earlier deliveries to reconcile.</label><button className="btn btn-primary mb-3">Review Rs 0 starting balance</button></fieldset></form>}</SupplierAction>}
    {preview?.cutover?<p>Starting balance confirmed at {pakistanTime(preview.cutover.cutoffAt)}. Check any reported problem; do not enter this balance again.</p>:preview&&<details open={preview.entries.length>0}><summary>Existing debt or manual account selection</summary><SupplierAction operation={'supplier-opening-'+supplierId} onChanged={()=>{setVersion(v=>v+1);onChanged();}}>{({prepare,locked})=><form onSubmit={e=>submit(e,prepare)}><fieldset disabled={locked||busy||availability.data?.accountingEnabled!==true}>
      <Field label="Starting date and time (Pakistan)"><input name="cutoff" type="datetime-local" step="0.001" className="form-control" defaultValue={new Date(Date.now()+5*3600000).toISOString().slice(0,23)} required/></Field>
      {['SUPPLIER_PAYABLE','PURCHASES_CLEARING','OPENING_EQUITY'].map(kind=><div key={kind}><Field label={accountLabels[kind]}><select name={kind} className="form-select" required value={selected[kind]??''} onChange={e=>{const id=e.target.value,account=choices.find(a=>a._id===id);setSelected(rows=>({...rows,[kind]:id}));if(account)setSavedAccounts(rows=>({...rows,[id]:account}));}}><option value="">Choose account</option>{choices.filter(a=>a.kind===kind&&a.isActive!==false&&(kind!=='SUPPLIER_PAYABLE'||a.entityId===supplierId)).map(a=><option key={a._id} value={a._id}>{accountName(a)}</option>)}</select></Field><button type="button" className="btn btn-outline-secondary btn-sm mb-3" onClick={()=>createAccount(kind)}>Create {accountLabels[kind].toLowerCase()}</button></div>)}
      <Pagination pagination={accounts.data?.pagination} onPage={setPage}/>
      <Field label="Other amount already owed (PKR)"><input name="other" className="form-control" type="number" min="0" step="0.01" required defaultValue="0"/></Field>
      {preview.entries.map(r=><div className="border-top pt-2" key={r._id}><p>{r.reference} · {pkr(r.totalMinor)} · {pakistanTime(r.occurredAt)} · {r.accountingStatus}</p><Field label={'Unpaid amount for '+r.reference+' (PKR)'}><input name={'unpaid-'+r._id} className="form-control" type="number" min="0" max={r.totalMinor/100} step="0.01" required/></Field><Field label={'Review / external payment evidence for '+r.reference}><input name={'review-'+r._id} className="form-control" maxLength={300} required/></Field></div>)}
      <Field label="Starting balance note"><input name="reason" className="form-control" maxLength={300} required/></Field><label className="form-check mb-3"><input className="form-check-input" type="checkbox" required/>I verified every old delivery and external payment. These amounts are still owed and are not already posted.</label>
      <button className="btn btn-primary" type="submit">Review starting balance</button>
    </fieldset></form>}</SupplierAction></details>}
  </details>;
}
