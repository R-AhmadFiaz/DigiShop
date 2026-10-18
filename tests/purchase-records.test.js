import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
  const {purchaseQuantities,purchaseActivity,receivedQuantity,readPurchaseRecords}=await server.ssrLoadModule('/src/api/purchaseRecords.js');
  const po={_id:'po',reference:'PO-1',supplierId:'supplier',items:[{productId:'a',name:'Cable',quantity:10,receivedQuantity:7},{productId:'b',name:'Bulb',quantity:4,receivedQuantity:2}]};
  const receipt=(id,items,at)=>({_id:id,purchaseOrderId:'po',supplierId:'supplier',items,occurredAt:at,totalMinor:12345});
  const receipts=[receipt('g2',[{productId:'a',quantity:2},{productId:'b',quantity:2}],'2026-01-02T00:00:00Z'),receipt('g1',[{productId:'a',quantity:5}],'2026-01-01T00:00:00Z')];
  const event=(id,receiptId,kind,items,at,extra={})=>({_id:id,receiptId,supplierId:'supplier',kind,items,occurredAt:at,amountMinor:500,...extra});
  const events=[event('r1','g1','RETURN',[{productId:'a',quantity:2}],'2026-01-03T00:00:00Z'),event('r2','g1','RETURN',[{productId:'a',quantity:1}],'2026-01-04T00:00:00Z'),event('x1','g1','REVERSAL',[{productId:'a',quantity:2}],'2026-01-05T00:00:00Z',{originalKind:'RETURN',reversalOf:'r1'}),event('r3','g2','RETURN',[{productId:'b',quantity:1}],'2026-01-04T00:00:00Z')];
  await test('partial multi-product receipts and multiple returns/corrections preserve received and net kept',()=>{
    const before=JSON.stringify({po,receipts,events});const result=purchaseQuantities(po,receipts,events);
    assert.deepEqual([result.received,result.returned,result.kept],[9,2,7]);
    assert.deepEqual(result.items.map(i=>[i.receivedQuantity,i.returnedQuantity,i.keptQuantity]),[[7,1,6],[2,1,1]]);
    assert.equal(JSON.stringify({po,receipts,events}),before);
    assert.equal(purchaseQuantities({...po,status:'CANCELLED'},receipts,events).kept,7);
  });
  await test('incomplete, duplicated, over-returned and foreign history cannot manufacture totals',()=>{
    assert.equal(receivedQuantity(po),9);
    assert.equal(receivedQuantity({items:[{receivedQuantity:Number.MAX_SAFE_INTEGER},{receivedQuantity:1}]}),null);
    assert.equal(receivedQuantity({items:[{receivedQuantity:null}]}),null);
    assert.throws(()=>purchaseQuantities(po,receipts.slice(0,1),events));
    assert.throws(()=>purchaseQuantities(po,[...receipts,receipts[0]],events));
    assert.throws(()=>purchaseQuantities(po,receipts,[...events,events[0]]));
    assert.throws(()=>purchaseQuantities(po,receipts,[event('bad','g1','RETURN',[{productId:'a',quantity:6}],'2026-01-06')]));
    assert.throws(()=>purchaseQuantities(po,[{...receipts[0],purchaseOrderId:'other'},receipts[1]],events));
    assert.throws(()=>purchaseQuantities(po,receipts,[{...events[0],supplierId:'other'}]));
    assert.throws(()=>purchaseQuantities(po,receipts,[events[2]]));
    assert.throws(()=>purchaseQuantities(po,receipts,[...events,{...events[2],_id:'another-reversal'}]));
  });
  await test('activity is chronological with deterministic ties and uses saved goods values',()=>{
    const rows=purchaseActivity(receipts,events);
    assert.deepEqual(rows.map(r=>r._id),['g1','g2','r1','r2','r3','x1']);
    assert.equal(rows[0].totalMinor,12345);assert.equal(rows[2].amountMinor,500);
    assert.equal(rows[2].receipt._id,'g1');assert.equal(rows.at(-1).activityKind,'REVERSAL');
  });
  await test('reads every page of deliveries and source-scoped returns without changing request values',async()=>{
    const calls=[];
    const request=async path=>{
      calls.push(path);const u=new URL(path,'http://local');const page=Number(u.searchParams.get('page'));
      if(u.pathname.endsWith('/receipts'))return {entries:[receipts[page-1]],pagination:{recordCount:2,totalPages:2}};
      assert.equal(u.pathname,'/accounts/suppliers/supplier/settlements');
      const data=events.filter(e=>e.receiptId===u.searchParams.get('sourceId'));
      return {entries:data,pagination:{recordCount:data.length,totalPages:1}};
    };
    const result=await readPurchaseRecords(po,undefined,request);
    assert.equal(result.summary.kept,7);assert.equal(calls.length,4);assert.equal(result.error,'');
  });
  await test('unavailable return accounting never appears as zero returns or kept inventory',async()=>{
    const result=await readPurchaseRecords(po,undefined,async path=>{
      if(path.startsWith('/purchases/'))return {entries:receipts,pagination:{recordCount:2,totalPages:1}};
      throw Error('Accounting unavailable');
    });
    assert.equal(result.summary,null);assert.equal(result.receipts.length,2);assert.deepEqual(result.events,[]);assert.match(result.error,/unavailable/i);
  });
  await test('empty unreceived purchase has a verified zero; incomplete pagination fails closed',async()=>{
    const unused={...po,items:po.items.map(i=>({...i,receivedQuantity:0}))};
    const result=await readPurchaseRecords(unused,undefined,async()=>({entries:[],pagination:{recordCount:0,totalPages:0}}));
    assert.equal(result.summary.returned,0);assert.equal(result.summary.kept,0);
    await assert.rejects(readPurchaseRecords(po,undefined,async()=>({entries:[],pagination:{recordCount:2,totalPages:1}})));
  });
  await test('purchase-history table has only one View link per purchase and no duplicate Details action',async()=>{
    const {default:PurchaseTable}=await server.ssrLoadModule('/src/components/PurchaseTable.jsx');
    const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(PurchaseTable,{history:true,result:{data:{entries:[{...po,supplierName:'Supplier',createdAt:'2026-01-01',totalMinor:10000}],pagination:{totalPages:1}}}})));
    assert.match(html,/Quantity returned/);assert.match(html,/Quantity received/);
    assert.equal((html.match(/href="\/owner\/purchases\/po"/g)||[]).length,1);
    assert.doesNotMatch(html,/>Open purchase<|>Details<\/button>/);
  });
}finally{await server.close();}
