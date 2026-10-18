import {useEffect,useMemo,useState} from 'react';
import {api,query} from './client';

const key=value=>typeof value==='string'?value.trim().toLowerCase():'';
const categoryId=p=>String(p.category?._id??p.category??'');
export function productBrands(products,category=''){
  const names=new Map();
  for(const product of products){
    if(category&&categoryId(product)!==category)continue;
    const value=key(product.brand);if(value&&!names.has(value))names.set(value,product.brand.trim());
  }
  return [...names].sort((a,b)=>a[1].localeCompare(b[1])).map(([value,label])=>({value,label}));
}
export function matchingProducts(products,{search='',category='',brand=''}={}){
  const words=key(search).split(/\s+/).filter(Boolean);
  return products.filter(p=>(!category||categoryId(p)===category)&&(!brand||key(p.brand)===key(brand))&&words.every(word=>[p.name,p.brand,p.category?.name,p.description].some(value=>key(value).includes(word))));
}
export function completeProducts(result){
  // This existing endpoint is unpaginated. Never mistake a partial page for its full list.
  if(!Array.isArray(result?.product)||(result.pagination&&(result.pagination.totalPages>1||result.pagination.recordCount!==result.product.length)))throw Error('Complete product results unavailable. Refresh or narrow the category.');
  return result.product;
}
export function useProductSearch({search='',category='',brand=''}={}){
  const url='/products/search-product'+query({category});
  const [state,setState]=useState({url:null,data:null,error:'',loading:true}),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState({url,data:null,error:'',loading:true});
    api(url,{signal:controller.signal}).then(result=>{
      const product=completeProducts(result);
      if(!controller.signal.aborted)setState({url,data:{...result,product},error:'',loading:false});
    }).catch(error=>{if(!controller.signal.aborted)setState({url,data:null,error:error.message,loading:false});});
    return ()=>controller.abort();
  },[url,revision]);
  const current=state.url===url?state:{data:null,error:'',loading:true};
  const products=useMemo(()=>matchingProducts(current.data?.product??[],{search,category,brand}),[current.data,search,category,brand]);
  const brands=useMemo(()=>productBrands(current.data?.product??[],category),[current.data,category]);
  return {...current,data:current.data?{...current.data,product:products}:null,brands,reload:()=>setRevision(n=>n+1)};
}
