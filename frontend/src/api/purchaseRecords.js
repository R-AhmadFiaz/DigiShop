import {useEffect, useState} from 'react';
import {api, query} from './client';
import {returnQuantities} from './purchases';

const empty=[];
const quantity=value=>Number.isSafeInteger(value)&&value>=0;
function total(values){const n=values.reduce((sum,value)=>sum+value,0);if(!Number.isSafeInteger(n))throw Error('Purchase quantities need review.');return n;}
export function receivedQuantity(po){
  if(!po.items.every(i=>quantity(i.receivedQuantity)))return null;
  const sum=po.items.reduce((n,i)=>n+i.receivedQuantity,0);
  return Number.isSafeInteger(sum)?sum:null;
}

// Read-only presentation totals. All deliveries and return corrections are required.
export function purchaseQuantities(po,receipts,events){
  if(new Set(po.items.map(i=>String(i.productId))).size!==po.items.length)throw Error('Purchase product quantities need review.');
  const ids=new Set(receipts.map(r=>String(r._id)));
  if(ids.size!==receipts.length||new Set(events.map(e=>String(e._id))).size!==events.length)throw Error('History changed. Refresh this purchase.');
  if(receipts.some(r=>String(r.purchaseOrderId)!==String(po._id)||String(r.supplierId)!==String(po.supplierId))||events.some(e=>!ids.has(String(e.receiptId))||String(e.supplierId)!==String(po.supplierId)||!(e.kind==='RETURN'||(e.kind==='REVERSAL'&&e.originalKind==='RETURN'))))throw Error('Purchase return history needs review.');
  const reversed=new Set();
  for(const event of events){
    if(!Array.isArray(event.items)||!event.items.length||event.items.some(i=>!quantity(i.quantity)||i.quantity===0))throw Error('Return quantities need review.');
    if(event.kind==='REVERSAL'){
      const original=events.find(e=>String(e._id)===String(event.reversalOf)&&e.kind==='RETURN'&&String(e.receiptId)===String(event.receiptId));
      const lines=items=>items.map(i=>String(i.productId)+':'+i.quantity).sort().join(',');
      if(!original||reversed.has(String(original._id))||lines(original.items)!==lines(event.items))throw Error('Return correction history is incomplete.');
      reversed.add(String(original._id));
    }
  }
  const received={},returned={};
  for(const receipt of receipts){
    const positions=returnQuantities(receipt,events.filter(e=>String(e.receiptId)===String(receipt._id)));
    for(const line of receipt.items){
      if(!quantity(line.quantity)||!po.items.some(p=>String(p.productId)===String(line.productId)))throw Error('Delivery quantities need review.');
      received[line.productId]=(received[line.productId]??0)+line.quantity;
      returned[line.productId]=(returned[line.productId]??0)+positions[line.productId].returned;
    }
  }
  const items=po.items.map(line=>{
    if(!quantity(line.quantity)||!quantity(line.receivedQuantity)||line.receivedQuantity>line.quantity||(received[line.productId]??0)!==line.receivedQuantity)throw Error('Delivery history changed or is incomplete. Refresh this purchase.');
    const back=returned[line.productId]??0;
    if(!quantity(back)||back>line.receivedQuantity)throw Error('Return quantities need review.');
    return {...line,returnedQuantity:back,keptQuantity:line.receivedQuantity-back};
  });
  return {items,received:total(items.map(i=>i.receivedQuantity)),returned:total(items.map(i=>i.returnedQuantity)),kept:total(items.map(i=>i.keptQuantity))};
}

async function pages(path,signal,request,filters={}){
  const entries=[],seen=new Set();let count;
  for(let page=1;page<=100;page++){
    const result=await request(path+query({...filters,page,limit:100}),{signal});
    const pagination=result.pagination;
    if(!Array.isArray(result.entries)||!pagination||!Number.isSafeInteger(pagination.totalPages)||pagination.totalPages<0||pagination.totalPages>100)throw Error('Complete history is unavailable.');
    if(count!==undefined&&pagination.recordCount!==count)throw Error('History changed. Refresh this purchase.');
    count=pagination.recordCount;
    for(const row of result.entries){if(seen.has(String(row._id)))throw Error('History changed. Refresh this purchase.');seen.add(String(row._id));entries.push(row);}
    if(page>=pagination.totalPages){if(Number.isSafeInteger(count)&&count!==entries.length)throw Error('Complete history is unavailable.');return entries;}
  }
  throw Error('Complete history is unavailable.');
}
export async function readPurchaseRecords(po,signal,request=api){
  const receipts=await pages('/purchases/'+po._id+'/receipts',signal,request);
  try{
    if(receipts.length>100)throw Error('More than 100 deliveries need a separate history review.');
    const events=[];
    for(const receipt of receipts)events.push(...await pages('/accounts/suppliers/'+po.supplierId+'/settlements',signal,request,{sourceId:receipt._id}));
    return {receipts,events,summary:purchaseQuantities(po,receipts,events),error:''};
  }catch(error){if(signal?.aborted)throw error;return {receipts,events:[],summary:null,error:'Returned and kept quantities unavailable: '+error.message};}
}

export function usePurchaseRecords(purchases=empty,enabled=true){
  const [state,setState]=useState({source:null,results:{}});
  useEffect(()=>{
    if(!enabled)return;
    const controller=new AbortController();let cursor=0;
    async function worker(){while(cursor<purchases.length&&!controller.signal.aborted){const po=purchases[cursor++];let result;
      try{result=await readPurchaseRecords(po,controller.signal);}catch(e){result={receipts:[],events:[],summary:null,error:'Purchase history unavailable: '+e.message};}
      if(!controller.signal.aborted)setState(previous=>({source:purchases,results:{...(previous.source===purchases?previous.results:{}),[po._id]:result}}));
    }}
    for(let n=0;n<Math.min(4,purchases.length);n++)worker();
    return ()=>controller.abort();
  },[purchases,enabled]);
  return state.source===purchases?state.results:{};
}

export function purchaseActivity(receipts=[],events=[]){
  return [...receipts.map(receipt=>({...receipt,activityKind:'RECEIPT',receipt})),...events.map(event=>({...event,activityKind:event.kind,receipt:receipts.find(r=>String(r._id)===String(event.receiptId))}))]
    .sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||String(a._id).localeCompare(String(b._id)));
}
