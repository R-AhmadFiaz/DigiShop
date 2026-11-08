export default function SupplierBalanceStatus({result,loading,error}){
  if(loading)return <p role="status">Checking supplier balance...</p>;
  if(error||!result)return <p role="alert" className="alert alert-warning">Supplier balance could not be checked. Try refreshing before recording a delivery or payment.</p>;
  if(result.authoritative===true&&result.cutover&&result.issues?.length===0&&Number.isSafeInteger(result.balanceMinor))return null;
  return <div role="alert" className="alert alert-warning supplier-balance-setup"><strong>{result.cutover===null?'Confirm previous supplier balance':'Review supplier records'}</strong><p className="mb-0">{result.cutover===null?'Before recording deliveries or payments, the owner must confirm what was already owed using the form below. Choose a new supplier only if there was no previous debt or delivery history. If the balance is unknown, check the supplier records first.':'The recorded balance does not reconcile with the supplier records. Ask the owner to review the linked deliveries, payments and accounting records before continuing. Do not enter another starting balance or reset the debt.'}</p></div>;
}
