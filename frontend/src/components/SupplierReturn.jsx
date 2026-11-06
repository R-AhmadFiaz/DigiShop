import RecordTable, {RecordFacts} from "./RecordTable";
import { useEffect, useState } from 'react';
import { api, query } from '../api/client';
import { useLoad } from '../api/hooks';
import { activity, pakistanTime, pkr, quantityItems, returnQuantities } from '../api/purchases';
import { Field, Notice } from './Common';
import SupplierAction from './SupplierAction';

export default function SupplierReturn({receipt,onClose,onChanged}) {
  const [history,setHistory]=useState(null),[error,setError]=useState(''),[values,setValues]=useState({}),[revision,setRevision]=useState(0);
  const balance=useLoad('/accounts/suppliers/'+receipt.supplierId+'/balance');
  useEffect(()=>{
    const controller=new AbortController();setHistory(null);setError('');
    (async()=>{
      const events=[];let page=1,totalPages;
      do{const result=await api('/accounts/suppliers/'+receipt.supplierId+'/settlements'+query({sourceId:receipt._id,page,limit:100}),{signal:controller.signal});
        events.push(...result.entries);totalPages=result.pagination.totalPages;
        if(totalPages>100)throw new Error('Return history is too large for safe entry here. Ask for a history review.');page++;
      }while(page<=totalPages);
      returnQuantities(receipt,events);if(!controller.signal.aborted)setHistory(events);
    })().catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    return ()=>controller.abort();
  },[receipt,revision]);
  const quantities=history?returnQuantities(receipt,history):null,ready=balance.data?.authoritative===true&&quantities&&receipt.accountingStatus!=='DEFERRED';
  function submit(e,prepare){
    e.preventDefault();try{const items=quantityItems(receipt.items,values,r=>quantities[r.productId].eligible),fields=new FormData(e.currentTarget);setError('');prepare({path:'/accounts/suppliers/'+receipt.supplierId+'/returns',title:'Confirm purchase return',summary:receipt.reference+'\nCurrent supplier payable: '+pkr(balance.data.balanceMinor)+'\n'+items.map(r=>receipt.items.find(i=>i.productId===r.productId).name+': '+r.quantity+' returned').join('\n')+'\nConfirm the supplier has accepted these goods. Payable is reduced first; any excess becomes available supplier credit. No cash refund will be recorded.',body:{requestKey:crypto.randomUUID(),reason:fields.get('reason'),occurredAt:new Date().toISOString(),receiptId:receipt._id,items}});}catch(e){setError(e.message);}
  }
  return <section className="panel mt-3" aria-label="Purchase return"><div className="d-flex justify-content-between gap-2"><h2 className="h5">Return from {receipt.reference}</h2><button className="btn btn-sm btn-outline-secondary" onClick={onClose}>Close return details</button></div>
    <details className="context-help"><summary>How supplier returns work</summary><p>Returns first reduce what we owe. Any extra becomes money the supplier owes us. Record a refund only after receiving the money.</p></details>
    <Notice loading={!history&&!error} error={error||balance.error}/>{balance.error&&<p>Accounting is unavailable or requires supplier setup. Return quantities cannot be confirmed.</p>}
    {receipt.accountingStatus==='DEFERRED'&&<p className="alert alert-warning">Check this old delivery and its starting balance before recording a return.</p>}
    {quantities&&<div className="table-responsive"><table className="table table-sm record-table"><thead><tr><th>Product</th><th className="text-end">Received</th><th className="text-end">Already returned</th><th className="text-end">Can return</th><th className="text-end">Original cost</th></tr></thead><tbody>{receipt.items.map(r=><tr key={r.productId}><td>{r.name}</td><td className="text-end record-number">{r.quantity}</td><td className="text-end record-number">{quantities[r.productId].returned}</td><td className="text-end record-number">{quantities[r.productId].eligible}</td><td className="text-end record-number">{pkr(r.unitCostMinor)}</td></tr>)}</tbody></table></div>}
    <SupplierAction onChanged={()=>{setRevision(v=>v+1);balance.reload();setValues({});onChanged();}}>{({prepare,locked})=><form onSubmit={e=>submit(e,prepare)}><fieldset disabled={locked||!ready}>
      {receipt.items.map(r=><Field label={'Return '+r.name} key={r.productId}><input className="form-control" type="number" min="0" max={quantities?.[r.productId].eligible??0} step="1" value={values[r.productId]??''} onChange={e=>setValues({...values,[r.productId]:e.target.value})}/></Field>)}
      <Field label="Return reason"><input name="reason" className="form-control" required maxLength={300}/></Field><button className="btn btn-primary" type="submit" disabled={!Object.values(quantities||{}).some(q=>q.eligible>0)}>Review return</button>
    </fieldset></form>}</SupplierAction>
    {history&&<><h3 className="h6 mt-3">Confirmed returns and corrections</h3><RecordTable label="Supplier goods return register" rows={history} columns={[
 {key:'date',label:'Date (Pakistan)',render:e=>pakistanTime(e.occurredAt)},
 {key:'action',label:'Action',render:e=>e.kind==='REVERSAL'?'Correction of supplier return':activity(e.kind)},
 {key:'reference',label:'Reference'},{key:'value',label:'Return / correction value',numeric:true,render:e=>pkr(e.amountMinor)}
 ]} details={e=><><RecordFacts items={[["Recorded by",e.createdByName||'Unavailable'],["Note",e.reason],["Original record",e.reversalOf||'—']]}/><RecordTable label={'Returned products '+e.reference} rows={e.items||[]} rowKey={i=>i.productId} columns={[{key:'name',label:'Product'},{key:'quantity',label:'Quantity',numeric:true},{key:'cost',label:'Original unit cost',numeric:true,render:i=>pkr(i.unitCostMinor)}]}/></>} empty="No returns recorded."/></>}
  </section>;
}
