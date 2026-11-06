const statuses={
  DRAFT:{label:'Pending · Draft',tone:'warning'},
  CONFIRMED:{label:'Pending · Confirmed',tone:'warning'},
  PARTIALLY_RECEIVED:{label:'Partially Received',tone:'primary'},
  RECEIVED:{label:'Received',tone:'success'},
  CANCELLED:{label:'Cancelled',tone:'danger'}
};
export default function PurchaseStatus({status}){
  const value=statuses[status];
  return <span className={'badge purchase-status '+(value?'text-bg-'+value.tone:'text-bg-secondary')}>{value?.label??status??'Unavailable'}</span>;
}
