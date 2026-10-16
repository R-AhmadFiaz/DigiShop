import { Link } from 'react-router-dom';
import { Empty, Notice, Pagination } from './Common';
import { activity, pakistanTime, pkr } from '../api/purchases';

export default function PurchaseTable({result,onPage}) {
  return <><Notice loading={result.loading} error={result.error}/>{result.data&&<>
    <div className="table-responsive"><table className="table table-sm align-middle"><thead><tr><th>Reference</th><th>Supplier</th><th>Date (Pakistan)</th><th>Total</th><th>Received units</th><th>Status</th><th/></tr></thead><tbody>
      {result.data.entries.map(po=><tr key={po._id}><td>{po.reference}</td><td>{po.supplierName}</td><td>{pakistanTime(po.createdAt)}</td><td>{pkr(po.totalMinor)}</td><td>{po.items.reduce((n,r)=>n+r.receivedQuantity,0)} / {po.items.reduce((n,r)=>n+r.quantity,0)}</td><td>{activity(po.status)}</td><td><Link className="btn btn-sm btn-outline-secondary" to={'/owner/purchases/'+po._id}>Open purchase</Link></td></tr>)}
    </tbody></table></div>{!result.data.entries.length&&<Empty>No purchase orders found.</Empty>}<Pagination pagination={result.data.pagination} onPage={onPage}/>
  </>}</>;
}
