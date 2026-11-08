import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';
import {receivingSetup, receivingError} from '../src/api/purchaseReceiving.js';

const loaded=data=>({data,loading:false,error:''});
const active=loaded({accountingEnabled:true});
const missing=loaded({authoritative:false,cutover:null,issues:[{problem:'Supplier payable cutover requires explicit owner review'}]});

test('inactive financial posting does not block stock-only receiving because supplier balances are unavailable',()=>{
  const state=receivingSetup(loaded({accountingEnabled:false}),{data:null,loading:false,error:'Supplier balance unavailable'});
  assert.equal(state.blocked,false);assert.equal(state.kind,'stock-only');
  assert.match(state.message,/not confirmed supplier debt/);assert.match(state.message,/do not make a payment/);
});
test('active accounting requires a confirmed supplier opening; zero debt is never inferred',()=>{
  const state=receivingSetup(active,missing);
  assert.equal(state.blocked,true);assert.equal(state.kind,'opening');assert.match(state.message,/review earlier debt and deliveries/);
  assert.doesNotMatch(state.message,/PKR 0|Rs 0|balance: 0/);
});
test('an existing inconsistent opening requires reconciliation rather than a second opening',()=>{
  const state=receivingSetup(active,loaded({authoritative:false,cutover:{_id:'opening'},issues:[{problem:'Missing or inconsistent supplier journal'}]}));
  assert.equal(state.blocked,true);assert.equal(state.kind,'review');assert.match(state.message,/Do not create another opening or reset the balance/);
});
test('reconciled posted records permit receiving; rechecking after owner setup unlocks the form',()=>{
  assert.equal(receivingSetup(active,missing).blocked,true);
  const ready=receivingSetup(active,loaded({authoritative:true,cutover:{_id:'confirmed'},issues:[]}));
  assert.equal(ready.blocked,false);assert.equal(ready.kind,'ready');assert.equal(ready.message,'');
  assert.equal(receivingSetup(active,loaded({authoritative:true,cutover:{},issues:[{problem:'inconsistent'}]})).blocked,true);
});
test('loading and failed active-accounting checks do not claim the supplier is ready',()=>{
  assert.equal(receivingSetup({data:null,loading:true,error:''},missing).blocked,true);
  assert.equal(receivingSetup(active,{data:null,loading:true,error:''}).blocked,true);
  assert.equal(receivingSetup(active,{data:null,loading:false,error:'Network unavailable'}).blocked,true);
  assert.equal(receivingSetup(active,loaded({authoritative:false})).kind,'unavailable');
  const unknown=receivingSetup({data:null,loading:false,error:'Settings unavailable'},missing);
  assert.equal(unknown.blocked,false);assert.equal(unknown.kind,'unverified');assert.match(unknown.message,/required supplier checks still apply/);
});
test('receiving prerequisite errors explain the safe next action without changing unrelated or uncertain failures',()=>{
  const error={status:409,message:'Supplier payable cutover or reconciliation incomplete; authoritative balance unavailable'};
  assert.match(receivingError(error,{path:'/purchases/purchase/receipts'}),/Open Supplier Khata/);
  assert.match(receivingError(error,{path:'/purchases/purchase/receipts'}),/This attempt changed no stock or payment/);
  assert.equal(receivingError(error,{path:'/accounts/suppliers/supplier/payments'}),error.message);
  assert.equal(receivingError({...error,status:0},{path:'/purchases/purchase/receipts'}),error.message);
  assert.equal(receivingError({status:409,message:'Received quantity exceeds the remaining order quantity'},{path:'/purchases/purchase/receipts'}),'Received quantity exceeds the remaining order quantity');
});
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try {
  const {default:Setup}=await server.ssrLoadModule('/src/components/PurchaseReceivingSetup.jsx');
  await test('purchase details compiles with setup guidance and renders its initial loading state',async()=>{
    const {default:Details}=await server.ssrLoadModule('/src/pages/owner/PurchaseDetails.jsx');
    const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Details)));
    assert.match(html,/Purchase details/);assert.match(html,/Loading/);
  });
  await test('blocked receiving shows a compact supplier action and a read-only recheck button',()=>{
    const render=state=>renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Setup,{state,supplierId:'supplier',onCheck:()=>{}})));
    const html=render(receivingSetup(active,missing));
    assert.match(html,/href="\/owner\/accounts\/suppliers\/supplier"/);assert.match(html,/Check setup again/);assert.match(html,/type="button"/);
    assert.doesNotMatch(html,/Confirm Rs 0|Reset balance|type="submit"/);
    assert.equal(render(receivingSetup(active,loaded({authoritative:true,cutover:{},issues:[]}))),'');
  });
} finally {await server.close();}
