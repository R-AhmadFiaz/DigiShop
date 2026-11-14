import {Link,useSearchParams} from 'react-router-dom';
import {useLoad} from '../../api/hooks';
import {Notice,PageTitle} from '../../components/Common';
import {SupplierSearch} from '../../components/SupplierQuickPayment';
import SupplierBalanceStatus from '../../components/SupplierBalanceStatus';
import TransactionHistory from '../../components/TransactionHistory';

function TransactionsPage({supplierId,onSelect,onClear}){
  const validId=/^[a-f\d]{24}$/i.test(supplierId||'');
  const entity=useLoad('/accounts/entities/'+supplierId,validId);
  const supplier=entity.data?.roles?.includes('SUPPLIER')?entity.data:null;
  const balance=useLoad('/accounts/suppliers/'+supplierId+'/reconciliation',validId&&!!supplier);
  const verified=!!(supplier&&balance.data?.authoritative===true&&balance.data.cutover&&balance.data.issues?.length===0&&Number.isSafeInteger(balance.data.balanceMinor));
  const ready=verified&&!!balance.data.accountId;
  return <><PageTitle title="Supplier Transactions">
    {supplier&&<Link className="btn btn-outline-secondary btn-sm" to={'/owner/accounts/suppliers/'+supplier._id}>Supplier Khata</Link>}
  </PageTitle>
    <section className="panel" aria-label="Selected supplier">
      {!supplierId?<SupplierSearch onSelect={onSelect}/>:<>
        <button type="button" className="btn btn-outline-secondary btn-sm mb-3" onClick={onClear}>Choose another supplier</button>
        <Notice loading={validId&&entity.loading} error={!validId?'Choose a valid supplier.':entity.error}/>
        {entity.error&&<button type="button" className="btn btn-outline-secondary btn-sm" onClick={entity.reload}>Retry supplier</button>}
        {validId&&!entity.loading&&entity.data&&!supplier&&<p role="alert">This business is not a supplier. Choose another supplier.</p>}
        {supplier&&<><h2 className="h6">{supplier.name}</h2>
          <SupplierBalanceStatus result={balance.data} loading={balance.loading||(!balance.data&&!balance.error)} error={balance.error}/>
          {verified&&!ready&&<p role="alert">The supplier transaction account is unavailable. Review supplier setup before opening its history.</p>}
          {!ready&&!balance.loading&&<div className="d-flex gap-2"><button type="button" className="btn btn-outline-secondary btn-sm" onClick={balance.reload}>Check supplier again</button><Link to={'/owner/accounts/suppliers/'+supplierId}>Open supplier setup</Link></div>}
        </>}
      </>}
    </section>
    {ready&&<TransactionHistory key={balance.data.accountId} accountId={balance.data.accountId} name={supplier.name} supplier/>}
  </>;
}
export default function SupplierTransactionsPage(){
  const [params,setParams]=useSearchParams(),supplierId=params.get('supplierId')||'';
  return <TransactionsPage key={supplierId||'supplier-search'} supplierId={supplierId} onSelect={supplier=>setParams({supplierId:supplier._id})} onClear={()=>setParams({})}/>;
}
