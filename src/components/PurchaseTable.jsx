import { Link } from 'react-router-dom';
import { Empty, Notice, Pagination } from './Common';
import { activity, pakistanTime, pkr } from '../api/purchases';
import RecordTable, {RecordFacts} from './RecordTable';

export default function PurchaseTable({result,onPage}) {
  return <><Notice loading={result.loading} error={result.error}/>{result.data&&<>
    <RecordTable label="Purchase order register" rows={result.data.entries} columns={[
      {key:'date',label:'Date (Pakistan)',render:po=>pakistanTime(po.createdAt)},
      {key:'reference',label:'Reference'},{key:'supplierName',label:'Supplier'},
      {key:'total',label:'Order value',numeric:true,render:po=>pkr(po.totalMinor)},
      {key:'received',label:'Received units',numeric:true,render:po=>po.items.reduce((n,r)=>n+r.receivedQuantity,0)+' / '+po.items.reduce((n,r)=>n+r.quantity,0)},
      {key:'status',label:'Status',render:po=>activity(po.status)},
      {key:'open',label:'Purchase',render:po=><Link className="btn btn-sm btn-outline-secondary" to={'/owner/purchases/'+po._id}>Open purchase</Link>}
    ]} details={po=><RecordFacts items={[["Supplier document",po.supplierDocumentNo||'—'],["Notes",po.notes||'—']]}/>} empty="No purchase orders found."/>
    <Pagination pagination={result.data.pagination} onPage={onPage}/>
  </>}</>;
}
