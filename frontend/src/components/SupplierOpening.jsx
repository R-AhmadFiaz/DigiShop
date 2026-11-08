import {useEffect,useState} from 'react';
import {api,query} from '../api/client';
import {useLoad} from '../api/hooks';
import {Field,Notice} from './Common';
import {minorAmount,pkr,pakistanTime} from '../api/purchases';
import SupplierAction from './SupplierAction';


// Uses the existing immutable supplier cutover; never backfills payments or receipts.
export default function SupplierOpening({supplierId,onChanged,defaultOpen=false}){
  const [expanded,setExpanded]=useState(defaultOpen);
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[situation,setSituation]=useState(''),[amounts,setAmounts]=useState({});
  const availability=useLoad('/orders/payment-accounts');
  let total=0,totalError='';
  try{for(const value of Object.values(amounts))total+=minorAmount(value||'0');if(!Number.isSafeInteger(total))throw new Error('Starting debt exceeds safe money range.');}catch(e){totalError=e.message;}
  useEffect(()=>{
    const controller=new AbortController();setPreview(null);setError('');
    (async()=>{let page=1,result,entries=[];do{result=await api('/accounts/suppliers/'+supplierId+'/cutover-preview'+query({page,limit:100}),{signal:controller.signal});if(result.pagination.totalPages>1)throw new Error('More than 100 historical deliveries require a separately reviewed reconciliation.');entries.push(...result.entries);page++;}while(page<=result.pagination.totalPages);if(!controller.signal.aborted)setPreview({...result,entries});})().catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return()=>controller.abort();
  },[supplierId,version]);
  function submit(e,prepare){
    e.preventDefault();try{
      const fields=new FormData(e.currentTarget),otherOpeningMinor=minorAmount(fields.get('other')),reviews=preview.entries.map(r=>({receiptId:r._id,unpaidMinor:minorAmount(fields.get('unpaid-'+r._id)),reason:fields.get('review-'+r._id)}));
      if(reviews.some((r,i)=>r.unpaidMinor>preview.entries[i].totalMinor))throw new Error('An unpaid amount cannot exceed its delivery value.');
      const total=reviews.reduce((n,r)=>n+BigInt(r.unpaidMinor),BigInt(otherOpeningMinor));if(total>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Opening exceeds safe money range.');
      const cutoffAt=new Date(fields.get('cutoff')+'+05:00').toISOString();setError('');
      prepare({path:'/accounts/suppliers/'+supplierId+'/cutover',title:'Confirm historical supplier opening',summary:preview.supplier.name+'\nVerified outstanding opening: '+pkr(Number(total))+'\nThis is existing debt, not a new purchase, payment or investment. Each old delivery remains unchanged. This opening is permanent; confirm external payments and every unpaid amount before continuing.',body:{requestKey:crypto.randomUUID(),confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt,openingBalanceMinor:Number(total),otherOpeningMinor,reviews,evidenceDigest:preview.evidenceDigest,reason:fields.get('reason')}});
    }catch(e){setError(e.message);}
  }
  const complete=preview&&['other',...preview.entries.map(r=>r._id)].every(key=>Object.hasOwn(amounts,key)&&amounts[key]!=='');
  return <details id="supplier-opening" className="panel mb-3" open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>Confirm previous supplier balance</summary><p className="mt-3">First confirm what you already owe this supplier. For a new supplier with no old debt or deliveries, use Rs 0 below.</p><Notice loading={!preview&&!error} error={error}/>
    {preview&&!preview.cutover&&<><Notice loading={availability.loading} error={availability.error}/>{availability.data?.accountingEnabled!==true&&!availability.loading&&<p className="alert alert-warning">Finish money-record setup before confirming this balance.</p>}</>}
    {preview&&!preview.cutover&&<Field label="Does this supplier have previous records?"><select aria-label="Supplier starting situation" className="form-select" value={preview.entries.length?'existing':situation} onChange={e=>{setSituation(e.target.value);setAmounts({});}} ><option value="">Choose an option</option><option value="new" disabled={preview.entries.length>0}>No &mdash; New supplier</option><option value="existing">Yes &mdash; Existing supplier</option></select></Field>}
    {situation==='new'&&!preview?.entries.length&&<p>No previous debt or deliveries. Start from Rs 0.</p>}
    {preview&&!preview.cutover&&situation==='new'&&preview.entries.length===0&&<SupplierAction operation={'new-supplier-opening-'+supplierId} onChanged={()=>{setVersion(v=>v+1);onChanged();}}>{({prepare,locked})=><form onSubmit={e=>{e.preventDefault();if(locked)return;prepare({path:'/accounts/suppliers/'+supplierId+'/cutover',title:'Confirm new supplier with zero opening debt',summary:preview.supplier.name+'\nOpening payable: PKR 0.00. Confirm nothing was owed before this start. This does not add stock or move money.',body:{requestKey:crypto.randomUUID(),confirmation:'CONFIRM SUPPLIER OPENING',enrollNewSupplier:true,cutoffAt:new Date().toISOString(),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:preview.evidenceDigest,reason:'Owner confirmed new supplier has no historical debt or deliveries'}});}}><fieldset disabled={locked||availability.data?.accountingEnabled!==true}><label className="form-check my-3"><input type="checkbox" className="form-check-input" required/>This is a new supplier. We owe no historical balance and have no earlier deliveries to reconcile.</label><button className="btn btn-primary mb-3">Review Rs 0 starting balance</button></fieldset></form>}</SupplierAction>}
    {preview?.cutover?<p>Starting balance confirmed at {pakistanTime(preview.cutover.cutoffAt)}. Check any reported problem; do not enter this balance again.</p>:preview&&(situation==='existing'||preview.entries.length>0)&&<section><SupplierAction operation={'supplier-opening-'+supplierId} onChanged={()=>{setVersion(v=>v+1);onChanged();}}>{({prepare,locked})=><form onSubmit={e=>submit(e,prepare)}><fieldset disabled={locked||availability.data?.accountingEnabled!==true}>
      <Field label="Starting date and time (Pakistan)"><input name="cutoff" type="datetime-local" step="0.001" className="form-control" defaultValue={new Date(Date.now()+5*3600000).toISOString().slice(0,23)} required/></Field>
      <Field label={preview.entries.length?'Additional previous debt (PKR)':'Previous amount owed (PKR)'}><input name="other" className="form-control" type="number" min="0" step="0.01" required onChange={e=>setAmounts(v=>({...v,other:e.target.value}))}/></Field>
      {preview.entries.length>0&&<p>Enter only unpaid delivery amounts below. Additional previous debt must not include these deliveries.</p>}
      {preview.entries.map(r=><div className="border-top pt-2" key={r._id}><p>{r.reference} · {pkr(r.totalMinor)} · {pakistanTime(r.occurredAt)} · {r.accountingStatus}</p><Field label={'Unpaid amount for '+r.reference+' (PKR)'}><input name={'unpaid-'+r._id} className="form-control" type="number" min="0" max={r.totalMinor/100} step="0.01" required onChange={e=>setAmounts(v=>({...v,[r._id]:e.target.value}))}/></Field><Field label={'Review / external payment evidence for '+r.reference}><input name={'review-'+r._id} className="form-control" maxLength={300} required/></Field></div>)}
      <p><strong>Total starting debt: {totalError||(complete?pkr(total):'Not confirmed')}</strong></p>
      <Field label="Reason / note"><input name="reason" className="form-control" maxLength={300} required/></Field><label className="form-check mb-3"><input className="form-check-input" type="checkbox" required/>I verified every old delivery and external payment. These amounts are still owed and are not already posted.</label>
      <button className="btn btn-primary" type="submit">Review starting balance</button>
    </fieldset></form>}</SupplierAction></section>}
  </details>;
}
