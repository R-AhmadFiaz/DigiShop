import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router-dom';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {default:Page}=await server.ssrLoadModule('/src/pages/owner/SupplierTransactionsPage.jsx');
 const render=url=>renderToStaticMarkup(createElement(MemoryRouter,{initialEntries:[url]},createElement(Page)));
 await test('transactions page reuses supplier selection when no supplier is supplied',()=>{
 const html=render('/owner/accounts/suppliers/transactions');assert.match(html,/Supplier Transactions/);assert.match(html,/Find supplier/);assert.doesNotMatch(html,/Account statement/);
 });
 await test('selected supplier identity and account must load before any history is rendered',()=>{
 const html=render('/owner/accounts/suppliers/transactions?supplierId=507f1f77bcf86cd799439031');assert.match(html,/Loading/);assert.doesNotMatch(html,/Business transaction register|Account statement|Find supplier/);
 });
 await test('invalid supplier cannot fall back to the general transaction register',()=>{
 const html=render('/owner/accounts/suppliers/transactions?supplierId=invalid');assert.match(html,/Choose a valid supplier/);assert.doesNotMatch(html,/Business transaction register|Account statement/);
 });
}finally{await server.close();}
