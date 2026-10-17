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
const {BusinessSetup}=await import('../dist/models/businessSetup.model.js');
const {applyInvoiceAdjustment}=await import('../dist/controllers/invoiceAdjustment.controller.js');
const {SupplierCutover}=await import('../dist/models/supplierCutover.model.js');
const {CapitalEvent}=await import('../dist/models/capitalEvent.model.js');
const {Order}=await import('../dist/models/order.model.js');
const {BusinessEntity}=await import('../dist/models/businessEntity.model.js');
const {Expense,ExpenseCategory}=await import('../dist/models/expense.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const binary='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await test('existing setup: real HTTP and disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-existing-setup-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','existingSetupTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/existing_setup_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'existingSetupTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const M of Object.values(mongoose.models)){await M.createCollection();await M.createIndexes();}
        async function fixture(label,phone){const _id=new mongoose.Types.ObjectId(),shop=await Shop.create({ownerId:_id,name:label,address:'Test',contactNo:phone,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)}),user=await User.create({_id,shopId:shop._id,username:label,email:label+'@purchase.test',password:'testing123',role:'OWNER'});return {shop,user,actor:{_id,shopId:shop._id,role:'OWNER'}};}
        const a=await fixture('owner','03111111111'),b=await fixture('other','03222222222');
        const cashier=await User.create({shopId:a.shop._id,username:'cashier',email:'cashier@purchase.test',password:'testing123',role:'CASHIER'}),admin=await User.create({username:'admin',email:'admin@purchase.test',password:'testing123',role:'ADMIN'});
        server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
        assert.equal(mongoose.connection.host,'127.0.0.1');assert.equal(mongoose.connection.name,'existing_setup_test');
        let n=0;
        async function http(method,url,body,user=a.user){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2${url}`,{method,headers:{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
        const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r.body));return r.body.data;};
        const tx=work=>accounts.businessTransaction(a.actor,work);
        async function account(kind,code){return tx(s=>accounts.createFinancialAccount(a.actor,{kind,code,name:code},s));}
        const base='/accounts/existing-setup',cash=await account('CASH','TILL'),bank=await account('BANK','BANK');
        const product=await Product.create({shopId:a.shop._id,name:'Existing cable',slug:'existing-cable',brand:'Wire',category:new mongoose.Types.ObjectId(),stockQuantity:20,costPrice:2,retailPrice:10,unit:'pcs'});
        const customer=await Customer.create({shopId:a.shop._id,name:'Existing customer',phoneNo:'03333333333'});
        const supplier=await tx(s=>accounts.createBusinessEntity(a.actor,{key:'existing-eagle',name:'Eagle',roles:['SUPPLIER','COMPANY']},s));
        const sale=async(paidAmount)=>ok(await http('POST','/orders/create-order',{items:[{productId:String(product._id),quantity:2}],saleType:'RETAIL',paidAmount,customerId:String(customer._id)}));
        const full=await sale(20),order=await Order.findById(full.order?._id??full._id);
        assert.ok(order,'ordinary sale API returns an invoice');
        await applyInvoiceAdjustment({...a.actor,username:a.user.username},String(order._id),{requestKey:'existing-credit-refund',expectedRevision:0,reason:'Actual historical return paid as customer credit',returns:[{lineId:order.items[0].lineId,quantity:1,disposition:'RESTOCK'}],additions:[],creditIssueAmount:10});
        await sale(0);
        let po=ok(await http('POST','/purchases/',{reference:'OLD-PO',requestKey:'existing-purchase',supplierId:String(supplier._id),items:[{productId:String(product._id),quantity:4,unitCostMinor:300}]})).purchaseOrder;
        po=ok(await http('POST','/purchases/'+po._id+'/confirm',{requestKey:'existing-confirm',expectedRevision:po.revision})).purchaseOrder;
        const receipt=ok(await http('POST','/purchases/'+po._id+'/receipts',{requestKey:'existing-receive',reference:'OLD-GR',expectedRevision:po.revision,items:[{productId:String(product._id),quantity:4}]})).receipt;
        const initialStock=(await Product.findById(product._id)).stockQuantity,ledgerCount=await CustomerLedger.countDocuments(),orderCount=await Order.countDocuments(),logs=await StockLog.countDocuments();
        assert.equal(initialStock,21);assert.equal((await Customer.findById(customer._id)).remainingMoney,20);assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor,1000);
        function input(extra={}){return {cutoffAt:new Date().toISOString(),reason:'Owner verified existing balances and goods',cash:[{accountId:String(cash._id),amountMinor:10000},{accountId:String(bank._id),amountMinor:5000}],suppliers:[{supplierId:String(supplier._id),otherOpeningMinor:100,reviews:[{receiptId:receipt._id,unpaidMinor:900,reason:'300 paisa settled externally before adoption'}]}],expectedNetAssetsMinor:19200,acknowledgeLegacyCustomerBalances:true,acknowledgeUnallocatedEquity:true,...extra};}
        let draft,preview,confirmBody;
        const save=async(values=input())=>{draft=ok(await http('PUT',base,{expectedRevision:draft?.revision??0,input:values})).setup;return draft;};
        const review=async()=>{preview=ok(await http('POST',base+'/preview',{expectedRevision:draft.revision}));draft=preview.setup;return preview;};
        function confirmation(extra={}){return {requestKey:'existing-setup-confirmation',expectedRevision:preview.expectedRevision,previewToken:preview.previewToken,confirmation:'CONFIRM EXISTING BUSINESS SETUP',...extra};}
        await t.test('readiness is read-only and disabled financial posting never changes stock or balances',async()=>{
            const view=ok(await http('GET',base));assert.equal(view.setup,null);assert.equal(view.evidence.totals.inventoryMinor,4200);assert.equal(view.evidence.totals.customerDebtMinor,2000);assert.equal(view.evidence.totals.storeCreditMinor,1000);
            assert.ok(view.evidence.customers[0].reconciled);await save();await review();
            assert.ok(preview.evidence.blockers.some(v=>v.includes('accounting is disabled')));
            assert.equal((await http('POST',base+'/confirm',confirmation())).status,409);assert.equal(await BusinessTransaction.countDocuments(),0);
        });
        await t.test('draft corrections are revision-safe; totals show debt and credit separately',async()=>{
            await save(input({expectedNetAssetsMinor:1}));process.env.BUSINESS_ACCOUNTING_ENABLED='true';await review();
            assert.equal(preview.evidence.totals.differenceMinor,19199);assert.ok(preview.evidence.blockers.some(v=>v.includes('differs')));
            assert.equal((await http('PUT',base,{expectedRevision:0,input:input()})).status,409);
            await save();await review();assert.deepEqual(preview.evidence.blockers,[]);assert.equal(preview.evidence.totals.journalBackedOpeningNetMinor,18200);assert.equal(preview.evidence.totals.legacyNetCustomerMinor,1000);
        });
        await t.test('changed stock invalidates preview without posting a partial opening',async()=>{
            await Product.updateOne({_id:product._id},{$inc:{stockQuantity:1}});
            assert.equal((await http('POST',base+'/confirm',confirmation())).status,409);assert.equal(await BusinessTransaction.countDocuments(),0);
            await Product.updateOne({_id:product._id},{$inc:{stockQuantity:-1}});await save();await review();
        });
        await t.test('ambiguous customer balances block setup instead of inventing receivables',async()=>{
            const bad=await Customer.create({shopId:a.shop._id,name:'Unreconciled historical balance',phoneNo:'03444444444',remainingMoney:25});
            await save(input({expectedNetAssetsMinor:21700}));await review();assert.ok(preview.evidence.blockers.some(v=>v.includes('Customer balance/history')));
            assert.equal((await http('POST',base+'/confirm',confirmation())).status,409);assert.equal((await Customer.findById(bad._id)).remainingMoney,25);assert.equal(await BusinessTransaction.countDocuments(),0);
            await Customer.deleteOne({_id:bad._id});
            const orphan=await CustomerLedger.create({shopId:a.shop._id,customerId:new mongoose.Types.ObjectId(),amount:1,description:'PURCHASE',invoiceNo:'UNRESOLVED-LEGACY',referenceId:new mongoose.Types.ObjectId(),createdBy:a.user._id});
            await save();await review();assert.ok(preview.evidence.blockers.some(v=>v.includes('missing or foreign customer')));assert.equal((await http('POST',base+'/confirm',confirmation())).status,409);
            await CustomerLedger.deleteOne({_id:orphan._id});await save();await review();
        });
        await t.test('supplier unpaid reviews cannot omit deliveries or exceed received value',async()=>{
            await save(input({suppliers:[{supplierId:String(supplier._id),otherOpeningMinor:100,reviews:[]}]}));await review();assert.ok(preview.evidence.blockers.some(v=>v.includes('every deferred')));
            await save(input({suppliers:[{supplierId:String(supplier._id),otherOpeningMinor:100,reviews:[{receiptId:receipt._id,unpaidMinor:1300,reason:'Invalid excess'}]}]}));await review();assert.ok(preview.evidence.blockers.some(v=>v.includes('Delivery review')));
            await save();await review();
        });
        await t.test('OWNER-only and cross-shop selections fail without touching records',async()=>{
            for(const user of [cashier,admin])for(const method of ['GET','PUT'])assert.equal((await http(method,base,method==='GET'?undefined:{expectedRevision:0,input:input()},user)).status,403);
            assert.equal(ok(await http('GET',base,null,b.user)).setup,null);
            const foreign=ok(await http('PUT',base,{expectedRevision:0,input:input()},b.user));assert.ok(foreign.evidence.blockers.some(v=>v.includes('outside this shop')));
            assert.equal((await http('POST',base+'/confirm',confirmation(),b.user)).status,409);
        });
        await t.test('expired previews and concurrent stock writes require fresh review and roll back all openings',async()=>{
            await BusinessSetup.collection.updateOne({shopId:a.shop._id},{$set:{'review.expiresAt':new Date(0)}});
            assert.equal((await http('POST',base+'/confirm',confirmation())).status,409);await review();
            const original=Product.updateOne;let injected=false;
            Product.updateOne=async function(filter,change,options){if(options?.session&&change.$set?.updatedAt&&!injected){injected=true;await Product.collection.updateOne({_id:product._id},{$inc:{stockQuantity:1},$set:{updatedAt:new Date()}});}return original.call(this,filter,change,options);};
            try{assert.equal((await http('POST',base+'/confirm',confirmation())).status,409);}finally{Product.updateOne=original;}
            assert.ok(injected);assert.equal(await BusinessTransaction.countDocuments(),0);assert.equal(await SupplierCutover.countDocuments(),0);
            await Product.updateOne({_id:product._id},{$inc:{stockQuantity:-1}});await save();await review();
        });
        await t.test('late supplier-journal failure rolls back cash, inventory valuation, cutovers and confirmation',async()=>{
            const original=BusinessTransaction.create;
            BusinessTransaction.create=async function(rows,...args){if(rows[0].source.kind==='SUPPLIER_OPENING')throw new Error('Injected supplier opening failure');return original.call(this,rows,...args);};
            try{assert.equal((await http('POST',base+'/confirm',confirmation())).status,500);}finally{BusinessTransaction.create=original;}
            assert.equal(await BusinessTransaction.countDocuments(),0);assert.equal(await SupplierCutover.countDocuments(),0);assert.equal((await BusinessSetup.findOne({shopId:a.shop._id})).state,'DRAFT');
            assert.equal((await FinancialAccount.findById(cash._id)).cashCutoverId,undefined);assert.equal((await Product.findById(product._id)).stockQuantity,initialStock);
        });
        await t.test('atomic confirmation records inventory value once and reuses existing customer authority',async()=>{
            confirmBody=confirmation();const results=await Promise.all([http('POST',base+'/confirm',confirmBody),http('POST',base+'/confirm',confirmBody)]);assert.ok(results.every(r=>[200,409].includes(r.status)));const result=ok(results.find(r=>r.status===200));assert.equal(result.setup.state,'CONFIRMED');
            assert.equal((await Product.findById(product._id)).stockQuantity,initialStock);assert.equal(await StockLog.countDocuments(),logs);assert.equal(await CustomerLedger.countDocuments(),ledgerCount);assert.equal(await Order.countDocuments(),orderCount);
            assert.equal((await Customer.findById(customer._id)).remainingMoney,20);assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor,1000);assert.equal(await CapitalEvent.countDocuments(),0);
            assert.equal((await tx(s=>accounts.getAccountBalance(a.actor,String(cash._id),s))).balanceMinor,10000);assert.equal((await tx(s=>accounts.getAccountBalance(a.actor,String(bank._id),s))).balanceMinor,5000);
            const payable=await tx(s=>accounts.requireSupplierPayable(a.actor,String(supplier._id),s));assert.equal(payable.balanceMinor,1000);assert.equal((await GoodsReceipt.findById(receipt._id)).accountingStatus,'DEFERRED');
            const equity=await FinancialAccount.findOne({shopId:a.shop._id,code:'EXISTING_SETUP_EQUITY'});assert.equal((await tx(s=>accounts.getAccountBalance(a.actor,String(equity._id),s))).balanceMinor,18200);
            const inventory=await FinancialAccount.findOne({shopId:a.shop._id,code:'EXISTING_SETUP_INVENTORY'});assert.equal((await tx(s=>accounts.getAccountBalance(a.actor,String(inventory._id),s))).balanceMinor,4200);
            for(const journal of await BusinessTransaction.find({shopId:a.shop._id}))assert.equal(journal.postings.reduce((sum,p)=>sum+p.debitMinor-p.creditMinor,0),0);
        });
        await t.test('duplicate confirmation cannot duplicate openings and confirmed setup cannot be edited',async()=>{
            const count=await BusinessTransaction.countDocuments();assert.equal(ok(await http('POST',base+'/confirm',confirmBody)).replayed,true);assert.equal(await BusinessTransaction.countDocuments(),count);
            assert.equal((await http('POST',base+'/confirm',{...confirmBody,requestKey:'different-confirm-key'})).status,409);
            assert.equal((await http('PUT',base,{expectedRevision:0,input:input()})).status,409);
            const snapshot=ok(await http('GET',base));assert.equal(snapshot.evidence.inventoryStatus,'COMPLETE');assert.equal(snapshot.evidence.cash[0].status,'COMPLETE');
            await assert.rejects(BusinessSetup.updateOne({shopId:a.shop._id},{$set:{state:'DRAFT'}}),/revision-safe/);
            const account=await FinancialAccount.findOne({shopId:a.shop._id,kind:'INVENTORY'}),journal=await BusinessTransaction.findOne({'source.kind':'OPENING','source.referenceId':account._id});
            await assert.rejects(tx(s=>accounts.reverseBusinessJournal(a.actor,{transactionId:String(journal._id),requestKey:'cannot-reverse-setup',occurredAt:new Date().toISOString(),reason:'Unsafe reset'},s)),/separate reconciliation/);
        });
        await t.test('ordinary POS and supplier receiving still operate after setup, while stored openings stay historical',async()=>{
            const before=ok(await http('GET',base)).evidence.totals.inventoryMinor;
            ok(await http('POST','/orders/create-order',{items:[{productId:String(product._id),quantity:1}],saleType:'RETAIL',paidAmount:10,requestKey:'post-setup-sale',receiptAccountId:String(cash._id)}));
            assert.equal((await Product.findById(product._id)).stockQuantity,20);assert.equal(ok(await http('GET',base)).evidence.totals.inventoryMinor,before);
            let next=ok(await http('POST','/purchases/',{reference:'AFTER-SETUP',requestKey:'after-setup-purchase',supplierId:String(supplier._id),items:[{productId:String(product._id),quantity:1,unitCostMinor:300}]})).purchaseOrder;
            next=ok(await http('POST','/purchases/'+next._id+'/confirm',{requestKey:'after-setup-confirm',expectedRevision:0})).purchaseOrder;
            ok(await http('POST','/purchases/'+next._id+'/receipts',{requestKey:'after-setup-receive',reference:'AFTER-GR',expectedRevision:next.revision,items:[{productId:String(product._id),quantity:1}]}));
            assert.equal((await tx(s=>accounts.requireSupplierPayable(a.actor,String(supplier._id),s))).balanceMinor,1300);
            assert.equal((await Product.findById(product._id)).stockQuantity,21);
        });
        const reportQuery='?from=2020-01-01T00%3A00%3A00.000Z&to=2020-02-01T00%3A00%3A00.000Z';
        const day=new Date().toISOString().slice(0,10),reportToday='?from='+day+'T00%3A00%3A00.000Z&to='+new Date(Date.parse(day+'T00:00:00.000Z')+86400000).toISOString();
        await t.test('reports: partial sales, returns, current debt/credit and opening stock remain separate',async()=>{
            const report=ok(await http('GET','/accounts/reports'+reportToday));
            assert.equal(report.sales.revenueMinor,4000);assert.equal(report.sales.returnsMinor,1000);assert.equal(report.sales.originalGrossMinor,5000);
            assert.equal(report.customers.debtMinor,2000);assert.equal(report.customers.storeCreditMinor,1000);assert.equal(report.customers.status,'RECONCILED');
            assert.equal(report.suppliers.totalMinor,1300);assert.equal(report.inventory.referenceValueMinor,4200);assert.equal(report.inventory.status,'PROVISIONAL');
            assert.equal(report.opening.totals.inventoryMinor,4200);assert.equal(report.capital.balanceMinor,0);assert.equal(report.profit.status,'UNAVAILABLE');
            const cashBefore=await tx(s=>accounts.getAccountBalance(a.actor,String(cash._id),s));assert.equal(cashBefore.balanceMinor,11000);
            const journals=await BusinessTransaction.countDocuments();await http('GET','/accounts/reports'+reportToday);assert.equal(await BusinessTransaction.countDocuments(),journals);
        });
        await t.test('reports: UTC boundaries and original/return dates do not rewrite sales or include payments',async()=>{
            const original=await Order.findById(order._id).lean(),event=await mongoose.connection.collection('invoiceadjustments').findOne({orderId:order._id,kind:'ADJUSTMENT'});
            await Order.collection.updateOne({_id:order._id},{$set:{createdAt:new Date('2020-01-01T00:00:00Z')}});
            await mongoose.connection.collection('invoiceadjustments').updateOne({_id:event._id},{$set:{occurredAt:new Date('2020-02-01T00:00:00Z')}});
            try {
                const january=ok(await http('GET','/accounts/reports'+reportQuery));assert.equal(january.sales.revenueMinor,2000);assert.equal(january.sales.returnsMinor,0);
                const february=ok(await http('GET','/accounts/reports?from=2020-02-01T00:00:00.000Z&to=2020-03-01T00:00:00.000Z'));assert.equal(february.sales.revenueMinor,-1000);assert.equal(february.sales.returnsMinor,1000);
                assert.equal(february.customers.debtMinor,2000);assert.equal(february.profit.status,'UNAVAILABLE');
            } finally {await Order.collection.updateOne({_id:order._id},{$set:{createdAt:original.createdAt}});await mongoose.connection.collection('invoiceadjustments').updateOne({_id:event._id},{$set:{occurredAt:event.occurredAt}});}
        });
        await t.test('reports: operating expense reversals and partner investments never inflate revenue',async()=>{
            const category=ok(await http('POST','/accounts/expenses/categories',{name:'Report transport'}));
            const expense=ok(await http('POST','/accounts/expenses',{requestKey:'report-expense-01',categoryId:category._id,accountId:String(cash._id),amountMinor:100,description:'Test transport payment',occurredAt:new Date().toISOString()})).expense;
            let report=ok(await http('GET','/accounts/reports'+reportToday));assert.equal(report.expenses.netMinor,100);assert.equal(report.expenses.categories[0].totalMinor,100);
            ok(await http('POST','/accounts/expenses/'+expense._id+'/reverse',{requestKey:'report-expense-reverse',description:'Actual cash restored',confirmation:'CONFIRM EXPENSE REVERSAL',occurredAt:new Date().toISOString()}));
            const partner=ok(await http('POST','/accounts/partners',{key:'report-partner',name:'Report owner'}));
            const investment=ok(await http('POST','/accounts/capital',{requestKey:'report-investment',partnerId:partner._id,accountId:String(cash._id),amountMinor:500,direction:'CONTRIBUTION',description:'Real test cash investment',occurredAt:new Date().toISOString()})).event;
            report=ok(await http('GET','/accounts/reports'+reportToday));assert.equal(report.capital.balanceMinor,500);assert.equal(report.expenses.spentMinor,100);assert.equal(report.expenses.reversedMinor,100);assert.equal(report.expenses.netMinor,0);assert.equal(report.sales.revenueMinor,4000);
            ok(await http('POST','/accounts/capital/'+investment._id+'/reverse',{requestKey:'report-investment-reverse',description:'Cash returned',confirmation:'CONFIRM CAPITAL REVERSAL',occurredAt:new Date().toISOString()}));
            report=ok(await http('GET','/accounts/reports'+reportToday));assert.equal(report.capital.balanceMinor,0);assert.equal((await tx(s=>accounts.getAccountBalance(a.actor,String(cash._id),s))).balanceMinor,11000);
        });
        await t.test('reports: prepared range cash statement agrees with postings; earlier ranges are unavailable',async()=>{
            const clear=await FinancialAccount.findOne({shopId:a.shop._id,kind:'SETTLEMENT_CLEARING'});
            const at=clear.cashIntegration.cutoffAt.toISOString();
            const r=ok(await http('GET','/accounts/reports?from='+at+'&to='+new Date(Date.now()+1000).toISOString()));
            const row=r.cashBank.entries.find(a=>a.id===String(cash._id));assert.equal(row.currentBalanceMinor,11000);assert.equal(row.closingMinor,11000);assert.equal(row.closingMinor-row.openingMinor,row.netMovementMinor);assert.ok(row.transactions.length<=5);
            assert.equal(ok(await http('GET','/accounts/reports'+reportQuery)).cashBank.entries[0].rangeAvailable,false);
        });
        await t.test('reports: disabled mode, role restrictions, shop isolation and invalid input',async()=>{
            for(const user of [cashier,admin])assert.equal((await http('GET','/accounts/reports'+reportToday,null,user)).status,403);
            const other=ok(await http('GET','/accounts/reports'+reportToday,null,b.user));assert.equal(other.sales.revenueMinor,0);assert.equal(other.customers.entries.length,0);assert.equal(other.inventory.entries.length,0);
            for(const q of ['','?from=no&to=no','?from=2020-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z'])assert.equal((await http('GET','/accounts/reports'+q)).status,400);
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            try{const r=ok(await http('GET','/accounts/reports'+reportToday));assert.equal(r.cashBank.status,'UNAVAILABLE');assert.equal(r.expenses.status,'UNAVAILABLE');assert.equal(r.capital.status,'UNAVAILABLE');assert.equal(r.suppliers.status,'UNAVAILABLE');assert.equal(r.sales.revenueMinor,4000);assert.equal(r.customers.debtMinor,2000);}
            finally{process.env.BUSINESS_ACCOUNTING_ENABLED='true';}
        });
        await t.test('reports: actual previewed cancellation reverses revenue on cancellation date, not cash twice',async()=>{
            const sale=ok(await http('POST','/orders/create-order',{items:[{productId:String(product._id),quantity:1}],saleType:'RETAIL',paidAmount:10,requestKey:'report-cancel-sale',receiptAccountId:String(cash._id)}));
            const id=sale.order?._id??sale._id,start=new Date().toISOString();
            const body={requestKey:'report-cancel-invoice',expectedRevision:0,reason:'Verified cancellation and actual cash returned',returns:[],additions:[],cashRefundAmount:10,refundAccountId:String(cash._id)};
            const preview=ok(await http('POST','/orders/'+id+'/cancellations/preview',body));assert.equal(preview.canSubmit,true);
            ok(await http('POST','/orders/'+id+'/cancellations',{...body,confirmationToken:preview.confirmationToken}));
            const dayReport=ok(await http('GET','/accounts/reports'+reportToday));assert.equal(dayReport.sales.revenueMinor,4000);assert.equal(dayReport.sales.returnsMinor,2000);
            const interval=ok(await http('GET','/accounts/reports?from='+start+'&to='+new Date(Date.now()+1000).toISOString()));assert.equal(interval.sales.revenueMinor,-1000);assert.equal(interval.sales.returnsMinor,1000);
            assert.equal((await tx(s=>accounts.getAccountBalance(a.actor,String(cash._id),s))).balanceMinor,11000);assert.equal((await Product.findById(product._id)).stockQuantity,21);
        });
        await t.test('production accounting remains disabled',async()=>{
            process.env.NODE_ENV='production';try{assert.equal((await http('POST',base+'/confirm',confirmBody)).status,409);}finally{process.env.NODE_ENV='test';}
        });
        await t.test('existing cash openings and zero-balance cutovers are reused without duplicate cash/equity',async()=>{
            const otherTx=work=>accounts.businessTransaction(b.actor,work),acc=(kind,code)=>otherTx(s=>accounts.createFinancialAccount(b.actor,{kind,code,name:code},s));
            const till=await acc('CASH','OTHER-TILL'),empty=await acc('BANK','OTHER-EMPTY'),equity=await acc('OPENING_EQUITY','OTHER-EQUITY'),control=await acc('SETTLEMENT_CLEARING','OTHER-CONTROL'),cutoffAt=new Date().toISOString();
            await otherTx(s=>accounts.recordOpeningBalance(b.actor,{requestKey:'other-existing-opening',accountId:String(till._id),equityAccountId:String(equity._id),amountMinor:1000,occurredAt:cutoffAt,reason:'Previously confirmed physical cash',confirmation:'CONFIRM OPENING BALANCE'},s));
            await otherTx(s=>accounts.prepareCashBankCutover(b.actor,{clearingAccountId:String(control._id),cutoffAt,accounts:[{accountId:String(till._id),confirmedBalanceMinor:1000},{accountId:String(empty._id),confirmedBalanceMinor:0}],confirmation:'PREPARE CASH BANK CUTOVER'},s));
            const current=ok(await http('GET',base,null,b.user)).setup;
            let body=input({cash:[{accountId:String(till._id),amountMinor:1000},{accountId:String(empty._id),amountMinor:500}],suppliers:[],expectedNetAssetsMinor:1500});
            let saved=ok(await http('PUT',base,{expectedRevision:current.revision,input:body},b.user)).setup;
            let p=ok(await http('POST',base+'/preview',{expectedRevision:saved.revision},b.user));assert.ok(p.evidence.blockers.some(v=>v.includes('prepared cash/bank')));
            body=input({cash:[{accountId:String(till._id),amountMinor:1000},{accountId:String(empty._id),amountMinor:0}],suppliers:[],expectedNetAssetsMinor:1000});
            saved=ok(await http('PUT',base,{expectedRevision:p.setup.revision,input:body},b.user)).setup;p=ok(await http('POST',base+'/preview',{expectedRevision:saved.revision},b.user));assert.deepEqual(p.evidence.blockers,[]);
            ok(await http('POST',base+'/confirm',{requestKey:'reuse-existing-other',expectedRevision:p.expectedRevision,previewToken:p.previewToken,confirmation:'CONFIRM EXISTING BUSINESS SETUP'},b.user));
            assert.equal(await BusinessTransaction.countDocuments({shopId:b.shop._id}),1);assert.equal((await otherTx(s=>accounts.getAccountBalance(b.actor,String(empty._id),s))).balanceMinor,0);
            assert.equal(await CapitalEvent.countDocuments({shopId:b.shop._id}),0);
        });
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-existing-setup-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
