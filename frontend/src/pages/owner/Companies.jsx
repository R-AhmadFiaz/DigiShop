import RecordTable from '../../components/RecordTable';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageParam, useQueryParam } from '../../api/paging';
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
export function EntityForm({onSaved,onBusy,supplier=false}) {
  const [key]=useState(()=>crypto.randomUUID()), [selectedRoles,setRoles]=useState(supplier?['SUPPLIER']:['COMPANY','SUPPLIER']), [customer,setCustomer]=useState(null), [busy,setBusy]=useState(false), [error,setError]=useState('');
  const linked=selectedRoles.includes('CUSTOMER');
  async function save(event) {
    event.preventDefault(); if(busy)return;
    if(!selectedRoles.length || (linked&&!customer)){setError('Choose a role and select an existing customer when needed.');return;}
    const fields=Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);onBusy(true);setError('');
    try{const entity=await api('/accounts/entities',{method:'POST',body:{key,roles:selectedRoles,...(linked?{customerId:customer._id}:{name:fields.name.trim(),phoneNo:fields.phoneNo,address:fields.address})}});onSaved(entity);}
    catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  }
  return <form onSubmit={save}><fieldset disabled={busy}><Notice error={error}/>{!supplier&&<div className="mb-3">{Object.entries(roles).map(([role,label])=><label className="form-check form-check-inline" key={role}><input className="form-check-input" type="checkbox" checked={selectedRoles.includes(role)} onChange={e=>setRoles(e.target.checked?[...selectedRoles,role]:selectedRoles.filter(r=>r!==role))}/>{label}</label>)}</div>}{linked?<><p className="text-body-secondary">Select the existing customer so their debt and store credit stay together.</p><ExistingCustomer value={customer} onChange={setCustomer}/></>:<><Field label={supplier?'Supplier name':'Business name'}><input name="name" className="form-control" required maxLength={100}/></Field><Field label="Phone (Optional)"><input name="phoneNo" className="form-control" pattern="[0-9]{11}" maxLength={11} title="11 digits"/></Field><Field label="Address (Optional)"><input name="address" className="form-control" maxLength={300}/></Field></>}<span className="d-block small text-body-secondary mb-2">{supplier&&"Next: confirm any previous supplier balance. Confirm Rs 0 only if nothing was previously owed."}</span><button className="btn btn-primary" type="submit">{busy?'Saving...':supplier?'Save supplier':'Save business'}</button></fieldset></form>;
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
  return <form onSubmit={save} className="border rounded p-3 mb-3"><h3 className="h6">This business is a</h3><p className="small text-body-secondary">Company identifies the business. Supplier means you buy goods from it. A brand is a product label, not a business role. One identity can have several roles.</p><Notice error={error}/><fieldset disabled={busy}>{Object.entries(roles).map(([value,label])=><label key={value} className="form-check form-check-inline"><input className="form-check-input" type="checkbox" aria-label={'Role '+label} checked={selected.includes(value)} disabled={value==='CUSTOMER'} onChange={e=>setSelected(e.target.checked?[...selected,value]:selected.filter(r=>r!==value))}/>{label}</label>)}<p className="small text-body-secondary">Customer role follows the existing customer link. Roles with financial history cannot be removed.</p><button className="btn btn-outline-primary btn-sm" disabled={!selected.length}>Save roles</button></fieldset></form>;
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
  return <section className="mt-4"><h3 className="h6">Associated products & stock</h3><p className="text-body-secondary">Only explicitly linked registered brands are included. Brand ownership does not identify the supplier who sold you the goods.</p><Notice loading={result.loading} error={result.error}/>{result.data&&<><div className="table-responsive"><table className="table table-sm record-table"><thead><tr><th>Product</th><th>Brand</th><th className="text-end">Current stock</th></tr></thead><tbody>{result.data.entries.map(p=><tr key={p._id}><td>{p.name}</td><td>{p.brand}</td><td className="text-end record-number">{p.stockQuantity} {p.unit}</td></tr>)}</tbody></table></div>{!result.data.entries.length&&<Empty>No explicitly linked products.</Empty>}<Pagination pagination={result.data.pagination} onPage={setPage}/><p className="small text-body-secondary">Sales summary unavailable: {result.data.sales.message}</p></>}<button className="btn btn-outline-secondary btn-sm mb-3" onClick={result.reload}>Refresh linked products</button><Field label="Find product to link"><input className="form-control" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setSelected(null);}}/></Field><Notice loading={products.loading} error={products.error}/>{search&&products.data?.product?.map(p=><button key={p._id} className="btn btn-outline-secondary btn-sm m-1" onClick={()=>setSelected(p)}>{p.name}</button>)}{selected&&<ProductBrandChoice key={selected._id} product={selected} entityId={entityId} onSaved={result.reload}/>}</section>;
}
function EntityDetails({id,onBusy,onChanged}) {
  const entity=useLoad('/accounts/entities/'+id);
  const [customer,setCustomer]=useState(null),[linking,setLinking]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[advanced,setAdvanced]=useState(false);
  async function linkCustomer() {
    if(!customer || busy)return;
    if(!window.confirm('Link '+customer.name+' to '+entity.data.name+'? Existing customer balances will be retained. This customer link cannot be replaced.'))return;
    setBusy(true);onBusy(true);setError('');
    try{await api('/accounts/entities/'+id+'/customer',{method:'PATCH',body:{customerId:customer._id,expectedRevision:entity.data.revision,confirmation:'LINK EXISTING CUSTOMER'}});setLinking(false);entity.reload();onChanged();}
    catch(e){setError(e.message);}finally{setBusy(false);onBusy(false);}
  }
  return <><Notice loading={entity.loading} error={entity.error || error}/>{entity.data && <><h2 className="h5">{entity.data.name}</h2><p>{entity.data.phoneNo || 'No phone saved'}<br/>{entity.data.address || 'No address saved'}</p>{entity.data.roles.includes('SUPPLIER')&&<p><Link className="btn btn-outline-primary btn-sm" to={'/owner/accounts/suppliers/'+entity.data._id}>Open supplier Khata</Link></p>}<button className="btn btn-outline-secondary btn-sm mb-3" aria-expanded={advanced} onClick={()=>setAdvanced(!advanced)} disabled={busy}>Business setup &amp; brand links</button>{advanced&&<><p className="small text-body-secondary">Keep one identity for this business. Brand links identify product companies, not who supplied a purchase.</p>{entity.data.customerId?<p>Linked to an existing customer. View debt and store credit under Accounts → Customers.</p>:<><button className="btn btn-outline-secondary btn-sm" onClick={()=>setLinking(!linking)} disabled={busy}>{linking?'Hide customer search':'Link existing customer'}</button>{linking && <div className="mt-3"><ExistingCustomer value={customer} onChange={setCustomer}/><button className="btn btn-primary btn-sm" disabled={!customer || busy} onClick={linkCustomer}>Confirm customer link</button></div>}</>}<RoleEditor key={entity.data.revision} entity={entity.data} onBusy={onBusy} onChanged={()=>{entity.reload();onChanged();}}/><BrandLinks entity={entity.data} onBusy={onBusy}/><CompanyProducts entityId={id}/></>}</>}</>;
}
export default function Companies() {
  const navigate=useNavigate();
  const [search,setSearch]=useQueryParam('search'),[page,setPage]=usePageParam(),[scopeParam,setScopeParam]=useQueryParam('scope','SUPPLIER'),[creating,setCreating]=useState(''),[busy,setBusy]=useState(false),[success,setSuccess]=useState('');
  // Suppliers ('SUPPLIER') or all businesses (''), kept in the URL with page and search.
  const scope=scopeParam==='ALL'?'':'SUPPLIER',setScope=value=>setScopeParam(value?'SUPPLIER':'ALL');
  const [selected,setSelected]=useQueryParam('business');
  const term=useDebounce(search), list=useLoad('/accounts/entities'+query({q:term,role:scope,page,limit:20}));
  return <><PageTitle title="Suppliers"><button className="btn btn-primary btn-sm" onClick={()=>setCreating('supplier')}>Add supplier</button></PageTitle>
    <Notice success={success}/><div className="d-flex flex-wrap gap-2 mb-3"><input className="form-control search-input" aria-label="Search businesses" placeholder="Supplier name or phone" maxLength={100} value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/><select className="form-select w-auto" aria-label="Business list filter" value={scope} onChange={e=>{setScope(e.target.value);setPage(1);}}><option value="SUPPLIER">Suppliers</option><option value="">All existing businesses (Advanced)</option></select></div>
    <section className="panel fill-panel"><Notice loading={list.loading} error={list.error}/>{list.data&&<><RecordTable label="Supplier accounts" rows={list.data.entries} columns={[
      {key:'name',label:scope?'Supplier':'Business'},...(!scope?[{key:'roles',label:'Roles',render:e=>e.roles.map(r=>roles[r]||r).join(', ')}]:[]),
      {key:'phoneNo',label:'Phone',render:e=>e.phoneNo||'—'},{key:'address',label:'Address',render:e=>e.address||'—'},
      ...(!scope?[{key:'supplier',label:'Supplier records',render:e=>e.roles.includes('SUPPLIER')?<Link className="btn btn-outline-primary btn-sm" to={'/owner/accounts/suppliers/'+e._id}>Supplier history</Link>:'—'}]:[])
    ]} onOpen={e=>scope&&e.roles.includes('SUPPLIER')?navigate('/owner/accounts/suppliers/'+e._id):setSelected(e._id)} detailLabel={scope?'View supplier':'Business details'} empty={scope?'No suppliers found.':'No businesses found.'}/><Pagination label={scope?'Suppliers':'Businesses'} pagination={list.data.pagination} rows={list.data.entries.length} onPage={setPage}/></>}</section>
    <details className="context-help mt-3"><summary>Other business records (Advanced)</summary><p>Already registered? Find the existing business and add Supplier in Business setup. Keep customer accounts in Customers and investments in Partners &amp; Capital.</p><button className="btn btn-sm btn-outline-secondary me-2" onClick={()=>{setScope('');setPage(1);}}>Show all businesses</button><button className="btn btn-sm btn-outline-secondary" onClick={()=>setCreating('legacy')}>Add other business</button></details>
    {creating&&<Modal title={creating==='supplier'?'Add supplier':'Add other business'} busy={busy} onClose={()=>setCreating('')}><EntityForm supplier={creating==='supplier'} onBusy={setBusy} onSaved={e=>{setCreating('');list.reload();if(creating==='supplier')navigate('/owner/accounts/suppliers/'+e._id);else setSuccess(e.name||'Business saved.');}}/></Modal>}
    {selected&&<Modal title="Business information & setup" busy={busy} onClose={()=>setSelected('')}><EntityDetails key={selected} id={selected} onBusy={setBusy} onChanged={list.reload}/></Modal>}
  </>;
}
