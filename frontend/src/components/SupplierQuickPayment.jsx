import {useEffect,useId,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {query} from '../api/client';
import {useDebounce,useLoad} from '../api/hooks';
import {pkr} from '../api/purchases';
import {paymentRecorded,verifiedPayable} from '../api/supplierPayment';
import {Field,Modal,Notice,Pagination} from './Common';
import SupplierBalanceStatus from './SupplierBalanceStatus';
import SupplierPayment from './SupplierPayment';

function SupplierSearch({onSelect}){
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[active,setActive]=useState(-1),id=useId(),term=useDebounce(search);
  const result=useLoad('/accounts/entities'+query({role:'SUPPLIER',q:term,page,limit:8}));
  const waiting=result.loading||term!==search,entries=waiting?[]:(result.data?.entries||[]).filter(e=>e.roles?.includes('SUPPLIER'));
  const searchInput=useRef(null);
  useEffect(()=>{searchInput.current?.focus();},[]);
  function keyboard(e){
    if(e.key==='Enter'){e.preventDefault();if(active>=0&&entries[active])onSelect(entries[active]);}
    if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setActive(i=>entries.length?(i<0?(e.key==='ArrowDown'?0:entries.length-1):(i+(e.key==='ArrowDown'?1:-1)+entries.length)%entries.length):-1);}
  }
  return <><Field label="Find supplier"><input ref={searchInput} data-modal-initial-focus aria-label="Find supplier" role="combobox" aria-autocomplete="list" aria-expanded={entries.length>0} aria-controls={id} aria-activedescendant={active>=0&&entries[active]?id+'-'+active:undefined} autoComplete="off" className="form-control" maxLength={100} placeholder="Name, phone or supplier code" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);setActive(-1);}} onKeyDown={keyboard}/></Field>
    <Notice loading={waiting} error={result.error}/>{result.error&&<button type="button" className="btn btn-outline-secondary btn-sm" onClick={result.reload}>Retry supplier search</button>}
    <div id={id} role="listbox" aria-label="Matching suppliers">{entries.map((s,i)=><div role="option" id={id+'-'+i} aria-selected={active===i} key={s._id}><button type="button" className={'btn w-100 text-start mb-1 '+(active===i?'btn-primary':'btn-outline-secondary')} onClick={()=>onSelect(s)}><strong>{s.name}</strong>{s.phoneNo&&<small className="ms-2">{s.phoneNo}</small>}<small className="d-block">{s.key}</small></button></div>)}</div>
    {!waiting&&!result.error&&!entries.length&&<p role="status">No matching suppliers. Try another name, phone or code.</p>}
    {!waiting&&<Pagination pagination={result.data?.pagination} onPage={p=>{setPage(p);setActive(-1);}}/>}
  </>;
}
function SelectedSupplier({supplier,onClose,onLockedChange}){
  const result=useLoad('/accounts/suppliers/'+supplier._id+'/reconciliation'),[success,setSuccess]=useState(false),status=useRef(null),heading=useRef(null);
  useEffect(()=>{heading.current?.focus();},[]);
  const ready=verifiedPayable(result.data);
  function changed(){
    setSuccess(true);
    window.dispatchEvent(new CustomEvent(paymentRecorded,{detail:{supplierId:supplier._id}}));
    requestAnimationFrame(()=>status.current?.focus());
  }
  return <><h3 ref={heading} tabIndex={-1} className="h6">{supplier.name}</h3>
    {success&&<p ref={status} tabIndex={-1} role="status" className="alert alert-success py-2">Supplier payment recorded.</p>}
    <SupplierBalanceStatus result={result.data} loading={result.loading} error={result.error}/>
    {!ready&&!result.loading&&<div className="d-flex gap-2 mb-2"><button type="button" className="btn btn-outline-secondary btn-sm" onClick={result.reload}>Check balance again</button><Link className="btn btn-outline-primary btn-sm" to={'/owner/accounts/suppliers/'+supplier._id+'#supplier-opening'} onClick={onClose}>Open supplier setup</Link></div>}
    {ready&&<><dl className="balance-strip mb-3"><div><dt>Outstanding</dt><dd>{pkr(result.data.balanceMinor)}</dd></div>{result.data.creditMinor>0&&<div><dt>Supplier credit</dt><dd>{pkr(result.data.creditMinor)}</dd></div>}</dl>{result.data.balanceMinor===0&&<p role="status">Nothing is currently owed. Supplier credit is handled separately in Supplier Khata.</p>}</>}
    <SupplierPayment supplierId={supplier._id} supplierName={supplier.name} balance={ready?result.data.balanceMinor:null} onChanged={changed} onRefresh={result.reload} inline onLockedChange={onLockedChange}/>
  </>;
}
export default function SupplierQuickPayment({onClose,onNavigate=onClose}){
  const [supplier,setSupplier]=useState(null),[locked,setLocked]=useState(false),lock=useRef(false);
  function updateLock(value){lock.current=value;setLocked(value);}
  function close(){if(!lock.current)onClose();}
  return <Modal title="Pay supplier" trapFocus busy={locked} onClose={close}>
    {supplier?<><button type="button" className="btn btn-outline-secondary btn-sm mb-3" disabled={locked} onClick={()=>setSupplier(null)}>Choose another supplier</button><SelectedSupplier key={supplier._id} supplier={supplier} onClose={onNavigate} onLockedChange={updateLock}/></>:<SupplierSearch onSelect={setSupplier}/>}
  </Modal>;
}
