import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { Empty, Field, Modal, Notice, PageTitle, Pagination } from '../../components/Common';

const roles = {COMPANY:'Company',SUPPLIER:'Supplier',CUSTOMER:'Customer',MANUFACTURER:'Manufacturer',OTHER:'Other'};
function ExistingCustomer({value,onChange}) {
  const [search,setSearch]=useState(''), [page,setPage]=useState(1), term=useDebounce(search);
  const customers=useLoad('/customers/'+query({search:term,page,limit:5}));
  return <div className="mb-3"><Field label="Find existing customer"><input className="form-control" value={search} maxLength={100} placeholder="Customer name or phone" onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field><Notice error={customers.error} loading={customers.loading}/>{customers.data?.customers.map(c=><button type="button" key={c._id} className={'btn btn-sm m-1 '+(value?._id===c._id?'btn-primary':'btn-outline-secondary')} onClick={()=>onChange(c)}>{c.name} · {c.phoneNo}</button>)}{customers.data?.customers.length===0 && <Empty>No customers found.</Empty>}<Pagination pagination={customers.data?.pagination} onPage={setPage}/>{value && <p className="mt-2 mb-0">Selected: {value.name}</p>}</div>;
}
function EntityForm({onSaved,onBusy}) {
  const [key]=useState(()=>crypto.randomUUID()), [selectedRoles,setRoles]=useState(['COMPANY','SUPPLIER']), [customer,setCustomer]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const linked=selectedRoles.includes('CUSTOMER');
  async function save(event) {
    event.preventDefault(); if(busy)return;
    if(!selectedRoles.length || (linked&&!customer)){setError('Choose a role and select an existing customer when needed.');return;}
    const fields=Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);onBusy(true);setError('');
    try{const entity=await api('/accounts/entities',{method:'POST',body:{key,roles:selectedRoles,...(linked?{customerId:customer._id}:{name:fields.name.trim(),phoneNo:fields.phoneNo,address:fields.address})}});onSaved(entity);}
    catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  }
  return <form onSubmit={save}><fieldset disabled={busy}><Notice error={error}/><div className="mb-3">{Object.entries(roles).map(([role,label])=><label className="form-check form-check-inline" key={role}><input className="form-check-input" type="checkbox" checked={selectedRoles.includes(role)} onChange={e=>setRoles(e.target.checked?[...selectedRoles,role]:selectedRoles.filter(r=>r!==role))}/>{label}</label>)}</div>{linked?<><p className="text-body-secondary">Use an existing customer identity. Their debt and store credit remain unchanged.</p><ExistingCustomer value={customer} onChange={setCustomer}/></>:<><Field label="Business name"><input name="name" className="form-control" required maxLength={100}/></Field><Field label="Phone (optional)"><input name="phoneNo" className="form-control" pattern="[0-9]{11}" maxLength={11} title="11 digits"/></Field><Field label="Address"><input name="address" className="form-control" maxLength={300}/></Field></>}<button className="btn btn-primary" type="submit">{busy?'Saving...':'Save business'}</button></fieldset></form>;
}
function BrandLinks({entity,onBusy}) {
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),term=useDebounce(search),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
  const brands=useLoad('/accounts/brands'+query({q:term,page,limit:10}));
  async function link(brand) {
    if(busy)return;setBusy(true);onBusy(true);setError('');setSuccess('');
    const linked=brand.entityIds.includes(entity._id);
    try{await api('/accounts/brands/'+brand._id+'/entities',{method:'PATCH',body:{expectedEntityIds:brand.entityIds,entityIds:linked?brand.entityIds.filter(id=>id!==entity._id):[...brand.entityIds,entity._id]}});brands.reload();setSuccess(linked?'Brand unlinked.':'Brand linked.');}
    catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  }
  async function create(event) {
    event.preventDefault(); if(busy)return;
    const form=event.currentTarget, name=new FormData(form).get('brandName').trim();
    setBusy(true);onBusy(true);setError('');setSuccess('');
    try{await api('/accounts/brands',{method:'POST',body:{name,entityIds:[entity._id]}});form.reset();brands.reload();setSuccess('Brand linked.');}
    catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  }
  return <section className="mt-4"><h3 className="h6">Brand associations</h3><p className="text-body-secondary">Brands are separate from companies. Linking a brand does not make this business its supplier.</p><Field label="Find brands"><input className="form-control" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></Field><Notice loading={brands.loading} error={error || brands.error} success={success}/>{brands.data?.entries.map(b=><div className="d-flex align-items-center justify-content-between gap-2 mb-2" key={b._id}><span>{b.name}{b.entityIds.includes(entity._id)?' — Linked':''}</span><button disabled={busy} className="btn btn-outline-secondary btn-sm" onClick={()=>link(b)}>{b.entityIds.includes(entity._id)?'Unlink':'Link brand'}</button></div>)}{brands.data?.entries.length===0 && <Empty>No registered brand associations found. Existing product brand text is not automatically linked to companies.</Empty>}<Pagination pagination={brands.data?.pagination} onPage={setPage}/><form onSubmit={create} className="mt-3"><fieldset disabled={busy}><Field label="New brand name"><input className="form-control" name="brandName" maxLength={100} required/></Field><button type="submit" className="btn btn-outline-secondary btn-sm">Add brand association</button></fieldset></form></section>;
}
function EntityDetails({id,onBusy,onChanged}) {
  const entity=useLoad('/accounts/entities/'+id);
  const [customer,setCustomer]=useState(null),[linking,setLinking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function linkCustomer() {
    if(!customer || busy)return;
    if(!window.confirm('Link '+customer.name+' to '+entity.data.name+'? Existing customer balances will be retained. This customer link cannot be replaced.'))return;
    setBusy(true);onBusy(true);setError('');
    try{await api('/accounts/entities/'+id+'/customer',{method:'PATCH',body:{customerId:customer._id,expectedRevision:entity.data.revision,confirmation:'LINK EXISTING CUSTOMER'}});setLinking(false);entity.reload();onChanged();}
    catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  }
  return <><Notice loading={entity.loading} error={entity.error || error}/>{entity.data && <><h2 className="h5">{entity.data.name}</h2><p>{entity.data.roles.map(r=>roles[r] || r).join(', ')}<br/>{entity.data.phoneNo || 'No phone saved'}<br/>{entity.data.address || 'No address saved'}</p>{entity.data.roles.includes('SUPPLIER')&&<p><Link className="btn btn-outline-primary btn-sm" to={'/owner/accounts/suppliers/'+entity.data._id}>Supplier account</Link></p>}{entity.data.customerId?<p>Linked to an existing customer. View debt and store credit under Accounts → Customers.</p>:<><button className="btn btn-outline-secondary btn-sm" onClick={()=>setLinking(!linking)} disabled={busy}>{linking?'Hide customer search':'Link existing customer'}</button>{linking && <div className="mt-3"><ExistingCustomer value={customer} onChange={setCustomer}/><button className="btn btn-primary btn-sm" disabled={!customer || busy} onClick={linkCustomer}>Confirm customer link</button></div>}</>}<BrandLinks entity={entity.data} onBusy={onBusy}/></>}</>;
}
export default function Companies() {
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[creating,setCreating]=useState(false),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[success,setSuccess]=useState('');
  const term=useDebounce(search), list=useLoad('/accounts/entities'+query({q:term,page,limit:20}));
  return <><PageTitle title="Companies & Suppliers"><button className="btn btn-primary btn-sm" onClick={()=>setCreating(true)}>Add business</button></PageTitle><p className="text-body-secondary">One business can be a company, supplier and customer. Open supplier details for purchases, payments and payable history.</p><Notice success={success}/><input className="form-control search-input mb-3" aria-label="Search businesses" placeholder="Business name or phone" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/><section className="panel"><Notice loading={list.loading} error={list.error}/>{list.data && <><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Business</th><th>Roles</th><th>Phone</th><th>Address</th><th/></tr></thead><tbody>{list.data.entries.map(e=><tr key={e._id}><td>{e.name}</td><td>{e.roles.map(r=>roles[r] || r).join(', ')}</td><td>{e.phoneNo || '—'}</td><td>{e.address || '—'}</td><td><button className="btn btn-outline-secondary btn-sm" onClick={()=>setSelected(e)}>View details</button></td></tr>)}</tbody></table></div>{!list.data.entries.length && <Empty>No businesses found.</Empty>}<Pagination pagination={list.data.pagination} onPage={setPage}/></>}</section>{creating && <Modal title="Add business" busy={busy} onClose={()=>setCreating(false)}><EntityForm onBusy={setBusy} onSaved={e=>{setCreating(false);setSuccess(e.name || 'Business saved.');list.reload();}}/></Modal>}{selected && <Modal title="Business details" busy={busy} onClose={()=>setSelected(null)}><EntityDetails id={selected._id} onBusy={setBusy} onChanged={list.reload}/></Modal>}</>;
}
