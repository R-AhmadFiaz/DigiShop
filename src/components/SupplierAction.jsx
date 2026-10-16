import { useRef, useState } from 'react';
import { api } from '../api/client';
import { clearPending, journalKey, readPending, savePending, uncertain } from '../api/invoice';
import { useAuth } from '../auth/AuthContext';
import { Modal, Notice } from './Common';

// Persist only the exact proposed request, not financial API responses.
export default function SupplierAction({children,onChanged}) {
  const {user}=useAuth(),storageKey=journalKey(user,'supplier-operation');
  const [request,setRequest]=useState(()=>readPending(storageKey)),[retained,setRetained]=useState(()=>!!readPending(storageKey));
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const [needsRefresh,setNeedsRefresh]=useState(false);
  const lock=useRef(false);
  function prepare(next){if(lock.current||retained||request||needsRefresh)return;const existing=readPending(storageKey);setError('');setSuccess('');if(existing){setRequest(existing);setRetained(true);}else setRequest(next);}
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
    {request&&<Modal title={request.title} busy={busy||retained} onClose={()=>setRequest(null)}>
      <p style={{whiteSpace:'pre-line'}}>{request.summary}</p><p className="text-body-secondary">The server will validate the current quantities, balances and access before saving.</p>
      <Notice error={error}/>{retained&&!busy&&<p role="status">This request is retained for an identical retry.</p>}
      <button className="btn btn-primary" disabled={busy} onClick={confirm}>{busy?'Recording...':retained?'Retry same request':request.confirmLabel||'Confirm and record'}</button>
    </Modal>}
  </>;
}
