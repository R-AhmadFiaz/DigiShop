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
import {mongodBinary} from './mongod-binary.mjs';
const binary=mongodBinary;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await test('supplier purchasing: actual HTTP and disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-purchase-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','purchaseTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/purchase_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'purchaseTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
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
        let main,first,last;
        await t.test('draft creation is scoped, precise, idempotent and does not create stock or money',async()=>{
            const before=await stock(p),count=await PurchaseOrder.countDocuments();main=await create({items:[{productId:String(p._id),quantity:5,unitCostMinor:1234},{productId:String(q._id),quantity:2,unitCostMinor:99}],createdBy:String(cashier._id),createdByName:'forged'});
            assert.equal(main.po.status,'DRAFT');assert.equal(main.po.totalMinor,6368);assert.equal(main.po.createdBy,String(a.user._id));assert.equal(main.po.createdByName,'owner');assert.equal(main.po.createdByRole,'OWNER');assert.equal(main.po.supplierName,'Eagle Cables');assert.equal(await stock(p),before);assert.equal(await BusinessTransaction.countDocuments(),0);assert.equal(await StockLog.countDocuments(),0);
            const replay=await http('POST','/purchases/',main.body);assert.equal(replay.status,200);assert.equal(replay.body.data.replayed,true);assert.equal(replay.body.data.purchaseOrder._id,main.po._id);assert.equal(await PurchaseOrder.countDocuments(),count+1);
            assert.equal((await http('POST','/purchases/',{...main.body,reference:'CHANGED'})).status,409);
            assert.equal((await http('POST','/purchases/',{...main.body,requestKey:'duplicate-reference'})).status,409);
        });
        await t.test('creation rejects invalid costs, precision, quantities, duplicate items and unrelated suppliers/products',async()=>{
            for(const items of [[{productId:String(p._id),quantity:1.5,unitCostMinor:1}],[{productId:String(p._id),quantity:1,unitCostMinor:1.5}],[{productId:String(p._id),quantity:1,unitCostMinor:-1}],[{productId:String(p._id),quantity:1,unitCostMinor:'10'}],[{productId:String(p._id),quantity:2,unitCostMinor:Number.MAX_SAFE_INTEGER}],[{productId:String(p._id),quantity:1,unitCostMinor:1},{productId:String(p._id),quantity:1,unitCostMinor:1}]])assert.equal((await http('POST','/purchases/',draft({items}))).status,400);
            assert.equal((await http('POST','/purchases/',draft({supplierId:String(company._id)}))).status,400);assert.equal((await http('POST','/purchases/',draft({supplierId:String(foreignSupplier._id)}))).status,404);assert.equal((await http('POST','/purchases/',draft({items:[{productId:String(foreignProduct._id),quantity:1,unitCostMinor:1}]}))).status,404);
        });
        await t.test('confirmation requires draft revision and makes no stock or payable movement',async()=>{
            assert.equal((await http('POST',`/purchases/${main.po._id}/receipts`,receiveBody(main.po))).status,409);
            const before=await stock(p),body={requestKey:'main-confirm',expectedRevision:0};
            const result=await http('POST',`/purchases/${main.po._id}/confirm`,body);assert.equal(result.status,200);main.po=result.body.data.purchaseOrder;assert.equal(main.po.status,'CONFIRMED');assert.equal(main.po.revision,1);assert.equal(main.po.actions[0].createdByName,'owner');assert.equal(await stock(p),before);assert.equal(await BusinessTransaction.countDocuments(),0);
            assert.equal((await http('POST',`/purchases/${main.po._id}/confirm`,body)).body.data.replayed,true);
            assert.equal((await http('POST',`/purchases/${main.po._id}/confirm`,{...body,requestKey:'confirm-twice'})).status,409);
            assert.equal((await http('PATCH',`/accounts/entities/${supplier._id}/roles`,{expectedRevision:0,roles:['COMPANY']})).status,409);
        });
        await t.test('partial delivery increases only actual quantities and records immutable unposted obligation evidence',async()=>{
            const before=await stock(p),body=receiveBody(main.po,2,{createdBy:String(cashier._id),createdByName:'forged',occurredAt:'1970-01-01T00:00:00.000Z',items:[{productId:String(p._id),quantity:2,unitCostMinor:1}]}),start=Date.now();
            assert.equal((await http('POST',`/purchases/${main.po._id}/receipts`,{...body,paidAmount:100})).status,400);assert.equal(await stock(p),before);
            const result=await http('POST',`/purchases/${main.po._id}/receipts`,body);assert.equal(result.status,200,JSON.stringify(result.body));first={body,receipt:result.body.data.receipt};main.po=result.body.data.purchaseOrder;
            assert.equal(main.po.status,'PARTIALLY_RECEIVED');assert.equal(main.po.receivedValueMinor,2468);assert.equal(first.receipt.totalMinor,2468);assert.equal(first.receipt.items[0].unitCostMinor,1234);assert.equal(first.receipt.accountingStatus,'DEFERRED');assert.equal(first.receipt.obligationType,'RECEIVED_GOODS');assert.equal(first.receipt.createdByName,'owner');assert.ok(+new Date(first.receipt.occurredAt)>=start);assert.equal(result.body.data.accounting.supplierBalanceAvailable,false);assert.equal(await stock(p),before+2);assert.equal(await stock(q),10);
            const log=await StockLog.findOne({purchaseReceiptId:first.receipt._id});assert.equal(log.quantityDelta,2);assert.equal(log.reason,'PURCHASE_RECEIVED');assert.equal(log.referenceId,undefined);assert.equal(log.saleType,undefined);assert.equal(log.invoiceNo,'');assert.equal(log.receivingReference,body.reference);assert.equal(+log.createdAt,+new Date(first.receipt.occurredAt));
            assert.equal(await BusinessTransaction.countDocuments(),0);assert.equal(await CustomerLedger.countDocuments(),0);assert.equal(await Customer.countDocuments(),0);
        });
        await t.test('receipt replay and changed payload cannot restock twice',async()=>{
            const before=await stock(p),result=await http('POST',`/purchases/${main.po._id}/receipts`,first.body);assert.equal(result.status,200);assert.equal(result.body.data.replayed,true);assert.equal(result.body.data.receipt._id,first.receipt._id);assert.equal(await stock(p),before);assert.equal(await StockLog.countDocuments({purchaseReceiptId:first.receipt._id}),1);
            assert.equal((await http('POST',`/purchases/${main.po._id}/receipts`,{...first.body,items:[{productId:String(p._id),quantity:1}]})).status,409);
            const doc=await GoodsReceipt.findById(first.receipt._id);doc.supplierName='tamper';await assert.rejects(doc.save(),/immutable/);await assert.rejects(GoodsReceipt.updateOne({_id:doc._id},{$set:{totalMinor:1}}),/immutable/);await assert.rejects(GoodsReceipt.deleteMany({_id:doc._id}),/immutable/);
        });
        await t.test('remaining delivery retains agreed historical costs and completes without changing selling/current cost prices',async()=>{
            await Product.updateOne({_id:p._id},{$set:{costPrice:99,name:'Renamed product'}});
            assert.equal((await http('POST',`/purchases/${main.po._id}/receipts`,receiveBody(main.po,4))).status,409);
            assert.equal((await http('POST',`/purchases/${main.po._id}/receipts`,receiveBody(main.po,1,{expectedRevision:1}))).status,409);
            const body=receiveBody(main.po,3,{items:[{productId:String(p._id),quantity:3},{productId:String(q._id),quantity:2}]}),result=await http('POST',`/purchases/${main.po._id}/receipts`,body);assert.equal(result.status,200);last=result.body.data.receipt;main.po=result.body.data.purchaseOrder;
            assert.equal(main.po.status,'RECEIVED');assert.equal(main.po.receivedValueMinor,6368);assert.equal(last.totalMinor,3900);assert.ok(last.items.some(r=>r.productId===String(p._id)&&r.unitCostMinor===1234&&r.name===first.receipt.items[0].name));assert.equal(await stock(p),15);assert.equal(await stock(q),12);assert.equal((await Product.findById(p._id)).costPrice,99);assert.equal((await Product.findById(p._id)).retailPrice,9);assert.equal((await http('POST',`/purchases/${main.po._id}/receipts`,receiveBody(main.po))).status,409);
        });
        await t.test('competing receipt revisions cannot over-receive and identical concurrent submissions commit once',async()=>{
            let po=await confirm((await create({items:[{productId:String(p._id),quantity:2,unitCostMinor:5}]})).po),before=await stock(p);
            const responses=await Promise.all([http('POST',`/purchases/${po._id}/receipts`,receiveBody(po)),http('POST',`/purchases/${po._id}/receipts`,receiveBody(po))]);assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,1);assert.equal(await stock(p),before+1);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:po._id}),1);
            po=(await http('GET',`/purchases/${po._id}`)).body.data.purchaseOrder;before=await stock(p);const body=receiveBody(po),twice=await Promise.all([http('POST',`/purchases/${po._id}/receipts`,body),http('POST',`/purchases/${po._id}/receipts`,body)]);assert.ok(twice.some(r=>r.status===200));assert.equal((await http('POST',`/purchases/${po._id}/receipts`,body)).body.data.replayed,true);assert.equal(await stock(p),before+1);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:po._id}),2);
        });
        await t.test('late database failure rolls back receipt, stock, logs and purchase revision; identical retry succeeds',async()=>{
            const po=await confirm((await create()).po),body=receiveBody(po),before=await stock(p),logs=await StockLog.countDocuments();
            await mongoose.connection.db.command({collMod:PurchaseOrder.collection.name,validator:{reference:{$ne:po.reference}}});
            try{assert.equal((await http('POST',`/purchases/${po._id}/receipts`,body)).status,500);}finally{await mongoose.connection.db.command({collMod:PurchaseOrder.collection.name,validator:{}});}
            assert.equal(await stock(p),before);assert.equal(await StockLog.countDocuments(),logs);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:po._id}),0);assert.equal((await PurchaseOrder.findById(po._id)).revision,1);assert.equal((await http('POST',`/purchases/${po._id}/receipts`,body)).status,200);assert.equal(await stock(p),before+1);
        });
        await t.test('duplicate receiving references and unknown products cannot leave an extra stock movement',async()=>{
            let po=await confirm((await create()).po),body=receiveBody(po,1,{reference:'GR-UNIQUE'}),first=await http('POST',`/purchases/${po._id}/receipts`,body);assert.equal(first.status,200);po=first.body.data.purchaseOrder;
            const before=await stock(p),logs=await StockLog.countDocuments();
            assert.equal((await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po,1,{reference:'GR-UNIQUE'}))).status,409);
            assert.equal((await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po,1,{items:[{productId:String(foreignProduct._id),quantity:1}]}))).status,400);
            assert.equal(await stock(p),before);assert.equal(await StockLog.countDocuments(),logs);assert.equal((await PurchaseOrder.findById(po._id)).revision,po.revision);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:po._id}),1);
        });
        await t.test('a supplier/customer identity retains separate pre-existing debt and store credit without new cash or payable balances',async()=>{
            const buyer=await Customer.create({shopId:a.shop._id,name:'Dual role',phoneNo:'03333333333',remainingMoney:25,storeCreditBalanceMinor:500});
            const ref=new mongoose.Types.ObjectId();await CustomerLedger.create([{shopId:a.shop._id,customerId:buyer._id,referenceId:ref,createdBy:a.user._id,invoiceNo:'LEGACY-TEST',description:'PURCHASE',amount:25,balanceType:'DEBT'},{shopId:a.shop._id,customerId:buyer._id,referenceId:ref,adjustmentId:new mongoose.Types.ObjectId(),createdBy:a.user._id,invoiceNo:'LEGACY-TEST',description:'CREDIT_ISSUED',amount:5,amountMinor:500,balanceType:'CREDIT'}]);
            const entity=await accounts.businessTransaction(a.actor,s=>accounts.createBusinessEntity(a.actor,{key:'dual-role',customerId:String(buyer._id),roles:['CUSTOMER','SUPPLIER']},s));
            const before=JSON.stringify(await Customer.findById(buyer._id).lean()),ledgerCount=await CustomerLedger.countDocuments(),po=await confirm((await create({supplierId:String(entity._id)})).po);
            const received=await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po));assert.equal(received.status,200);assert.equal(received.body.data.receipt.supplierId,String(entity._id));assert.equal(received.body.data.receipt.supplierName,'Dual role');assert.equal(received.body.data.accounting.supplierBalanceAvailable,false);assert.equal(JSON.stringify(await Customer.findById(buyer._id).lean()),before);assert.equal(await CustomerLedger.countDocuments(),ledgerCount);assert.equal(await BusinessTransaction.countDocuments(),0);
        });
        await t.test('cancelled outstanding quantities never undo received stock or unposted obligation records',async()=>{
            let po=await confirm((await create()).po),result=await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po));po=result.body.data.purchaseOrder;
            const before=await stock(p),body={requestKey:'cancel-remainder',expectedRevision:po.revision,reason:'No remaining delivery needed'},cancel=await http('POST',`/purchases/${po._id}/cancel`,body);assert.equal(cancel.status,200);assert.equal(cancel.body.data.purchaseOrder.status,'CANCELLED');assert.equal(cancel.body.data.purchaseOrder.receivedValueMinor,1234);assert.equal(await stock(p),before);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:po._id}),1);assert.equal((await http('POST',`/purchases/${po._id}/cancel`,body)).body.data.replayed,true);assert.equal((await http('POST',`/purchases/${po._id}/receipts`,receiveBody(cancel.body.data.purchaseOrder))).status,409);
            assert.equal((await http('POST',`/purchases/${main.po._id}/cancel`,{requestKey:'cancel-complete',expectedRevision:main.po.revision,reason:'Invalid'})).status,409);
        });
        await t.test('enabled test accounting fails closed rather than creating unbalanced supplier postings',async()=>{
            const po=await confirm((await create()).po),body=receiveBody(po),before=await stock(p);process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            try{const response=await http('POST',`/purchases/${po._id}/receipts`,body);assert.equal(response.status,409);assert.match(response.body.message,/payable cutover/);assert.equal(await stock(p),before);assert.equal(await GoodsReceipt.countDocuments({purchaseOrderId:po._id}),0);assert.equal((await PurchaseOrder.findById(po._id)).revision,1);assert.equal(await BusinessTransaction.countDocuments(),0);process.env.NODE_ENV='production';assert.equal((await http('POST',`/purchases/${po._id}/receipts`,body)).status,200);}finally{delete process.env.BUSINESS_ACCOUNTING_ENABLED;process.env.NODE_ENV='test';}
        });
        await t.test('history uses shop filters, stable pagination and preserved actor snapshots',async()=>{
            await User.updateOne({_id:a.user._id},{$set:{username:'changed owner'}});
            try{const list=await http('GET','/purchases/'+ '?q='+main.po.reference+'&limit=1');assert.equal(list.status,200);assert.equal(list.body.data.entries.length,1);assert.ok(list.body.data.entries[0].reference.includes(main.po.reference));const detail=await http('GET',`/purchases/${main.po._id}`);assert.equal(detail.body.data.purchaseOrder.createdByName,'owner');const history=await http('GET',`/purchases/${main.po._id}/receipts?limit=1`);assert.equal(history.status,200);assert.equal(history.body.data.pagination.recordCount,2);assert.equal(history.body.data.entries[0]._id,last._id);assert.equal(history.body.data.entries[0].createdByName,'owner');assert.equal((await http('GET',`/purchases/${main.po._id}/receipts?limit=1&page=2`)).body.data.entries[0]._id,first.receipt._id);}finally{await User.updateOne({_id:a.user._id},{$set:{username:'owner'}});}
            assert.equal((await http('GET','/purchases/?q=%5B')).status,200);assert.equal((await http('GET','/purchases/?limit=101')).status,400);assert.equal((await http('GET','/purchases/?status=BOGUS')).status,400);assert.equal((await http('GET','/purchases/?from=invalid')).status,400);assert.equal((await http('GET','/purchases/not-an-id')).status,400);assert.equal((await http('GET','/purchases/?supplierId='+foreignSupplier._id)).body.data.entries.length,0);
        });
        await t.test('OWNER-only routes and current-shop membership prevent unauthorized purchasing and receiving',async()=>{
            const paths=[['GET','/purchases/'],['POST','/purchases/',draft()],['GET',`/purchases/${main.po._id}`],['POST',`/purchases/${main.po._id}/confirm`,{}],['POST',`/purchases/${main.po._id}/cancel`,{}],['POST',`/purchases/${main.po._id}/receipts`,{}],['GET',`/purchases/${main.po._id}/receipts`]];
            for(const user of [cashier,admin])for(const [method,url,body] of paths)assert.equal((await http(method,url,body,user)).status,403);
            for(const [method,url] of paths.filter(row=>row[1]!=='/purchases/'))assert.equal((await http(method,url,method==='POST'?(url.endsWith('/receipts')?receiveBody(main.po):{requestKey:'foreign-action',expectedRevision:main.po.revision,reason:'Not my shop'}):undefined,b.user)).status,404);
            assert.equal((await http('GET','/purchases/',undefined,null)).status,400);
            const before=await stock(p);try{
                await Shop.updateOne({_id:a.shop._id},{$set:{subscriptionExpiry:new Date(0)}});for(const [method,url,body] of paths)assert.equal((await http(method,url,body)).status,403);
                await Shop.updateOne({_id:a.shop._id},{$set:{isActive:false}});for(const [method,url,body] of paths)assert.equal((await http(method,url,body)).body.message,'Shop has been deactivated. Contact administrator.');
                assert.equal(await stock(p),before);
            }finally{await Shop.updateOne({_id:a.shop._id},{$set:{isActive:true,subscriptionExpiry:a.shop.subscriptionExpiry}});}
        });
        await t.test('corrections: automatic references skip legacy collisions and exact retries retain numbers and notes',async()=>{
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            await create({reference:'PO-AUTO-1'});
            const body=draft({reference:undefined,notes:'Owner purchase note',supplierDocumentNo:'INV / 123'}),result=await http('POST','/purchases/',body);assert.equal(result.status,200,JSON.stringify(result.body));let po=result.body.data.purchaseOrder;
            assert.match(po.reference,/^PO-[1-9][0-9]*$/);assert.equal(po.notes,'Owner purchase note');assert.equal(po.supplierDocumentNo,'INV / 123');
            const counter=(await Shop.findById(a.shop._id)).referenceCounters.get('PO');assert.equal((await http('POST','/purchases/',body)).body.data.purchaseOrder.reference,po.reference);assert.equal((await Shop.findById(a.shop._id)).referenceCounters.get('PO'),counter);
            po=await confirm(po);const legacy=await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po,1,{reference:'GR-AUTO-1'}));assert.equal(legacy.status,200);po=legacy.body.data.purchaseOrder;
            const delivery=receiveBody(po,1,{reference:undefined,notes:'Delivery verified',supplierDocumentNo:'CHALLAN-7'}),received=await http('POST',`/purchases/${po._id}/receipts`,delivery);assert.equal(received.status,200,JSON.stringify(received.body));
            assert.match(received.body.data.receipt.reference,/^GR-[1-9][0-9]*$/);assert.equal(received.body.data.receipt.notes,'Delivery verified');
            assert.equal((await http('POST',`/purchases/${po._id}/receipts`,delivery)).body.data.receipt._id,received.body.data.receipt._id);
            assert.equal((await StockLog.findOne({purchaseReceiptId:received.body.data.receipt._id})).receivingReference,received.body.data.receipt.reference);
            assert.equal((await http('POST','/purchases/',{...body,notes:'Changed'})).status,409);
            for(const extra of [{notes:123},{notes:'x'.repeat(501)},{supplierDocumentNo:'x'.repeat(101)}])assert.equal((await http('POST','/purchases/',draft(extra))).status,400);
        });
        await t.test('corrections: concurrent automatic numbering is unique and failed receiving rolls its counter back',async()=>{
            const bodies=[draft({reference:undefined}),draft({reference:undefined})],results=await Promise.all(bodies.map(body=>http('POST','/purchases/',body)));
            assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
            const ids=[];for(const body of bodies){const r=await http('POST','/purchases/',body);assert.equal(r.status,200);ids.push(r.body.data.purchaseOrder.reference);}assert.equal(new Set(ids).size,2);
            let po=(await create({reference:undefined})).po;po=await confirm(po);const before=(await Shop.findById(a.shop._id)).referenceCounters?.get('GR'),beforeStock=await stock(p),original=StockLog.create;
            StockLog.create=async()=>{throw Error('Injected reference rollback');};try{assert.equal((await http('POST',`/purchases/${po._id}/receipts`,receiveBody(po,1,{reference:undefined}))).status,500);}finally{StockLog.create=original;}
            assert.equal((await Shop.findById(a.shop._id)).referenceCounters?.get('GR'),before);assert.equal(await stock(p),beforeStock);
        });
        await t.test('corrections: role editing preserves identity and explicit company-brand products are scoped and live',async()=>{
            const path='/accounts/entities/'+company._id,body={expectedRevision:company.revision,roles:['COMPANY','SUPPLIER']};
            assert.equal((await http('PATCH',path+'/roles',body)).status,200);assert.equal((await http('PATCH',path+'/roles',body)).status,409);
            assert.equal((await http('GET',path)).body.data._id,String(company._id));
            const created=await http('POST','/accounts/brands',{name:'Eagle',entityIds:[String(company._id)]});assert.equal(created.status,200);const brand=created.body.data;
            assert.equal((await http('GET',path+'/products')).body.data.entries.length,0);
            assert.equal((await http('PUT','/accounts/products/'+p._id+'/brand',{brandId:String(brand._id)})).status,200);
            const rows=(await http('GET',path+'/products')).body.data;assert.equal(rows.entries.length,1);assert.equal(rows.entries[0].stockQuantity,await stock(p));assert.equal(rows.sales.status,'UNAVAILABLE');
            await Product.updateOne({_id:p._id},{$set:{brand:'Different'}});try{assert.equal((await http('GET',path+'/products')).body.data.entries.length,0);}finally{await Product.updateOne({_id:p._id},{$set:{brand:'Eagle'}});}
            for(const user of [cashier,admin]){assert.equal((await http('GET',path+'/products',undefined,user)).status,403);assert.equal((await http('PATCH',path+'/roles',{...body,expectedRevision:1},user)).status,403);}
            assert.equal((await http('GET',path+'/products',undefined,b.user)).status,404);assert.equal((await http('GET',path+'/products?limit=101')).status,400);
            assert.equal((await Product.findById(p._id)).brand,'Eagle');assert.equal((await http('GET',path)).body.data.roles.includes('SUPPLIER'),true);
        });
        await t.test('permanent shop deletion also removes new purchasing records and preserves other shops and ADMIN',async()=>{
            const other=await http('POST','/purchases/',draft({reference:'OTHER-PO',supplierId:String(foreignSupplier._id),items:[{productId:String(foreignProduct._id),quantity:1,unitCostMinor:1}]}),b.user);assert.equal(other.status,200);
            await Shop.updateOne({_id:a.shop._id},{$set:{isActive:false}});assert.equal((await http('DELETE',`/admin/shops/${a.shop._id}`,undefined,admin)).status,200);assert.equal(await GoodsReceipt.countDocuments({shopId:a.shop._id}),0);assert.equal(await PurchaseOrder.countDocuments({shopId:a.shop._id}),0);assert.equal(await PurchaseOrder.countDocuments({shopId:b.shop._id}),1);assert.ok(await User.findById(admin._id));assert.ok(await Shop.findById(b.shop._id));
        });
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-purchase-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
