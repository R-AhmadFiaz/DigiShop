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
const binary='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await test('supplier payables: actual HTTP and disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-supplier-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','supplierTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/supplier_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'supplierTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const M of Object.values(mongoose.models)){await M.createCollection();await M.createIndexes();}
        async function fixture(label,phone){const _id=new mongoose.Types.ObjectId(),shop=await Shop.create({ownerId:_id,name:label,address:'Test',contactNo:phone,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)}),user=await User.create({_id,shopId:shop._id,username:label,email:label+'@purchase.test',password:'testing123',role:'OWNER'});return {shop,user,actor:{_id,shopId:shop._id,role:'OWNER'}};}
        const a=await fixture('owner','03111111111'),b=await fixture('other','03222222222');
        const cashier=await User.create({shopId:a.shop._id,username:'cashier',email:'cashier@purchase.test',password:'testing123',role:'CASHIER'}),admin=await User.create({username:'admin',email:'admin@purchase.test',password:'testing123',role:'ADMIN'});
        const supplier=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'eagle',name:'Eagle Cables',roles:['SUPPLIER','COMPANY']},s));
        const foreignSupplier=await accounts.businessTransaction(b.actor,s=>accounts.createBusinessEntity(b.actor,{key:'other',name:'Other supplier',roles:['SUPPLIER']},s));
        const company=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'company-only',name:'Company only',roles:['COMPANY']},s));
        let n=0;
        async function product(shop=a.shop){return Product.create({shopId:shop._id,name:'Cable '+(++n),slug:'cable-'+n,brand:'Eagle',category:new mongoose.Types.ObjectId(),unit:'pcs',costPrice:4,retailPrice:9,stockQuantity:10});}
        const p=await product(),q=await product(),foreignProduct=await product(b.shop);
        server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
        async function http(method,url,body,user=a.user){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2${url}`,{method,headers:{...(user?{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET)}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
        function draft(extra={}){const seq=++n;return {reference:'PO-'+seq,requestKey:'purchase-create-'+seq,supplierId:String(supplier._id),items:[{productId:String(p._id),quantity:5,unitCostMinor:1234}],...extra};}
        async function create(extra={}){const body=draft(extra),result=await http('POST','/purchases/',body);assert.equal(result.status,200,JSON.stringify(result.body));return {body,po:result.body.data.purchaseOrder};}
        async function confirm(po){const body={requestKey:'confirm-'+(++n),expectedRevision:po.revision},result=await http('POST',`/purchases/${po._id}/confirm`,body);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.data.purchaseOrder;}
        function receiveBody(po,quantity=1,extra={}){const seq=++n;return {requestKey:'receive-'+seq,reference:'GR-'+seq,expectedRevision:po.revision,items:[{productId:String(p._id),quantity}],...extra};}
        const stock=async product=>(await Product.findById(product._id)).stockQuantity;
        const {SupplierCutover}=await import('../dist/models/supplierCutover.model.js');
        const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
        // Import happened after index setup: explicitly create its unique indexes too.
        await SupplierCutover.createCollection();await SupplierCutover.createIndexes();
        const base=`/accounts/suppliers/${supplier._id}`;
        const ok=result=>{assert.equal(result.status,200,JSON.stringify(result.body));return result.body.data;};
        async function account(kind,code,entityId){return accounts.businessTransaction(a.actor,s=>accounts.createFinancialAccount(a.actor,{kind,code,name:code,...(entityId?{entityId:String(entityId)}:{})},s));}
        const ap=await account('SUPPLIER_PAYABLE','AP-EAGLE',supplier._id),offset=await account('PURCHASES_CLEARING','RECEIVED-CLEARING'),equity=await account('OPENING_EQUITY','OPENING');
        let old,opening,cutover,newReceipt,po;
        await t.test('default-off receiving remains deferred; opening requires test accounting and explicit historical review',async()=>{
            old=await create();old.po=await confirm(old.po);old.receipt=ok(await http('POST',`/purchases/${old.po._id}/receipts`,receiveBody(old.po))).receipt;
            assert.equal(old.receipt.accountingStatus,'DEFERRED');assert.equal(await BusinessTransaction.countDocuments(),0);
            assert.equal((await http('GET',base+'/balance')).status,409);
            const preview=ok(await http('GET',base+'/cutover-preview?limit=1'));assert.equal(preview.pagination.recordCount,1);assert.equal(preview.authoritative,false);
            opening={requestKey:'supplier-opening-confirm',confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt:new Date().toISOString(),payableAccountId:String(ap._id),offsetAccountId:String(offset._id),equityAccountId:String(equity._id),openingBalanceMinor:1100,otherOpeningMinor:100,reviews:[{receiptId:old.receipt._id,unpaidMinor:1000,reason:'234 paisa externally settled; 1000 still owed'}],evidenceDigest:preview.evidenceDigest,reason:'Owner reviewed deliveries, external payments and other debt'};
            assert.equal((await http('POST',base+'/cutover',opening)).status,409);
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            const accountCount=await FinancialAccount.countDocuments({shopId:a.shop._id});
            assert.equal((await http('POST',base+'/cutover',{requestKey:'unsafe-new-enrollment',confirmation:'CONFIRM SUPPLIER OPENING',enrollNewSupplier:true,cutoffAt:new Date().toISOString(),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:preview.evidenceDigest,reason:'Cannot skip an existing delivery review'})).status,409);
            assert.equal(await FinancialAccount.countDocuments({shopId:a.shop._id}),accountCount);
            assert.equal((await http('POST',base+'/cutover',{...opening,reviews:[]})).status,409);
            assert.equal((await http('POST',base+'/cutover',{...opening,openingBalanceMinor:1200})).status,400);
            assert.equal((await http('POST',base+'/cutover',{...opening,evidenceDigest:'stale'})).status,409);
            assert.equal((await http('POST',base+'/cutover',{...opening,cutoffAt:new Date(+new Date(old.receipt.occurredAt)-1).toISOString()})).status,409);
            assert.equal(await SupplierCutover.countDocuments(),0);assert.equal(await BusinessTransaction.countDocuments(),0);
        });
        await t.test('confirmed opening is balanced, source-linked, immutable, once-only and exactly replayable',async()=>{
            cutover=ok(await http('POST',base+'/cutover',opening)).cutover;
            assert.equal(cutover.createdByName,'owner');assert.equal(cutover.createdByRole,'OWNER');assert.equal(ok(await http('GET',base+'/balance')).balanceMinor,1100);
            const journal=await BusinessTransaction.findOne({'source.kind':'SUPPLIER_OPENING'});assert.equal(String(journal.source.referenceId),cutover._id);assert.equal(journal.postings.find(r=>String(r.accountId)===String(ap._id)).creditMinor,1100);assert.equal(journal.postings.find(r=>String(r.accountId)===String(equity._id)).debitMinor,1100);
            assert.equal(ok(await http('POST',base+'/cutover',opening)).replayed,true);
            assert.equal((await http('POST',base+'/cutover',{...opening,requestKey:'different-opening-key'})).status,409);
            await assert.rejects(SupplierCutover.updateOne({_id:cutover._id},{$set:{openingBalanceMinor:0}}),/immutable/);
            await assert.rejects(accounts.businessTransaction(a.actor,s=>accounts.postBusinessJournal(a.actor,{requestKey:'manual-payable-bypass',reason:'Unsafe',occurredAt:new Date().toISOString(),postings:[{accountId:String(offset._id),debitMinor:10,creditMinor:0},{accountId:String(ap._id),debitMinor:0,creditMinor:10}]},s)),/verified/);
        });
        await t.test('new delivery posts agreed received value, stock and audit atomically; creation and confirmation never post',async()=>{
            const count=await BusinessTransaction.countDocuments();po=(await create()).po;po=await confirm(po);assert.equal(await BusinessTransaction.countDocuments(),count);
            await Product.updateOne({_id:p._id},{$set:{costPrice:888}});
            const before=await stock(p),body=receiveBody(po,2);const data=ok(await http('POST',`/purchases/${po._id}/receipts`,body));newReceipt={...data,body};po=data.purchaseOrder;
            assert.equal(data.receipt.accountingStatus,'POSTED');assert.equal(data.receipt.totalMinor,2468);assert.equal(data.receipt.items[0].unitCostMinor,1234);assert.equal(await stock(p),before+2);
            assert.equal(await StockLog.countDocuments({purchaseReceiptId:data.receipt._id}),1);
            const journal=await BusinessTransaction.findOne({'source.kind':'PURCHASE_RECEIPT','source.referenceId':data.receipt._id});assert.equal(journal.postings.find(r=>String(r.accountId)===String(offset._id)).debitMinor,2468);assert.equal(journal.postings.find(r=>String(r.accountId)===String(ap._id)).creditMinor,2468);
            assert.equal(ok(await http('GET',base+'/balance')).balanceMinor,3568);
            assert.equal(ok(await http('POST',`/purchases/${po._id}/receipts`,body)).replayed,true);assert.equal(await stock(p),before+2);assert.equal(await BusinessTransaction.countDocuments(),count+1);
            assert.equal((await http('POST',`/purchases/${po._id}/receipts`,{...body,reference:'FORGED'})).status,409);
        });
        await t.test('old deferred receipts remain unchanged and cannot be reposted, including replay after activation',async()=>{
            const before=await GoodsReceipt.findById(old.receipt._id).lean();assert.equal(before.accountingStatus,'DEFERRED');
            await assert.rejects(accounts.businessTransaction(a.actor,s=>accounts.postSupplierReceipt(a.actor,old.receipt._id,s)),/deferred/);
            assert.equal(await BusinessTransaction.countDocuments({'source.kind':'PURCHASE_RECEIPT','source.referenceId':old.receipt._id}),0);
            assert.deepEqual(await GoodsReceipt.findById(old.receipt._id).lean(),before);
            const count=await BusinessTransaction.countDocuments();await accounts.businessTransaction(a.actor,s=>accounts.postSupplierReceipt(a.actor,newReceipt.receipt._id,s));assert.equal(await BusinessTransaction.countDocuments(),count);
        });
        await t.test('supplier statement uses UTC range balances, source references, actor snapshots and deterministic pagination',async()=>{
            const result=ok(await http('GET',`/accounts/financial/${ap._id}/history?limit=1`));assert.equal(result.rangeOpeningBalanceMinor,0);assert.equal(result.rangeClosingBalanceMinor,3568);assert.equal(result.pagination.recordCount,2);assert.equal(result.transactions[0].eventType,'SUPPLIER_OPENING');
            const second=ok(await http('GET',`/accounts/financial/${ap._id}/history?limit=1&page=2`)).transactions[0];assert.equal(second.actor.name,'owner');assert.equal(second.sourceDocument.reference,newReceipt.receipt.reference);assert.equal(second.runningBalanceMinor,3568);assert.equal(second.accountPosting.moneyInMinor,null);
            const range=ok(await http('GET',`/accounts/financial/${ap._id}/history?from=${newReceipt.receipt.occurredAt}`));assert.equal(range.rangeOpeningBalanceMinor,1100);assert.equal(range.rangeClosingBalanceMinor,3568);
            const search=ok(await http('GET',`/accounts/financial/${ap._id}/history?q=${newReceipt.receipt.reference}`));assert.equal(search.pagination.recordCount,1);
            const global=ok(await http('GET',`/accounts/transactions?sourceId=${po._id}`));assert.equal(global.pagination.recordCount,1);assert.equal(global.entries[0].postings.length,2);
            const detail=ok(await http('GET',`/accounts/transactions/${global.entries[0].eventId}`));assert.equal(detail.transaction.businessAction.totalMinor,2468);
        });
        await t.test('concurrent receiving claims one revision and identical retries post only once',async()=>{
            const before=await stock(p),body=receiveBody(po,1);const results=await Promise.all([http('POST',`/purchases/${po._id}/receipts`,body),http('POST',`/purchases/${po._id}/receipts`,body)]);
            assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
            const replay=ok(await http('POST',`/purchases/${po._id}/receipts`,body));assert.equal(replay.replayed,true);assert.equal(await stock(p),before+1);assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':replay.receipt._id,'source.kind':'PURCHASE_RECEIPT'}),1);po=replay.purchaseOrder;
        });
        await t.test('late payable journal failure rolls back stock, logs, receipt, PO and account revisions',async()=>{
            const before={stock:await stock(p),logs:await StockLog.countDocuments(),receipts:await GoodsReceipt.countDocuments(),journals:await BusinessTransaction.countDocuments(),account:await FinancialAccount.findById(ap._id).lean()},body=receiveBody(po,1),original=BusinessTransaction.create;
            BusinessTransaction.create=async()=>{throw Error('Injected journal failure');};try{assert.equal((await http('POST',`/purchases/${po._id}/receipts`,body)).status,500);}finally{BusinessTransaction.create=original;}
            assert.equal(await stock(p),before.stock);assert.equal(await StockLog.countDocuments(),before.logs);assert.equal(await GoodsReceipt.countDocuments(),before.receipts);assert.equal(await BusinessTransaction.countDocuments(),before.journals);assert.equal((await PurchaseOrder.findById(po._id)).revision,po.revision);assert.equal((await FinancialAccount.findById(ap._id)).postingRevision,before.account.postingRevision);
            po=ok(await http('POST',`/purchases/${po._id}/receipts`,body)).purchaseOrder;
        });
        await t.test('zero opening and zero-value deliveries never fabricate zero journals',async()=>{
            const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'zero-supplier',name:'Zero supplier',roles:['SUPPLIER']},s)),accountId=(await account('SUPPLIER_PAYABLE','AP-ZERO',entity._id))._id;
            const preview=ok(await http('GET',`/accounts/suppliers/${entity._id}/cutover-preview`));const result=ok(await http('POST',`/accounts/suppliers/${entity._id}/cutover`,{...opening,requestKey:'zero-opening-key',payableAccountId:String(accountId),cutoffAt:new Date().toISOString(),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:preview.evidenceDigest}));
            assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':result.cutover._id}),0);const zero=await create({supplierId:String(entity._id),items:[{productId:String(p._id),quantity:1,unitCostMinor:0}]});zero.po=await confirm(zero.po);const data=ok(await http('POST',`/purchases/${zero.po._id}/receipts`,receiveBody(zero.po)));assert.equal(data.receipt.accountingStatus,'NO_PAYABLE');assert.equal(ok(await http('GET',`/accounts/suppliers/${entity._id}/balance`)).balanceMinor,0);
        });
        await t.test('cutoff equality is historical review, not a new receiving date; post-cutoff existing evidence blocks initialization',async()=>{
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'boundary-supplier',name:'Boundary supplier',roles:['SUPPLIER']},s)),accountId=(await account('SUPPLIER_PAYABLE','AP-BOUNDARY',entity._id))._id;
            const x=await create({supplierId:String(entity._id)});x.po=await confirm(x.po);const receipt=ok(await http('POST',`/purchases/${x.po._id}/receipts`,receiveBody(x.po))).receipt;process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            const preview=ok(await http('GET',`/accounts/suppliers/${entity._id}/cutover-preview`)),body={...opening,requestKey:'boundary-opening',payableAccountId:String(accountId),cutoffAt:receipt.occurredAt,openingBalanceMinor:0,otherOpeningMinor:0,reviews:[{receiptId:receipt._id,unpaidMinor:0,reason:'Paid externally before opening'}],evidenceDigest:preview.evidenceDigest};
            assert.equal((await http('POST',`/accounts/suppliers/${entity._id}/cutover`,{...body,cutoffAt:new Date(+new Date(receipt.occurredAt)-1).toISOString()})).status,409);
            ok(await http('POST',`/accounts/suppliers/${entity._id}/cutover`,body));assert.equal(ok(await http('GET',`/accounts/suppliers/${entity._id}/balance`)).balanceMinor,0);
        });
        await t.test('multi-role customer debt and credit remain separate and unchanged',async()=>{
            const customer=await Customer.create({shopId:a.shop._id,name:'Eagle Customer',phoneNo:'03333333333',address:'Test',remainingMoney:25,storeCreditBalanceMinor:750});
            await accounts.businessTransaction(a.actor,s=>accounts.linkBusinessCustomer(a.actor,String(supplier._id),String(customer._id),0,'LINK EXISTING CUSTOMER',s));
            const before=await Customer.findById(customer._id).lean(),ledgers=await CustomerLedger.countDocuments();assert.equal(ok(await http('GET',base+'/balance')).authoritative,true);assert.deepEqual(await Customer.findById(customer._id).lean(),before);assert.equal(await CustomerLedger.countDocuments(),ledgers);
        });
        await t.test('new receipts at or before cutoff are rejected without inventory changes',async()=>{
            const before=await stock(p),body=receiveBody(po);
            for(const time of [+new Date(cutover.cutoffAt),+new Date(cutover.cutoffAt)-1]){
                t.mock.timers.enable({apis:['Date'],now:time});
                try{assert.equal((await http('POST',`/purchases/${po._id}/receipts`,body)).status,409);assert.equal(await stock(p),before);}finally{t.mock.timers.reset();}
            }
        });
        await t.test('wrong-shop account selection and prior payable activity cannot initialize supplier debt',async()=>{
            const otherAccount=await accounts.businessTransaction(b.actor,s=>accounts.createFinancialAccount(b.actor,{kind:'SUPPLIER_PAYABLE',entityId:String(foreignSupplier._id),code:'OTHER-AP',name:'Other AP'},s));
            const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'isolation-supplier',name:'Isolation supplier',roles:['SUPPLIER']},s)),preview=ok(await http('GET',`/accounts/suppliers/${entity._id}/cutover-preview`));
            const body={...opening,requestKey:'foreign-account-opening',cutoffAt:new Date().toISOString(),payableAccountId:String(otherAccount._id),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:preview.evidenceDigest};assert.equal((await http('POST',`/accounts/suppliers/${entity._id}/cutover`,body)).status,404);
            const local=await account('SUPPLIER_PAYABLE','AP-PRIOR',entity._id),expense=await account('EXPENSE','PRIOR-EXPENSE');
            await accounts.businessTransaction(a.actor,s=>accounts.postBusinessJournal(a.actor,{requestKey:'prior-payable-event',reason:'Existing test foundation posting',occurredAt:new Date().toISOString(),postings:[{accountId:String(expense._id),debitMinor:1,creditMinor:0},{accountId:String(local._id),debitMinor:0,creditMinor:1}]},s));
            assert.equal((await http('POST',`/accounts/suppliers/${entity._id}/cutover`,{...body,payableAccountId:String(local._id)})).status,409);
        });
        await t.test('opening journal failure is atomic and concurrent confirmations create one opening',async()=>{
            const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'atomic-supplier',name:'Atomic supplier',roles:['SUPPLIER']},s)),local=await account('SUPPLIER_PAYABLE','AP-ATOMIC',entity._id),path=`/accounts/suppliers/${entity._id}`;
            const preview=ok(await http('GET',path+'/cutover-preview')),body={...opening,requestKey:'atomic-opening-confirm',payableAccountId:String(local._id),cutoffAt:new Date().toISOString(),openingBalanceMinor:77,otherOpeningMinor:77,reviews:[],evidenceDigest:preview.evidenceDigest};
            const original=BusinessTransaction.create;BusinessTransaction.create=async()=>{throw Error('Injected opening failure');};
            try{assert.equal((await http('POST',path+'/cutover',body)).status,500);}finally{BusinessTransaction.create=original;}
            assert.equal(await SupplierCutover.countDocuments({supplierId:entity._id}),0);assert.equal((await FinancialAccount.findById(local._id)).postingRevision,0);
            const results=await Promise.all([http('POST',path+'/cutover',body),http('POST',path+'/cutover',body)]);assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
            const result=ok(await http('POST',path+'/cutover',body));assert.equal(result.replayed,true);assert.equal(await SupplierCutover.countDocuments({supplierId:entity._id}),1);assert.equal(await BusinessTransaction.countDocuments({'source.kind':'SUPPLIER_OPENING','source.referenceId':result.cutover._id}),1);assert.equal(ok(await http('GET',path+'/balance')).balanceMinor,77);
        });
        await t.test('inactive payable account rejects receiving and suppresses balance until reactivated',async()=>{
            const before=await stock(p);await FinancialAccount.updateOne({_id:ap._id},{$set:{isActive:false}});
            try{assert.equal((await http('GET',base+'/balance')).status,409);assert.equal((await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po))).status,409);assert.equal(await stock(p),before);}finally{await FinancialAccount.updateOne({_id:ap._id},{$set:{isActive:true}});}
        });
        await t.test('missing receipt posting is reported without repair and blocks authoritative balance',async()=>{
            // Deliberate corruption of this disposable database only, to prove fail-closed reads.
            const journal=await BusinessTransaction.findOne({'source.kind':'PURCHASE_RECEIPT','source.referenceId':newReceipt.receipt._id}).lean();
            await BusinessTransaction.collection.deleteOne({_id:journal._id});
            try{const report=ok(await http('GET',base+'/reconciliation'));assert.equal(report.authoritative,false);assert.ok(report.issues.some(i=>/Missing or inconsistent/.test(i.problem)));assert.equal((await http('GET',base+'/balance')).status,409);assert.equal(await BusinessTransaction.countDocuments({_id:journal._id}),0);}finally{await BusinessTransaction.collection.insertOne(journal);}
            assert.equal(ok(await http('GET',base+'/balance')).authoritative,true);
        });
        await t.test('all supplier APIs enforce OWNER, subscription and cross-shop isolation',async()=>{
            for(const user of [cashier,admin])for(const path of ['/balance','/cutover-preview','/reconciliation'])assert.equal((await http('GET',base+path,undefined,user)).status,403);
            assert.equal((await http('POST',base+'/cutover',opening,cashier)).status,403);assert.equal((await http('GET',base+'/balance',undefined,b.user)).status,404);assert.equal((await http('GET',`/accounts/financial/${ap._id}/history`,undefined,b.user)).status,404);
            try{await Shop.updateOne({_id:a.shop._id},{$set:{subscriptionExpiry:new Date(0)}});assert.equal((await http('GET',base+'/balance')).status,403);await Shop.updateOne({_id:a.shop._id},{$set:{isActive:false}});assert.equal((await http('GET',base+'/balance')).body.message,'Shop has been deactivated. Contact administrator.');}finally{await Shop.updateOne({_id:a.shop._id},{$set:{isActive:true,subscriptionExpiry:a.shop.subscriptionExpiry}});}
        });
        await t.test('unreviewed deferred gap after initialization fails closed without rewriting evidence',async()=>{
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;const x=await create();x.po=await confirm(x.po);const receipt=ok(await http('POST',`/purchases/${x.po._id}/receipts`,receiveBody(x.po))).receipt;process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            const report=ok(await http('GET',base+'/reconciliation'));assert.equal(report.authoritative,false);assert.equal(report.balanceMinor,null);assert.ok(report.issues.some(i=>/Unreviewed deferred/.test(i.problem)));assert.equal((await http('GET',base+'/balance')).status,409);assert.equal((await http('GET',`/accounts/financial/${ap._id}/history`)).status,409);const before=await stock(p);assert.equal((await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po))).status,409);assert.equal(await stock(p),before);assert.equal((await GoodsReceipt.findById(receipt._id)).accountingStatus,'DEFERRED');
        });
        await t.test('automatic historical opening records Rs 30000 once and reuses supplier accounts',async()=>{
            const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'automatic-history',name:'Historical supplier',roles:['SUPPLIER']},s));
            const path='/accounts/suppliers/'+entity._id;
            const payable=await account('SUPPLIER_PAYABLE','CUSTOM-AP',entity._id);
            const evidence=ok(await http('GET',path+'/cutover-preview'));
            const body={requestKey:'auto-historical-opening',confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt:new Date().toISOString(),openingBalanceMinor:3000000,otherOpeningMinor:3000000,reviews:[],evidenceDigest:evidence.evidenceDigest,reason:'Owner confirmed historical external debt'};
            assert.equal((await http('POST',path+'/cutover',{...body,payableAccountId:String(payable._id)})).status,400);
            const count=await FinancialAccount.countDocuments();
            assert.equal((await http('POST',path+'/cutover',{...body,evidenceDigest:'stale'})).status,409);
            assert.equal(await FinancialAccount.countDocuments(),count);
            const result=ok(await http('POST',path+'/cutover',body));
            assert.equal(result.cutover.payableAccountId,String(payable._id));
            const journal=await BusinessTransaction.findOne({'source.referenceId':result.cutover._id});
            assert.equal(journal.postings.length,2);
            assert.equal(journal.postings.find(p=>String(p.accountId)===String(payable._id)).creditMinor,3000000);
            assert.equal(journal.postings.find(p=>String(p.accountId)===result.cutover.equityAccountId).debitMinor,3000000);
            assert.equal(ok(await http('POST',path+'/cutover',body)).replayed,true);
            assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':result.cutover._id}),1);
            assert.equal(ok(await http('GET',path+'/balance')).balanceMinor,3000000);
            assert.equal((await http('POST',path+'/cutover',{...body,requestKey:'second-opening-attempt'})).status,409);
        });
        await t.test('automatic openings review unpaid, paid and mixed historical deliveries without reposting',async()=>{
            for(const [index,unpaid,other] of [[1,1234,0],[2,0,0],[3,700,300]]){
                const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'history-'+index,name:'History '+index,roles:['SUPPLIER']},s));
                delete process.env.BUSINESS_ACCOUNTING_ENABLED;
                let purchase=(await create({supplierId:String(entity._id)})).po;purchase=await confirm(purchase);
                const receipt=ok(await http('POST','/purchases/'+purchase._id+'/receipts',receiveBody(purchase))).receipt;
                process.env.BUSINESS_ACCOUNTING_ENABLED='true';
                const path='/accounts/suppliers/'+entity._id,evidence=ok(await http('GET',path+'/cutover-preview'));
                const body={requestKey:'auto-history-'+index,confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt:new Date().toISOString(),openingBalanceMinor:unpaid+other,otherOpeningMinor:other,reviews:[{receiptId:receipt._id,unpaidMinor:unpaid,reason:'Owner checked external payments'}],evidenceDigest:evidence.evidenceDigest,reason:'Owner verified no overlap with additional debt'};
                assert.equal((await http('POST',path+'/cutover',{...body,enrollNewSupplier:true,openingBalanceMinor:0,otherOpeningMinor:0,reviews:[]})).status,409);
                assert.equal((await http('POST',path+'/cutover',{...body,reviews:[]})).status,409);
                const result=ok(await http('POST',path+'/cutover',body));
                assert.equal(ok(await http('GET',path+'/balance')).balanceMinor,unpaid+other);
                assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':result.cutover._id}),unpaid+other?1:0);
                assert.equal((await GoodsReceipt.findById(receipt._id)).accountingStatus,'DEFERRED');
                assert.equal(ok(await http('POST',path+'/cutover',body)).replayed,true);
            }
        });
        await t.test('conflicting and inactive automatic accounts fail closed with rollback',async()=>{
            for(const inactive of [false,true]){
                const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'invalid-'+inactive,name:'Invalid '+inactive,roles:['SUPPLIER']},s));
                const coded=await account(inactive?'PURCHASES_CLEARING':'OPENING_EQUITY','RECEIVED_'+entity._id);
                if(inactive)await FinancialAccount.updateOne({_id:coded._id},{$set:{isActive:false}});
                const path='/accounts/suppliers/'+entity._id,evidence=ok(await http('GET',path+'/cutover-preview'));
                const count=await FinancialAccount.countDocuments();
                assert.equal((await http('POST',path+'/cutover',{requestKey:'bad-auto-'+inactive,confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt:new Date().toISOString(),openingBalanceMinor:3000000,otherOpeningMinor:3000000,reviews:[],evidenceDigest:evidence.evidenceDigest,reason:'Check account conflict'})).status,409);
                assert.equal(await FinancialAccount.countDocuments(),count);assert.equal(await SupplierCutover.countDocuments({supplierId:entity._id}),0);
            }
        });
        await t.test('receiving readiness, full and partial deliveries preserve authoritative payable without payments',async()=>{
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'receiving-prerequisite',name:'Isolated receiving supplier',roles:['SUPPLIER']},s));
            const item=await product(),supplierPath='/accounts/suppliers/'+entity._id;
            let purchase=(await create({supplierId:String(entity._id),items:[{productId:String(item._id),quantity:50,unitCostMinor:65000}]})).po;
            const beforeStock=await stock(item),beforeJournals=await BusinessTransaction.countDocuments();
            purchase=await confirm(purchase);
            assert.equal(await stock(item),beforeStock);assert.equal(await BusinessTransaction.countDocuments(),beforeJournals);
            const receive=(po,quantity,requestKey)=>({expectedRevision:po.revision,requestKey,items:[{productId:String(item._id),quantity}]});
            assert.equal((await http('GET','/purchases/'+purchase._id)).status,200);
            assert.equal(ok(await http('GET','/purchases/'+purchase._id+'/receipts')).entries.length,0);
            const prerequisite=ok(await http('GET',supplierPath+'/reconciliation'));
            assert.equal(prerequisite.authoritative,false);assert.equal(prerequisite.cutover,null);
            const blocked=await http('POST','/purchases/'+purchase._id+'/receipts',receive(purchase,20,'blocked-receiving'));
            assert.equal(blocked.status,409);assert.match(blocked.body.message,/Supplier payable cutover or reconciliation incomplete/);
            assert.equal(await stock(item),beforeStock);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:purchase._id}),0);
            assert.equal(await BusinessTransaction.countDocuments(),beforeJournals);
            // Explicit owner-confirmed zero opening is performed only in this disposable test database.
            const evidence=ok(await http('GET',supplierPath+'/cutover-preview'));
            const setup=ok(await http('POST',supplierPath+'/cutover',{requestKey:'isolated-receiving-opening',confirmation:'CONFIRM SUPPLIER OPENING',enrollNewSupplier:true,cutoffAt:new Date(Date.now()-1000).toISOString(),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:evidence.evidenceDigest,reason:'Isolated owner verified no previous debt or deliveries'}));
            assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':setup.cutover._id}),0);
            const firstBody=receive(purchase,20,'partial-receiving');
            const first=ok(await http('POST','/purchases/'+purchase._id+'/receipts',firstBody));purchase=first.purchaseOrder;
            assert.equal(purchase.status,'PARTIALLY_RECEIVED');assert.equal(purchase.items[0].receivedQuantity,20);
            assert.equal(await stock(item),beforeStock+20);assert.equal(first.receipt.totalMinor,1300000);assert.equal(first.accounting.cashMovementMinor,0);
            assert.equal(ok(await http('GET',supplierPath+'/balance')).balanceMinor,1300000);
            assert.equal(ok(await http('POST','/purchases/'+purchase._id+'/receipts',firstBody)).replayed,true);
            assert.equal(await stock(item),beforeStock+20);assert.equal(await StockLog.countDocuments({purchaseReceiptId:first.receipt._id}),1);
            assert.equal((await http('POST','/purchases/'+purchase._id+'/receipts',receive(purchase,31,'over-receiving'))).status,409);
            assert.equal(await stock(item),beforeStock+20);assert.equal(ok(await http('GET',supplierPath+'/balance')).balanceMinor,1300000);
            const last=ok(await http('POST','/purchases/'+purchase._id+'/receipts',receive(purchase,30,'remaining-receiving')));purchase=last.purchaseOrder;
            assert.equal(purchase.status,'RECEIVED');assert.equal(purchase.items[0].receivedQuantity,50);assert.equal(await stock(item),beforeStock+50);
            assert.equal(ok(await http('GET',supplierPath+'/balance')).balanceMinor,3250000);
            assert.equal(ok(await http('GET','/purchases/'+purchase._id)).purchaseOrder.receivedValueMinor,3250000);
            assert.equal(ok(await http('GET','/purchases/'+purchase._id+'/receipts')).entries.length,2);
            assert.equal((await http('POST','/purchases/'+purchase._id+'/receipts',receive(purchase,1,'after-completion'))).status,409);
            let full=(await create({supplierId:String(entity._id),items:[{productId:String(item._id),quantity:50,unitCostMinor:65000}]})).po;full=await confirm(full);
            const fullBody=receive(full,50,'full-receiving');const fullReceipt=ok(await http('POST','/purchases/'+full._id+'/receipts',fullBody));
            assert.equal(fullReceipt.purchaseOrder.status,'RECEIVED');assert.equal(await stock(item),beforeStock+100);
            assert.equal(ok(await http('POST','/purchases/'+full._id+'/receipts',fullBody)).replayed,true);
            assert.equal(await stock(item),beforeStock+100);assert.equal(ok(await http('GET',supplierPath+'/balance')).balanceMinor,6500000);
            const journals=await BusinessTransaction.find({shopId:a.shop._id,'postings.accountId':setup.cutover.payableAccountId});
            assert.equal(journals.length,3);assert.ok(journals.every(j=>j.source.kind==='PURCHASE_RECEIPT'&&j.postings.length===2));
            assert.ok(journals.every(j=>j.postings.every(p=>[String(setup.cutover.payableAccountId),String(setup.cutover.offsetAccountId)].includes(String(p.accountId)))));
            assert.equal(await mongoose.models.SupplierSettlement.countDocuments({supplierId:entity._id}),0);
        });

    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-supplier-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
