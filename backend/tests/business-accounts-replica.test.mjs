import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
process.env.ACCESS_TOKEN_EXPIRY='15m';
process.env.REFRESH_TOKEN_EXPIRY='7d';
const service=await import('../dist/utils/businessAccounts.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {User}=await import('../dist/models/user.model.js');
const {Customer}=await import('../dist/models/customer.model.js');
const {CustomerLedger}=await import('../dist/models/customerLedger.model.js');
const {Product}=await import('../dist/models/product.model.js');
const {BusinessEntity}=await import('../dist/models/businessEntity.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const {BusinessTransaction}=await import('../dist/models/businessTransaction.model.js');
const {Order}=await import('../dist/models/order.model.js');
const {InvoiceAdjustment}=await import('../dist/models/invoiceAdjustment.model.js');
const {BusinessBrand,ProductBrandLink}=await import('../dist/models/businessBrand.model.js');
const binary='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Fresh loopback-only replica set. Never loads environment files or an existing URI.
await test('business accounts: real isolated MongoDB transactions', {skip:!existsSync(binary)}, async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-business-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','businessTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/business_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'businessTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const M of [Shop,User,Customer,CustomerLedger,Order,InvoiceAdjustment,Product,BusinessEntity,FinancialAccount,BusinessTransaction,BusinessBrand,ProductBrandLink]){await M.createCollection();await M.createIndexes();}
        async function fixture(suffix){const _id=new mongoose.Types.ObjectId();const shop=await Shop.create({name:'Shop '+suffix,address:'Test',contactNo:suffix==='a'?'03111111111':'03222222222',ownerId:_id,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)});const user=await User.create({_id,username:'owner'+suffix,email:suffix+'@business.test',password:'testing123',role:'OWNER',shopId:shop._id});return {_id:user._id,shopId:shop._id,role:'OWNER'};}
        const actor=await fixture('a'),other=await fixture('b');
        const run=(fn,a=actor)=>service.businessTransaction(a,s=>fn(s));
        const account=(code,kind,entityId)=>run(s=>service.createFinancialAccount(actor,{code,name:code,kind,...(entityId?{entityId}: {})},s));
        const cash=await account('CASH','CASH'),bank=await account('BANK','BANK'),equity=await account('EQUITY','OPENING_EQUITY'),expense=await account('EXPENSE','EXPENSE');
        const when=new Date(Date.now()-10000).toISOString();
        const opening={requestKey:'cash-opening',accountId:String(cash._id),equityAccountId:String(equity._id),amountMinor:10000,occurredAt:when,reason:'Verified physical cash at cutoff',confirmation:'CONFIRM OPENING BALANCE'};
        let opened,transfer,customer,entity,receivable,credit,supplier,payable;
        const balance=a=>run(s=>service.getAccountBalance(actor,String(a._id),s));
        const move=(key,amount=1000)=>({requestKey:key,reason:'Bank deposit',occurredAt:when,postings:[{accountId:String(bank._id),debitMinor:amount,creditMinor:0},{accountId:String(cash._id),debitMinor:0,creditMinor:amount}]});
        await t.test('owner authorization checks real user, shop membership and active transaction',async()=>{
            for(const a of [{...actor,role:'CASHIER'},{...actor,role:'ADMIN'},{...actor,shopId:other.shopId}])await assert.rejects(run(s=>service.getAccountBalance(a,String(cash._id),s),a),/Owner shop/);
            await assert.rejects(service.getAccountBalance(actor,String(cash._id),null),/transaction/);
        });
        await t.test('opening is explicitly confirmed, balanced and idempotent',async()=>{
            await assert.rejects(run(s=>service.recordOpeningBalance(actor,{...opening,confirmation:''},s)),/confirm/);
            opened=await run(s=>service.recordOpeningBalance(actor,opening,s));
            const replay=await run(s=>service.recordOpeningBalance(actor,opening,s));assert.equal(String(opened._id),String(replay._id));
            assert.equal((await balance(cash)).balanceMinor,10000);assert.equal((await balance(equity)).balanceMinor,10000);
            await assert.rejects(run(s=>service.recordOpeningBalance(actor,{...opening,requestKey:'second-opening'},s)));
        });
        await t.test('cash transfer, replay and changed-payload conflict preserve precise balances',async()=>{
            transfer=await run(s=>service.postBusinessJournal(actor,move('bank-transfer'),s));
            const again=await run(s=>service.postBusinessJournal(actor,move('bank-transfer'),s));assert.equal(String(again._id),String(transfer._id));
            await assert.rejects(run(s=>service.postBusinessJournal(actor,move('bank-transfer',999),s)),/different transaction/);
            assert.equal((await balance(cash)).balanceMinor,9000);assert.equal((await balance(bank)).balanceMinor,1000);
        });
        await t.test('reversal appends exact inverse without altering original and cannot repeat',async()=>{
            const reversal={transactionId:String(transfer._id),requestKey:'reverse-transfer',occurredAt:when,reason:'Deposit corrected'};
            const reversed=await run(s=>service.reverseBusinessJournal(actor,reversal,s));
            assert.equal((await balance(cash)).balanceMinor,10000);assert.equal((await balance(bank)).balanceMinor,0);
            assert.equal((await BusinessTransaction.findById(transfer._id)).reason,'Bank deposit');
            assert.equal(String((await run(s=>service.reverseBusinessJournal(actor,reversal,s)))._id),String(reversed._id));
            await assert.rejects(run(s=>service.reverseBusinessJournal(actor,{...reversal,requestKey:'second-reversal'},s)));
            await assert.rejects(run(s=>service.reverseBusinessJournal(actor,{...reversal,transactionId:String(reversed._id)},s)));
        });
        await t.test('posted history rejects save, update, delete and bulk mutation',async()=>{
            const doc=await BusinessTransaction.findById(opened._id);doc.reason='tamper';await assert.rejects(doc.save(),/immutable/);
            await assert.rejects(BusinessTransaction.updateOne({_id:doc._id},{$set:{reason:'tamper'}}),/immutable/);
            await assert.rejects(BusinessTransaction.deleteMany({shopId:actor.shopId}),/immutable/);
            await assert.rejects(BusinessTransaction.bulkWrite([{deleteOne:{filter:{_id:doc._id}}}]),/bulk/);
        });
        await t.test('existing customer identity and balances remain authoritative without migration',async()=>{
            customer=await Customer.create({name:'Wholesale buyer',phoneNo:'03333333333',address:'Market',remainingMoney:0,shopId:actor.shopId});
            entity=await run(s=>service.createBusinessEntity(actor,{key:'buyer',customerId:String(customer._id),roles:['CUSTOMER','SUPPLIER'],customerType:'WHOLESALE'},s));
            receivable=await account('AR-BUYER','CUSTOMER_RECEIVABLE',String(entity._id));credit=await account('CREDIT-BUYER','STORE_CREDIT_LIABILITY',String(entity._id));
            assert.equal((await balance(receivable)).authority,'LEGACY_CUSTOMER');assert.equal((await balance(credit)).balanceMinor,0);
            assert.equal(await Customer.countDocuments({shopId:actor.shopId}),1);
            await Customer.updateOne({_id:customer._id},{$set:{name:'Changed buyer'}});
            assert.equal((await run(s=>service.getBusinessEntity(actor,String(entity._id),s))).name,'Changed buyer');
            await assert.rejects(run(s=>service.createBusinessEntity(actor,{key:'duplicate',customerId:String(customer._id),roles:['CUSTOMER']},s)));
            await assert.rejects(run(s=>service.recordOpeningBalance(actor,{...opening,requestKey:'legacy-opening',accountId:String(receivable._id)},s)),/existing ledger/);
            await assert.rejects(run(s=>service.postBusinessJournal(actor,{...move('legacy-post'),postings:[{accountId:String(receivable._id),debitMinor:100,creditMinor:0},{accountId:String(cash._id),debitMinor:0,creditMinor:100}]},s)),/existing ledger/);
        });
        await t.test('supplier identity, customer link and payable remain separate from receivables',async()=>{
            supplier=await run(s=>service.createBusinessEntity(actor,{key:'manufacturer',name:'Eagle Cables',roles:['MANUFACTURER','SUPPLIER']},s));
            payable=await account('AP-EAGLE','SUPPLIER_PAYABLE',String(supplier._id));
            await run(s=>service.recordOpeningBalance(actor,{...opening,requestKey:'supplier-opening',accountId:String(payable._id),amountMinor:5000},s));
            assert.equal((await balance(payable)).balanceMinor,5000);assert.equal((await balance(cash)).balanceMinor,10000);
            assert.equal(await Customer.countDocuments({shopId:actor.shopId}),1);
            await assert.rejects(run(s=>service.setBusinessRoles(actor,String(supplier._id),['MANUFACTURER'],0,s)),/Supplier account/);
            const c=await Customer.create({name:'Eagle buyer',phoneNo:'03444444444',shopId:actor.shopId});
            const linked=await run(s=>service.linkBusinessCustomer(actor,String(supplier._id),String(c._id),0,'LINK EXISTING CUSTOMER',s));
            assert.equal(String(linked.customerId),String(c._id));assert.ok(linked.roles.includes('CUSTOMER'));
            assert.equal((await balance(payable)).balanceMinor,5000);
        });
        await t.test('existing debt and store-credit movements are read separately, never reposted',async()=>{
            const {changeStoreCredit}=await import('../dist/utils/invoiceSettlement.js');
            const referenceId=new mongoose.Types.ObjectId(),adjustmentId=new mongoose.Types.ObjectId();
            await run(async s=>{
                await Customer.updateOne({_id:customer._id,shopId:actor.shopId},{$set:{remainingMoney:7.25}},{session:s});
                await CustomerLedger.create([{customerId:customer._id,shopId:actor.shopId,referenceId,invoiceNo:'LEGACY-TEST',description:'PURCHASE',amount:7.25}],{session:s});
                await changeStoreCredit(customer._id,{_id:referenceId,invoiceNo:'LEGACY-TEST'},300,'CREDIT_ISSUED',actor,adjustmentId,s);
            });
            const count=await BusinessTransaction.countDocuments();
            assert.equal((await balance(receivable)).balanceMinor,725);assert.equal((await balance(credit)).balanceMinor,300);
            await run(s=>changeStoreCredit(customer._id,{_id:referenceId,invoiceNo:'LEGACY-TEST'},-100,'CREDIT_REDEEMED',actor,adjustmentId,s));
            assert.equal((await balance(credit)).balanceMinor,200);assert.equal((await balance(receivable)).balanceMinor,725);
            const statement=await run(s=>service.getAccountStatement(actor,{accountId:String(credit._id),page:2,limit:1},s));
            assert.equal(statement.openingBalanceMinor,300);assert.equal(statement.entries[0].runningBalanceMinor,200);
            assert.equal(await BusinessTransaction.countDocuments(),count);
        });
        await t.test('customer history deduplicates adjustment-linked ledger rows and isolates shops',async()=>{
            const historyCustomer=await Customer.create({name:'History buyer',phoneNo:'03555555555',remainingMoney:0,storeCreditBalanceMinor:0,shopId:actor.shopId});
            const orderId=new mongoose.Types.ObjectId(),adjustmentId=new mongoose.Types.ObjectId(),now=new Date();
            await Order.create({_id:orderId,shopId:actor.shopId,type:'INVOICE',items:[],invoiceNo:'HIST-1',totalPrice:0,discountAmount:0,subtotal:0,saleType:'RETAIL',createdBy:actor._id,createdByName:'Owner',paidAmount:0,amountDue:0,customerId:historyCustomer._id,status:'DELIVERED'});
            const snapshot={items:[],subtotalMinor:0,discountMinor:0,totalMinor:0,settledMinor:0,dueMinor:0,discountType:'NONE',discountValue:0};
            await InvoiceAdjustment.create({_id:adjustmentId,shopId:actor.shopId,orderId,invoiceNo:'HIST-1',kind:'SALE',requestKey:'history-sale-key',requestHash:'history-sale-hash',revisionBefore:0,revisionAfter:0,createdBy:actor._id,createdByName:'Owner',reason:'Invoice created',before:snapshot,after:snapshot,movements:[],financial:{salesDeltaMinor:0,debtDeltaMinor:0,cashReceivedMinor:0,cashRefundMinor:0,creditRedeemedMinor:0,creditIssuedMinor:0,creditRestoredMinor:0},occurredAt:now});
            await CustomerLedger.create({customerId:historyCustomer._id,shopId:actor.shopId,referenceId:orderId,adjustmentId,invoiceNo:'HIST-1',createdBy:actor._id,description:'PAYMENT',amount:0,amountMinor:0});
            const history=await run(s=>service.getCustomerHistory(actor,String(historyCustomer._id),{page:1,limit:20},s));
            assert.equal(history.entries.length,1);assert.equal(history.entries[0].type,'INVOICE');assert.equal(String(history.entries[0].orderId),String(orderId));
            const global=await run(s=>service.getGlobalCustomerActivity(actor,{service:'HISTORY',page:1,limit:20,customerId:String(historyCustomer._id)},s));
            assert.equal(global.entries.length,1);assert.equal(global.entries[0].customerName,'History buyer');assert.equal(global.entries[0].invoiceNo,'HIST-1');
            const invoices=await run(s=>service.getGlobalCustomerActivity(actor,{service:'INVOICES',page:1,limit:20,customerId:String(historyCustomer._id)},s));
            assert.equal(invoices.entries.length,1);assert.equal(invoices.entries[0].type,'INVOICE');
            assert.equal((await run(s=>service.getGlobalCustomerActivity(actor,{service:'HISTORY',page:2,limit:1,customerId:String(historyCustomer._id)},s))).entries.length,0);
            await InvoiceAdjustment.create([{shopId:actor.shopId,orderId,invoiceNo:'HIST-1',requestKey:'history-refund-key',requestHash:'history-refund-hash',kind:'CANCELLATION',revisionBefore:0,revisionAfter:1,createdBy:actor._id,createdByName:'Owner',debtCustomerId:historyCustomer._id,reason:'Customer refund',before:snapshot,after:snapshot,movements:[],financial:{salesDeltaMinor:0,debtDeltaMinor:0,cashReceivedMinor:0,cashRefundMinor:250,creditRedeemedMinor:0,creditIssuedMinor:0,creditRestoredMinor:0},occurredAt:new Date(now.getTime()+1000)}]);
            const refunds=await run(s=>service.getGlobalCustomerActivity(actor,{service:'REFUNDS',page:1,limit:20,customerId:String(historyCustomer._id)},s));
            assert.equal(refunds.entries.length,1);assert.equal(refunds.entries[0].type,'REFUND');assert.equal(refunds.entries[0].details.cashRefundMinor,250);
            assert.equal((await run(s=>service.getGlobalCustomerActivity(actor,{service:'RETURNS',page:1,limit:20,customerId:String(historyCustomer._id)},s))).entries.length,0);
            assert.equal((await run(s=>service.getGlobalCustomerActivity(other,{service:'HISTORY',page:1,limit:20},s),other)).entries.length,0);
            await assert.rejects(run(s=>service.getCustomerHistory(other,String(historyCustomer._id),{page:1,limit:20},s),other),/not found/);
        });
        await t.test('shop isolation covers entities, accounts, postings, reversals and brands',async()=>{
            await assert.rejects(run(s=>service.getBusinessEntity(other,String(entity._id),s),other),/not found/);
            await assert.rejects(run(s=>service.getAccountBalance(other,String(cash._id),s),other),/not found/);
            await assert.rejects(run(s=>service.postBusinessJournal(other,move('foreign-post'),s),other),/not found/);
            await assert.rejects(run(s=>service.reverseBusinessJournal(other,{transactionId:String(opened._id),requestKey:'foreign-reverse',occurredAt:when,reason:'invalid'},s),other));
            await assert.rejects(run(s=>service.createBusinessBrand(other,{name:'Eagle',entityIds:[String(supplier._id)]},s),other),/not found/);
        });
        await t.test('brand-company links do not change legacy product brand and stale links are ignored',async()=>{
            const product=await Product.create({name:'Cable',slug:'business-cable',brand:'Eagle',category:new mongoose.Types.ObjectId(),unit:'m',shopId:actor.shopId,costPrice:1,retailPrice:2,wholesalePrice:2,stockQuantity:5});
            const brand=await run(s=>service.createBusinessBrand(actor,{name:'Eagle',entityIds:[String(supplier._id)]},s));
            await run(s=>service.linkProductBrand(actor,String(product._id),String(brand._id),s));
            assert.equal((await run(s=>service.getProductBusinessLinks(actor,String(product._id),s))).entities.length,1);
            assert.equal((await Product.findById(product._id)).brand,'Eagle');
            await Product.updateOne({_id:product._id},{$set:{brand:'Other'}});
            assert.equal(await run(s=>service.getProductBusinessLinks(actor,String(product._id),s)),null);
        });
        await t.test('statements paginate with correct opening and running balances',async()=>{
            const page=await run(s=>service.getAccountStatement(actor,{accountId:String(cash._id),page:2,limit:1},s));
            assert.equal(page.entries.length,1);assert.equal(page.openingBalanceMinor,10000);assert.equal(page.entries[0].runningBalanceMinor,9000);assert.equal(page.pagination.recordCount,3);
            const legacy=await run(s=>service.getAccountStatement(actor,{accountId:String(receivable._id)},s));assert.equal(legacy.entries.length,1);assert.equal(legacy.balanceMinor,725);
            await assert.rejects(run(s=>service.getAccountStatement(actor,{accountId:String(cash._id),limit:101},s)),/pagination/);
        });
        await t.test('insufficient funds and concurrent spending cannot overdraw cash',async()=>{
            await assert.rejects(run(s=>service.postBusinessJournal(actor,move('too-large-transfer',10001),s)),/Insufficient/);
            const attempts=await Promise.allSettled(['concurrent-one','concurrent-two'].map(key=>run(s=>service.postBusinessJournal(actor,move(key,7000),s))));
            assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal((await balance(cash)).balanceMinor,3000);
        });
        await t.test('concurrent identical requests create only one journal and are safely replayable',async()=>{
            const input=move('concurrent-duplicate',100);
            const results=await Promise.allSettled([run(s=>service.postBusinessJournal(actor,input,s)),run(s=>service.postBusinessJournal(actor,input,s))]);
            assert.ok(results.some(r=>r.status==='fulfilled'));
            await run(s=>service.postBusinessJournal(actor,input,s));assert.equal(await BusinessTransaction.countDocuments({shopId:actor.shopId,requestKey:input.requestKey}),1);
            assert.equal((await balance(cash)).balanceMinor,2900);
        });
        await t.test('real late database failure rolls back journal, account claims and composed inventory writes',async()=>{
            const product=await Product.findOne({shopId:actor.shopId});const before=product.stockQuantity;
            const revision=(await FinancialAccount.findById(cash._id)).postingRevision;
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{requestKey:{$ne:'forced-rollback'}}});
            await assert.rejects(run(async s=>{await Product.updateOne({_id:product._id,shopId:actor.shopId},{$inc:{stockQuantity:10}},{session:s});return service.postBusinessJournal(actor,move('forced-rollback',100),s);}));
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{}});
            assert.equal((await Product.findById(product._id)).stockQuantity,before);assert.equal((await FinancialAccount.findById(cash._id)).postingRevision,revision);
            assert.equal((await balance(cash)).balanceMinor,2900);assert.equal(await BusinessTransaction.countDocuments({requestKey:'forced-rollback'}),0);
        });
        await t.test('manual access precedes subscription and legacy mismatch is rejected without rewriting data',async()=>{
            await Shop.updateOne({_id:actor.shopId},{$set:{isActive:false,subscriptionActive:false}});
            await assert.rejects(balance(cash),/deactivated/);await Shop.updateOne({_id:actor.shopId},{$set:{isActive:true}});
            await assert.rejects(balance(cash),/Subscription/);await Shop.updateOne({_id:actor.shopId},{$set:{subscriptionActive:true}});
            await Customer.updateOne({_id:customer._id},{$set:{remainingMoney:5}});
            await assert.rejects(balance(receivable));assert.equal((await Customer.findById(customer._id)).remainingMoney,5);
        });
    }finally{
        await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir() && path.basename(temp).startsWith('digishop-business-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
