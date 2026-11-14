import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';

const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {default:Page}=await server.ssrLoadModule('/src/pages/owner/SupplierPaymentPage.jsx');
 const render=url=>renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:[url]},createElement(Page)));
 await test('payment page starts with the existing supplier picker without a selected supplier',()=>{
   const html=render('/owner/accounts/suppliers/pay');assert.match(html,/Pay Supplier/);assert.match(html,/Find supplier/);assert.doesNotMatch(html,/Payment amount/);
 });
 await test('deep-linked supplier is loaded before showing any payment controls',()=>{
   const html=render('/owner/accounts/suppliers/pay?supplierId=507f1f77bcf86cd799439031');assert.match(html,/Loading/);assert.match(html,/Choose another supplier/);assert.doesNotMatch(html,/Find supplier|Payment amount/);
 });
 await test('invalid supplier selection fails closed and offers choosing another supplier',()=>{
   const html=render('/owner/accounts/suppliers/pay?supplierId=invalid');assert.match(html,/Choose a valid supplier/);assert.doesNotMatch(html,/Payment amount|PKR 0/);
 });
}finally{await server.close();}
