import { useRef, useState } from 'react';
import { api } from '../api/client';
import { clearPending, journalKey, readPending, savePending, uncertain } from '../api/invoice';
import { useAuth } from '../auth/AuthContext';
import { Modal, Notice } from './Common';
import { pkr } from '../api/purchases';

// Persist only the exact proposed request, not financial API responses.
export default function SupplierAction({children,onChanged,operation="supplier-operation"}) {
  const {user}=useAuth(),storageKey=journalKey(user,operation);
  const [request,setRequest]=useState(()=>readPending(storageKey)),[retained,setRetained]=useState(()=>!!readPending(storageKey));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const [needsRefresh,setNeedsRefresh]=useState(false);
  const lock=useRef(false),opener=useRef(null);
  function prepare(next){if(lock.current||retained||request||needsRefresh)return;opener.current=document.activeElement;const existing=readPending(storageKey);setError('');setSuccess('');if(existing){setRequest(existing);setRetained(true);}else setRequest(next);}
  function close(){setRequest(null);requestAnimationFrame(()=>opener.current?.focus?.());}
  async function confirm(){
    if(lock.current||!request)return;lock.current=true;setBusy(true);setError('');
    try{
      const existing=readPending(storageKey);
      if(existing&&existing.body.requestKey!==request.body.requestKey){setRequest(existing);setRetained(true);setError('Resolve the retained request before recording another operation.');return;}
      savePending(storageKey,request);setRetained(true);
      await api(request.path,{method:'POST',body:request.body});
      clearPending(storageKey);setRequest(null);setRetained(false);setSuccess('Recorded successfully.');onChanged();
    }catch(e){
      // A later access/setup rejection cannot prove an earlier lost response
      // did not commit. Keep that original key until a confirmed replay resolves it.
      const unresolved=uncertain(e)||retained;
      setError(unresolved?'The result is uncertain. It may already be recorded. Retry this exact request to check safely; do not create another entry.'+(retained&&!uncertain(e)?' '+e.message:''):e.message);
      if(!unresolved){clearPending(storageKey);setRequest(null);setRetained(false);if(e.status===409)setNeedsRefresh(true);}
    }finally{lock.current=false;setBusy(false);}
  }
  return <><Notice error={!request?error:''} success={success}/>{needsRefresh&&<button className="btn btn-outline-secondary mb-3" onClick={()=>{setNeedsRefresh(false);setError('');onChanged();}}>Refresh current data</button>}{children({prepare,locked:busy||retained||!!request||needsRefresh})}
    {request&&<Modal title={request.title} busy={busy||retained} onClose={close}>
      {request.confirmationType==='purchase-order'?<>
        <p className="mb-2"><strong>Supplier:</strong> {request.supplierName}</p>
        <div className="table-responsive"><table className="table table-sm purchase-confirmation-table mb-2"><thead><tr><th>Product</th><th className="text-end">Quantity</th><th className="text-end">Unit price</th><th className="text-end">Total</th></tr></thead><tbody>{request.items.map((item,index)=><tr key={index}><td>{item.name}</td><td className="text-end">{item.quantity}</td><td className="text-end text-nowrap">{pkr(item.unitCostMinor)}</td><td className="text-end text-nowrap">{pkr(item.totalMinor)}</td></tr>)}</tbody></table></div>
        <p className="d-flex justify-content-between align-items-center border-top pt-2 mb-2"><strong>Order total</strong><strong>{pkr(request.totalMinor)}</strong></p>
        <p className="small text-body-secondary mb-3">Stock and payment will be recorded separately.</p>
      </>:<><p style={{whiteSpace:'pre-line'}}>{request.summary}</p><p className="text-body-secondary">Check these details before confirming. Quantities and balances will be checked again.</p></>}
      <Notice error={error}/>{retained&&!busy&&<p role="status">The same request is saved for a safe retry.</p>}
      {request.confirmationType==='purchase-order'&&<button type="button" className="btn btn-outline-secondary me-2" disabled={busy||retained} onClick={close}>Back</button>}
      <button type="button" data-modal-initial-focus={request.confirmationType==='purchase-order'?true:undefined} className="btn btn-primary" disabled={busy} onClick={confirm}>{busy?'Recording...':retained?'Retry same request':request.confirmationType==='purchase-order'?'Confirm order':request.confirmLabel||'Confirm and record'}</button>
    </Modal>}
  </>;
}
