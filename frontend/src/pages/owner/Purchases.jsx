import { useState } from 'react';
import { Link } from 'react-router-dom';
import { query } from '../../api/client';
import { useDebounce, useLoad } from '../../api/hooks';
import {useProductSearch} from '../../api/productSearch';
import ProductFilters from '../../components/ProductFilters';
import { purchaseItems } from '../../api/purchases';
import { Empty, Field, Notice, PageTitle, Pagination } from '../../components/Common';
import PurchaseTable from '../../components/PurchaseTable';
import {usePageParam,useQueryParam} from '../../api/paging';
import SupplierAction from '../../components/SupplierAction';

function CreatePurchase({prepare,locked,onClose}) {
  const [supplierSearch,setSupplierSearch]=useState(''),[supplierPage,setSupplierPage]=useState(1),[supplier,setSupplier]=useState(null);
  const [search,setSearch]=useState(''),[category,setCategory]=useState(''),[brand,setBrand]=useState(''),[productPage,setProductPage]=useState(1),[rows,setRows]=useState([]),[error,setError]=useState('');
  const suppliers=useLoad('/accounts/entities'+query({role:'SUPPLIER',q:useDebounce(supplierSearch),page:supplierPage,limit:10}));
  const products=useProductSearch({search,category,brand}),categories=useLoad('/categories/');
  const productPages=Math.ceil((products.data?.product.length??0)/20),currentProductPage=Math.min(productPage,Math.max(1,productPages));
  function submit(e){
    e.preventDefault();if(locked)return;setError('');
    try{if(!supplier)throw new Error('Choose a supplier.');const form=new FormData(e.currentTarget),items=purchaseItems(rows);
      const reviewedItems=rows.map((row,index)=>({name:row.name,quantity:items[index].quantity,unitCostMinor:items[index].unitCostMinor,totalMinor:items[index].quantity*items[index].unitCostMinor}));
      prepare({path:'/purchases/',title:'Confirm purchase order',confirmationType:'purchase-order',supplierName:supplier.name,items:reviewedItems,totalMinor:reviewedItems.reduce((total,item)=>total+item.totalMinor,0),body:{...(form.get('notes')?{notes:form.get('notes')}:{}),...(form.get('supplierDocumentNo')?{supplierDocumentNo:form.get('supplierDocumentNo')}:{}),supplierId:supplier._id,items,requestKey:crypto.randomUUID()}});
    }catch(e){setError(e.message);}
  }
  return <section className="panel mb-3"><h2 className="h5">Create purchase order</h2><form onSubmit={submit}><fieldset disabled={locked}><Notice error={error}/>
    <p className="text-body-secondary">DigiShop assigns the purchase number after saving.</p>
    <Field label="Supplier invoice / challan (Optional)"><input name="supplierDocumentNo" className="form-control" maxLength={100}/></Field><Field label="Purchase notes (Optional)"><input name="notes" className="form-control" maxLength={500}/></Field>
    <Field label="Find supplier"><input className="form-control" value={supplierSearch} maxLength={100} onChange={e=>{setSupplierSearch(e.target.value);setSupplierPage(1);}}/></Field><Notice loading={suppliers.loading} error={suppliers.error}/>
    <div className="d-flex flex-wrap gap-2 mb-2">{suppliers.data?.entries.map(s=><button type="button" className={'btn btn-sm '+(supplier?._id===s._id?'btn-primary':'btn-outline-secondary')} key={s._id} onClick={()=>setSupplier(s)}>{s.name}</button>)}</div><Pagination pagination={suppliers.data?.pagination} onPage={setSupplierPage}/>{suppliers.data?.entries.length===0&&<p>No suppliers found. <Link to="/owner/accounts/companies">Add a supplier</Link> first.</p>}{supplier&&<p>Supplier: <strong>{supplier.name}</strong></p>}
    <ProductFilters search={search} onSearch={value=>{setSearch(value);setProductPage(1);}} category={category} onCategory={value=>{setCategory(value);setProductPage(1);}} brand={brand} onBrand={value=>{setBrand(value);setProductPage(1);}} categories={categories.data?.categories} brands={products.brands} visibleSearchLabel="Find purchase products" categoryLabel="Purchase category filter" brandLabel="Purchase brand filter"/>
    <Notice loading={products.loading} error={products.error||categories.error}/>
    <div className="d-flex flex-wrap gap-2 mb-3">{products.data?.product?.slice((currentProductPage-1)*20,currentProductPage*20).map(p=><button className="btn btn-sm btn-outline-secondary" type="button" key={p._id} disabled={rows.some(r=>r._id===p._id)} onClick={()=>setRows([...rows,{...p,quantity:'1',cost:''}])}>Add {p.name}</button>)}</div>
    {products.data&&!products.data.product.length&&<Empty>No matching products.</Empty>}<Pagination pagination={{currentPage:currentProductPage,totalPages:productPages}} onPage={setProductPage}/>
    {rows.length>0&&<div className="table-responsive"><table className="table table-sm"><thead><tr><th>Product</th><th>Quantity</th><th>Agreed unit cost (PKR)</th><th/></tr></thead><tbody>{rows.map(r=><tr key={r._id}><td>{r.name}</td><td><input aria-label={'Quantity for '+r.name} className="form-control" type="number" min="1" step="1" required value={r.quantity} onChange={e=>setRows(rows.map(x=>x._id===r._id?{...x,quantity:e.target.value}:x))}/></td><td><input aria-label={'Unit cost for '+r.name} className="form-control" type="number" min="0" step="0.01" required value={r.cost} onChange={e=>setRows(rows.map(x=>x._id===r._id?{...x,cost:e.target.value}:x))}/></td><td><button type="button" className="btn btn-sm btn-outline-danger" onClick={()=>setRows(rows.filter(x=>x._id!==r._id))}>Remove</button></td></tr>)}</tbody></table></div>}
    <button className="btn btn-primary me-2" disabled={!rows.length} type="submit">Review purchase order</button><button className="btn btn-outline-secondary" type="button" onClick={onClose}>Close form</button>
  </fieldset></form></section>;
}
export default function Purchases(){
  // Existing links pass ?reference=; filters and page stay in the URL.
  const [search,setSearch]=useQueryParam('reference'),[status,setStatus]=useQueryParam('status'),[page,setPage]=usePageParam(),[creating,setCreating]=useState(false);
  const list=useLoad('/purchases/'+query({q:useDebounce(search),status,page,limit:20}));
  return <><PageTitle title="Purchases"><button className="btn btn-primary btn-sm" onClick={()=>setCreating(true)}>Create purchase order</button></PageTitle>
    <SupplierAction onChanged={()=>{setCreating(false);list.reload();}}>{({prepare,locked})=><>{creating&&<CreatePurchase prepare={prepare} locked={locked} onClose={()=>setCreating(false)}/>}</>}</SupplierAction>
    <div className="row g-2 mb-3"><div className="col-md-8"><Field label="Search purchases"><input className="form-control" placeholder="Reference or supplier" maxLength={100} value={search} onChange={e=>setSearch(e.target.value,['page'])}/></Field></div><div className="col-md-4"><Field label="Purchase status"><select className="form-select" value={status} onChange={e=>setStatus(e.target.value,['page'])}><option value="">All statuses</option>{['DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED'].map(s=><option key={s} value={s}>{s.replaceAll('_',' ').toLowerCase()}</option>)}</select></Field></div></div>
    <section className="panel"><PurchaseTable result={list} onPage={setPage} history/>{list.data?.entries.length===0&&<Empty>Create an order when you agree a purchase with a supplier. Receive stock only when goods arrive.</Empty>}</section>
  </>;
}
