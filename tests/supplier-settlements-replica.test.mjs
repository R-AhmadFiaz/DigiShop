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

await test('supplier settlements: actual HTTP and disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-settlement-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','settlementTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/settlement_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'settlementTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
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
        const {SupplierSettlement}=await import('../dist/models/supplierSettlement.model.js');
        const cash=await account('CASH','CASH'),bank=await account('BANK','BANK'),control=await account('SETTLEMENT_CLEARING','CASH-CONTROL');
        const tx=work=>accounts.businessTransaction(a.actor,work);
        const balance=async()=>ok(await http('GET',base+'/balance')).balanceMinor;
        const funds=async account=>tx(s=>accounts.getAccountBalance(a.actor,String(account._id),s));
        function payment(amountMinor,account=cash,extra={}){const seq=++n;return {requestKey:'supplier-payment-'+seq,reference:'PAY-'+seq,occurredAt:new Date().toISOString(),reason:'Payment actually made to supplier',amountMinor,accountId:String(account._id),...extra};}
        function returned(receipt,quantity=1,extra={}){const seq=++n;return {requestKey:'supplier-return-'+seq,reference:'RET-'+seq,occurredAt:new Date().toISOString(),reason:'Goods accepted back by supplier as a payable credit',receiptId:receipt._id,items:[{productId:String(p._id),quantity}],...extra};}
        function reversal(){const seq=++n;return {requestKey:'supplier-reversal-'+seq,reference:'REV-'+seq,occurredAt:new Date().toISOString(),reason:'Confirmed actual funds or goods restored',confirmation:'CONFIRM SUPPLIER REVERSAL'};}
        let receipt,partial,full,firstReturn,secondReturn;
        await t.test('prepared cash/bank and supplier cutovers permit receiving, but no fake historical supplier payments',async()=>{
            const cutoffAt=new Date(Date.now()-10000).toISOString();
            for(const [selected,amountMinor] of [[cash,10000],[bank,5000]])await tx(s=>accounts.recordOpeningBalance(a.actor,{requestKey:'opening-'+selected._id,reason:'Owner-confirmed physical funds',occurredAt:cutoffAt,accountId:String(selected._id),equityAccountId:String(equity._id),amountMinor,confirmation:'CONFIRM OPENING BALANCE'},s));
            await tx(s=>accounts.prepareCashBankCutover(a.actor,{clearingAccountId:String(control._id),cutoffAt,accounts:[{accountId:String(cash._id),confirmedBalanceMinor:10000},{accountId:String(bank._id),confirmedBalanceMinor:5000}],confirmation:'PREPARE CASH BANK CUTOVER'},s));
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';const preview=ok(await http('GET',base+'/cutover-preview'));
            ok(await http('POST',base+'/cutover',{requestKey:'supplier-zero-opening',confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt:new Date(Date.now()-1000).toISOString(),payableAccountId:String(ap._id),offsetAccountId:String(offset._id),equityAccountId:String(equity._id),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:preview.evidenceDigest,reason:'No historical outstanding supplier debt'}));
            const x=await create({items:[{productId:String(p._id),quantity:10,unitCostMinor:100}]});x.po=await confirm(x.po);receipt=ok(await http('POST',`/purchases/${x.po._id}/receipts`,receiveBody(x.po,10))).receipt;
            assert.equal(await balance(),1000);assert.equal(await stock(p),20);assert.equal(await SupplierSettlement.countDocuments(),0);
        });
        await t.test('partial supplier cash payment decreases payable and cash through one balanced source journal',async()=>{
            partial={body:payment(200)};partial.event=ok(await http('POST',base+'/payments',partial.body)).settlement;
            assert.equal(await balance(),800);assert.equal((await funds(cash)).balanceMinor,9800);assert.equal(partial.event.createdByName,'owner');assert.equal(partial.event.createdByRole,'OWNER');assert.equal(partial.event.amountMinor,200);
            const journal=await BusinessTransaction.findOne({'source.kind':'SUPPLIER_PAYMENT','source.referenceId':partial.event._id});assert.equal(journal.postings.find(p=>String(p.accountId)===String(ap._id)).debitMinor,200);assert.equal(journal.postings.find(p=>String(p.accountId)===String(cash._id)).creditMinor,200);
            assert.equal(journal.postings.reduce((n,p)=>n+p.debitMinor-p.creditMinor,0),0);
        });
        await t.test('duplicate keys and payment references cannot pay twice; exact retry is stable',async()=>{
            const count=await SupplierSettlement.countDocuments();assert.equal(ok(await http('POST',base+'/payments',partial.body)).replayed,true);assert.equal(await SupplierSettlement.countDocuments(),count);assert.equal(await balance(),800);
            assert.equal((await http('POST',base+'/payments',{...partial.body,amountMinor:201})).status,409);assert.equal((await http('POST',base+'/payments',{...partial.body,requestKey:'duplicate-bank-reference'})).status,409);assert.equal((await funds(cash)).balanceMinor,9800);
            await assert.rejects(SupplierSettlement.updateOne({_id:partial.event._id},{$set:{amountMinor:1}}),/immutable/);
            const journal=await BusinessTransaction.findOne({'source.kind':'SUPPLIER_PAYMENT','source.referenceId':partial.event._id});
            await assert.rejects(tx(s=>accounts.reverseBusinessJournal(a.actor,{transactionId:String(journal._id),requestKey:'generic-supplier-reverse',occurredAt:new Date().toISOString(),reason:'Unsafe standalone reversal'},s)),/verified settlement/);
        });
        await t.test('explicit bank payments work; validation, overpayment and unprepared accounts fail before writing',async()=>{
            ok(await http('POST',base+'/payments',payment(100,bank)));assert.equal(await balance(),700);assert.equal((await funds(bank)).balanceMinor,4900);
            const unprepared=await account('CASH','UNPREPARED');
            for(const amount of [0,-1,1.1,'10',701])assert.ok([400,409].includes((await http('POST',base+'/payments',payment(amount))).status));
            assert.equal((await http('POST',base+'/payments',payment(1,unprepared))).status,409);assert.equal((await http('POST',base+'/payments',payment(1,cash,{allocations:[]}))).status,400);
        });
        await t.test('partial and multiple original-cost returns reduce stock and payable but never increase cash',async()=>{
            await Product.updateOne({_id:p._id},{$set:{costPrice:999}});const before=(await funds(cash)).balanceMinor;
            firstReturn={body:returned(receipt,2)};firstReturn.event=ok(await http('POST',base+'/returns',firstReturn.body)).settlement;
            secondReturn=ok(await http('POST',base+'/returns',returned(receipt,1))).settlement;
            assert.equal(firstReturn.event.amountMinor,200);assert.equal(firstReturn.event.items[0].unitCostMinor,100);assert.equal(await balance(),400);assert.equal(await stock(p),17);assert.equal((await funds(cash)).balanceMinor,before);
            const log=await StockLog.findOne({supplierSettlementId:firstReturn.event._id});assert.equal(log.quantityDelta,-2);assert.equal(String(log.sourceReceiptId),receipt._id);assert.equal(log.reason,'PURCHASE_RETURN');assert.equal(log.purchaseReceiptId,undefined);
            assert.equal(ok(await http('POST',base+'/returns',firstReturn.body)).replayed,true);assert.equal(await stock(p),17);
        });
        await t.test('over-return and insufficient stock leave inventory, liability and audit unchanged',async()=>{
            assert.equal((await http('POST',base+'/returns',returned(receipt,8))).status,409);const prior=await stock(p),events=await SupplierSettlement.countDocuments();
            await Product.updateOne({_id:p._id},{$set:{stockQuantity:0}});try{assert.equal((await http('POST',base+'/returns',returned(receipt,1))).status,409);assert.equal(await SupplierSettlement.countDocuments(),events);assert.equal(await balance(),400);}finally{await Product.updateOne({_id:p._id},{$set:{stockQuantity:prior}});}
        });
        await t.test('full payment followed by return creates separate credit without recording cash received',async()=>{
            full=ok(await http('POST',base+'/payments',payment(400))).settlement;assert.equal(await balance(),0);assert.equal((await funds(cash)).balanceMinor,9400);
            const result=ok(await http('POST',base+'/returns',returned(receipt,1))).settlement;assert.equal((ok(await http('GET',base+'/balance'))).creditMinor,100);assert.equal(await stock(p),16);ok(await http('POST',base+'/settlements/'+result._id+'/reverse',reversal()));assert.equal(await stock(p),17);assert.equal((ok(await http('GET',base+'/balance'))).creditMinor,0);assert.equal((await funds(cash)).balanceMinor,9400);assert.equal((await http('POST',base+'/payments',payment(1))).status,409);
        });
        await t.test('payment correction is an explicitly confirmed immutable inverse, not history rewriting',async()=>{
            const body=reversal();assert.equal((await http('POST',base+`/settlements/${full._id}/reverse`,{...body,confirmation:'NO'})).status,400);
            const event=ok(await http('POST',base+`/settlements/${full._id}/reverse`,body)).settlement;assert.equal(event.reversalOf,full._id);assert.equal(await balance(),400);assert.equal((await funds(cash)).balanceMinor,9800);
            assert.equal(ok(await http('POST',base+`/settlements/${full._id}/reverse`,body)).replayed,true);assert.equal((await http('POST',base+`/settlements/${full._id}/reverse`,reversal())).status,409);assert.equal((await http('POST',base+`/settlements/${event._id}/reverse`,reversal())).status,409);
        });
        await t.test('return reversal restores exact stock and liability and releases original receipt eligibility',async()=>{
            const original=await SupplierSettlement.findById(firstReturn.event._id).lean(),body=reversal();ok(await http('POST',base+`/settlements/${firstReturn.event._id}/reverse`,body));assert.equal(await stock(p),19);assert.equal(await balance(),600);assert.deepEqual(await SupplierSettlement.findById(firstReturn.event._id).lean(),original);
            ok(await http('POST',base+'/returns',returned(receipt,1)));assert.equal(await stock(p),18);assert.equal(await balance(),500);
        });
        await t.test('concurrent full-pay requests cannot exceed payable or double-spend cash',async()=>{
            const outstanding=await balance(),before=(await funds(cash)).balanceMinor,bodies=[payment(outstanding),payment(outstanding)],results=await Promise.all(bodies.map(body=>http('POST',base+'/payments',body)));
            assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal(await balance(),0);assert.equal((await funds(cash)).balanceMinor,before-outstanding);
            const event=results.find(r=>r.status===200).body.data.settlement;ok(await http('POST',base+`/settlements/${event._id}/reverse`,reversal()));assert.equal(await balance(),outstanding);
        });
        await t.test('concurrent duplicate returns commit one stock movement and one journal',async()=>{
            const before=await stock(p),due=await balance(),body=returned(receipt,1),results=await Promise.all([http('POST',base+'/returns',body),http('POST',base+'/returns',body)]);assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
            const event=ok(await http('POST',base+'/returns',body)).settlement;assert.equal(await stock(p),before-1);assert.equal(await balance(),due-100);assert.equal(await StockLog.countDocuments({supplierSettlementId:event._id}),1);assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':event._id}),1);
        });
        await t.test('late journal failures roll back payment and return documents, cash, payable, stock and logs',async()=>{
            const before={cash:(await funds(cash)).balanceMinor,due:await balance(),stock:await stock(p),events:await SupplierSettlement.countDocuments(),logs:await StockLog.countDocuments(),journals:await BusinessTransaction.countDocuments()};
            const original=BusinessTransaction.create;BusinessTransaction.create=async()=>{throw Error('Injected supplier journal failure');};
            try{assert.equal((await http('POST',base+'/payments',payment(10))).status,500);assert.equal((await http('POST',base+'/returns',returned(receipt,1))).status,500);}finally{BusinessTransaction.create=original;}
            assert.equal((await funds(cash)).balanceMinor,before.cash);assert.equal(await balance(),before.due);assert.equal(await stock(p),before.stock);assert.equal(await SupplierSettlement.countDocuments(),before.events);assert.equal(await StockLog.countDocuments(),before.logs);assert.equal(await BusinessTransaction.countDocuments(),before.journals);
        });
        await t.test('cash cannot become negative even with sufficient supplier payable',async()=>{
            const current=(await funds(cash)).balanceMinor;await tx(s=>accounts.transferCashBank(a.actor,{fromAccountId:String(cash._id),toAccountId:String(bank._id),amountMinor:current-1,occurredAt:new Date().toISOString(),requestKey:'move-cash-to-bank',reason:'Explicit test transfer'},s));
            assert.equal((await http('POST',base+'/payments',payment(2))).status,409);assert.equal((await funds(cash)).balanceMinor,1);
        });
        await t.test('zero-cost goods can be returned and reversed without fake monetary journals',async()=>{
            const x=await create({items:[{productId:String(p._id),quantity:1,unitCostMinor:0}]});x.po=await confirm(x.po);const zero=ok(await http('POST',`/purchases/${x.po._id}/receipts`,receiveBody(x.po))).receipt,before=await balance(),event=ok(await http('POST',base+'/returns',returned(zero,1))).settlement;
            assert.equal(event.amountMinor,0);assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':event._id}),0);ok(await http('POST',base+`/settlements/${event._id}/reverse`,reversal()));assert.equal(await balance(),before);
        });
        await t.test('full receipt return closes all eligible units without altering original delivery history',async()=>{
            const prior=await balance(),before=await stock(p),x=await create({items:[{productId:String(p._id),quantity:2,unitCostMinor:155}]});x.po=await confirm(x.po);
            const original=ok(await http('POST',`/purchases/${x.po._id}/receipts`,receiveBody(x.po,2))).receipt,snapshot=await GoodsReceipt.findById(original._id).lean();assert.equal(await balance(),prior+310);
            ok(await http('POST',base+'/returns',returned(original,2)));assert.equal(await balance(),prior);assert.equal(await stock(p),before);assert.deepEqual(await GoodsReceipt.findById(original._id).lean(),snapshot);assert.equal((await PurchaseOrder.findById(x.po._id)).status,'RECEIVED');assert.equal((await http('POST',base+'/returns',returned(original,1))).status,409);
        });
        await t.test('different concurrent return requests cannot claim the same final eligible unit',async()=>{
            const x=await create({items:[{productId:String(p._id),quantity:1,unitCostMinor:1}]});x.po=await confirm(x.po);const original=ok(await http('POST',`/purchases/${x.po._id}/receipts`,receiveBody(x.po))).receipt,before=await stock(p),due=await balance();
            const results=await Promise.all([http('POST',base+'/returns',returned(original)),http('POST',base+'/returns',returned(original))]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal(await stock(p),before-1);assert.equal(await balance(),due-1);assert.equal(await SupplierSettlement.countDocuments({receiptId:original._id,kind:'RETURN'}),1);
        });
        await t.test('statements and settlement history show sources, actors, cash directions, reversals and pagination',async()=>{
            const history=ok(await http('GET',base+'/settlements?limit=2'));assert.equal(history.entries.length,2);assert.equal(history.allocation,'UNAPPLIED_SUPPLIER_LEVEL');assert.equal(history.entries[0].createdByName,'owner');assert.equal(history.entries[0].requestHash,undefined);
            const list=ok(await http('GET',`/accounts/financial/${ap._id}/history?type=SUPPLIER_PAYMENT&q=${partial.event.reference}`));assert.equal(list.pagination.recordCount,1);assert.equal(list.transactions[0].sourceDocument.reference,partial.event.reference);assert.equal(list.transactions[0].postings.find(p=>p.account.kind==='CASH').moneyOutMinor,200);
            const global=ok(await http('GET',`/accounts/transactions?q=${partial.event.reference}&type=SUPPLIER_PAYMENT`));assert.equal(global.pagination.recordCount,1);const detail=ok(await http('GET',`/accounts/transactions/${global.entries[0].eventId}`));assert.equal(detail.transaction.businessAction.amountMinor,200);
            const all=ok(await http('GET',`/accounts/financial/${ap._id}/history?limit=100`));assert.equal(all.rangeClosingBalanceMinor,await balance());assert.equal(all.transactions.at(-1).runningBalanceMinor,await balance());
            const reversed=ok(await http('GET',`/accounts/transactions?type=SUPPLIER_REVERSAL&limit=100`)).entries.find(e=>e.sourceDocument.reversalOf===full._id);
            const reversedDetail=ok(await http('GET',`/accounts/transactions/${reversed.eventId}`));assert.equal(reversedDetail.originalTransaction.sourceDocument.settlementId,full._id);assert.equal(String(reversedDetail.transaction.reversalOf),String(reversedDetail.originalTransaction.eventId));assert.ok(reversedDetail.originalTransaction.reversedBy.some(e=>e._id===reversed.eventId));
            const ranged=ok(await http('GET',`/accounts/financial/${ap._id}/history?from=${partial.event.occurredAt}&to=${full.occurredAt}`));assert.equal(ranged.rangeOpeningBalanceMinor,1000);assert.equal(ranged.rangeClosingBalanceMinor,400);
            const cashReconciliation=ok(await http('GET',`/accounts/reconciliation?clearingAccountId=${control._id}`));assert.equal(cashReconciliation.supplierReconciliation.length,1);assert.equal(cashReconciliation.supplierReconciliation[0].authoritative,true);assert.equal(cashReconciliation.orphanedSupplierCashJournals.length,0);
            assert.equal((await http('GET',base+'/settlements?limit=101')).status,400);assert.equal((await http('GET',base+'/settlements?from=invalid')).status,400);
        });
        await t.test('OWNER-only permissions, cross-shop accounts and subscriptions are enforced',async()=>{
            const paths=[['POST',base+'/payments',payment(1)],['POST',base+'/returns',returned(receipt)],['POST',base+`/settlements/${partial.event._id}/reverse`,reversal()],['GET',base+'/settlements']];
            for(const user of [cashier,admin])for(const [method,path,body] of paths)assert.equal((await http(method,path,body,user)).status,403);
            for(const [method,path,body] of paths)assert.equal((await http(method,path,body,b.user)).status,404);
            const foreign=await accounts.businessTransaction(b.actor,s=>accounts.createFinancialAccount(b.actor,{kind:'CASH',name:'Other cash',code:'OTHER-CASH'},s));assert.equal((await http('POST',base+'/payments',payment(1,foreign))).status,404);
            assert.equal((await http('POST',base+'/returns',returned(receipt,1,{receiptId:String(new mongoose.Types.ObjectId())}))).status,404);assert.equal((await http('POST',base+'/returns',returned(receipt,1,{cashRefundMinor:0}))).status,400);
            try{await Shop.updateOne({_id:a.shop._id},{$set:{subscriptionExpiry:new Date(0)}});assert.equal((await http('POST',base+'/payments',payment(1))).status,403);await Shop.updateOne({_id:a.shop._id},{$set:{isActive:false}});assert.equal((await http('POST',base+'/returns',returned(receipt))).body.message,'Shop has been deactivated. Contact administrator.');}finally{await Shop.updateOne({_id:a.shop._id},{$set:{subscriptionExpiry:a.shop.subscriptionExpiry,isActive:true}});}
        });
        await t.test('missing journal or stock audit fails reconciliation without silent repair',async()=>{
            const journal=await BusinessTransaction.findOne({'source.kind':'SUPPLIER_PAYMENT','source.referenceId':partial.event._id}).lean();await BusinessTransaction.collection.deleteOne({_id:journal._id});
            try{assert.equal((await http('GET',base+'/balance')).status,409);assert.equal((await http('POST',base+'/payments',payment(1,bank))).status,409);}finally{await BusinessTransaction.collection.insertOne(journal);}
            assert.equal(ok(await http('GET',base+'/balance')).authoritative,true);
            const log=await StockLog.findOne({supplierSettlementId:secondReturn._id}).lean();await StockLog.collection.deleteOne({_id:log._id});try{assert.equal((await http('GET',base+'/balance')).status,409);}finally{await StockLog.collection.insertOne(log);}
        });
        await t.test('missing immutable payment source is visible in both supplier and cash reconciliation',async()=>{
            const event=await SupplierSettlement.findById(partial.event._id).lean();await SupplierSettlement.collection.deleteOne({_id:event._id});
            try{assert.equal((await http('GET',base+'/balance')).status,409);const report=ok(await http('GET',`/accounts/reconciliation?clearingAccountId=${control._id}`));assert.equal(report.supplierReconciliation[0].authoritative,false);assert.ok(report.orphanedSupplierCashJournals.some(j=>j.referenceId===partial.event._id));}finally{await SupplierSettlement.collection.insertOne(event);}
        });
        await t.test('disabled mode and production guard reject new supplier financial mutations',async()=>{
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;assert.equal((await http('POST',base+'/payments',payment(1,bank))).status,409);assert.equal((await http('POST',base+'/returns',returned(receipt))).status,409);
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';process.env.NODE_ENV='production';try{assert.equal((await http('POST',base+'/payments',payment(1,bank))).status,409);}finally{process.env.NODE_ENV='test';}
        });
        const creditSupplier=await tx(s=>accounts.createBusinessEntity(a.actor,{key:'credit-supplier',name:'Credit supplier',roles:['SUPPLIER']},s));
        const creditAp=await account('SUPPLIER_PAYABLE','CREDIT-AP',creditSupplier._id),creditBase='/accounts/suppliers/'+creditSupplier._id;
        const cutPreview=ok(await http('GET',creditBase+'/cutover-preview'));
        ok(await http('POST',creditBase+'/cutover',{requestKey:'credit-supplier-opening',confirmation:'CONFIRM SUPPLIER OPENING',reason:'Owner reviewed zero prior debt',cutoffAt:new Date().toISOString(),payableAccountId:String(creditAp._id),offsetAccountId:String(offset._id),equityAccountId:String(equity._id),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:cutPreview.evidenceDigest}));
        const state=async()=>ok(await http('GET',creditBase+'/balance'));
        const creditReceipt=async(quantity)=>{const x=await create({supplierId:String(creditSupplier._id),items:[{productId:String(p._id),quantity,unitCostMinor:100}]});x.po=await confirm(x.po);return ok(await http('POST',`/purchases/${x.po._id}/receipts`,receiveBody(x.po,quantity))).receipt;};
        function creditBody(amountMinor,extra={}){return {...payment(amountMinor),confirmation:'CONFIRM SUPPLIER REFUND RECEIVED',...extra};}
        function applyBody(amountMinor){const body=creditBody(amountMinor,{confirmation:'CONFIRM SUPPLIER CREDIT APPLICATION'});delete body.accountId;return body;}
        let paid,credited,refund,application,firstReceipt;
        await tx(s=>accounts.transferCashBank(a.actor,{fromAccountId:String(bank._id),toAccountId:String(cash._id),amountMinor:5000,occurredAt:new Date().toISOString(),requestKey:'prepare-credit-test-funds',reason:'Move prepared test bank funds to till'},s));
        const initialFunds=(await funds(cash)).balanceMinor,initialInventory=await stock(p);
        await t.test('supplier credit: full payment then return creates a separate asset at original received cost',async()=>{
            firstReceipt=await creditReceipt(10);paid=ok(await http('POST',creditBase+'/payments',payment(1000))).settlement;
            const createJournal=BusinessTransaction.create;
            BusinessTransaction.create=async()=>{throw Error('Injected excess return failure');};
            try{assert.equal((await http('POST',creditBase+'/returns',returned(firstReceipt,6))).status,500);}finally{BusinessTransaction.create=createJournal;}
            assert.equal(await stock(p),initialInventory+10);assert.equal(await FinancialAccount.countDocuments({shopId:a.shop._id,entityId:creditSupplier._id,kind:'SUPPLIER_CREDIT'}),0);
            credited=ok(await http('POST',creditBase+'/returns',returned(firstReceipt,6))).settlement;
            const s=await state();assert.equal(s.balanceMinor,0);assert.equal(s.creditMinor,600);assert.equal(s.refundDueMinor,600);assert.equal(credited.payableReductionMinor,0);assert.equal(credited.creditMovementMinor,600);
            assert.equal((await funds(cash)).balanceMinor,initialFunds-1000);assert.equal(await stock(p),initialInventory+4);
        });
        await t.test('supplier credit: partial refund increases selected cash once, never sales revenue',async()=>{
            const body=creditBody(200);refund=ok(await http('POST',creditBase+'/refunds',body)).settlement;
            assert.equal(ok(await http('POST',creditBase+'/refunds',body)).replayed,true);assert.equal((await state()).creditMinor,400);assert.equal((await state()).refundsReceivedMinor,200);
            assert.equal((await funds(cash)).balanceMinor,initialFunds-800);const journal=await BusinessTransaction.findOne({'source.referenceId':refund._id});assert.equal(journal.source.kind,'SUPPLIER_REFUND');assert.equal(journal.postings.find(r=>String(r.accountId)===String(cash._id)).debitMinor,200);
            assert.equal((await http('POST',creditBase+'/settlements/'+credited._id+'/reverse',reversal())).status,409);
        });
        await t.test('supplier credit: future receipt payable and partial application consume credit without cash',async()=>{
            await creditReceipt(3);const before=(await funds(cash)).balanceMinor,body=applyBody(200);application=ok(await http('POST',creditBase+'/credit-applications',body)).settlement;
            assert.equal(ok(await http('POST',creditBase+'/credit-applications',body)).replayed,true);assert.equal((await state()).balanceMinor,100);assert.equal((await state()).creditMinor,200);assert.equal((await state()).creditAppliedMinor,200);assert.equal((await funds(cash)).balanceMinor,before);
            assert.equal((await http('POST',creditBase+'/credit-applications',applyBody(101))).status,409);assert.equal((await http('POST',creditBase+'/refunds',creditBody(201))).status,409);
        });
        await t.test('supplier credit: concurrent refund versus application cannot spend the same credit',async()=>{
            const responses=await Promise.all([http('POST',creditBase+'/refunds',creditBody(150)),http('POST',creditBase+'/credit-applications',applyBody(100))]);
            assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,1);
            const event=ok(responses.find(r=>r.status===200)).settlement;ok(await http('POST',creditBase+'/settlements/'+event._id+'/reverse',reversal()));
            assert.equal((await state()).balanceMinor,100);assert.equal((await state()).creditMinor,200);
        });
        await t.test('supplier credit: concurrent refund requests cannot consume the same remaining credit',async()=>{
            const one=creditBody(150),two=creditBody(150),responses=await Promise.all([http('POST',creditBase+'/refunds',one),http('POST',creditBase+'/refunds',two)]);
            assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===409).length,1);const event=ok(responses.find(r=>r.status===200)).settlement;
            assert.equal((await state()).creditMinor,50);assert.equal((await http('POST',creditBase+'/credit-applications',applyBody(100))).status,409);
            ok(await http('POST',creditBase+'/settlements/'+event._id+'/reverse',reversal()));assert.equal((await state()).creditMinor,200);
        });
        await t.test('supplier credit: journal failure rolls back refunds, credit applications and all balances',async()=>{
            const prior=await state(),before=(await funds(cash)).balanceMinor,count=await SupplierSettlement.countDocuments(),createJournal=BusinessTransaction.create;
            BusinessTransaction.create=async()=>{throw Error('Injected credit journal failure');};
            try{assert.equal((await http('POST',creditBase+'/refunds',creditBody(10))).status,500);assert.equal((await http('POST',creditBase+'/credit-applications',applyBody(10))).status,500);}finally{BusinessTransaction.create=createJournal;}
            assert.equal((await state()).creditMinor,prior.creditMinor);assert.equal((await state()).balanceMinor,prior.balanceMinor);assert.equal((await funds(cash)).balanceMinor,before);assert.equal(await SupplierSettlement.countDocuments(),count);
        });
        await t.test('supplier credit: confirmed inverse corrections restore credit before stock-return reversal',async()=>{
            ok(await http('POST',creditBase+'/settlements/'+application._id+'/reverse',reversal()));assert.equal((await state()).balanceMinor,300);assert.equal((await state()).creditMinor,400);
            ok(await http('POST',creditBase+'/settlements/'+refund._id+'/reverse',reversal()));assert.equal((await state()).creditMinor,600);assert.equal((await state()).refundsReceivedMinor,0);
            ok(await http('POST',creditBase+'/settlements/'+credited._id+'/reverse',reversal()));assert.equal((await state()).creditMinor,0);assert.equal(await stock(p),initialInventory+13);
            ok(await http('POST',creditBase+'/settlements/'+paid._id+'/reverse',reversal()));assert.equal((await funds(cash)).balanceMinor,initialFunds);assert.equal((await state()).balanceMinor,1300);
        });
        await t.test('supplier credit: split return reduces payable first then recognizes only the excess as credit',async()=>{
            ok(await http('POST',creditBase+'/payments',payment(1200)));const r=ok(await http('POST',creditBase+'/returns',returned(firstReceipt,2))).settlement;
            assert.equal(r.payableReductionMinor,100);assert.equal(r.creditMovementMinor,100);assert.equal((await state()).balanceMinor,0);assert.equal((await state()).creditMinor,100);
            const j=await BusinessTransaction.findOne({'source.referenceId':r._id});assert.equal(j.postings.length,3);assert.equal(j.postings.reduce((n,p)=>n+p.debitMinor-p.creditMinor,0),0);
        });
        await t.test('supplier credit: owner-only, shop isolation, explicit confirmations and reconciliation',async()=>{
            for(const user of [cashier,admin])for(const path of ['/refunds','/credit-applications'])assert.equal((await http('POST',creditBase+path,creditBody(1),user)).status,403);
            assert.equal((await http('POST',creditBase+'/refunds',creditBody(1),b.user)).status,404);
            assert.equal((await http('POST',creditBase+'/refunds',creditBody(1,{confirmation:'NO'}))).status,400);
            assert.equal((await http('POST',creditBase+'/refunds',creditBody(1,{accountId:String(new mongoose.Types.ObjectId())}))).status,404);
            const s=await state();assert.equal(s.authoritative,true);const statement=ok(await http('GET','/accounts/financial/'+s.creditAccountId+'/history'));assert.equal(statement.rangeClosingBalanceMinor,100);
            const register=ok(await http('GET','/accounts/transactions?type=SUPPLIER_REFUND'));assert.ok(register.entries.length>0);const detail=ok(await http('GET','/accounts/transactions/'+register.entries[0].eventId));assert.equal(detail.transaction.eventType,'SUPPLIER_REFUND');
            const cashReport=ok(await http('GET','/accounts/reconciliation?clearingAccountId='+control._id));assert.ok(cashReport.supplierReconciliation.every(r=>r.authoritative));assert.equal(cashReport.orphanedSupplierCashJournals.length,0);
            const day=new Date().toISOString().slice(0,10),reports=ok(await http('GET','/accounts/reports?from='+day+'T00:00:00.000Z&to='+new Date(Date.parse(day+'T00:00:00.000Z')+86400000).toISOString()));
            assert.equal(reports.suppliers.creditMinor,100);assert.equal(reports.sales.revenueMinor,0);assert.equal(reports.expenses.netMinor,0);assert.equal(reports.capital.balanceMinor,0);
            const old=await SupplierSettlement.findById(partial.event._id).lean(),beforeLegacy=await balance();
            await SupplierSettlement.collection.updateOne({_id:old._id},{$unset:{payableReductionMinor:'',creditMovementMinor:''}});
            try{assert.equal(await balance(),beforeLegacy);assert.equal((await state()).creditMinor,100);}finally{await SupplierSettlement.collection.updateOne({_id:old._id},{$set:{payableReductionMinor:old.payableReductionMinor,creditMovementMinor:old.creditMovementMinor}});}
            const foreignCash=await accounts.businessTransaction(b.actor,s=>accounts.createFinancialAccount(b.actor,{kind:'CASH',code:'FOREIGN-TILL',name:'Other shop till'},s));
            assert.equal((await http('POST',creditBase+'/refunds',creditBody(1,{accountId:String(foreignCash._id)}))).status,404);
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;try{assert.equal((await http('POST',creditBase+'/refunds',creditBody(1))).status,409);}finally{process.env.BUSINESS_ACCOUNTING_ENABLED='true';}
        });
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-settlement-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
