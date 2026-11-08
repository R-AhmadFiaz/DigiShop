import RecordTable, {RecordFacts} from "../../components/RecordTable";
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLoad } from '../../api/hooks';
import {purchaseActivity,receivedQuantity,usePurchaseRecords} from '../../api/purchaseRecords';
import { activity, pakistanTime, pkr, quantityItems } from '../../api/purchases';
import { Field, Notice, PageTitle, Pagination } from '../../components/Common';
import SupplierAction from '../../components/SupplierAction';
import SupplierReturn from '../../components/SupplierReturn';
import PurchaseStatus from '../../components/PurchaseStatus';
import PurchaseReceivingSetup from '../../components/PurchaseReceivingSetup';
import {receivingSetup,receivingError} from '../../api/purchaseReceiving';
import { usePageParam } from '../../api/paging';

function Receiving({po,prepare,locked}){
  const availability=useLoad('/orders/payment-accounts');
  const reconciliation=useLoad('/accounts/suppliers/'+po.supplierId+'/reconciliation',availability.data?.accountingEnabled===true);
  const setup=receivingSetup(availability,reconciliation);
  const [values,setValues]=useState({}),[error,setError]=useState('');
  function submit(e){e.preventDefault();if(locked||setup.blocked)return;try{const items=quantityItems(po.items,values,r=>r.quantity-r.receivedQuantity);setError('');const fields=new FormData(e.currentTarget);prepare({path:'/purchases/'+po._id+'/receipts',title:'Confirm delivered stock',summary:'Automatic delivery reference'+'\n'+items.map(r=>po.items.find(i=>i.productId===r.productId).name+': '+r.quantity+' delivered').join('\n')+'\nConfirm these goods have physically arrived. Stock changes only after recording succeeds.',body:{requestKey:crypto.randomUUID(),...(fields.get('notes')?{notes:fields.get('notes')}:{}),...(fields.get('supplierDocumentNo')?{supplierDocumentNo:fields.get('supplierDocumentNo')}:{}),expectedRevision:po.revision,items}});}catch(e){setError(e.message);}}
  return <form onSubmit={submit} className="mt-3"><PurchaseReceivingSetup state={setup} supplierId={po.supplierId} onCheck={()=>{availability.reload();reconciliation.reload();}}/><fieldset disabled={locked||setup.blocked}><h2 className="h5">Receive delivery</h2><details className="context-help"><summary>Delivery help</summary><p className="text-body-secondary">Enter only quantities physically delivered now. Recording goods never pays the supplier. When financial posting is active, the supplier starting balance must be confirmed and reconciled first.</p><p><Link to={"/owner/accounts/suppliers/"+po.supplierId}>Confirm previous supplier balance</Link> - only confirm a zero opening after verifying there is no previous debt or delivery history. Otherwise review unpaid deliveries and external payments. Return here and check setup again.</p></details><Notice error={error}/>
    <Field label="Delivery invoice / challan (Optional)"><input name="supplierDocumentNo" className="form-control" maxLength={100}/></Field><Field label="Delivery notes (Optional)"><input name="notes" className="form-control" maxLength={500}/></Field>
    {po.items.filter(r=>r.receivedQuantity<r.quantity).map(r=><Field key={r.productId} label={r.name+' — '+(r.quantity-r.receivedQuantity)+' remaining'}><input aria-label={'Delivered '+r.name} className="form-control" type="number" min="0" max={r.quantity-r.receivedQuantity} step="1" value={values[r.productId]??''} onChange={e=>setValues({...values,[r.productId]:e.target.value})}/></Field>)}<button className="btn btn-primary" type="submit">Review delivered quantities</button>
  </fieldset></form>;
}
export default function PurchaseDetails(){
  const {purchaseId}=useParams(),[page,setPage]=usePageParam('activityPage'),[returning,setReturning]=useState(null),[cancelReason,setCancelReason]=useState(''),[setupVersion,setSetupVersion]=useState(0);
  const detail=useLoad('/purchases/'+purchaseId),po=detail.data?.purchaseOrder;
  const purchases=useMemo(()=>po?[po]:[],[po]);
  const records=usePurchaseRecords(purchases),record=po?records[po._id]:null,summary=record?.summary;
  const activities=useMemo(()=>purchaseActivity(record?.receipts,record?.events),[record]);
  const pagination={currentPage:page,totalPages:Math.ceil(activities.length/20)};
  const refresh=()=>{detail.reload();setReturning(null);setPage(1);setSetupVersion(v=>v+1);};
  const back=line=>summary?.items.find(r=>String(r.productId)===String(line.productId));
  const unknown=record?'Unavailable':'Loading…';
  return <><PageTitle title={po?po.reference+' · '+po.supplierName:'Purchase details'}>
    <Link className="btn btn-sm btn-outline-secondary" to="/owner/purchases">All purchases</Link>
    {po&&<Link className="btn btn-sm btn-outline-secondary" to={'/owner/accounts/suppliers/'+po.supplierId}>Supplier Khata</Link>}
    <button className="btn btn-sm btn-outline-secondary" onClick={refresh}>Refresh</button>
  </PageTitle><Notice loading={detail.loading} error={detail.error}/>
    {po&&<>
      <div className="d-flex flex-wrap align-items-center gap-2 mb-2"><span className="small text-body-secondary">{pakistanTime(po.createdAt)}</span><PurchaseStatus status={po.status}/></div>
      <dl className="balance-strip">
        <div><dt>Order value</dt><dd>{pkr(po.totalMinor)}</dd></div>
        <div><dt>Total received</dt><dd>{receivedQuantity(po)??'Unavailable'}</dd></div>
        <div><dt>Total returned</dt><dd>{summary?.returned??unknown}</dd></div>
        <div><dt>Net quantity kept</dt><dd>{summary?.kept??unknown}</dd></div>
      </dl>
      <p className="small text-body-secondary">Kept uses recorded deliveries minus returns, not current stock. Order value is not supplier debt.</p>
      {record?.error&&<p className="alert alert-warning" role="alert">{record.error}</p>}
      <section className="panel mb-3"><h2 className="h5">Products</h2>
        <RecordTable label="Purchase products" rows={po.items} rowKey={r=>r.productId} columns={[
          {key:'name',label:'Product'},{key:'quantity',label:'Ordered',numeric:true},
          {key:'receivedQuantity',label:'Received',numeric:true},
          {key:'returned',label:'Returned',numeric:true,render:r=>back(r)?.returnedQuantity??unknown},
          {key:'kept',label:'Kept',numeric:true,render:r=>back(r)?.keptQuantity??unknown}
        ]} details={r=><RecordFacts items={[["Brand",r.brand||'Not recorded'],["Unit",r.unit||'Not recorded'],["Agreed unit cost",pkr(r.unitCostMinor)],["Ordered goods value",pkr(r.totalMinor)],["Not yet delivered",r.quantity-r.receivedQuantity]]}/>}/>
        {(po.notes||po.supplierDocumentNo)&&<details className="context-help mt-2"><summary>Purchase notes and supplier document</summary><RecordFacts items={[["Supplier invoice / challan",po.supplierDocumentNo||'Not recorded'],["Notes",po.notes||'Not recorded']]}/></details>}
      </section>
      <SupplierAction onChanged={refresh} formatError={receivingError}>{({prepare,locked})=><>
        {po.status==='DRAFT'&&<button className="btn btn-primary mb-3" disabled={locked} onClick={()=>prepare({path:'/purchases/'+po._id+'/confirm',title:'Confirm purchase order',summary:po.reference+' — '+po.supplierName+'\nConfirmation does not receive stock or make a payment.',body:{requestKey:crypto.randomUUID(),expectedRevision:po.revision}})}>Confirm order</button>}
        {['CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status)&&<details className="action-disclosure"><summary>Receive delivery — remaining goods</summary><Receiving key={po.revision+'-'+setupVersion} po={po} prepare={prepare} locked={locked}/></details>}
        {['DRAFT','CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status)&&<details className="context-help"><summary>Cancel remaining order</summary><Field label="Reason for cancelling remaining order"><input className="form-control" maxLength={300} value={cancelReason} disabled={locked} onChange={e=>setCancelReason(e.target.value)}/></Field><button className="btn btn-sm btn-outline-danger mb-2" disabled={locked||!cancelReason.trim()} onClick={()=>prepare({path:'/purchases/'+po._id+'/cancel',title:'Cancel remaining purchase order',summary:po.reference+'\nAlready received deliveries and stock will remain unchanged.\n'+cancelReason,body:{requestKey:crypto.randomUUID(),expectedRevision:po.revision,reason:cancelReason.trim()}})}>Cancel remaining order</button></details>}
      </>}</SupplierAction>
      <section className="panel" id="purchase-activity"><h2 className="h5">Purchase activity</h2>
        <Notice loading={!record}/>
        <RecordTable label="Purchase activity register" rows={activities.slice((page-1)*20,page*20)} columns={[
          {key:'date',label:'Date (Pakistan)',render:r=>pakistanTime(r.occurredAt)},
          {key:'action',label:'Action',render:r=>r.activityKind==='RECEIPT'?'Goods received':r.activityKind==='RETURN'?'Goods returned':'Return corrected'},
          {key:'reference',label:'Reference'},
          {key:'quantity',label:'Quantity',numeric:true,render:r=>(r.activityKind==='RETURN'?'−':'+')+r.items.reduce((n,i)=>n+i.quantity,0)},
          {key:'value',label:'Goods value',numeric:true,render:r=>pkr(r.activityKind==='RECEIPT'?r.totalMinor:r.amountMinor)},
          {key:'return',label:'Actions',render:r=>r.activityKind==='RECEIPT'?<button className="btn btn-sm btn-outline-secondary" onClick={()=>setReturning(r.receipt)}>Return goods</button>:'—'}
        ]} details={r=><>
          <RecordFacts items={[["Delivery",r.receipt?.reference||'Unavailable'],["Recorded by",r.createdByName||'Unavailable'],["Supplier document",r.supplierDocumentNo||'Not recorded'],["Notes / reason",r.notes||r.reason||'Not recorded'],["Correction of",r.reversalOf?record.events.find(e=>String(e._id)===String(r.reversalOf))?.reference||r.reversalOf:'—'],["Accounting",r.accountingStatus==='DEFERRED'?'Deferred — not confirmed supplier debt':r.accountingStatus?activity(r.accountingStatus):'See Supplier Khata']]}/>
          <RecordTable label={'Activity products '+r.reference} rows={r.items} rowKey={i=>i.productId} columns={[{key:'name',label:'Product'},{key:'quantity',label:'Quantity',numeric:true},{key:'cost',label:'Original unit cost',numeric:true,render:i=>pkr(i.unitCostMinor)}]}/>
        </>} empty={record?.error?'Complete activity unavailable.':'No deliveries or returns recorded.'}/>
        <Pagination label="Purchase activity" pagination={pagination} rows={activities.slice((page-1)*20,page*20).length} onPage={setPage}/>
      </section>
      {returning&&<SupplierReturn key={returning._id} receipt={returning} onClose={()=>setReturning(null)} onChanged={refresh}/>}
    </>}
  </>;
}
