import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import jwt from 'jsonwebtoken';
process.env.DOTENV_CONFIG_PATH=path.join(os.tmpdir(),'digishop-nonexistent-test-env');
process.env.ACCESS_TOKEN_EXPIRY='15m';process.env.REFRESH_TOKEN_EXPIRY='7d';
process.env.ACCESS_TOKEN_SECRET='accounting-http-test';process.env.REFRESH_TOKEN_SECRET='accounting-refresh-test';process.env.OPENAI_API_KEY='test-only';
delete process.env.BUSINESS_ACCOUNTING_ENABLED;process.env.NODE_ENV='test';
const {app}=await import('../dist/app.js');
const accounts=await import('../dist/utils/businessAccounts.js');
const {invoiceAccountingEnabled,throwAccountingTransactionError,recordIntegratedSale}=await import('../dist/utils/invoiceAccountingIntegration.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {User}=await import('../dist/models/user.model.js');
const {Customer}=await import('../dist/models/customer.model.js');
const {CustomerLedger}=await import('../dist/models/customerLedger.model.js');
const {Order}=await import('../dist/models/order.model.js');
const {Product}=await import('../dist/models/product.model.js');
const {StockLog}=await import('../dist/models/stockLog.model.js');
const {InvoiceAdjustment}=await import('../dist/models/invoiceAdjustment.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const {BusinessEntity}=await import('../dist/models/businessEntity.model.js');
const {BusinessBrand,ProductBrandLink}=await import('../dist/models/businessBrand.model.js');
const {BusinessTransaction}=await import('../dist/models/businessTransaction.model.js');
const binary='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

await test('Phase 2B actual HTTP financial writers with isolated MongoDB transactions',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-accounting-http-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','accountingHttp','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/accounting_http_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(error){if(n>40)throw error;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'accountingHttp',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const Model of [Shop,User,Customer,CustomerLedger,Order,Product,StockLog,InvoiceAdjustment,FinancialAccount,BusinessTransaction,BusinessEntity,BusinessBrand,ProductBrandLink]){await Model.createCollection();await Model.createIndexes();}
        const ownerId=new mongoose.Types.ObjectId(),foreignId=new mongoose.Types.ObjectId();
        const shop=await Shop.create({name:'HTTP Accounting Shop',ownerId,address:'Test',contactNo:'03111111111',subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)});
        const foreignShop=await Shop.create({name:'Other Shop',ownerId:foreignId,address:'Test',contactNo:'03222222222',subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)});
        const owner=await User.create({_id:ownerId,shopId:shop._id,role:'OWNER',username:'httpowner',email:'owner@accounting.test',password:'testing123'});
        const cashier=await User.create({shopId:shop._id,role:'CASHIER',username:'httpcashier',email:'cashier@accounting.test',password:'testing123'});
        const foreign=await User.create({_id:foreignId,shopId:foreignShop._id,role:'OWNER',username:'otherowner',email:'other@accounting.test',password:'testing123'});
        const admin=await User.create({role:'ADMIN',username:'httpadmin',email:'admin@accounting.test',password:'testing123'});
        const actor={_id:ownerId,shopId:shop._id,role:'OWNER',username:owner.username};
        const run=fn=>accounts.businessTransaction(actor,fn);
        const account=(code,kind)=>run(s=>accounts.createFinancialAccount(actor,{code,name:code,kind},s));
        const cash=await account('CASH','CASH'),bank=await account('BANK','BANK'),empty=await account('EMPTY','CASH'),equity=await account('EQUITY','OPENING_EQUITY'),clearing=await account('CONTROL','SETTLEMENT_CLEARING');
        const cutoffAt=new Date(Date.now()-60000).toISOString();
        for(const a of [cash,bank])await run(s=>accounts.recordOpeningBalance(actor,{accountId:String(a._id),equityAccountId:String(equity._id),amountMinor:1000000,occurredAt:cutoffAt,requestKey:'opening-'+a.code,reason:'Counted test money',confirmation:'CONFIRM OPENING BALANCE'},s));
        await run(s=>accounts.prepareCashBankCutover(actor,{clearingAccountId:String(clearing._id),cutoffAt,confirmation:'PREPARE CASH BANK CUTOVER',accounts:[{accountId:String(cash._id),confirmedBalanceMinor:1000000},{accountId:String(bank._id),confirmedBalanceMinor:1000000},{accountId:String(empty._id),confirmedBalanceMinor:0}]},s));
        const balance=a=>run(s=>accounts.getAccountBalance(actor,String(a._id),s)).then(row=>row.balanceMinor);
        const report=()=>run(s=>accounts.reconcileCashBank(actor,{clearingAccountId:String(clearing._id),limit:100},s));
        server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
        async function http(method,route,body,user=owner){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2${route}`,{method,headers:{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
        let n=0;
        const key=label=>'http-'+label+'-'+(++n);
        async function product(){return Product.create({shopId:shop._id,name:'Cable '+(++n),brand:'Wire',slug:'http-cable-'+n,category:new mongoose.Types.ObjectId(),unit:'m',stockQuantity:20,costPrice:10,retailPrice:50,wholesalePrice:45});}
        async function customer(){return Customer.create({shopId:shop._id,name:'Customer '+(++n),phoneNo:String(33000000000+n)});}
        function saleBody(p,extra={}){return {items:[{productId:String(p._id),quantity:2}],saleType:'RETAIL',discountType:'NONE',discountValue:0,paidAmount:100,requestKey:key('sale'),receiptAccountId:String(cash._id),...extra};}
        async function sale(extra={},user=owner){const p=await product();const body=saleBody(p,extra);const result=await http('POST','/orders/create-order',body,user);assert.equal(result.status,201,JSON.stringify(result.body));return {p,body,order:result.body.data};}
        async function preview(orderId,kind,extra={}){const current=await Order.findById(orderId);const body={requestKey:key('operation'),expectedRevision:current.revision??0,reason:'Verified HTTP test',returns:[],additions:[],...extra};return {body,response:await http('POST',`/orders/${orderId}/${kind}/preview`,body)};}
        async function operation(orderId,kind,extra={}){const p=await preview(orderId,kind,extra);assert.equal(p.response.status,200,JSON.stringify(p.response.body));assert.equal(p.response.body.data.canSubmit,true,JSON.stringify(p.response.body));const body={...p.body,confirmationToken:p.response.body.data.confirmationToken};const result=await http('POST',`/orders/${orderId}/${kind}`,body);assert.equal(result.status,200,JSON.stringify(result.body));return {body,event:result.body.data.event};}
        const returns=(order,quantity=1,disposition='RESTOCK')=>[{lineId:order.items[0].lineId,quantity,disposition}];
        async function quote(user=owner){const p=await product();const response=await http('POST','/orders/quotation',{items:[{productId:String(p._id),quantity:2}],saleType:'RETAIL',discountType:'NONE',discountValue:0},user);assert.equal(response.status,201);return {p,quotation:response.body.data.quotation};}
        async function fundedCustomer(){const buyer=await customer(),donor=await sale({customerId:String(buyer._id)});await operation(donor.order._id,'adjustments',{returns:returns(donor.order,2),creditIssueAmount:100});return buyer;}
        async function cashierTransaction(work){const session=await mongoose.startSession();session.startTransaction({readConcern:{level:'snapshot'}});try{const value=await work(session);await session.commitTransaction();return value;}catch(error){if(session.inTransaction())await session.abortTransaction();throw error;}finally{await session.endSession();}}
        const cashierActor={_id:cashier._id,shopId:shop._id,role:'CASHIER',username:cashier.username};
        let legacy,paid,partial;
        await t.test('disabled default preserves OWNER/CASHIER cash sales, missing routing, and existing cancellation',async()=>{
            assert.equal(invoiceAccountingEnabled(),false);
            legacy=await sale({receiptAccountId:undefined},cashier);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId:legacy.order._id}),0);assert.equal(await BusinessTransaction.countDocuments({'source.kind':'INVOICE_RECEIPT'}),0);
            assert.equal(legacy.order.accountingMode,undefined);
            const old=await sale({receiptAccountId:undefined});assert.equal((await http('PATCH',`/orders/${old.order._id}/cancel`,{})).status,200);
            assert.equal((await Product.findById(old.p._id)).stockQuantity,20);
        });
        await t.test('explicit flag refuses non-test environments and cannot enable live posting',async()=>{
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';process.env.NODE_ENV='production';
            const p=await product(),before=await Order.countDocuments();
            try{assert.equal((await http('POST','/orders/create-order',saleBody(p))).status,503);assert.equal(await Order.countDocuments(),before);}finally{process.env.NODE_ENV='test';}
            assert.equal(invoiceAccountingEnabled(),true);
        });
        await t.test('OWNER sale creates one initial source, exact cash posting, snapshots and idempotent replay',async()=>{
            const before=await balance(cash);paid=await sale();assert.equal(await balance(cash),before+10000);
            const event=await InvoiceAdjustment.findOne({orderId:paid.order._id,kind:'SALE'});assert.equal(event.financial.cashReceivedMinor,10000);assert.equal(String(event.cashRouting.receiptAccountId),String(cash._id));
            assert.equal(paid.order.accountingMode,'INTEGRATION_TEST');assert.equal(paid.order.originalSnapshot.createdByName,owner.username);
            assert.equal((await http('POST','/orders/create-order',paid.body)).status,200);assert.equal((await Product.findById(paid.p._id)).stockQuantity,18);assert.equal(await balance(cash),before+10000);
            assert.equal((await http('POST','/orders/create-order',{...paid.body,receiptAccountId:String(bank._id)})).status,409);
        });
        await t.test('missing, malformed, foreign or non-cash routing rolls back sale and counter',async()=>{
            const otherAccount=await FinancialAccount.create({shopId:foreignShop._id,code:'FOREIGN',name:'Foreign',kind:'CASH',normalSide:'DEBIT',authority:'JOURNAL'});
            for(const route of [undefined,'bad',String(otherAccount._id),String(equity._id)]){
                const p=await product(),count=await Order.countDocuments(),counter=(await Shop.findById(shop._id)).invoiceCounter;
                const response=await http('POST','/orders/create-order',saleBody(p,{receiptAccountId:route}));assert.ok([400,404,409].includes(response.status),JSON.stringify(response.body));
                assert.equal((await Product.findById(p._id)).stockQuantity,20);assert.equal(await Order.countDocuments(),count);assert.equal((await Shop.findById(shop._id)).invoiceCounter,counter);
            }
        });
        await t.test('credit sale records initial money only; partial/full payments update debt and bank atomically',async()=>{
            const buyer=await customer();const before=await balance(cash);partial=await sale({paidAmount:20,customerId:String(buyer._id)});
            assert.equal(await balance(cash),before+2000);assert.equal((await Customer.findById(buyer._id)).remainingMoney,80);
            const bankBefore=await balance(bank);await operation(partial.order._id,'payments',{cashReceivedAmount:30,receiptAccountId:String(bank._id)});
            assert.equal(await balance(bank),bankBefore+3000);assert.equal((await Customer.findById(buyer._id)).remainingMoney,50);
            await operation(partial.order._id,'payments',{cashReceivedAmount:50,receiptAccountId:String(bank._id)});
            assert.equal(await balance(bank),bankBefore+8000);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);
            assert.equal((await run(s=>accounts.reconcileBusinessCustomer(actor,String(buyer._id),s))).reconciled,true);
        });
        await t.test('zero-paid customer sale records source and debt without inventing cash',async()=>{
            const buyer=await customer(),before=await balance(cash);const f=await sale({paidAmount:0,receiptAccountId:undefined,customerId:String(buyer._id)});
            assert.equal(await balance(cash),before);assert.equal((await Customer.findById(buyer._id)).remainingMoney,100);assert.equal(await InvoiceAdjustment.countDocuments({orderId:f.order._id,kind:'SALE'}),1);
            assert.equal(await BusinessTransaction.countDocuments({'source.referenceId':(await InvoiceAdjustment.findOne({orderId:f.order._id}))._id}),0);
        });
        await t.test('zero-money credit sale rejects unreconciled existing debt instead of extending an inconsistent balance',async()=>{
            const buyer=await customer(),p=await product();await Customer.updateOne({_id:buyer._id},{$set:{remainingMoney:10}});
            const count=await Order.countDocuments();const response=await http('POST','/orders/create-order',saleBody(p,{paidAmount:0,receiptAccountId:undefined,customerId:String(buyer._id)}));
            assert.equal(response.status,409);assert.equal((await Customer.findById(buyer._id)).remainingMoney,10);assert.equal(await Order.countDocuments(),count);assert.equal((await Product.findById(p._id)).stockQuantity,20);assert.equal(await CustomerLedger.countDocuments({customerId:buyer._id}),0);
        });
        await t.test('preview binds account routing; missing routing and changed account cannot be confirmed',async()=>{
            const buyer=await customer(),f=await sale({paidAmount:20,customerId:String(buyer._id)});
            const missing=await preview(f.order._id,'payments',{cashReceivedAmount:10});assert.equal(missing.response.body.data.canSubmit,false);assert.match(missing.response.body.data.validationMessage,/explicit receipt/);
            const p=await preview(f.order._id,'payments',{cashReceivedAmount:10,receiptAccountId:String(cash._id)});assert.equal(p.response.body.data.canSubmit,true);
            const response=await http('POST',`/orders/${f.order._id}/payments`,{...p.body,receiptAccountId:String(bank._id),confirmationToken:p.response.body.data.confirmationToken});assert.equal(response.status,409);
            assert.equal((await Customer.findById(buyer._id)).remainingMoney,80);
        });
        await t.test('RESTOCK return refunds actual cash once, while DAMAGED exchange uses current added price',async()=>{
            const f=await sale(),before=await balance(cash);const returned=await operation(f.order._id,'adjustments',{returns:returns(f.order),cashRefundAmount:50,refundAccountId:String(cash._id)});
            assert.equal(await balance(cash),before-5000);assert.equal((await Product.findById(f.p._id)).stockQuantity,19);
            assert.equal((await http('POST',`/orders/${f.order._id}/adjustments`,returned.body)).status,200);assert.equal((await Product.findById(f.p._id)).stockQuantity,19);
            const g=await sale();await Product.updateOne({_id:g.p._id},{$set:{retailPrice:60}});const bankBefore=await balance(bank);
            await operation(g.order._id,'adjustments',{returns:returns(g.order,1,'DAMAGED'),additions:[{productId:String(g.p._id),quantity:1}],cashReceivedAmount:10,receiptAccountId:String(bank._id)});
            const saved=await Order.findById(g.order._id);assert.equal(saved.items[0].unitPrice,50);assert.equal(saved.items[1].unitPrice,60);assert.equal(saved.totalPrice,110);assert.equal(await balance(bank),bankBefore+1000);assert.equal((await Product.findById(g.p._id)).stockQuantity,17);
            assert.equal((await StockLog.findOne({referenceId:g.order._id,disposition:'DAMAGED'})).quantityDelta,0);
        });
        await t.test('partial unpaid return reduces debt before refunds and creates no cash movement',async()=>{
            const buyer=await customer(),f=await sale({paidAmount:20,customerId:String(buyer._id)}),before=await balance(cash);
            const result=await operation(f.order._id,'adjustments',{returns:returns(f.order)});
            assert.equal(result.event.financial.debtDeltaMinor,-5000);assert.equal(result.event.financial.cashRefundMinor,0);assert.equal(await balance(cash),before);assert.equal((await Customer.findById(buyer._id)).remainingMoney,30);
        });
        await t.test('mixed cash/credit refunds, mixed POS funding and credit-first restoration never double-count cash',async()=>{
            const buyer=await customer(),donor=await sale({customerId:String(buyer._id)}),before=await balance(cash);
            await operation(donor.order._id,'adjustments',{returns:returns(donor.order,2),cashRefundAmount:40,creditIssueAmount:60,refundAccountId:String(cash._id)});
            assert.equal(await balance(cash),before-4000);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,6000);
            const mixed=await sale({paidAmount:40,creditAmount:60,customerId:String(buyer._id)});assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,0);
            const event=await InvoiceAdjustment.findOne({orderId:mixed.order._id,kind:'SALE'});assert.equal(event.financial.cashReceivedMinor,4000);assert.equal(event.financial.creditRedeemedMinor,6000);
            const afterSale=await balance(cash);const result=await operation(mixed.order._id,'adjustments',{returns:returns(mixed.order,2),cashRefundAmount:40,refundAccountId:String(cash._id)});
            assert.equal(result.event.financial.creditRestoredMinor,6000);assert.equal(await balance(cash),afterSale-4000);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,6000);
            assert.equal((await Order.findById(mixed.order._id)).returnState,'FULL');assert.equal((await Product.findById(mixed.p._id)).stockQuantity,20);
        });
        await t.test('credit-only payment and issuance have source history but no cash postings',async()=>{
            const buyer=await customer(),donor=await sale({customerId:String(buyer._id)});
            const before=await balance(cash);await operation(donor.order._id,'adjustments',{returns:returns(donor.order,2),creditIssueAmount:100});assert.equal(await balance(cash),before);
            const debt=await sale({paidAmount:0,receiptAccountId:undefined,customerId:String(buyer._id)});const count=await BusinessTransaction.countDocuments();
            await operation(debt.order._id,'payments',{creditRedeemedAmount:100});assert.equal(await BusinessTransaction.countDocuments(),count);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,0);
        });
        await t.test('settlement cancellation restores remaining stock/refunds once; old cancellation cannot bypass it',async()=>{
            const f=await sale();assert.equal((await http('PATCH',`/orders/${f.order._id}/cancel`,{})).status,409);
            await operation(f.order._id,'adjustments',{returns:returns(f.order),cashRefundAmount:50,refundAccountId:String(cash._id)});const before=await balance(cash);
            const cancelled=await operation(f.order._id,'cancellations',{cashRefundAmount:50,refundAccountId:String(cash._id)});
            assert.equal((await Order.findById(f.order._id)).status,'CANCELLED');assert.equal(await balance(cash),before-5000);assert.equal((await Product.findById(f.p._id)).stockQuantity,20);
            assert.equal((await http('POST',`/orders/${f.order._id}/cancellations`,cancelled.body)).status,200);assert.equal((await Product.findById(f.p._id)).stockQuantity,20);
        });
        await t.test('quotation conversion creates its own source and preserves price, creator and retry behavior',async()=>{
            const p=await product();const response=await http('POST','/orders/quotation',{items:[{productId:String(p._id),quantity:2}],saleType:'RETAIL',discountType:'NONE',discountValue:0});assert.equal(response.status,201);
            const quotation=response.body.data.quotation,body={paidAmount:100,receiptAccountId:String(bank._id),requestKey:key('convert')},before=await balance(bank);
            const result=await http('PATCH',`/orders/${quotation._id}`,body);assert.equal(result.status,201,JSON.stringify(result.body));const order=result.body.data.createOrder;
            assert.equal(await balance(bank),before+10000);assert.equal((await Order.findById(quotation._id)).status,'CONVERTED');assert.equal((await Product.findById(p._id)).stockQuantity,18);
            const event=await InvoiceAdjustment.findOne({orderId:order._id,kind:'SALE'});assert.equal(String(event.sourceQuotationId),quotation._id);assert.equal(String(event.createdBy),String(ownerId));
            assert.equal((await http('PATCH',`/orders/${quotation._id}`,body)).status,200);assert.equal(await balance(bank),before+10000);
            assert.equal((await http('PATCH',`/orders/${quotation._id}`,{...body,requestKey:key('second-convert')})).status,409);
        });
        await t.test('partial quotation conversion preserves customer debt and rolls back entirely on posting failure',async()=>{
            const p=await product(),buyer=await customer();const q=await http('POST','/orders/quotation',{items:[{productId:String(p._id),quantity:2}],saleType:'RETAIL',discountType:'NONE',discountValue:0});
            const id=q.body.data.quotation._id,body={paidAmount:20,customerId:String(buyer._id),receiptAccountId:String(bank._id),requestKey:key('partial-convert')};
            const counter=(await Shop.findById(shop._id)).invoiceCounter,before=await balance(bank);
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{'source.kind':{$ne:'INVOICE_RECEIPT'}}});
            try{assert.equal((await http('PATCH',`/orders/${id}`,body)).status,500);}finally{await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{}});}
            assert.equal((await Order.findById(id)).status,'DRAFT');assert.equal((await Product.findById(p._id)).stockQuantity,20);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);assert.equal((await Shop.findById(shop._id)).invoiceCounter,counter);assert.equal(await balance(bank),before);
            const result=await http('PATCH',`/orders/${id}`,body);assert.equal(result.status,201);assert.equal(result.body.data.createOrder.customerId,String(buyer._id));assert.equal((await Customer.findById(buyer._id)).remainingMoney,80);assert.equal(await balance(bank),before+2000);
        });
        await t.test('concurrent quotation conversions cannot create two invoices or initial receipts',async()=>{
            const p=await product();const q=await http('POST','/orders/quotation',{items:[{productId:String(p._id),quantity:2}],saleType:'RETAIL',discountType:'NONE',discountValue:0});const id=q.body.data.quotation._id,before=await balance(cash);
            const body={paidAmount:100,receiptAccountId:String(cash._id),requestKey:key('race-conversion')};
            const results=await Promise.all([http('PATCH',`/orders/${id}`,body),http('PATCH',`/orders/${id}`,{...body,requestKey:key('other-conversion')})]);
            assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal(await balance(cash),before+10000);assert.equal((await Product.findById(p._id)).stockQuantity,18);assert.equal(await InvoiceAdjustment.countDocuments({sourceQuotationId:id}),1);
        });
        await t.test('anonymous store-credit recipient remains separate from original invoice customer',async()=>{
            const buyer=await customer(),f=await sale(),before=await balance(cash);
            await operation(f.order._id,'adjustments',{returns:returns(f.order,2),creditIssueAmount:100,creditRecipientId:String(buyer._id)});
            const saved=await Order.findById(f.order._id);assert.equal(saved.customerId,undefined);assert.equal(String(saved.creditRecipientId),String(buyer._id));assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,10000);assert.equal(await balance(cash),before);
        });
        await t.test('pre-cutover legacy invoice can receive new payment without inventing its initial event',async()=>{
            const before=await balance(cash);const body={requestKey:key('legacy-pay'),cashReceivedAmount:0};
            const buyer=await customer();delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            const f=await sale({paidAmount:20,customerId:String(buyer._id),receiptAccountId:undefined});process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            const oldDate=new Date(+new Date(cutoffAt)-86400000);
            await Order.collection.updateOne({_id:new mongoose.Types.ObjectId(f.order._id)},{$set:{createdAt:oldDate,'originalSnapshot.createdAt':oldDate}});
            await CustomerLedger.collection.updateMany({referenceId:new mongoose.Types.ObjectId(f.order._id)},{$set:{createdAt:oldDate}});
            await operation(f.order._id,'payments',{...body,cashReceivedAmount:30,receiptAccountId:String(cash._id)});
            assert.equal(await balance(cash),before+3000);assert.equal(await InvoiceAdjustment.countDocuments({orderId:f.order._id,kind:'SALE'}),0);assert.equal((await Customer.findById(buyer._id)).remainingMoney,50);
        });
        await t.test('post-cutover invoices missing initial evidence are rejected instead of silently filling the gap',async()=>{
            const buyer=await customer();delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            const f=await sale({paidAmount:20,receiptAccountId:undefined,customerId:String(buyer._id)});process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            const p=await preview(f.order._id,'payments',{cashReceivedAmount:10,receiptAccountId:String(cash._id)}),before=await balance(cash);
            const result=await http('POST',`/orders/${f.order._id}/payments`,{...p.body,confirmationToken:p.response.body.data.confirmationToken});assert.equal(result.status,409);assert.match(result.body.message,/Initial invoice funding/);
            assert.equal((await Customer.findById(buyer._id)).remainingMoney,80);assert.equal((await Order.findById(f.order._id)).revision,0);assert.equal(await balance(cash),before);assert.equal(await InvoiceAdjustment.countDocuments({orderId:f.order._id}),0);
        });
        await t.test('even zero-cash integration requires a prepared shop; internal source creation requires a transaction',async()=>{
            const p=await Product.create({shopId:foreignShop._id,name:'Other Cable',slug:'other-cable',brand:'Wire',category:new mongoose.Types.ObjectId(),unit:'m',stockQuantity:20,costPrice:10,retailPrice:50,wholesalePrice:45});
            const buyer=await Customer.create({shopId:foreignShop._id,name:'Other buyer',phoneNo:'03999999999'}),before=await Order.countDocuments();
            const result=await http('POST','/orders/create-order',saleBody(p,{paidAmount:0,receiptAccountId:undefined,customerId:String(buyer._id)}),foreign);assert.equal(result.status,409);assert.equal(await Order.countDocuments(),before);assert.equal((await Product.findById(p._id)).stockQuantity,20);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);
            const count=await InvoiceAdjustment.countDocuments();await assert.rejects(recordIntegratedSale(actor,{}, {requestKey:'outside-txn',requestHash:'invalid',routing:{}},null),/active transaction/);assert.equal(await InvoiceAdjustment.countDocuments(),count);
        });
        await t.test('enabled CASHIER sales post while Admin and cross-shop restrictions remain',async()=>{
            const p=await product();assert.equal((await http('POST','/orders/create-order',saleBody(p),cashier)).status,201);assert.equal((await http('POST','/orders/create-order',saleBody(p),admin)).status,403);
            assert.equal((await http('POST',`/orders/${paid.order._id}/adjustments/preview`,{requestKey:key('foreign'),expectedRevision:0,reason:'Invalid',returns:[],additions:[]},foreign)).status,404);
            assert.equal((await Product.findById(p._id)).stockQuantity,18);
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;const response=await http('POST','/orders/create-order',saleBody(p,{receiptAccountId:undefined}),cashier);assert.equal(response.status,201);process.env.BUSINESS_ACCOUNTING_ENABLED='true';
        });
        await t.test('late initial-sale journal failure rolls back invoice, stock, source, debt and counter',async()=>{
            const p=await product(),buyer=await customer(),before=await balance(cash),count=await Order.countDocuments(),counter=(await Shop.findById(shop._id)).invoiceCounter;
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{'source.kind':{$ne:'INVOICE_RECEIPT'}}});
            try{assert.equal((await http('POST','/orders/create-order',saleBody(p,{paidAmount:20,customerId:String(buyer._id)}))).status,500);}finally{await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{}});}
            assert.equal(await Order.countDocuments(),count);assert.equal((await Product.findById(p._id)).stockQuantity,20);assert.equal((await Shop.findById(shop._id)).invoiceCounter,counter);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);assert.equal(await CustomerLedger.countDocuments({customerId:buyer._id}),0);assert.equal(await balance(cash),before);
        });
        await t.test('late refund journal failure rolls back stock, wallet, invoice revision and all financial history',async()=>{
            const buyer=await customer(),f=await sale({customerId:String(buyer._id)}),before=await balance(cash);
            const p=await preview(f.order._id,'adjustments',{returns:returns(f.order,2),cashRefundAmount:40,creditIssueAmount:60,refundAccountId:String(cash._id)});assert.equal(p.response.body.data.canSubmit,true);
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{'source.kind':{$ne:'INVOICE_REFUND'}}});
            try{const response=await http('POST',`/orders/${f.order._id}/adjustments`,{...p.body,confirmationToken:p.response.body.data.confirmationToken});assert.equal(response.status,500);}finally{await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{}});}
            assert.equal((await Order.findById(f.order._id)).revision,0);assert.equal((await Product.findById(f.p._id)).stockQuantity,18);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,0);assert.equal(await InvoiceAdjustment.countDocuments({orderId:f.order._id}),1);assert.equal(await StockLog.countDocuments({referenceId:f.order._id}),1);assert.equal(await balance(cash),before);
        });
        await t.test('late payment journal failure restores outstanding debt and payment history',async()=>{
            const buyer=await customer(),f=await sale({paidAmount:20,customerId:String(buyer._id)}),before=await balance(bank);
            const p=await preview(f.order._id,'payments',{cashReceivedAmount:80,receiptAccountId:String(bank._id)});assert.equal(p.response.body.data.canSubmit,true);
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{'source.kind':{$ne:'INVOICE_RECEIPT'}}});
            try{assert.equal((await http('POST',`/orders/${f.order._id}/payments`,{...p.body,confirmationToken:p.response.body.data.confirmationToken})).status,500);}finally{await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{}});}
            assert.equal((await Customer.findById(buyer._id)).remainingMoney,80);assert.equal((await Order.findById(f.order._id)).paidAmount,20);assert.equal((await Order.findById(f.order._id)).revision,0);assert.equal(await InvoiceAdjustment.countDocuments({orderId:f.order._id}),1);assert.equal(await CustomerLedger.countDocuments({referenceId:f.order._id}),1);assert.equal(await balance(bank),before);
        });
        await t.test('concurrent identical sales and refund submissions cannot duplicate stock or cash',async()=>{
            const p=await product(),body=saleBody(p),before=await balance(cash);
            const results=await Promise.all([http('POST','/orders/create-order',body),http('POST','/orders/create-order',body)]);assert.ok(results.some(r=>r.status===201));assert.ok(results.every(r=>[200,201,409].includes(r.status)));
            const replay=await http('POST','/orders/create-order',body);assert.equal(replay.status,200);assert.equal(await balance(cash),before+10000);assert.equal((await Product.findById(p._id)).stockQuantity,18);
            const order=replay.body.data,pv=await preview(order._id,'adjustments',{returns:returns(order,2),cashRefundAmount:100,refundAccountId:String(cash._id)}),refund={...pv.body,confirmationToken:pv.response.body.data.confirmationToken};
            const refunds=await Promise.all([http('POST',`/orders/${order._id}/adjustments`,refund),http('POST',`/orders/${order._id}/adjustments`,refund)]);assert.ok(refunds.some(r=>r.status===200));
            assert.equal((await http('POST',`/orders/${order._id}/adjustments`,refund)).status,200);assert.equal(await balance(cash),before);assert.equal((await Product.findById(p._id)).stockQuantity,20);
        });
        await t.test('concurrent payments reject stale revisions and cannot collect outstanding debt twice',async()=>{
            const buyer=await customer(),f=await sale({paidAmount:20,customerId:String(buyer._id)}),before=await balance(bank);
            const p=await preview(f.order._id,'payments',{cashReceivedAmount:80,receiptAccountId:String(bank._id)}),body={...p.body,confirmationToken:p.response.body.data.confirmationToken};
            const results=await Promise.all([http('POST',`/orders/${f.order._id}/payments`,body),http('POST',`/orders/${f.order._id}/payments`,{...body,requestKey:key('other-payment')})]);assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal(await balance(bank),before+8000);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);
        });
        await t.test('reconciliation verifies integrated sources, detects missing and misrouted postings, and never repairs history',async()=>{
            const event=await InvoiceAdjustment.findOne({orderId:paid.order._id,kind:'SALE'}).lean(),journal=await BusinessTransaction.findOne({'source.referenceId':event._id}).lean();
            let r=await report();assert.deepEqual(r.entries.find(row=>row.eventId===String(event._id)).issues,[]);
            try{await BusinessTransaction.collection.deleteOne({_id:journal._id});r=await report();assert.ok(r.entries.find(row=>row.eventId===String(event._id)).issues.includes('MISSING_INVOICE_RECEIPT'));assert.equal(await BusinessTransaction.countDocuments({_id:journal._id}),0);}finally{await BusinessTransaction.collection.insertOne(journal);}
            const wrong=journal.postings.map(row=>({...row,accountId:String(row.accountId)===String(cash._id)?bank._id:row.accountId}));
            try{await BusinessTransaction.collection.updateOne({_id:journal._id},{$set:{postings:wrong}});r=await report();assert.ok(r.entries.find(row=>row.eventId===String(event._id)).issues.includes('ROUTING_MISMATCH_INVOICE_RECEIPT'));}finally{await BusinessTransaction.collection.updateOne({_id:journal._id},{$set:{postings:journal.postings}});}
            assert.equal(r.livePostingEnabled,false);
        });
        await t.test('reconciliation detects duplicate source journals and initial events if required indexes were missing',async()=>{
            // Deliberate corruption ONLY in this process's fresh disposable database.
            const event=await InvoiceAdjustment.findOne({orderId:paid.order._id,kind:'SALE'}).lean(),journal=await BusinessTransaction.findOne({'source.referenceId':event._id}).lean();
            const ji=(await BusinessTransaction.collection.indexes()).find(row=>row.key['source.kind']===1&&row.unique);
            const ei=(await InvoiceAdjustment.collection.indexes()).find(row=>row.key.orderId===1&&row.key.kind===1&&row.unique);
            const duplicateJournal={...journal,_id:new mongoose.Types.ObjectId(),requestKey:key('corrupt-journal')},duplicateEvent={...event,_id:new mongoose.Types.ObjectId(),requestKey:key('corrupt-event')};
            try{
                await BusinessTransaction.collection.dropIndex(ji.name);await InvoiceAdjustment.collection.dropIndex(ei.name);
                await BusinessTransaction.collection.insertOne(duplicateJournal);await InvoiceAdjustment.collection.insertOne(duplicateEvent);
                const r=await report();assert.ok(r.entries.find(row=>row.eventId===String(event._id)).issues.includes('DUPLICATE_INVOICE_RECEIPT'));assert.ok(r.duplicateInitialEvents.entries.some(row=>String(row._id)===paid.order._id));
            }finally{
                await BusinessTransaction.collection.deleteOne({_id:duplicateJournal._id});await InvoiceAdjustment.collection.deleteOne({_id:duplicateEvent._id});
                await BusinessTransaction.createIndexes();await InvoiceAdjustment.createIndexes();
            }
        });
        await t.test('disabled rollback locks already-integrated invoices instead of creating unposted mutations',async()=>{
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            try{const result=await http('POST',`/orders/${paid.order._id}/adjustments/preview`,{expectedRevision:0,requestKey:key('disabled-edit'),reason:'No silent gap',returns:returns(paid.order),additions:[],cashRefundAmount:50});assert.equal(result.status,409);assert.equal((await Order.findById(paid.order._id)).revision,0);}finally{process.env.BUSINESS_ACCOUNTING_ENABLED='true';}
        });
        await t.test('unknown commit outcomes and write conflicts return controlled retry guidance',()=>{
            assert.throws(()=>throwAccountingTransactionError({hasErrorLabel:label=>label==='UnknownTransactionCommitResult'}),error=>error.statusCode===503&&/identical/.test(error.message));
            assert.throws(()=>throwAccountingTransactionError({code:112}),error=>error.statusCode===409);
        });
        await t.test('payment-account read route exposes only active same-shop names/kinds to OWNER/CASHIER',async()=>{
            const hidden=await account('UNPREPARED','BANK');
            for(const user of [owner,cashier]){const response=await http('GET','/orders/payment-accounts',undefined,user);assert.equal(response.status,200);assert.equal(response.body.data.accountingEnabled,true);assert.equal(response.body.data.accounts.length,3);for(const row of response.body.data.accounts){assert.deepEqual(Object.keys(row).sort(),['_id','kind','name']);assert.notEqual(row._id,String(hidden._id));}}
            assert.equal((await http('GET','/orders/payment-accounts',undefined,admin)).status,403);
            assert.equal((await http('GET','/orders/payment-accounts',undefined,foreign)).status,409);
            const bad=await http('POST','/orders/create-order',saleBody(await product(),{receiptAccountId:String(hidden._id)}),cashier);assert.equal(bad.status,409);
        });
        await t.test('CASHIER retail/wholesale cash and partial sales use explicit accounts and historical cashier attribution',async()=>{
            const before=await balance(bank),f=await sale({saleType:'WHOLESALE',paidAmount:90,receiptAccountId:String(bank._id)},cashier);assert.equal(await balance(bank),before+9000);assert.equal(f.order.totalPrice,90);assert.equal(f.order.items[0].unitPrice,45);assert.equal(f.order.createdBy,String(cashier._id));assert.equal(f.order.createdByName,cashier.username);
            const event=await InvoiceAdjustment.findOne({orderId:f.order._id});assert.equal(event.createdByRole,'CASHIER');assert.equal(String((await BusinessTransaction.findOne({'source.referenceId':event._id})).createdBy),String(cashier._id));
            const buyer=await customer(),partial=await sale({paidAmount:20,customerId:String(buyer._id)},cashier);assert.equal(partial.order.amountDue,80);assert.equal((await Customer.findById(buyer._id)).remainingMoney,80);
            const beforeReplay=await balance(bank);assert.equal((await http('POST','/orders/create-order',f.body,cashier)).status,200);assert.equal(await balance(bank),beforeReplay);
        });
        await t.test('CASHIER mixed and credit-only POS sales never count redeemed credit as cash',async()=>{
            const buyer=await fundedCustomer(),before=await balance(cash),f=await sale({paidAmount:20,creditAmount:30,customerId:String(buyer._id)},cashier);
            assert.equal(await balance(cash),before+2000);assert.equal(f.order.paidAmount,50);assert.equal(f.order.amountDue,50);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,7000);
            const buyer2=await fundedCustomer(),count=await BusinessTransaction.countDocuments(),g=await sale({paidAmount:0,creditAmount:100,receiptAccountId:undefined,customerId:String(buyer2._id)},cashier);assert.equal(g.order.amountDue,0);assert.equal(await BusinessTransaction.countDocuments(),count);assert.equal((await Customer.findById(buyer2._id)).storeCreditBalanceMinor,0);
        });
        await t.test('OWNER and CASHIER quotation conversions redeem mixed credit and preserve quotation prices/customer',async()=>{
            for(const user of [owner,cashier]){const buyer=await fundedCustomer(),q=await quote(owner),before=await balance(bank);await Product.updateOne({_id:q.p._id},{$set:{retailPrice:75}});
                const body={requestKey:key('mixed-conversion'),paidAmount:20,creditAmount:50,customerId:String(buyer._id),receiptAccountId:String(bank._id)};
                const result=await http('PATCH',`/orders/${q.quotation._id}`,body,user);assert.equal(result.status,201,JSON.stringify(result.body));const order=result.body.data.createOrder;
                assert.equal(order.totalPrice,100);assert.equal(order.items[0].unitPrice,50);assert.equal(order.paidAmount,70);assert.equal(order.amountDue,30);assert.equal(order.customerId,String(buyer._id));assert.equal(order.createdBy,String(user._id));assert.equal((await Customer.findById(buyer._id)).remainingMoney,30);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,5000);assert.equal(await balance(bank),before+2000);
                const event=await InvoiceAdjustment.findOne({orderId:order._id});assert.equal(event.createdByRole,user.role);assert.equal(event.financial.creditRedeemedMinor,5000);assert.equal(event.financial.cashReceivedMinor,2000);assert.equal(String((await CustomerLedger.findOne({referenceId:order._id,description:'CREDIT_REDEEMED'})).adjustmentId),String(event._id));
                assert.equal((await http('PATCH',`/orders/${q.quotation._id}`,body,user)).status,200);assert.equal(await balance(bank),before+2000);assert.equal((await http('PATCH',`/orders/${q.quotation._id}`,{...body,creditAmount:40},user)).status,409);assert.equal(String((await Order.findById(q.quotation._id)).createdBy),String(owner._id));
            }
        });
        await t.test('credit-only CASHIER conversion has no cash posting and OWNER return restores credit only',async()=>{
            const buyer=await fundedCustomer(),q=await quote(cashier),count=await BusinessTransaction.countDocuments();
            const result=await http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('credit-only-convert'),paidAmount:0,creditAmount:100,customerId:String(buyer._id)},cashier);assert.equal(result.status,201);const order=result.body.data.createOrder;
            assert.equal(order.paidAmount,100);assert.equal(order.amountDue,0);assert.equal(await BusinessTransaction.countDocuments(),count);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,0);
            const returned=await operation(order._id,'adjustments',{returns:returns(order,2)});assert.equal(returned.event.financial.creditRestoredMinor,10000);assert.equal(returned.event.financial.cashRefundMinor,0);assert.equal(await BusinessTransaction.countDocuments(),count);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,10000);assert.equal((await Product.findById(q.p._id)).stockQuantity,20);
        });
        await t.test('OWNER subsequent mixed payment/cancellation of CASHIER credit conversion reconciles debt and funding',async()=>{
            const buyer=await fundedCustomer(),q=await quote(cashier);const response=await http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('later-payment-convert'),paidAmount:20,creditAmount:50,customerId:String(buyer._id),receiptAccountId:String(cash._id)},cashier);assert.equal(response.status,201);const order=response.body.data.createOrder;
            const before=await balance(bank);await operation(order._id,'payments',{cashReceivedAmount:10,creditRedeemedAmount:20,receiptAccountId:String(bank._id)});assert.equal(await balance(bank),before+1000);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,3000);
            const cancelled=await operation(order._id,'cancellations',{cashRefundAmount:30,refundAccountId:String(cash._id)});assert.equal(cancelled.event.financial.creditRestoredMinor,7000);assert.equal(cancelled.event.financial.cashRefundMinor,3000);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,10000);assert.equal((await Product.findById(q.p._id)).stockQuantity,20);assert.equal(String((await Order.findById(order._id)).createdBy),String(cashier._id));
            assert.equal((await run(s=>accounts.reconcileBusinessCustomer(actor,String(buyer._id),s))).reconciled,true);
        });
        await t.test('CASHIER cannot use OWNER routes or internal management/balance/refund primitives',async()=>{
            const f=await sale({},cashier),source=await InvoiceAdjustment.findOne({orderId:f.order._id});
            for(const kind of ['payments','adjustments','cancellations']){for(const suffix of ['', '/preview'])assert.equal((await http('POST',`/orders/${f.order._id}/${kind}${suffix}`,{requestKey:key('forbidden'),expectedRevision:0,reason:'Forbidden',returns:[],additions:[]},cashier)).status,403);}
            assert.equal((await http('PATCH',`/orders/${f.order._id}/cancel`,{},cashier)).status,403);
            await assert.rejects(cashierTransaction(s=>accounts.getAccountBalance(cashierActor,String(cash._id),s)),/Owner/);
            await assert.rejects(cashierTransaction(s=>accounts.createFinancialAccount(cashierActor,{code:'BAD',name:'Bad',kind:'CASH'},s)),/Owner/);
            await assert.rejects(cashierTransaction(s=>accounts.recordOpeningBalance(cashierActor,{accountId:String(cash._id),equityAccountId:String(equity._id),amountMinor:1,requestKey:key('bad-opening'),occurredAt:new Date().toISOString(),reason:'Forbidden',confirmation:'CONFIRM OPENING BALANCE'},s)),/Owner/);
            await assert.rejects(cashierTransaction(s=>accounts.postInvoiceCashMovement(cashierActor,{eventId:String(source._id),cashAccountId:String(cash._id),direction:'REFUND',requestKey:key('bad-refund')},s)),/cannot issue refunds/);
            await assert.rejects(cashierTransaction(s=>accounts.postBusinessJournal(cashierActor,{requestKey:key('bad-journal'),reason:'Forbidden',occurredAt:new Date().toISOString(),postings:[]},s)),/Owner/);
            const ownerSource=await InvoiceAdjustment.findOne({orderId:paid.order._id,kind:'SALE'});
            await assert.rejects(cashierTransaction(s=>accounts.postInvoiceCashMovement(cashierActor,{eventId:String(ownerSource._id),cashAccountId:String(cash._id),direction:'RECEIPT',requestKey:key('borrowed-source')},s)),/own initial sale/);
        });
        await t.test('inactive cash/clearing accounts are hidden and rejected, without changing historical balances',async()=>{
            const before=await balance(bank);await FinancialAccount.updateOne({_id:bank._id},{$set:{isActive:false}});
            try{
                const selected=await http('GET','/orders/payment-accounts',undefined,cashier);assert.equal(selected.status,200);assert.ok(selected.body.data.accounts.every(row=>row._id!==String(bank._id)));assert.equal(await balance(bank),before);
                const p=await product(),count=await Order.countDocuments();const result=await http('POST','/orders/create-order',saleBody(p,{receiptAccountId:String(bank._id)}),cashier);assert.equal(result.status,409);assert.equal((await Product.findById(p._id)).stockQuantity,20);assert.equal(await Order.countDocuments(),count);
            }finally{await FinancialAccount.updateOne({_id:bank._id},{$set:{isActive:true}});}
            await FinancialAccount.updateOne({_id:clearing._id},{$set:{isActive:false}});
            try{assert.equal((await http('GET','/orders/payment-accounts',undefined,cashier)).status,409);const p=await product();assert.equal((await http('POST','/orders/create-order',saleBody(p),cashier)).status,409);assert.equal((await Product.findById(p._id)).stockQuantity,20);}finally{await FinancialAccount.updateOne({_id:clearing._id},{$set:{isActive:true}});}
        });
        await t.test('account deactivation after preview prevents mutation and replay of an old sale does not repost',async()=>{
            const f=await sale({receiptAccountId:String(bank._id)}),pv=await preview(f.order._id,'adjustments',{returns:returns(f.order),cashRefundAmount:50,refundAccountId:String(bank._id)}),before=await balance(bank);
            await FinancialAccount.updateOne({_id:bank._id},{$set:{isActive:false}});
            try{assert.equal((await http('POST',`/orders/${f.order._id}/adjustments`,{...pv.body,confirmationToken:pv.response.body.data.confirmationToken})).status,409);assert.equal((await Order.findById(f.order._id)).revision,0);assert.equal((await Product.findById(f.p._id)).stockQuantity,18);assert.equal((await http('POST','/orders/create-order',f.body)).status,200);assert.equal(await balance(bank),before);}finally{await FinancialAccount.updateOne({_id:bank._id},{$set:{isActive:true}});}
        });
        await t.test('invalid, excessive and insufficient quotation credit cannot change wallets, stock or quotation status',async()=>{
            const buyer=await fundedCustomer(),q=await quote(),counter=(await Shop.findById(shop._id)).invoiceCounter;
            for(const extra of [{paidAmount:80,creditAmount:30,customerId:String(buyer._id)},{paidAmount:0,creditAmount:101,customerId:String(buyer._id)},{paidAmount:0,creditAmount:100},{paidAmount:0,creditAmount:-1,customerId:String(buyer._id)},{paidAmount:0,creditAmount:'10',customerId:String(buyer._id)},{paidAmount:0,creditRedeemedAmount:100,customerId:String(buyer._id)}]){
                const response=await http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('invalid-credit-convert'),...extra},cashier);assert.ok([400,409].includes(response.status),JSON.stringify(response.body));assert.equal((await Order.findById(q.quotation._id)).status,'DRAFT');assert.equal((await Product.findById(q.p._id)).stockQuantity,20);
            }
            const emptyBuyer=await customer();assert.equal((await http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('insufficient-credit'),paidAmount:0,creditAmount:100,customerId:String(emptyBuyer._id)},cashier)).status,409);
            assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,10000);assert.equal((await Shop.findById(shop._id)).invoiceCounter,counter);
        });
        await t.test('CASHIER conversion rejects foreign customers and accounts without exposing or modifying them',async()=>{
            const q=await quote(),foreignBuyer=await Customer.create({shopId:foreignShop._id,name:'Foreign buyer',phoneNo:'03888888888'});
            assert.equal((await http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('foreign-credit'),paidAmount:0,creditAmount:100,customerId:String(foreignBuyer._id)},cashier)).status,400);
            const foreignAccount=await FinancialAccount.findOne({shopId:foreignShop._id,kind:'CASH'});assert.ok(foreignAccount);
            assert.equal((await http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('foreign-routing'),paidAmount:100,receiptAccountId:String(foreignAccount._id)},cashier)).status,404);assert.equal((await Order.findById(q.quotation._id)).status,'DRAFT');assert.equal((await Product.findById(q.p._id)).stockQuantity,20);assert.equal((await Customer.findById(foreignBuyer._id)).storeCreditBalanceMinor,0);
        });
        await t.test('mixed CASHIER conversion rolls back wallet, debt, quotation, inventory and event when journal insertion fails',async()=>{
            const buyer=await fundedCustomer(),q=await quote(),before=await balance(bank),counter=(await Shop.findById(shop._id)).invoiceCounter;
            const body={requestKey:key('rollback-credit-convert'),paidAmount:20,creditAmount:50,customerId:String(buyer._id),receiptAccountId:String(bank._id)};
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{'source.kind':{$ne:'INVOICE_RECEIPT'}}});
            try{assert.equal((await http('PATCH',`/orders/${q.quotation._id}`,body,cashier)).status,500);}finally{await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{}});}
            assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,10000);assert.equal((await Customer.findById(buyer._id)).remainingMoney,0);assert.equal((await Order.findById(q.quotation._id)).status,'DRAFT');assert.equal((await Product.findById(q.p._id)).stockQuantity,20);assert.equal((await Shop.findById(shop._id)).invoiceCounter,counter);assert.equal(await InvoiceAdjustment.countDocuments({requestKey:body.requestKey}),0);assert.equal(await balance(bank),before);
            assert.equal((await http('PATCH',`/orders/${q.quotation._id}`,body,cashier)).status,201);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,5000);
        });
        await t.test('concurrent credit conversions cannot redeem one customer wallet twice',async()=>{
            const buyer=await fundedCustomer(),a=await quote(),b=await quote(),counter=(await Shop.findById(shop._id)).invoiceCounter;
            const results=await Promise.all([a,b].map(q=>http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('race-credit'),paidAmount:0,creditAmount:100,customerId:String(buyer._id)},cashier)));
            assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,0);assert.equal((await Shop.findById(shop._id)).invoiceCounter,counter+1);assert.deepEqual([(await Product.findById(a.p._id)).stockQuantity,(await Product.findById(b.p._id)).stockQuantity].sort(),[18,20]);
        });
        await t.test('concurrent identical CASHIER POS requests post once, with unchanged retry identity',async()=>{
            const p=await product(),body=saleBody(p),before=await balance(cash);const results=await Promise.all([http('POST','/orders/create-order',body,cashier),http('POST','/orders/create-order',body,cashier)]);assert.ok(results.some(row=>row.status===201));assert.equal((await http('POST','/orders/create-order',body,cashier)).status,200);assert.equal(await balance(cash),before+10000);assert.equal((await Product.findById(p._id)).stockQuantity,18);assert.equal(await InvoiceAdjustment.countDocuments({requestKey:body.requestKey}),1);
        });
        await t.test('disabled mode preserves quotation cash calculations and does not introduce credit redemption or routing',async()=>{
            const buyer=await fundedCustomer(),q=await quote();delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            try{const selected=await http('GET','/orders/payment-accounts',undefined,cashier);assert.deepEqual(selected.body.data,{accountingEnabled:false,accounts:[]});const before=await balance(cash),result=await http('PATCH',`/orders/${q.quotation._id}`,{paidAmount:20,creditAmount:50,customerId:String(buyer._id),receiptAccountId:'ignored'},cashier);assert.equal(result.status,201);assert.equal(result.body.data.createOrder.paidAmount,20);assert.equal(result.body.data.createOrder.amountDue,80);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,10000);assert.equal(await balance(cash),before);assert.equal(await InvoiceAdjustment.countDocuments({orderId:result.body.data.createOrder._id}),0);}finally{process.env.BUSINESS_ACCOUNTING_ENABLED='true';}
        });
        await t.test('reconciliation accepts cashier credit conversions and detects wallet corruption without repairing it',async()=>{
            const buyer=await fundedCustomer(),q=await quote();const response=await http('PATCH',`/orders/${q.quotation._id}`,{requestKey:key('reconcile-credit'),paidAmount:20,creditAmount:50,customerId:String(buyer._id),receiptAccountId:String(cash._id)},cashier);assert.equal(response.status,201);const order=response.body.data.createOrder,event=await InvoiceAdjustment.findOne({orderId:order._id});
            const reconcileEvent=()=>run(s=>accounts.reconcileCashBank(actor,{clearingAccountId:String(clearing._id),limit:100,page:1},s));let r=await reconcileEvent();
            let row=r.entries.find(e=>e.eventId===String(event._id));if(!row){r=await run(s=>accounts.reconcileCashBank(actor,{clearingAccountId:String(clearing._id),limit:100,page:2},s));row=r.entries.find(e=>e.eventId===String(event._id));}assert.ok(row);assert.deepEqual(row.issues,[]);
            const ledger=await CustomerLedger.findOne({referenceId:order._id,description:'CREDIT_REDEEMED'}).lean();
            try{await CustomerLedger.collection.updateOne({_id:ledger._id},{$set:{amountMinor:ledger.amountMinor+1}});const mismatch=await run(s=>accounts.reconcileBusinessCustomer(actor,String(buyer._id),s));assert.equal(mismatch.reconciled,false);assert.equal((await CustomerLedger.collection.findOne({_id:ledger._id})).amountMinor,ledger.amountMinor+1);}finally{await CustomerLedger.collection.updateOne({_id:ledger._id},{$set:{amountMinor:ledger.amountMinor}});}
        });
        let entity;
        await t.test('Accounts APIs create multiple-role entities, replay identity keys and reject duplicates',async()=>{
            const body={key:'eagle-company',name:'Eagle Cables',roles:['COMPANY','SUPPLIER'],phoneNo:'03001234567'};
            const first=await http('POST','/accounts/entities',body);assert.equal(first.status,200,JSON.stringify(first.body));entity=first.body.data;
            const again=await http('POST','/accounts/entities',body);assert.equal(again.status,200);assert.equal(again.body.data._id,entity._id);
            assert.equal((await http('POST','/accounts/entities',{...body,key:'duplicate'})).status,409);
            assert.equal((await http('POST','/accounts/entities',{...body,key:'invalid',roles:['BOGUS'],name:'Other',phoneNo:''})).status,400);
            const results=await http('GET','/accounts/entities?q=Eagle&role=COMPANY&limit=1');assert.equal(results.status,200);assert.equal(results.body.data.entries.length,1);
            assert.equal((await http('GET','/accounts/entities?q=%5B')).status,200);
            assert.equal((await http('GET','/accounts/entities?limit=101')).status,400);
        });
        await t.test('Accounts APIs resolve linked customers without duplicating financial identities and safely link brands',async()=>{
            const buyer=await customer(),before=await Customer.countDocuments();
            const linked=await http('POST','/accounts/entities',{key:'linked-buyer',customerId:String(buyer._id),roles:['CUSTOMER','SUPPLIER']});assert.equal(linked.status,200);
            const detail=await http('GET',`/accounts/entities/${linked.body.data._id}`);assert.equal(detail.body.data.name,buyer.name);assert.equal(await Customer.countDocuments(),before);
            assert.equal((await http('GET',`/accounts/entities?q=${encodeURIComponent(buyer.name)}`)).body.data.entries.length,1);
            assert.equal((await http('POST','/accounts/entities',{key:'duplicate-buyer',customerId:String(buyer._id),roles:['CUSTOMER']})).status,409);
            const p=await product(),brand=await http('POST','/accounts/brands',{name:p.brand,entityIds:[entity._id]});assert.equal(brand.status,200);
            const links={entityIds:[entity._id,linked.body.data._id],expectedEntityIds:[entity._id]};
            assert.equal((await http('PATCH',`/accounts/brands/${brand.body.data._id}/entities`,links)).status,200);
            assert.equal((await http('PATCH',`/accounts/brands/${brand.body.data._id}/entities`,links)).status,200);
            assert.equal((await http('PATCH',`/accounts/brands/${brand.body.data._id}/entities`,{entityIds:[],expectedEntityIds:[]})).status,409);
            assert.equal((await http('PUT',`/accounts/products/${p._id}/brand`,{brandId:brand.body.data._id})).status,200);
            assert.ok((await http('GET',`/accounts/products/${p._id}/brand`)).body.data.entities.some(row=>row._id===entity._id));
            const roles=await http('PATCH',`/accounts/entities/${entity._id}/roles`,{roles:['COMPANY','SUPPLIER','OTHER'],expectedRevision:0});assert.equal(roles.status,200);
            assert.equal((await http('PATCH',`/accounts/entities/${entity._id}/roles`,{roles:['COMPANY'],expectedRevision:0})).status,409);
        });
        await t.test('Accounts APIs expose prepared balances, paginated searchable history and read-only reconciliation',async()=>{
            const detail=await http('GET',`/accounts/financial/${cash._id}`);assert.equal(detail.status,200);assert.equal(detail.body.data.balanceMinor,await balance(cash));assert.equal(detail.body.data.livePostingEnabled,false);
            const list=await http('GET','/accounts/financial?q=CASH&limit=1');assert.equal(list.status,200);assert.ok(!Object.hasOwn(list.body.data.entries[0],'balanceMinor'));
            const history=await http('GET',`/accounts/financial/${cash._id}/history?limit=2`);assert.equal(history.status,200);assert.equal(history.body.data.entries.length,2);assert.equal(typeof history.body.data.entries[0].runningBalanceMinor,'number');
            const filtered=await http('GET',`/accounts/financial/${cash._id}/history?q=INVOICE_RECEIPT&limit=1`);assert.equal(filtered.status,200);assert.equal(filtered.body.data.entries[0].source.kind,'INVOICE_RECEIPT');assert.equal(filtered.body.data.entries[0].runningBalanceMinor,null);assert.equal(filtered.body.data.openingBalanceMinor,null);
            const invoiceSearch=await http('GET',`/accounts/financial/${cash._id}/history?q=${encodeURIComponent(paid.order.invoiceNo)}`);assert.equal(invoiceSearch.status,200);assert.ok(invoiceSearch.body.data.entries.some(row=>row.invoice?.orderId===paid.order._id));
            const dated=await http('GET',`/accounts/financial/${cash._id}/history?from=${cutoffAt}&to=${new Date().toISOString()}&limit=1`);assert.equal(dated.status,200);assert.equal(dated.body.data.entries.length,1);
            assert.equal((await http('GET',`/accounts/financial/${cash._id}/history?from=invalid`)).status,400);
            const count=await BusinessTransaction.countDocuments();const r=await http('GET',`/accounts/reconciliation?clearingAccountId=${clearing._id}&limit=2`);assert.equal(r.status,200);assert.equal(r.body.data.livePostingEnabled,false);assert.equal(await BusinessTransaction.countDocuments(),count);
        });
        await t.test('Accounts APIs retain authoritative customer debt and credit as separate accounts',async()=>{
            const buyer=await fundedCustomer();await sale({paidAmount:20,customerId:String(buyer._id)});
            const party=await http('POST','/accounts/entities',{key:'separate-balances',customerId:String(buyer._id),roles:['CUSTOMER']});
            for(const kind of ['CUSTOMER_RECEIVABLE','STORE_CREDIT_LIABILITY']){
                const created=await http('POST','/accounts/financial',{code:kind,name:kind,kind,entityId:party.body.data._id});assert.equal(created.status,200,JSON.stringify(created.body));
                const read=await http('GET',`/accounts/financial/${created.body.data._id}`);assert.equal(read.status,200);assert.equal(read.body.data.authority,'LEGACY_CUSTOMER');assert.equal(read.body.data.balanceMinor,kind==='CUSTOMER_RECEIVABLE'?8000:10000);
                delete process.env.BUSINESS_ACCOUNTING_ENABLED;
                try{assert.equal((await http('GET',`/accounts/financial/${created.body.data._id}`)).status,200);}finally{process.env.BUSINESS_ACCOUNTING_ENABLED='true';}
            }
            assert.equal((await Customer.findById(buyer._id)).remainingMoney,80);assert.equal((await Customer.findById(buyer._id)).storeCreditBalanceMinor,10000);
            assert.equal((await http('GET',`/accounts/customers/${buyer._id}/reconciliation`)).status,200);
        });
        await t.test('Accounts APIs enforce owner permissions and foreign-shop isolation',async()=>{
            for(const user of [cashier,admin]) for(const [method,url,body] of [['GET','/accounts/entities'],['GET','/accounts/financial'],['POST','/accounts/entities',{key:'forbidden',name:'Forbidden',roles:['COMPANY']}],['POST',`/accounts/financial/${cash._id}/opening`,{}],['GET',`/accounts/reconciliation?clearingAccountId=${clearing._id}`]]) assert.equal((await http(method,url,body,user)).status,403);
            assert.equal((await http('GET',`/accounts/entities/${entity._id}`,undefined,foreign)).status,404);
            assert.equal((await http('GET',`/accounts/financial/${cash._id}`,undefined,foreign)).status,404);
            assert.equal((await http('GET',`/accounts/customers/${(await customer())._id}/reconciliation`,undefined,foreign)).status,404);
            assert.equal((await http('PUT',`/accounts/products/${(await product())._id}/brand`,{brandId:entity._id},foreign)).status,400);
        });
        await t.test('all Accounts APIs reject expired and manually deactivated shops before financial persistence',async()=>{
            const paths=[['GET','/accounts/entities'],['POST','/accounts/entities',{}],['GET',`/accounts/entities/${entity._id}`],['PATCH',`/accounts/entities/${entity._id}/roles`,{}],['PATCH',`/accounts/entities/${entity._id}/customer`,{}],['GET','/accounts/brands'],['POST','/accounts/brands',{}],['GET',`/accounts/products/${entity._id}/brand`],['PUT',`/accounts/products/${entity._id}/brand`,{}],['GET','/accounts/financial'],['POST','/accounts/financial',{}],['GET',`/accounts/financial/${cash._id}`],['GET',`/accounts/financial/${cash._id}/history`],['POST',`/accounts/financial/${cash._id}/opening`,{}],['POST','/accounts/cutover/prepare',{}],['GET',`/accounts/reconciliation?clearingAccountId=${clearing._id}`],['GET',`/accounts/customers/${entity._id}/reconciliation`]];
            const original=await Shop.findById(shop._id);const before=await BusinessTransaction.countDocuments();
            try{
                for(const state of [{subscriptionExpiry:new Date(0)},{isActive:false}]){
                    await Shop.updateOne({_id:shop._id},{$set:state});
                    for(const [method,url,body] of paths){const result=await http(method,url,body);assert.equal(result.status,403,url);assert.equal(result.body.message,state.isActive===false?'Shop has been deactivated. Contact administrator.':'Subscription expired or inactive');}
                }
                assert.equal(await BusinessTransaction.countDocuments(),before);
            }finally{await Shop.updateOne({_id:shop._id},{$set:{isActive:true,subscriptionExpiry:original.subscriptionExpiry}});}
        });
        await t.test('concurrent entity creation cannot create duplicate shop identities',async()=>{
            const results=await Promise.all(['company-a','company-b'].map(key=>http('POST','/accounts/entities',{key,name:'Unique simultaneous supplier',roles:['SUPPLIER']})));
            assert.equal(results.filter(row=>row.status===200).length,1);assert.equal(results.filter(row=>row.status===409).length,1);assert.equal(await BusinessEntity.countDocuments({shopId:shop._id,name:'Unique simultaneous supplier'}),1);
        });
        await t.test('Accounts APIs create confirmed openings once and reject incomplete balances and unsafe activation',async()=>{
            const created=await http('POST','/accounts/financial',{code:'API_TILL',name:'New till',kind:'CASH'});assert.equal(created.status,200);const id=created.body.data._id;
            const body={requestKey:'api-opening-key',equityAccountId:String(equity._id),amountMinor:1000,occurredAt:new Date().toISOString(),reason:'Counted till',confirmation:'CONFIRM OPENING BALANCE'};
            assert.equal((await http('POST',`/accounts/financial/${id}/opening`,{...body,confirmation:'no'})).status,400);
            assert.equal((await http('POST',`/accounts/financial/${id}/opening`,body)).status,200);assert.equal((await http('POST',`/accounts/financial/${id}/opening`,body)).status,200);
            assert.equal((await http('GET',`/accounts/financial/${id}`)).status,409);
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            try{assert.equal((await http('GET',`/accounts/financial/${cash._id}`)).status,409);assert.equal((await http('POST','/accounts/financial',{code:'BLOCKED',name:'Blocked',kind:'BANK'})).status,409);assert.equal((await http('GET','/accounts/entities')).status,200);}finally{process.env.BUSINESS_ACCOUNTING_ENABLED='true';}
            process.env.NODE_ENV='production';try{assert.equal((await http('POST',`/accounts/financial/${id}/opening`,body)).status,503);}finally{process.env.NODE_ENV='test';}
        });
        await t.test('public cutover preparation rolls back invalid evidence and permits only confirmed test balances',async()=>{
            const till=(await http('POST','/accounts/financial',{code:'PREVIEW_TILL',name:'Prepared till',kind:'CASH'})).body.data;
            const control=(await http('POST','/accounts/financial',{code:'PREVIEW_CONTROL',name:'Other control',kind:'SETTLEMENT_CLEARING'},foreign)).body.data;
            // A second clearing account in one shop is rejected, not silently reused.
            assert.equal((await http('POST','/accounts/financial',{code:'ANOTHER_CONTROL',name:'Another',kind:'SETTLEMENT_CLEARING'})).status,409);
            const when=new Date().toISOString();
            const preparation={clearingAccountId:String(control._id),cutoffAt:when,confirmation:'PREPARE CASH BANK CUTOVER',accounts:[{accountId:till._id,confirmedBalanceMinor:0}]};
            assert.equal((await http('POST','/accounts/cutover/prepare',preparation)).status,404);
            assert.equal((await FinancialAccount.findById(till._id)).cashCutoverId,undefined);
            assert.equal((await http('POST','/accounts/cutover/prepare',{...preparation,accounts:[null]})).status,400);
            assert.equal((await http('POST',`/accounts/financial/${equity._id}/opening`,{})).status,400);
            const otherTill=(await http('POST','/accounts/financial',{code:'OTHER_TILL',name:'Other till',kind:'CASH'},foreign)).body.data;
            const valid={...preparation,accounts:[{accountId:otherTill._id,confirmedBalanceMinor:0}]};
            assert.equal((await http('POST','/accounts/cutover/prepare',valid,foreign)).status,200);
            assert.equal((await http('POST','/accounts/cutover/prepare',valid,foreign)).status,200);
            const read=await http('GET',`/accounts/financial/${otherTill._id}`,undefined,foreign);assert.equal(read.status,200);assert.equal(read.body.data.balanceMinor,0);
        });
        let auditTransfers=[],auditAt,auditBefore;
        await t.test('audit statements order tied timestamps deterministically and preserve range balances across pages',async()=>{
            auditBefore=await balance(cash);auditAt=new Date().toISOString();
            for(let i=0;i<3;i++)auditTransfers.push(await run(s=>accounts.transferCashBank(actor,{fromAccountId:String(cash._id),toAccountId:String(bank._id),amountMinor:125,requestKey:'audit-transfer-'+i,occurredAt:auditAt,reason:'Audit transfer'},s)));
            const until=new Date(+new Date(auditAt)+1).toISOString(),ids=[];
            for(let page=1;page<=3;page++){
                const response=await http('GET',`/accounts/financial/${cash._id}/history?from=${auditAt}&to=${until}&limit=1&page=${page}`);assert.equal(response.status,200,JSON.stringify(response.body));const data=response.body.data;
                assert.equal(data.rangeOpeningBalanceMinor,auditBefore);assert.equal(data.rangeClosingBalanceMinor,auditBefore-375);assert.equal(data.rangeNetChangeMinor,-375);assert.equal(data.pagination.recordCount,3);
                assert.equal(data.openingBalanceMinor,auditBefore-125*(page-1));assert.equal(data.entries[0].runningBalanceMinor,auditBefore-125*page);ids.push(data.entries[0]._id);
                const standard=data.transactions[0];assert.equal(standard.eventId,data.entries[0]._id);assert.equal(standard.eventType,'TRANSFER');assert.equal(standard.currency,'PKR');assert.equal(standard.actor.role,'OWNER');assert.equal(standard.accountPosting.moneyOutMinor,125);assert.equal(standard.accountPosting.debitMinor,0);assert.equal(standard.accountPosting.balanceDeltaMinor,-125);assert.equal(standard.recordedAt!==null,true);
            }
            assert.deepEqual(ids,auditTransfers.map(t=>String(t._id)).sort());
            const filtered=await http('GET',`/accounts/financial/${cash._id}/history?from=${auditAt}&to=${until}&type=TRANSFER&q=Audit`);assert.equal(filtered.status,200);assert.equal(filtered.body.data.rangeClosingBalanceMinor,auditBefore-375);assert.equal(filtered.body.data.entries[0].runningBalanceMinor,null);
            const excluded=await http('GET',`/accounts/financial/${cash._id}/history?to=${auditAt}&limit=1`);assert.equal(excluded.body.data.rangeClosingBalanceMinor,auditBefore);
        });
        await t.test('shop register counts journal events once rather than doubling balanced account postings',async()=>{
            const before=await BusinessTransaction.countDocuments(),result=await http('GET',`/accounts/transactions?from=${auditAt}&type=TRANSFER&limit=1`);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.data.pagination.recordCount,3);assert.equal(result.body.data.entries.length,1);assert.equal(result.body.data.entries[0].postings.length,2);assert.equal(result.body.data.entries[0].amountMinor,125);assert.equal(result.body.data.coverage.complete,false);assert.equal(result.body.data.coverage.livePostingEnabled,false);
            const second=await http('GET',`/accounts/transactions?from=${auditAt}&type=TRANSFER&limit=1&page=2`);assert.notEqual(second.body.data.entries[0].eventId,result.body.data.entries[0].eventId);
            const found=await http('GET',`/accounts/transactions?sourceId=${auditTransfers[0]._id}`);assert.equal(found.body.data.pagination.recordCount,1);
            const linked=await http('GET',`/accounts/transactions?q=${encodeURIComponent(paid.order.invoiceNo)}`);assert.ok(linked.body.data.entries.some(e=>e.sourceDocument?.orderId===paid.order._id));
            const account=await http('GET',`/accounts/transactions?from=${auditAt}&type=TRANSFER&accountId=${cash._id}`);assert.equal(account.body.data.pagination.recordCount,3);assert.equal(await BusinessTransaction.countDocuments(),before);
        });
        await t.test('transaction details preserve reversal relationships, snapshots and original source event effects',async()=>{
            const original=auditTransfers[0],before=await BusinessTransaction.countDocuments();
            const reversed=await run(s=>accounts.reverseBusinessJournal(actor,{transactionId:String(original._id),requestKey:'audit-reversal',occurredAt:new Date().toISOString(),reason:'Correct transfer'},s));
            const again=await run(s=>accounts.reverseBusinessJournal(actor,{transactionId:String(original._id),requestKey:'audit-reversal',occurredAt:reversed.occurredAt.toISOString(),reason:'Correct transfer'},s));assert.equal(String(again._id),String(reversed._id));
            const detail=await http('GET',`/accounts/transactions/${original._id}`);assert.equal(detail.status,200);assert.equal(detail.body.data.transaction.reversedBy[0]._id,String(reversed._id));assert.equal(detail.body.data.transaction.reason,'Audit transfer');
            const reverse=await http('GET',`/accounts/transactions/${reversed._id}`);assert.equal(reverse.body.data.transaction.reversalOf,String(original._id));assert.equal(reverse.body.data.originalTransaction.eventId,String(original._id));assert.equal(await BusinessTransaction.countDocuments(),before+1);
            const source=await BusinessTransaction.findOne({shopId:shop._id,'source.kind':'INVOICE_RECEIPT'});const receipt=await http('GET',`/accounts/transactions/${source._id}`);assert.equal(receipt.status,200);assert.ok(receipt.body.data.transaction.sourceDocument.orderId);assert.ok(receipt.body.data.transaction.businessAction.financial.cashReceivedMinor>0);assert.ok(!Object.hasOwn(receipt.body.data.transaction,'requestHash'));
            const scoped=await http('GET',`/accounts/financial/${cash._id}/history/${original._id}`);assert.equal(scoped.status,200);assert.equal(scoped.body.data.transaction.eventId,String(original._id));
            assert.equal((await http('GET',`/accounts/financial/${empty._id}/history/${original._id}`)).status,404);
        });
        await t.test('legacy customer transaction views retain debt/credit separation without fabricated timestamps or role',async()=>{
            const account=await FinancialAccount.findOne({shopId:shop._id,code:'CUSTOMER_RECEIVABLE'}),result=await http('GET',`/accounts/financial/${account._id}/history?type=PURCHASE`);assert.equal(result.status,200);assert.ok(result.body.data.transactions.length);
            const view=result.body.data.transactions[0];assert.equal(view.recordKind,'CUSTOMER_LEDGER');assert.equal(view.occurredAt,null);assert.ok(view.recordedAt);assert.equal(view.actor.role,null);assert.equal(view.postings[0].moneyInMinor,null);assert.equal(view.postings[0].moneyOutMinor,null);assert.equal(view.postings[0].debitMinor,8000);assert.equal(result.body.data.rangeClosingBalanceMinor,8000);
            const detail=await http('GET',`/accounts/financial/${account._id}/history/${view.eventId}`);assert.equal(detail.status,200);assert.equal(detail.body.data.transaction.eventId,view.eventId);
            const credit=await FinancialAccount.findOne({shopId:shop._id,code:'STORE_CREDIT_LIABILITY'});assert.equal((await http('GET',`/accounts/financial/${credit._id}/history/${view.eventId}`)).status,404);
            const wallet=await http('GET',`/accounts/financial/${credit._id}/history`);assert.equal(wallet.body.data.rangeClosingBalanceMinor,10000);assert.equal(wallet.body.data.transactions[0].postings[0].creditMinor,10000);assert.equal(wallet.body.data.transactions[0].postings[0].debitMinor,0);assert.equal(wallet.body.data.transactions[0].postings[0].moneyInMinor,null);assert.ok(wallet.body.data.transactions[0].occurredAt);assert.equal(wallet.body.data.transactions[0].actor.role,'OWNER');
        });
        await t.test('old journal metadata stays unknown instead of using current owner name or role',async()=>{
            const source=auditTransfers[1],saved=await BusinessTransaction.findById(source._id).lean();
            await BusinessTransaction.collection.updateOne({_id:source._id},{$unset:{createdByRole:'',recordedAt:''}});await User.updateOne({_id:owner._id},{$set:{username:'renamed owner'}});
            try{const detail=await http('GET',`/accounts/transactions/${source._id}`);assert.equal(detail.status,200);assert.equal(detail.body.data.transaction.actor.role,null);assert.equal(detail.body.data.transaction.actor.name,saved.createdByName);assert.equal(detail.body.data.transaction.recordedAt,null);assert.equal((await BusinessTransaction.collection.findOne({_id:source._id})).recordedAt,undefined);}finally{await BusinessTransaction.collection.updateOne({_id:source._id},{$set:{createdByRole:saved.createdByRole,recordedAt:saved.recordedAt}});await User.updateOne({_id:owner._id},{$set:{username:owner.username}});}
            const cashierJournal=await BusinessTransaction.findOne({shopId:shop._id,createdBy:cashier._id,'source.kind':'INVOICE_RECEIPT'}).lean();assert.equal(cashierJournal.createdByRole,'CASHIER');
            await BusinessTransaction.collection.updateOne({_id:cashierJournal._id},{$unset:{createdByRole:''}});
            try{const detail=await http('GET',`/accounts/transactions/${cashierJournal._id}`);assert.equal(detail.body.data.transaction.actor.role,'CASHIER');assert.equal(detail.body.data.transaction.actor._id,String(cashier._id));assert.equal((await BusinessTransaction.collection.findOne({_id:cashierJournal._id})).createdByRole,undefined);}finally{await BusinessTransaction.collection.updateOne({_id:cashierJournal._id},{$set:{createdByRole:'CASHIER'}});}
        });
        await t.test('audit APIs reject malformed filters, foreign records, unauthorized roles and disabled accounting',async()=>{
            for(const suffix of ['?limit=101','?page=0','?type=BOGUS','?sourceId=bad','?accountId=bad','?from=invalid','?from=2026-01-02T00:00:00.000Z&to=2026-01-01T00:00:00.000Z','?q='+('a'.repeat(101))])assert.equal((await http('GET','/accounts/transactions'+suffix)).status,400,suffix);
            assert.equal((await http('GET','/accounts/transactions/not-an-id')).status,400);
            assert.equal((await http('GET','/accounts/transactions?q=%5B')).status,200);
            assert.equal((await http('GET','/accounts/transactions?from=3000-01-01T00:00:00.000Z')).status,400);
            for(const user of [cashier,admin])for(const route of ['/accounts/transactions',`/accounts/transactions/${auditTransfers[0]._id}`,`/accounts/financial/${cash._id}/history/${auditTransfers[0]._id}`])assert.equal((await http('GET',route,undefined,user)).status,403);
            assert.equal((await http('GET',`/accounts/transactions/${auditTransfers[0]._id}`,undefined,foreign)).status,404);
            const filtered=await http('GET',`/accounts/transactions?sourceId=${auditTransfers[0]._id}`,undefined,foreign);assert.equal(filtered.status,200);assert.equal(filtered.body.data.entries.length,0);
            assert.equal((await http('GET',`/accounts/transactions?accountId=${cash._id}`,undefined,foreign)).status,404);
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;try{assert.equal((await http('GET','/accounts/transactions')).status,409);assert.equal((await http('GET',`/accounts/transactions/${auditTransfers[0]._id}`)).status,409);}finally{process.env.BUSINESS_ACCOUNTING_ENABLED='true';}
            const original=await Shop.findById(shop._id);try{await Shop.updateOne({_id:shop._id},{$set:{subscriptionExpiry:new Date(0)}});assert.equal((await http('GET','/accounts/transactions')).status,403);await Shop.updateOne({_id:shop._id},{$set:{isActive:false}});assert.equal((await http('GET','/accounts/transactions')).body.message,'Shop has been deactivated. Contact administrator.');}finally{await Shop.updateOne({_id:shop._id},{$set:{isActive:true,subscriptionExpiry:original.subscriptionExpiry}});}
        });
        await t.test('audit reads never expose an uncommitted or rolled-back posting',async()=>{
            const before=await balance(cash),session=await mongoose.startSession();session.startTransaction({readConcern:{level:'snapshot'},writeConcern:{w:'majority'}});
            let pending;
            try{
                pending=await accounts.transferCashBank(actor,{fromAccountId:String(cash._id),toAccountId:String(bank._id),amountMinor:1,requestKey:'uncommitted-audit',occurredAt:new Date().toISOString(),reason:'Will roll back'},session);
                assert.equal((await http('GET',`/accounts/transactions/${pending._id}`)).status,404);
                const register=await http('GET',`/accounts/transactions?sourceId=${pending._id}`);assert.equal(register.status,200);assert.equal(register.body.data.pagination.recordCount,0);
            }finally{if(session.inTransaction())await session.abortTransaction();await session.endSession();}
            assert.equal((await http('GET',`/accounts/transactions/${pending._id}`)).status,404);assert.equal(await balance(cash),before);
        });
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-accounting-http-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
