import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true,hmr:false},appType:'custom'});
try{
 const {verifiedPayable,paymentAmount,samePayable}=await server.ssrLoadModule('/src/api/supplierPayment.js');
 const ready={authoritative:true,cutover:{_id:'opening'},issues:[],balanceMinor:3250000,creditMinor:200};
 await test('supplier payments require verified debt and preserve separate supplier credit',()=>{
 assert.equal(verifiedPayable(ready),true);
 for(const value of [{...ready,authoritative:false},{...ready,cutover:null},{...ready,issues:[{}]},{...ready,balanceMinor:null}])assert.equal(verifiedPayable(value),false);
 assert.equal(samePayable({...ready},ready),true);
 assert.equal(samePayable({...ready,balanceMinor:3000000},ready),false);
 assert.equal(samePayable({...ready,creditMinor:0},ready),false);
 });
 await test('payment validation uses exact minor units and rejects invalid, excess and unfunded amounts',()=>{
 assert.equal(paymentAmount('123.45',3250000,50000),12345);
 for(const amount of ['0','-1','32500.01','1.001','no'])assert.throws(()=>paymentAmount(amount,3250000,9999999));
 assert.throws(()=>paymentAmount('500',3250000,49999));
 assert.throws(()=>paymentAmount('500',3250000,null));
 });
 await test('shared payment and global quick action compile',async()=>{
 for(const path of ['/src/components/SupplierPayment.jsx','/src/components/SupplierQuickPayment.jsx','/src/layouts/ShopLayout.jsx','/src/pages/owner/SupplierDetails.jsx'])assert.ok((await server.ssrLoadModule(path)).default);
 });
}finally{await server.close();}
