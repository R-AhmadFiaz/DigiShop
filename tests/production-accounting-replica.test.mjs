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
// Deliberately no dotenv file and no externally supplied database URI.
process.env.DOTENV_CONFIG_PATH=path.join(os.tmpdir(),'digishop-activation-no-env');
process.env.NODE_ENV='production';
process.env.ACCESS_TOKEN_SECRET='isolated-production-accounting-test';
process.env.REFRESH_TOKEN_SECRET='isolated-production-refresh-test';
process.env.ACCESS_TOKEN_EXPIRY='15m';process.env.REFRESH_TOKEN_EXPIRY='7d';process.env.OPENAI_API_KEY='test-only';
delete process.env.BUSINESS_ACCOUNTING_ENABLED;delete process.env.BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED;
const {app}=await import('../dist/app.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {User}=await import('../dist/models/user.model.js');
const {Product}=await import('../dist/models/product.model.js');
const {Customer}=await import('../dist/models/customer.model.js');
const {Order}=await import('../dist/models/order.model.js');
const {InvoiceAdjustment}=await import('../dist/models/invoiceAdjustment.model.js');
const {BusinessTransaction}=await import('../dist/models/businessTransaction.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const {AccountingActivationEvent}=await import('../dist/models/accountingActivationEvent.model.js');
const binary='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await test('production activation: actual HTTP and disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-production-activation-'));
  const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
  const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','activationTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
  let server;
  try{
    for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/production_activation_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
    await mongoose.connection.db.admin().command({replSetInitiate:{_id:'activationTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
    for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
    assert.equal(mongoose.connection.host,'127.0.0.1');assert.equal(mongoose.connection.name,'production_activation_test');
    for(const model of Object.values(mongoose.models)){await model.createCollection();await model.createIndexes();}
    async function fixture(name,phone){const _id=new mongoose.Types.ObjectId(),shop=await Shop.create({ownerId:_id,name,address:'Local test',contactNo:phone,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)}),owner=await User.create({_id,shopId:shop._id,username:name,email:name+'@activation.test',password:'testing123',role:'OWNER'});return {shop,owner};}
    const a=await fixture('activationowner','03111111111'),b=await fixture('unactivatedowner','03222222222');
    const cashier=await User.create({shopId:a.shop._id,username:'activationcashier',email:'cashier@activation.test',password:'testing123',role:'CASHIER'});
    const admin=await User.create({username:'activationadmin',email:'admin@activation.test',password:'testing123',role:'ADMIN'});
    const product=await Product.create({shopId:a.shop._id,name:'Cable',slug:'cable',brand:'Wire',category:new mongoose.Types.ObjectId(),stockQuantity:100,costPrice:2,retailPrice:10,wholesalePrice:8,unit:'pcs'});
    const customer=await Customer.create({shopId:a.shop._id,name:'Customer',phoneNo:'03333333333'});
    server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    async function http(method,url,body,user=a.owner){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v2${url}`,{method,headers:{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
    const ok=r=>{assert.ok(r.status>=200&&r.status<300,JSON.stringify(r));return r.body.data;};
    const root='/accounts/activation';let revision=0,preview,setup,cash,bank,confirmBody;
    let serial=0,legacyInvoice;
    const action=(operation,body={},user=a.owner)=>http('POST',root+'/'+operation,{expectedRevision:revision,requestKey:'activation-request-'+(++serial),reason:'Owner reviewed isolated test evidence',...body},user);
    const sale=(extra={},user=a.owner)=>http('POST','/orders/create-order',{items:[{productId:String(product._id),quantity:1}],saleType:'RETAIL',paidAmount:10,...extra},user);
    const balance=async account=>ok(await http('GET','/accounts/financial/'+account._id)).balanceMinor;

    await t.test('disabled default preserves ordinary POS and cannot activate with either permission missing',async()=>{
      assert.equal(ok(await http('GET',root)).state,'DISABLED');
      const invoice=ok(await sale());assert.equal(invoice.accountingMode,undefined);legacyInvoice=invoice;
      assert.equal((await action('prepare',{strategy:'CLEAN_START',confirmation:'PREPARE ACCOUNTING'})).status,503);
      process.env.BUSINESS_ACCOUNTING_ENABLED='true';
      assert.equal((await action('prepare',{strategy:'CLEAN_START',confirmation:'PREPARE ACCOUNTING'})).status,503);
      process.env.BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED='true';
    });
    await t.test('OWNER only; per-shop preparation freezes business changes without touching stock',async()=>{
      for(const user of [cashier,admin])assert.equal((await action('prepare',{strategy:'CLEAN_START',confirmation:'PREPARE ACCOUNTING'},user)).status,403);
      revision=ok(await action('prepare',{strategy:'CLEAN_START',confirmation:'PREPARE ACCOUNTING'})).revision;
      const before=(await Product.findById(product._id)).stockQuantity;
      assert.equal((await sale()).status,409);assert.equal((await sale({},cashier)).status,409);
      assert.equal((await Product.findById(product._id)).stockQuantity,before);
      assert.equal(ok(await http('GET',root,undefined,b.owner)).state,'DISABLED');
      const another=await Product.create({shopId:b.shop._id,name:'Other cable',slug:'other',brand:'Other',category:new mongoose.Types.ObjectId(),stockQuantity:4,costPrice:2,retailPrice:10,unit:'pcs'});
      assert.equal((await sale({items:[{productId:String(another._id),quantity:1}]},b.owner)).status,201);
      preview=ok(await http('POST',root+'/preview',{}));assert.equal(preview.ready,false);
    });
    await t.test('owner-confirmed openings reuse current inventory and existing customer authority',async()=>{
      cash=ok(await http('POST','/accounts/financial',{code:'TILL',name:'Till',kind:'CASH'}));
      bank=ok(await http('POST','/accounts/financial',{code:'BANK',name:'Bank',kind:'BANK'}));
      const cutoffAt=new Date().toISOString(),stock=(await Product.findById(product._id)).stockQuantity;
      const input={cutoffAt,reason:'Counted inventory and money, no demo debts carried',cash:[{accountId:cash._id,amountMinor:100000},{accountId:bank._id,amountMinor:0}],suppliers:[],expectedNetAssetsMinor:100000+stock*200,acknowledgeLegacyCustomerBalances:true,acknowledgeUnallocatedEquity:true};
      setup=ok(await http('PUT','/accounts/existing-setup',{expectedRevision:0,input})).setup;
      const review=ok(await http('POST','/accounts/existing-setup/preview',{expectedRevision:setup.revision}));
      assert.deepEqual(review.evidence.blockers,[]);
      setup=ok(await http('POST','/accounts/existing-setup/confirm',{expectedRevision:review.setup.revision,requestKey:'activation-opening-confirm',previewToken:review.previewToken,confirmation:'CONFIRM EXISTING BUSINESS SETUP'})).setup;
      assert.equal(setup.state,'CONFIRMED');assert.equal((await Product.findById(product._id)).stockQuantity,stock);
      assert.equal((await Customer.findById(customer._id)).remainingMoney,0);
    });
    await t.test('clean start rejects nonzero demo balances without clearing them',async()=>{
      await Customer.updateOne({_id:customer._id},{$set:{remainingMoney:20}});
      preview=ok(await http('POST',root+'/preview',{}));assert.equal(preview.ready,false);
      assert.ok(preview.blockers.some(b=>/Customer|customer/.test(b)));
      assert.equal((await Customer.findById(customer._id)).remainingMoney,20);
      // Test-only restoration of the deliberately corrupt fixture, never a production cleanup.
      await Customer.updateOne({_id:customer._id},{$set:{remainingMoney:0}});
    });
    await t.test('preview fingerprint and expiry reject stale confirmation; activation is atomic and idempotent',async()=>{
      preview=ok(await http('POST',root+'/preview',{}));assert.equal(preview.ready,true,JSON.stringify(preview.blockers));
      confirmBody={expectedRevision:revision,requestKey:'activate-exact-request',reason:'Confirmed opening evidence',confirmation:'ACTIVATE ACCOUNTING',previewToken:preview.previewToken,expiresAt:preview.expiresAt};
      assert.equal((await http('POST',root+'/confirm',{...confirmBody,expiresAt:'2000-01-01T00:00:00.000Z'})).status,409);
      assert.equal((await http('POST',root+'/confirm',{...confirmBody,previewToken:'é'.repeat(64)})).status,409);
      const originalCreate=AccountingActivationEvent.create;
      AccountingActivationEvent.create=async()=>{throw new Error('Injected local activation audit failure');};
      try{assert.equal((await http('POST',root+'/confirm',confirmBody)).status,500);}finally{AccountingActivationEvent.create=originalCreate;}
      assert.equal(ok(await http('GET',root)).state,'PREPARING');
      assert.equal(await AccountingActivationEvent.countDocuments({operation:'confirm'}),0);
      const results=await Promise.all([http('POST',root+'/confirm',confirmBody),http('POST',root+'/confirm',confirmBody)]);
      assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
      revision=ok(await http('POST',root+'/confirm',confirmBody)).revision;
      assert.equal(await AccountingActivationEvent.countDocuments({shopId:a.shop._id,operation:'confirm'}),1);
      assert.equal(ok(await http('GET',root)).state,'ACTIVE');assert.equal(await balance(cash),100000);
    });
    await t.test('production OWNER/CASHIER sales post exactly once with LIVE source; failed routing rolls back',async()=>{
      const before=await balance(cash),stock=(await Product.findById(product._id)).stockQuantity;
      assert.equal((await sale({requestKey:'sale-no-routing'})).status,400);
      assert.equal((await Product.findById(product._id)).stockQuantity,stock);assert.equal(await balance(cash),before);
      for(const user of [a.owner,cashier]){
        const body={requestKey:'production-sale-'+user.role,receiptAccountId:String(cash._id)};
        const invoice=ok(await sale(body,user));assert.equal(invoice.accountingMode,'LIVE');
        assert.equal((await InvoiceAdjustment.findOne({orderId:invoice._id,kind:'SALE'})).cashRouting.mode,'LIVE');
        assert.equal(ok(await sale(body,user))._id,invoice._id);
      }
      assert.equal(await balance(cash),before+2000);assert.equal((await Product.findById(product._id)).stockQuantity,stock-2);
      assert.equal((await http('GET','/accounts/transactions',undefined,cashier)).status,403);
      const register=ok(await http('GET','/accounts/transactions'));assert.equal(register.coverage.livePostingEnabled,true);
    });
    await t.test('clean-start historical demo invoices cannot create future refunds or debt changes',async()=>{
      const detail=ok(await http('GET','/orders/'+legacyInvoice._id));
      assert.equal(detail.eligibility?.adjustmentEligible??detail.adjustmentEligible,false);
      const result=await http('POST','/orders/'+legacyInvoice._id+'/adjustments/preview',{requestKey:'legacy-demo-return',expectedRevision:0,reason:'Attempt to refund demo invoice',returns:[],additions:[]});
      assert.equal(result.status,409);
    });
    await t.test('production expenses and partner capital use existing balanced posting/reversal engines',async()=>{
      const before=await balance(cash);
      const category=ok(await http('POST','/accounts/expenses/categories',{name:'Electricity'}));
      const expense=ok(await http('POST','/accounts/expenses',{requestKey:'production-expense',amountMinor:1000,categoryId:category._id,accountId:cash._id,occurredAt:new Date().toISOString(),description:'Real test bill',reference:'PROD-BILL'})).expense;
      assert.equal(await balance(cash),before-1000);
      ok(await http('POST','/accounts/expenses/'+expense._id+'/reverse',{requestKey:'production-expense-reverse',occurredAt:new Date().toISOString(),description:'Funds actually returned',confirmation:'CONFIRM EXPENSE REVERSAL'}));
      assert.equal(await balance(cash),before);
      const partner=ok(await http('POST','/accounts/partners',{key:'owner-partner',name:'Shop owner'}));
      const movement=ok(await http('POST','/accounts/capital',{requestKey:'production-capital',partnerId:partner._id,direction:'CONTRIBUTION',amountMinor:2000,accountId:cash._id,occurredAt:new Date().toISOString(),description:'Actual contribution received',reference:'PROD-CAP'}));
      assert.equal(await balance(cash),before+2000);
      const event=movement.event??movement.capitalEvent;
      assert.ok(event,'capital API returns source event');
      ok(await http('POST','/accounts/capital/'+event._id+'/reverse',{requestKey:'production-capital-reverse',occurredAt:new Date().toISOString(),description:'Contribution returned',confirmation:'CONFIRM CAPITAL REVERSAL'}));
      assert.equal(await balance(cash),before);
      assert.equal((await http('POST','/accounts/expenses',{requestKey:'cashier-not-expense'},cashier)).status,403);
    });
    await t.test('production supplier cutover, receipts, payments, credit and refunds reconcile',async()=>{
      const supplier=ok(await http('POST','/accounts/entities',{key:'production-supplier',name:'Eagle Cables',roles:['SUPPLIER','COMPANY']}));
      const account=async(kind,code,extra={})=>ok(await http('POST','/accounts/financial',{kind,code,name:code,...extra}));
      const ap=await account('SUPPLIER_PAYABLE','EAGLE-AP',{entityId:supplier._id}),offset=await account('PURCHASES_CLEARING','GOODS-OFFSET');
      const equity=await FinancialAccount.findOne({shopId:a.shop._id,code:'EXISTING_SETUP_EQUITY'});
      const base='/accounts/suppliers/'+supplier._id;
      const cutover=ok(await http('GET',base+'/cutover-preview'));
      ok(await http('POST',base+'/cutover',{requestKey:'production-supplier-opening',confirmation:'CONFIRM SUPPLIER OPENING',cutoffAt:new Date().toISOString(),payableAccountId:ap._id,offsetAccountId:offset._id,equityAccountId:String(equity._id),openingBalanceMinor:0,otherOpeningMinor:0,reviews:[],evidenceDigest:cutover.evidenceDigest,reason:'Verified zero pre-start supplier debt'}));
      let po=ok(await http('POST','/purchases',{requestKey:'production-purchase',supplierId:supplier._id,items:[{productId:String(product._id),quantity:5,unitCostMinor:200}]})).purchaseOrder;
      po=ok(await http('POST','/purchases/'+po._id+'/confirm',{requestKey:'production-purchase-confirm',expectedRevision:po.revision})).purchaseOrder;
      const stock=(await Product.findById(product._id)).stockQuantity;
      const receipt=ok(await http('POST','/purchases/'+po._id+'/receipts',{requestKey:'production-goods',expectedRevision:po.revision,items:[{productId:String(product._id),quantity:5}]})).receipt;
      assert.equal((await Product.findById(product._id)).stockQuantity,stock+5);
      assert.equal(ok(await http('GET',base+'/balance')).balanceMinor,1000);
      const before=await balance(cash);
      ok(await http('POST',base+'/payments',{requestKey:'production-supplier-payment',amountMinor:1000,accountId:cash._id,reference:'EAGLE-PAYMENT',occurredAt:new Date().toISOString(),reason:'Supplier actually paid'}));
      assert.equal(await balance(cash),before-1000);
      ok(await http('POST',base+'/returns',{requestKey:'production-goods-return',receiptId:receipt._id,items:[{productId:String(product._id),quantity:2}],reference:'EAGLE-RETURN',occurredAt:new Date().toISOString(),reason:'Supplier accepted goods back'}));
      const position=ok(await http('GET',base+'/balance'));assert.equal(position.balanceMinor,0);assert.equal(position.creditMinor,400);
      ok(await http('POST',base+'/refunds',{requestKey:'production-supplier-refund',amountMinor:400,accountId:cash._id,reference:'EAGLE-REFUND',occurredAt:new Date().toISOString(),reason:'Actual supplier refund received',confirmation:'CONFIRM SUPPLIER REFUND RECEIVED'}));
      assert.equal(await balance(cash),before-600);assert.equal(ok(await http('GET',base+'/balance')).creditMinor,0);
      assert.equal(ok(await http('GET',base+'/reconciliation')).authoritative,true);
    });
    await t.test('additional cash/bank enrollment is explicit, isolated and idempotent',async()=>{
      const next=ok(await http('POST','/accounts/financial',{code:'NEWBANK',name:'Additional bank',kind:'BANK'}));
      const body={expectedRevision:revision,requestKey:'enroll-additional-bank',reason:'Verified actual bank statement',confirmation:'ENROLL ACCOUNT',accountId:next._id,amountMinor:5000};
      const result=ok(await http('POST',root+'/enroll',body));revision=result.revision;
      assert.equal(ok(await http('POST',root+'/enroll',body)).replayed,true);assert.equal(await balance(next),5000);
      const selector=ok(await http('GET','/orders/payment-accounts',undefined,cashier));assert.ok(selector.accounts.some(a=>String(a._id)===String(next._id)));
      assert.equal((await action('enroll',{accountId:cash._id,amountMinor:999,confirmation:'ENROLL ACCOUNT'})).status,409);
      assert.equal((await action('enroll',{accountId:next._id,amountMinor:0,confirmation:'ENROLL ACCOUNT'},b.owner)).status,409);
    });
    await t.test('production debt, additional payments, mixed refunds and cashier credit redemption keep existing authorities',async()=>{
      const before=await balance(cash),stock=(await Product.findById(product._id)).stockQuantity;
      let invoice=ok(await sale({paidAmount:4,customerId:String(customer._id),receiptAccountId:cash._id,requestKey:'production-partial-sale'}));
      assert.equal((await Customer.findById(customer._id)).remainingMoney,6);
      async function mutate(kind,input){
        const url='/orders/'+invoice._id+'/'+kind;
        const preview=ok(await http('POST',url+'/preview',input));
        const result=ok(await http('POST',url,{...input,confirmationToken:preview.confirmationToken}));
        invoice=(await Order.findById(invoice._id)).toObject();return result;
      }
      await mutate('payments',{requestKey:'production-additional-payment',expectedRevision:0,reason:'Additional money received',cashReceivedAmount:2,receiptAccountId:cash._id});
      assert.equal((await Customer.findById(customer._id)).remainingMoney,4);
      await mutate('adjustments',{requestKey:'production-mixed-refund',expectedRevision:1,reason:'Full return with actual cash refund and store credit',returns:[{lineId:invoice.items[0].lineId,quantity:1,disposition:'RESTOCK'}],additions:[],cashRefundAmount:4,creditIssueAmount:2,refundAccountId:cash._id});
      const updated=await Customer.findById(customer._id);assert.equal(updated.remainingMoney,0);assert.equal(updated.storeCreditBalanceMinor,200);
      assert.equal(await balance(cash),before+200);assert.equal((await Product.findById(product._id)).stockQuantity,stock);
      ok(await sale({paidAmount:8,creditAmount:2,customerId:String(customer._id),receiptAccountId:cash._id,requestKey:'production-cashier-credit-redemption'},cashier));
      assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor,0);assert.equal(await balance(cash),before+1000);
      // Legitimate post-activation debt must survive pause/resume without being mistaken for demo debt.
      ok(await sale({paidAmount:0,customerId:String(customer._id),requestKey:'production-current-debt'}));
      assert.equal((await Customer.findById(customer._id)).remainingMoney,10);
    });
    await t.test('server kill switch and OWNER pause never fall back to unposted POS; resume requires fresh review',async()=>{
      const before=await balance(cash),count=await Order.countDocuments({shopId:a.shop._id});
      delete process.env.BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED;
      assert.equal((await sale({requestKey:'paused-server-sale',receiptAccountId:cash._id})).status,503);
      revision=ok(await action('pause',{confirmation:'PAUSE ACCOUNTING'})).revision;
      assert.equal((await sale()).status,409);assert.equal(await Order.countDocuments({shopId:a.shop._id}),count);
      process.env.BUSINESS_ACCOUNTING_PRODUCTION_ALLOWED='true';
      preview=ok(await http('POST',root+'/preview',{}));assert.equal(preview.ready,true,JSON.stringify(preview.blockers));
      revision=ok(await action('resume',{confirmation:'ACTIVATE ACCOUNTING',previewToken:preview.previewToken,expiresAt:preview.expiresAt})).revision;
      assert.equal(await balance(cash),before);
    });
    await t.test('immutable audit records and balanced postings remain intact',async()=>{
      const event=await AccountingActivationEvent.findOne({shopId:a.shop._id});
      event.reason='forged';await assert.rejects(()=>event.save(),/immutable/);
      for(const journal of await BusinessTransaction.find({shopId:a.shop._id})){assert.equal(journal.postings.reduce((n,p)=>n+BigInt(p.debitMinor),0n),journal.postings.reduce((n,p)=>n+BigInt(p.creditMinor),0n));}
      assert.equal(await BusinessTransaction.countDocuments({shopId:b.shop._id}),0);
      const report=ok(await http('GET','/accounts/reports?from='+encodeURIComponent(new Date(Date.now()-86400000).toISOString())+'&to='+encodeURIComponent(new Date(Date.now()+86400000).toISOString())));
      const currentShop=await Shop.findById(a.shop._id);
      const current=await Order.find({shopId:a.shop._id,type:'INVOICE',createdAt:{$gt:currentShop.accounting.cutoffAt}});
      assert.equal(report.sales.revenueMinor,current.reduce((sum,o)=>sum+Math.round(o.totalPrice*100),0));
      assert.match(report.sales.coverageMessage,/Original Sales and AI histories remain unchanged/);
    });
    await t.test('explicit reconciliation retains genuine legacy debt and posts only a new post-cutover payment',async()=>{
      const c=await fixture('reconciledowner','03444444444');
      const p=await Product.create({shopId:c.shop._id,name:'Existing switch',slug:'switch',brand:'Switch',category:new mongoose.Types.ObjectId(),stockQuantity:5,costPrice:2,retailPrice:10,unit:'pcs'});
      const buyer=await Customer.create({shopId:c.shop._id,name:'Existing genuine customer',phoneNo:'03555555555'});
      const legacy=ok(await http('POST','/orders/create-order',{items:[{productId:String(p._id),quantity:1}],saleType:'RETAIL',paidAmount:0,customerId:String(buyer._id)},c.owner));
      ok(await http('POST',root+'/prepare',{expectedRevision:0,requestKey:'reconcile-prepare',reason:'Retain verified genuine debt',strategy:'RECONCILE',confirmation:'PREPARE ACCOUNTING'},c.owner));
      const till=ok(await http('POST','/accounts/financial',{code:'REAL-TILL',name:'Real till',kind:'CASH'},c.owner));
      let draft=ok(await http('PUT','/accounts/existing-setup',{expectedRevision:0,input:{cutoffAt:new Date().toISOString(),reason:'Existing genuine trading evidence',cash:[{accountId:till._id,amountMinor:1000}],suppliers:[],expectedNetAssetsMinor:2800,acknowledgeLegacyCustomerBalances:true,acknowledgeUnallocatedEquity:true}},c.owner));
      draft=ok(await http('POST','/accounts/existing-setup/preview',{expectedRevision:draft.setup.revision},c.owner));assert.deepEqual(draft.evidence.blockers,[]);
      ok(await http('POST','/accounts/existing-setup/confirm',{expectedRevision:draft.setup.revision,previewToken:draft.previewToken,requestKey:'reconcile-confirm-openings',confirmation:'CONFIRM EXISTING BUSINESS SETUP'},c.owner));
      const ready=ok(await http('POST',root+'/preview',{},c.owner));assert.equal(ready.ready,true,JSON.stringify(ready.blockers));
      ok(await http('POST',root+'/confirm',{expectedRevision:1,requestKey:'reconcile-activate',reason:'Verified balance carried explicitly',previewToken:ready.previewToken,expiresAt:ready.expiresAt,confirmation:'ACTIVATE ACCOUNTING'},c.owner));
      assert.equal((await Customer.findById(buyer._id)).remainingMoney,10);
      const url='/orders/'+legacy._id+'/payments',body={requestKey:'reconcile-real-payment',expectedRevision:0,reason:'Actual new payment received',cashReceivedAmount:2,receiptAccountId:till._id};
      const payment=ok(await http('POST',url+'/preview',body,c.owner));
      ok(await http('POST',url,{...body,confirmationToken:payment.confirmationToken},c.owner));
      assert.equal((await Customer.findById(buyer._id)).remainingMoney,8);
      assert.equal(ok(await http('GET','/accounts/financial/'+till._id,undefined,c.owner)).balanceMinor,1200);
      assert.equal(await InvoiceAdjustment.countDocuments({orderId:legacy._id,kind:'SALE'}),0);
      assert.equal(await BusinessTransaction.countDocuments({shopId:c.shop._id,'source.kind':'INVOICE_RECEIPT'}),1);
    });
    await t.test('brand-new PREPARING shop accepts zero cash and explicitly confirms empty inventory without activating',async()=>{
      const fresh=await fixture('zeroshopowner','03666666666'),shopId=fresh.shop._id;
      ok(await http('POST',root+'/prepare',{expectedRevision:0,requestKey:'zero-shop-prepare',reason:'Brand-new shop with no historical activity',strategy:'CLEAN_START',confirmation:'PREPARE ACCOUNTING'},fresh.owner));
      const cash=ok(await http('POST','/accounts/financial',{code:'MAIN-CASH',name:'main cash',kind:'CASH'},fresh.owner));
      const input={cutoffAt:new Date().toISOString(),reason:'New shop with no opening stock or money',cash:[{accountId:cash._id,amountMinor:0}],suppliers:[],expectedNetAssetsMinor:0,acknowledgeLegacyCustomerBalances:true,acknowledgeUnallocatedEquity:true};
      assert.equal((await http('PUT','/accounts/existing-setup',{expectedRevision:0,input:{...input,cash:[{accountId:cash._id,amountMinor:-1}]}},fresh.owner)).status,400);
      assert.equal((await http('PUT','/accounts/existing-setup',{expectedRevision:0,input:{...input,cash:[{accountId:cash._id,amountMinor:null}]}},fresh.owner)).status,400);
      const saved=ok(await http('PUT','/accounts/existing-setup',{expectedRevision:0,input},fresh.owner));
      assert.equal(saved.setup.state,'DRAFT');assert.equal(saved.setup.input.cash[0].amountMinor,0);assert.equal(saved.setup.input.expectedNetAssetsMinor,0);
      assert.equal(saved.evidence.cash[0].declaredMinor,0);assert.equal(saved.evidence.cash[0].status,'INCOMPLETE');
      assert.equal(saved.evidence.inventoryStatus,'REVIEW_REQUIRED');assert.deepEqual(saved.evidence.inventory,[]);assert.deepEqual(saved.evidence.blockers,[]);
      const restored=ok(await http('GET','/accounts/existing-setup',undefined,fresh.owner));assert.equal(restored.setup.input.cash[0].amountMinor,0);
      assert.equal(await BusinessTransaction.countDocuments({shopId}),0);
      const reviewed=ok(await http('POST','/accounts/existing-setup/preview',{expectedRevision:restored.setup.revision},fresh.owner));
      assert.equal(reviewed.evidence.totals.inventoryMinor,0);assert.equal(reviewed.evidence.totals.netAssetsMinor,0);assert.equal(reviewed.evidence.totals.differenceMinor,0);assert.deepEqual(reviewed.evidence.blockers,[]);
      const confirm={expectedRevision:reviewed.expectedRevision,previewToken:reviewed.previewToken,requestKey:'zero-shop-confirm',confirmation:'CONFIRM EXISTING BUSINESS SETUP'};
      const confirmed=ok(await http('POST','/accounts/existing-setup/confirm',confirm,fresh.owner));assert.equal(confirmed.setup.state,'CONFIRMED');assert.equal(confirmed.setup.review.evidence.inventoryStatus,'COMPLETE');
      assert.equal(ok(await http('POST','/accounts/existing-setup/confirm',confirm,fresh.owner)).replayed,true);
      assert.equal(ok(await http('GET','/accounts/financial/'+cash._id,undefined,fresh.owner)).balanceMinor,0);
      for(const model of [Product,Customer,Order,BusinessTransaction,mongoose.models.StockLog])assert.equal(await model.countDocuments({shopId}),0);
      assert.equal((await Shop.findById(shopId)).accounting.state,'PREPARING');
      assert.equal(ok(await http('POST',root+'/preview',{},fresh.owner)).ready,true);
      assert.equal((await Shop.findById(shopId)).accounting.state,'PREPARING');
    });
  }finally{
    if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();
    await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:150});
  }
});
