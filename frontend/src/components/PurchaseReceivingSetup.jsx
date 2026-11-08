import {Link} from 'react-router-dom';

export default function PurchaseReceivingSetup({state, supplierId, onCheck}) {
  if (state.kind === 'ready') return null;
  if (['checking', 'stock-only'].includes(state.kind))
    return <p className="small text-body-secondary mb-2" role="status">{state.message}</p>;
  return <div className="alert alert-warning py-2 small" role="status">
    <p className="mb-1">{state.message}</p>
    <div className="d-flex flex-wrap gap-3 align-items-center">
      <Link to={'/owner/accounts/suppliers/' + supplierId}>Review supplier setup</Link>
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onCheck}>Check setup again</button>
    </div>
  </div>;
}
