import RecordTable, {RecordFacts} from "../../components/RecordTable";
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLoad } from '../../api/hooks';
import { query } from '../../api/client';
import { activity, pakistanTime, pkr, quantityItems } from '../../api/purchases';
import { Empty, Field, Notice, PageTitle, Pagination } from '../../components/Common';
import SupplierAction from '../../components/SupplierAction';
import SupplierReturn from '../../components/SupplierReturn';

function Receiving({po,prepare,locked}){
  const [values,setValues]=useState({}),[error,setError]=useState('');
  function submit(e){e.preventDefault();if(locked)return;try{const items=quantityItems(po.items,values,r=>r.quantity-r.receivedQuantity);setError('');const fields=new FormData(e.currentTarget),reference=fields.get('reference');prepare({path:'/purchases/'+po._id+'/receipts',title:'Confirm delivered stock',summary:(reference||'Automatic delivery reference')+'\n'+items.map(r=>po.items.find(i=>i.productId===r.productId).name+': '+r.quantity+' delivered').join('\n')+'\nConfirm these goods have physically arrived. Stock changes only after recording succeeds.',body:{requestKey:crypto.randomUUID(),reference,...(fields.get('notes')?{notes:fields.get('notes')}:{}),...(fields.get('supplierDocumentNo')?{supplierDocumentNo:fields.get('supplierDocumentNo')}:{}),expectedRevision:po.revision,items}});}catch(e){setError(e.message);}}
  return <form onSubmit={submit} className="mt-3"><fieldset disabled={locked}><h2 className="h5">Receive delivery</h2><details className="context-help"><summary>Delivery help</summary><p className="text-body-secondary">Enter only quantities delivered now. Before the first accounting delivery, confirm the supplier opening, even for a new shop.</p><p><Link to={"/owner/accounts/suppliers/"+po.supplierId}>Prepare or review supplier opening</Link> - for a new supplier with no earlier debt, confirm the zero opening, then return here to receive this order.</p><Notice error={error}/><p className="text-body-secondary">Delivery number is generated automatically if left blank.</p></details><Field label="Delivery reference (optional)"><input name="reference" className="form-control" maxLength={50} pattern="[A-Za-z0-9][A-Za-z0-9/_-]*"/></Field>
    <Field label="Delivery invoice / challan (optional)"><input name="supplierDocumentNo" className="form-control" maxLength={100}/></Field><Field label="Delivery notes (optional)"><input name="notes" className="form-control" maxLength={500}/></Field>
    {po.items.filter(r=>r.receivedQuantity<r.quantity).map(r=><Field key={r.productId} label={r.name+' — '+(r.quantity-r.receivedQuantity)+' remaining'}><input aria-label={'Delivered '+r.name} className="form-control" type="number" min="0" max={r.quantity-r.receivedQuantity} step="1" value={values[r.productId]??''} onChange={e=>setValues({...values,[r.productId]:e.target.value})}/></Field>)}<button className="btn btn-primary" type="submit">Review delivered quantities</button>
  </fieldset></form>;
}
export default function PurchaseDetails(){
  const {purchaseId}=useParams(),[page,setPage]=useState(1),[returning,setReturning]=useState(null),[cancelReason,setCancelReason]=useState('');
  const detail=useLoad('/purchases/'+purchaseId),receipts=useLoad('/purchases/'+purchaseId+'/receipts'+query({page,limit:10})),po=detail.data?.purchaseOrder;
  const refresh=()=>{detail.reload();receipts.reload();setReturning(null);};
  return <><PageTitle title={po?.reference||'Purchase order'}><Link className="btn btn-sm btn-outline-secondary" to="/owner/purchases">All purchases</Link></PageTitle><Notice loading={detail.loading} error={detail.error}/>
    {po&&<><section className="panel mb-3"><h2 className="h5">{po.supplierName}</h2><p className="record-balance">Order value: <strong>{pkr(po.totalMinor)}</strong></p><RecordFacts items={[["Date (Pakistan)",pakistanTime(po.createdAt)],["Status",activity(po.status)]]}/><Link to={'/owner/accounts/suppliers/'+po.supplierId}>Supplier Khata</Link>
      <p>{po.supplierDocumentNo&&<>Supplier document: {po.supplierDocumentNo}<br/></>}{po.notes}</p><div className="table-responsive mt-3"><table className="table table-sm record-table"><thead><tr><th>Product</th><th className="text-end">Ordered</th><th className="text-end">Received</th><th className="text-end">Remaining</th><th className="text-end">Agreed cost</th></tr></thead><tbody>{po.items.map(r=><tr key={r.productId}><td>{r.name}</td><td className="text-end record-number">{r.quantity}</td><td className="text-end record-number">{r.receivedQuantity}</td><td className="text-end record-number">{r.quantity-r.receivedQuantity}</td><td className="text-end record-number">{pkr(r.unitCostMinor)}</td></tr>)}</tbody></table></div>
      <SupplierAction onChanged={refresh}>{({prepare,locked})=><>
        {po.status==='DRAFT'&&<button className="btn btn-primary me-2" disabled={locked} onClick={()=>prepare({path:'/purchases/'+po._id+'/confirm',title:'Confirm purchase order',summary:po.reference+' — '+po.supplierName+'\nConfirmation does not receive stock or make a payment.',body:{requestKey:crypto.randomUUID(),expectedRevision:po.revision}})}>Confirm order</button>}
        {['DRAFT','CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status)&&<div className="mt-3"><Field label="Reason for cancelling remaining order"><input className="form-control" maxLength={300} value={cancelReason} disabled={locked} onChange={e=>setCancelReason(e.target.value)}/></Field><button className="btn btn-sm btn-outline-danger" disabled={locked||!cancelReason.trim()} onClick={()=>prepare({path:'/purchases/'+po._id+'/cancel',title:'Cancel remaining purchase order',summary:po.reference+'\nAlready received deliveries and stock will remain unchanged.\n'+cancelReason,body:{requestKey:crypto.randomUUID(),expectedRevision:po.revision,reason:cancelReason.trim()}})}>Cancel remaining order</button></div>}
        {['CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status)&&<Receiving key={po.revision} po={po} prepare={prepare} locked={locked}/>}
      </>}</SupplierAction>
    </section><section className="panel"><h2 className="h5">Delivery history</h2><Notice loading={receipts.loading} error={receipts.error}/>{receipts.data&&<RecordTable label="Goods delivery register" rows={receipts.data.entries} columns={[
 {key:'date',label:'Date (Pakistan)',render:r=>pakistanTime(r.occurredAt)},
 {key:'reference',label:'Delivery'}, {key:'value',label:'Goods value',numeric:true,render:r=>pkr(r.totalMinor)},
 {key:'status',label:'Accounting',render:r=>r.accountingStatus==='DEFERRED'?'Deferred — not confirmed debt':activity(r.accountingStatus)},
 {key:'return',label:'Return goods',render:r=><button className="btn btn-sm btn-outline-secondary" onClick={()=>setReturning(r)}>Return details</button>}
 ]} details={r=><><RecordFacts items={[["Received by",r.createdByName||'Unavailable'],["Supplier document",r.supplierDocumentNo||'—'],["Notes",r.notes||'—']]}/><RecordTable label={'Delivery products '+r.reference} rows={r.items} rowKey={i=>i.productId} columns={[{key:'name',label:'Product'},{key:'quantity',label:'Received (+)',numeric:true},{key:'cost',label:'Original unit cost',numeric:true,render:i=>pkr(i.unitCostMinor)}]}/></>} empty="No deliveries recorded."/>}<Pagination pagination={receipts.data?.pagination} onPage={setPage}/></section>
      {returning&&<SupplierReturn key={returning._id} receipt={returning} onClose={()=>setReturning(null)} onChanged={refresh}/>}
    </>}
  </>;
}
