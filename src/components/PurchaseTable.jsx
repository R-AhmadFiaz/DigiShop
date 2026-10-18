import { Link } from 'react-router-dom';
import { Empty, Notice, Pagination } from './Common';
import { pakistanTime, pkr } from '../api/purchases';
import PurchaseStatus from './PurchaseStatus';
import RecordTable, {RecordFacts} from './RecordTable';
import {receivedQuantity,usePurchaseRecords} from '../api/purchaseRecords';

export default function PurchaseTable({result,onPage,history=false}) {
  const records=usePurchaseRecords(result.data?.entries,history);
  return <><Notice loading={result.loading} error={result.error}/>{result.data&&<>
    <RecordTable label="Purchase order register" rows={result.data.entries} columns={[
      ...(history?[{key:'reference',label:'Purchase reference'}]:[]),
      {key:'date',label:'Date (Pakistan)',render:po=>pakistanTime(po.createdAt)},
      ...(!history?[{key:'reference',label:'Reference'}]:[]),{key:'supplierName',label:'Supplier'},
      {key:'total',label:'Order value',numeric:true,render:po=>pkr(po.totalMinor)},
      {key:'received',label:history?'Quantity received':'Received units',numeric:true,render:po=>history?receivedQuantity(po)??'Unavailable':po.items.reduce((n,r)=>n+r.receivedQuantity,0)+' / '+po.items.reduce((n,r)=>n+r.quantity,0)},
      ...(history?[{key:'returned',label:'Quantity returned',numeric:true,render:po=>records[po._id]?.summary?.returned??(records[po._id]?'Unavailable':'Loading…')}]:[]),
      {key:'status',label:'Status',render:po=><PurchaseStatus status={po.status}/>},
      {key:'open',label:history?'View':'Purchase',render:po=><Link className="btn btn-sm btn-outline-secondary" to={'/owner/purchases/'+po._id}>{history?'View':'Open purchase'}</Link>}
    ]} details={history?undefined:po=><RecordFacts items={[["Supplier document",po.supplierDocumentNo||'—'],["Notes",po.notes||'—']]}/>} empty="No purchase orders found."/>
    {history&&Object.values(records).some(r=>r.error)&&<p className="small text-body-secondary mt-2 mb-0">Some return totals are unavailable. Open the purchase to review its history.</p>}
    <Pagination pagination={result.data.pagination} onPage={onPage}/>
  </>}</>;
}
