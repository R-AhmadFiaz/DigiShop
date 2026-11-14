import {useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useLoad} from '../../api/hooks';
import {Notice,PageTitle} from '../../components/Common';
import {SupplierSearch,SelectedSupplier} from '../../components/SupplierQuickPayment';

function PaymentPage({supplierId,onSelect,onClear}){
  const [locked,setLocked]=useState(false);
  const validId=/^[a-f\d]{24}$/i.test(supplierId||'');
  const entity=useLoad('/accounts/entities/'+supplierId,validId);
  // Keep the selected identity mounted during payment-triggered refreshes.
  // Balances still come from SelectedSupplier's fresh reconciliation request.
  const [selectedIdentity,setSelectedIdentity]=useState(null);
  useEffect(()=>{if(entity.data)setSelectedIdentity(entity.data);},[entity.data]);
  const identity=entity.data||selectedIdentity;
  const supplier=identity?.roles?.includes('SUPPLIER')?identity:null;
  return <><PageTitle title="Pay Supplier">
    {supplier&&<Link className="btn btn-outline-secondary btn-sm" to={'/owner/accounts/suppliers/'+supplier._id}>Supplier Khata</Link>}
  </PageTitle>
    <section className="panel" aria-label="Supplier payment">
      {!supplierId?<SupplierSearch onSelect={onSelect}/>:<>
        <button type="button" className="btn btn-outline-secondary btn-sm mb-3" disabled={locked} onClick={onClear}>Choose another supplier</button>
        <Notice loading={validId&&entity.loading} error={!validId?'Choose a valid supplier.':entity.error}/>
        {entity.error&&<button type="button" className="btn btn-outline-secondary btn-sm mb-3" onClick={entity.reload}>Retry supplier</button>}
        {validId&&!entity.loading&&entity.data&&!supplier&&<p role="alert">This business is not a supplier. Choose another supplier.</p>}
        {supplier&&<SelectedSupplier key={supplier._id} supplier={supplier} onLockedChange={setLocked}/>}
      </>}
    </section>
  </>;
}
export default function SupplierPaymentPage(){
  const [params,setParams]=useSearchParams(),supplierId=params.get('supplierId')||'';
  return <PaymentPage key={supplierId||'supplier-search'} supplierId={supplierId} onSelect={supplier=>setParams({supplierId:supplier._id})} onClear={()=>setParams({})}/>;
}
