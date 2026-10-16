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
        for(const Model of [Shop,User,Customer,CustomerLedger,Order,Product,StockLog,InvoiceAdjustment,FinancialAccount,BusinessTransaction]){await Model.createCollection();await Model.createIndexes();}
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
        await t.test('enabled CASHIER writes fail closed; OWNER/CASHIER/Admin and cross-shop restrictions remain',async()=>{
            const p=await product();assert.equal((await http('POST','/orders/create-order',saleBody(p),cashier)).status,403);assert.equal((await http('POST','/orders/create-order',saleBody(p),admin)).status,403);
            assert.equal((await http('POST',`/orders/${paid.order._id}/adjustments/preview`,{requestKey:key('foreign'),expectedRevision:0,reason:'Invalid',returns:[],additions:[]},foreign)).status,404);
            assert.equal((await Product.findById(p._id)).stockQuantity,20);
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
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-accounting-http-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
