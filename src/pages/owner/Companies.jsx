import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import { Empty, Field, Modal, Notice, PageTitle, Pagination } from '../../components/Common';
import {literalSearch} from '../../api/sale';

const roles = {COMPANY:'Company',SUPPLIER:'Supplier',CUSTOMER:'Customer',MANUFACTURER:'Manufacturer',OTHER:'Other',PARTNER:'Business partner'};
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
function RoleEditor({entity,onBusy,onChanged}){
  const [selected,setSelected]=useState(entity.roles),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(e){e.preventDefault();if(busy)return;setBusy(true);onBusy(true);setError('');try{await api('/accounts/entities/'+entity._id+'/roles',{method:'PATCH',body:{roles:selected,expectedRevision:entity.revision}});onChanged();}catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}}
  return <form onSubmit={save} className="border rounded p-3 mb-3"><h3 className="h6">Business roles</h3><p className="small text-body-secondary">Company identifies the business. Supplier means you buy goods from it. A brand is a product label, not a business role. One identity can have several roles.</p><Notice error={error}/><fieldset disabled={busy}>{Object.entries(roles).map(([value,label])=><label key={value} className="form-check form-check-inline"><input className="form-check-input" type="checkbox" aria-label={'Role '+label} checked={selected.includes(value)} disabled={value==='CUSTOMER'} onChange={e=>setSelected(e.target.checked?[...selected,value]:selected.filter(r=>r!==value))}/>{label}</label>)}<p className="small text-body-secondary">Customer role follows the existing customer link. Roles with financial history cannot be removed.</p><button className="btn btn-outline-primary btn-sm" disabled={!selected.length}>Save roles</button></fieldset></form>;
}
function ProductBrandChoice({product,entityId,onSaved}){
  const current=useLoad('/accounts/products/'+product._id+'/brand'),brands=useLoad('/accounts/brands'+query({q:product.brand,limit:100}));
  const [brandId,setBrandId]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function save(){if(busy||!brandId)return;if(!window.confirm('Link '+product.name+' to this registered brand? This does not change stock, prices, historical sales or purchase supplier.'))return;setBusy(true);setError('');try{await api('/accounts/products/'+product._id+'/brand',{method:'PUT',body:{brandId}});current.reload();onSaved();}catch(e){setError(e.message);}finally{setBusy(false);}}
  const choices=brands.data?.entries.filter(b=>b.entityIds.includes(entityId)&&b.nameKey===product.brand.trim().toLowerCase())??[];
  return <div className="border rounded p-3 my-2"><strong>{product.name}</strong><p>Product brand text: {product.brand}. Registered brand: {current.data?.brand?.name||'No current explicit link'}</p><Notice loading={current.loading||brands.loading} error={error||current.error||brands.error}/><Field label="Registered brand"><select className="form-select" value={brandId} onChange={e=>setBrandId(e.target.value)} disabled={busy}><option value="">Choose matching company-associated brand</option>{choices.map(b=><option key={b._id} value={b._id}>{b.name}</option>)}</select></Field>{!brands.loading&&!choices.length&&<p className="text-body-secondary">Associate the exact registered brand above first. Free-text product brands are never linked automatically.</p>}<button className="btn btn-outline-primary btn-sm" disabled={busy||!brandId||current.loading||!!current.error} onClick={save}>Confirm product brand link</button></div>;
}
function CompanyProducts({entityId}){
  const [page,setPage]=useState(1),[search,setSearch]=useState(''),[selected,setSelected]=useState(null);
  const result=useLoad('/accounts/entities/'+entityId+'/products'+query({page,limit:10})),products=useLoad('/products/search-product'+query({search:literalSearch(useDebounce(search))}));
  return <section className="mt-4"><h3 className="h6">Associated products & stock</h3><p className="text-body-secondary">Only explicitly linked registered brands are included. Brand ownership does not identify the supplier who sold you the goods.</p><Notice loading={result.loading} error={result.error}/>{result.data&&<><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Product</th><th>Brand</th><th>Current stock</th></tr></thead><tbody>{result.data.entries.map(p=><tr key={p._id}><td>{p.name}</td><td>{p.brand}</td><td>{p.stockQuantity} {p.unit}</td></tr>)}</tbody></table></div>{!result.data.entries.length&&<Empty>No explicitly linked products.</Empty>}<Pagination pagination={result.data.pagination} onPage={setPage}/><p className="small text-body-secondary">Sales summary unavailable: {result.data.sales.message}</p></>}<button className="btn btn-outline-secondary btn-sm mb-3" onClick={result.reload}>Refresh linked products</button><Field label="Find product to link"><input className="form-control" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setSelected(null);}}/></Field><Notice loading={products.loading} error={products.error}/>{search&&products.data?.product?.slice(0,10).map(p=><button key={p._id} className="btn btn-outline-secondary btn-sm m-1" onClick={()=>setSelected(p)}>{p.name}</button>)}{selected&&<ProductBrandChoice key={selected._id} product={selected} entityId={entityId} onSaved={result.reload}/>}</section>;
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
  return <><Notice loading={entity.loading} error={entity.error || error}/>{entity.data && <><h2 className="h5">{entity.data.name}</h2><p>{entity.data.roles.map(r=>roles[r] || r).join(', ')}<br/>{entity.data.phoneNo || 'No phone saved'}<br/>{entity.data.address || 'No address saved'}</p>{entity.data.roles.includes('SUPPLIER')&&<p><Link className="btn btn-outline-primary btn-sm" to={'/owner/accounts/suppliers/'+entity.data._id}>Purchases, payments & supplier history</Link></p>}{entity.data.customerId?<p>Linked to an existing customer. View debt and store credit under Accounts → Customers.</p>:<><button className="btn btn-outline-secondary btn-sm" onClick={()=>setLinking(!linking)} disabled={busy}>{linking?'Hide customer search':'Link existing customer'}</button>{linking && <div className="mt-3"><ExistingCustomer value={customer} onChange={setCustomer}/><button className="btn btn-primary btn-sm" disabled={!customer || busy} onClick={linkCustomer}>Confirm customer link</button></div>}</>}<RoleEditor key={entity.data.revision} entity={entity.data} onBusy={onBusy} onChanged={()=>{entity.reload();onChanged();}}/><BrandLinks entity={entity.data} onBusy={onBusy}/><CompanyProducts entityId={id}/></>}</>;
}
export default function Companies() {
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[creating,setCreating]=useState(false),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[success,setSuccess]=useState('');
  const term=useDebounce(search), list=useLoad('/accounts/entities'+query({q:term,page,limit:20}));
  return <><PageTitle title="Companies & Suppliers"><button className="btn btn-primary btn-sm" onClick={()=>setCreating(true)}>Add business</button></PageTitle><p className="text-body-secondary">Keep one identity per business. Use Business setup for roles, customer links and brands; use Supplier history for purchases, payments and balances.</p><Notice success={success}/><input className="form-control search-input mb-3" aria-label="Search businesses" placeholder="Business name or phone" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/><section className="panel"><Notice loading={list.loading} error={list.error}/>{list.data && <><div className="table-responsive"><table className="table table-sm"><thead><tr><th>Business</th><th>Roles</th><th>Phone</th><th>Address</th><th/></tr></thead><tbody>{list.data.entries.map(e=><tr key={e._id}><td>{e.name}</td><td>{e.roles.map(r=>roles[r] || r).join(', ')}</td><td>{e.phoneNo || '—'}</td><td>{e.address || '—'}</td><td><button className="btn btn-outline-secondary btn-sm" onClick={()=>setSelected(e)}>Business setup</button>{e.roles.includes('SUPPLIER')&&<Link className="btn btn-outline-primary btn-sm ms-2" to={'/owner/accounts/suppliers/'+e._id}>Supplier history</Link>}</td></tr>)}</tbody></table></div>{!list.data.entries.length && <Empty>No businesses found.</Empty>}<Pagination pagination={list.data.pagination} onPage={setPage}/></>}</section>{creating && <Modal title="Add business" busy={busy} onClose={()=>setCreating(false)}><EntityForm onBusy={setBusy} onSaved={e=>{setCreating(false);setSuccess(e.name || 'Business saved.');list.reload();}}/></Modal>}{selected && <Modal title="Business information & setup" busy={busy} onClose={()=>setSelected(null)}><EntityDetails id={selected._id} onBusy={setBusy} onChanged={list.reload}/></Modal>}</>;
}
