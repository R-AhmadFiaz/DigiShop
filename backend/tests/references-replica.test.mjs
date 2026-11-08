import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import jwt from 'jsonwebtoken';
process.env.DOTENV_CONFIG_PATH=path.join(os.tmpdir(),'digishop-no-purchase-env');
process.env.NODE_ENV='test';delete process.env.BUSINESS_ACCOUNTING_ENABLED;
process.env.ACCESS_TOKEN_SECRET='purchase-test';process.env.REFRESH_TOKEN_SECRET='purchase-refresh-test';
process.env.ACCESS_TOKEN_EXPIRY='15m';process.env.REFRESH_TOKEN_EXPIRY='7d';process.env.OPENAI_API_KEY='test-only';
const {app}=await import('../dist/app.js');
const accounts=await import('../dist/utils/businessAccounts.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {User}=await import('../dist/models/user.model.js');
const {Product}=await import('../dist/models/product.model.js');
const {PurchaseOrder}=await import('../dist/models/purchaseOrder.model.js');
const {GoodsReceipt}=await import('../dist/models/goodsReceipt.model.js');
const {StockLog}=await import('../dist/models/stockLog.model.js');
const {BusinessTransaction}=await import('../dist/models/businessTransaction.model.js');
const {CustomerLedger}=await import('../dist/models/customerLedger.model.js');
const {Customer}=await import('../dist/models/customer.model.js');
const {Expense,ExpenseCategory}=await import('../dist/models/expense.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
import {mongodBinary} from './mongod-binary.mjs';
const binary=mongodBinary;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await test('automatic references: disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-expenses-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','expenseTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/expense_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'expenseTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const M of Object.values(mongoose.models)){await M.createCollection();await M.createIndexes();}
        async function fixture(label,phone){const _id=new mongoose.Types.ObjectId(),shop=await Shop.create({ownerId:_id,name:label,address:'Test',contactNo:phone,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)}),user=await User.create({_id,shopId:shop._id,username:label,email:label+'@purchase.test',password:'testing123',role:'OWNER'});return {shop,user,actor:{_id,shopId:shop._id,role:'OWNER'}};}

        const {nextReference,automaticReference}=await import('../dist/utils/references.js');
        const schema=new mongoose.Schema({shopId:mongoose.Schema.Types.ObjectId,reference:String,kind:String});
        automaticReference(schema,d=>d.kind);
        const Record=mongoose.model('ReferenceTestRecord',schema);await Record.createCollection();await Record.createIndexes();
        const a=await fixture('reference-owner','03111111111'),b=await fixture('reference-other','03222222222');
        const allocate=(shop,kind)=>accounts.businessTransaction(shop.actor,session=>nextReference(shop.shop._id,kind,Record,session));
        await t.test('independent durable sequences per type and shop',async()=>{
            for(const prefix of ['PO','GR','SP','SR','CP','CR','QT','EX','CA','CW','SA','TR','SF','SC','SX','ER','CX','IA','IC','JR','JE','OB','SO'])assert.equal(await allocate(a,prefix),prefix+'-1');
            assert.equal(await allocate(a,'SP'),'SP-2');assert.equal(await allocate(b,'SP'),'SP-1');
        });
        await t.test('legacy numbers are retained and skipped; later manually issued numbers advance the counter',async()=>{
            await Record.collection.insertMany([{shopId:a.shop._id,reference:'LX-12'},{shopId:a.shop._id,reference:'LX-AUTO-20'}]);
            assert.equal(await accounts.businessTransaction(a.actor,session=>nextReference(a.shop._id,'LX',Record,session,'reference',['LX-AUTO'])),'LX-21');
            const record=await Record.create({shopId:a.shop._id,kind:'LX',reference:'LX-100'});assert.equal(record.reference,'LX-100');
            assert.equal(await allocate(a,'LX'),'LX-101');
        });
        await t.test('concurrent allocations commit distinct references',async()=>{
            const outcomes=await Promise.allSettled(Array.from({length:5},()=>allocate(a,'CC')));
            const issued=[];for(const result of outcomes){if(result.status==='fulfilled')issued.push(result.value);else {assert.equal(result.reason.statusCode,409);issued.push(await allocate(a,'CC'));}}
            assert.equal(new Set(issued).size,5);
        });
        await t.test('invoice numbering advances past legacy invoices even when the saved counter lags',async()=>{
            await Record.collection.insertOne({shopId:a.shop._id,reference:'INV-50'});
            assert.equal(await allocate(a,'INV'),'INV-51');
            assert.equal((await Shop.findById(a.shop._id)).invoiceCounter,51);
        });
        await t.test('failed transaction issues no committed reference; issued references survive record removal and model reload',async()=>{
            const before=(await Shop.findById(a.shop._id)).referenceCounters?.get('EX');
            await assert.rejects(accounts.businessTransaction(a.actor,async session=>{await nextReference(a.shop._id,'EX',Record,session);throw Error('rollback reference');}));
            assert.equal((await Shop.findById(a.shop._id)).referenceCounters.get('EX'),before);
            const row=await Record.create({shopId:a.shop._id,kind:'ZZ'});assert.equal(row.reference,'ZZ-1');
            await Record.collection.deleteOne({_id:row._id});
            assert.equal(await allocate(a,'ZZ'),'ZZ-2');
            assert.equal((await mongoose.model('ReferenceTestRecord').create({shopId:a.shop._id,kind:'ZZ'})).reference,'ZZ-3');
        });
        await t.test('new issued references have a unique shop index; legacy records are not rewritten',async()=>{
            const before=await Record.find({reference:'LX-12'}).lean();
            await assert.rejects(Record.create({shopId:a.shop._id,kind:'ZZ',reference:'ZZ-3'}),e=>e.statusCode===409);
            await assert.rejects(Record.collection.insertOne({shopId:a.shop._id,reference:'ZZ-3',referenceIssued:true}),e=>e.code===11000);
            await assert.rejects(Record.create({shopId:a.shop._id,kind:'LX',reference:'LX-12'}),e=>e.statusCode===409);
            assert.equal((await Record.create({shopId:b.shop._id,kind:'ZZ',reference:'ZZ-3'})).reference,'ZZ-3');
            assert.deepEqual(await Record.find({reference:'LX-12'}).lean(),before);
        });
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-expenses-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
