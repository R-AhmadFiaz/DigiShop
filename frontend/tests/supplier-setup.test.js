import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {default:Status}=await server.ssrLoadModule('/src/components/SupplierBalanceStatus.jsx');
 const render=props=>renderToStaticMarkup(createElement(Status,props));
 await test('unknown supplier balance has one actionable warning without assuming zero',()=>{
 const html=render({result:{authoritative:false,cutover:null,issues:[{problem:'Supplier payable cutover requires explicit owner review'}]}});
 assert.equal((html.match(/role="alert"/g)||[]).length,1);assert.match(html,/Confirm previous supplier balance/);assert.match(html,/If the balance is unknown/);assert.doesNotMatch(html,/cutover|reconciliation incomplete|Rs 0/);
 });
 await test('verified zero and existing starting debt show no redundant setup warning',()=>{
 for(const balanceMinor of [0,125000])assert.equal(render({result:{authoritative:true,cutover:{},issues:[],balanceMinor}}),'');
 });
 await test('inconsistent confirmed records require review without another opening',()=>{
 const html=render({result:{authoritative:false,cutover:{},issues:[{problem:'journal mismatch'}]}});
 assert.match(html,/Review supplier records/);assert.match(html,/Do not enter another starting balance/);assert.doesNotMatch(html,/Confirm previous supplier balance/);
 });
 await test('failed balance check does not advise initializing unknown debt',()=>{
 const html=render({error:'Network unavailable'});assert.match(html,/could not be checked/);assert.doesNotMatch(html,/Rs 0|Confirm previous supplier balance/);
 });
 await test('supplier opening is expanded on onboarding and closed by default',async()=>{
 const {default:Opening}=await server.ssrLoadModule('/src/components/SupplierOpening.jsx');
 const show=defaultOpen=>renderToStaticMarkup(createElement(Opening,{supplierId:'supplier',onChanged:()=>{},defaultOpen}));
 assert.match(show(true),/id="supplier-opening"[^>]*open=""/);assert.doesNotMatch(show(false),/open=""/);
 assert.match(show(true),/Confirm previous supplier balance/);
 });
 await test('supplier pages and onboarding compile with the existing explicit confirmation workflow',async()=>{
 for(const path of ['/src/pages/owner/Companies.jsx','/src/pages/owner/SupplierDetails.jsx']){
 const {default:Page}=await server.ssrLoadModule(path);
 assert.ok(renderToStaticMarkup(createElement(MemoryRouter,null,createElement(Page))));
 }
 });
}finally{await server.close();}
