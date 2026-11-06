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
const {CapitalEvent}=await import('../dist/models/capitalEvent.model.js');
const {Order}=await import('../dist/models/order.model.js');
const {BusinessEntity}=await import('../dist/models/businessEntity.model.js');
const {Expense,ExpenseCategory}=await import('../dist/models/expense.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const binary='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await test('partner capital: real HTTP and disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-capital-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','capitalTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/capital_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'capitalTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const M of Object.values(mongoose.models)){await M.createCollection();await M.createIndexes();}
        async function fixture(label,phone){const _id=new mongoose.Types.ObjectId(),shop=await Shop.create({ownerId:_id,name:label,address:'Test',contactNo:phone,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)}),user=await User.create({_id,shopId:shop._id,username:label,email:label+'@purchase.test',password:'testing123',role:'OWNER'});return {shop,user,actor:{_id,shopId:shop._id,role:'OWNER'}};}
        const a=await fixture('owner','03111111111'),b=await fixture('other','03222222222');
        const cashier=await User.create({shopId:a.shop._id,username:'cashier',email:'cashier@purchase.test',password:'testing123',role:'CASHIER'}),admin=await User.create({username:'admin',email:'admin@purchase.test',password:'testing123',role:'ADMIN'});
        server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
        assert.equal(mongoose.connection.host,'127.0.0.1');assert.equal(mongoose.connection.name,'capital_test');
        let n=0;
        async function http(method,url,body,user=a.user){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2/accounts${url}`,{method,headers:{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
        const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
        const tx=work=>accounts.businessTransaction(a.actor,work);
        async function account(kind,code){return tx(s=>accounts.createFinancialAccount(a.actor,{kind,code,name:code},s));}
        const cash=await account('CASH','TILL'),bank=await account('BANK','BANK'),equity=await account('OPENING_EQUITY','EQUITY'),control=await account('SETTLEMENT_CLEARING','CONTROL');
        const balance=acc=>tx(s=>accounts.getAccountBalance(a.actor,String(acc._id),s));
        let partner,investment,investmentBody;
        const data=(extra={})=>({requestKey:'capital-request-'+(++n),partnerId:String(partner._id),direction:'CONTRIBUTION',amountMinor:5000,accountId:String(cash._id),occurredAt:new Date().toISOString(),description:'Actual partner funds received',reference:'CAP-'+n,...extra});
        const reverse=(extra={})=>({requestKey:'capital-reverse-'+(++n),occurredAt:new Date().toISOString(),description:'Original funds actually moved back',confirmation:'CONFIRM CAPITAL REVERSAL',...extra});
        const partners=async()=>ok(await http('GET','/partners'));
        const capital=async()=>{const list=await partners();return list.entries.find(e=>e._id===String(partner._id)).capital;};
        await t.test('partner identities including OWNER work while balances/posting are unavailable',async()=>{
            partner=ok(await http('POST','/partners',{key:'owner-partner-identity',name:'Shop Owner',phoneNo:'03333333333'}));
            assert.ok(partner.roles.includes('PARTNER'));assert.equal((await partners()).entries[0].capital,null);assert.equal((await partners()).total,null);
            assert.equal((await http('POST','/capital',data())).status,409);assert.equal(await CapitalEvent.countDocuments(),0);
            assert.equal(ok(await http('POST','/partners',{key:'owner-partner-identity',name:'Shop Owner',phoneNo:'03333333333'}))._id,partner._id);
            assert.equal((await http('POST','/partners',{key:'duplicate-owner',name:'shop owner'})).status,409);
            assert.equal((await http('POST','/partners',{key:'invalid-phone',name:'Invalid',phoneNo:'123'})).status,400);
        });
        await t.test('existing customer/supplier identity can gain PARTNER without duplicating balances',async()=>{
            const customer=await Customer.create({shopId:a.shop._id,name:'Shared identity',phoneNo:'03444444444',address:'Test',remainingMoney:15,storeCreditBalanceMinor:500});
            const entity=await tx(s=>accounts.createBusinessEntity(a.actor,{key:'linked-partner',roles:['CUSTOMER','SUPPLIER'],customerId:String(customer._id)},s));
            const linked=ok(await http('POST','/partners',{entityId:String(entity._id),expectedRevision:entity.revision}));assert.ok(linked.roles.includes('PARTNER'));assert.equal(String(linked.customerId),String(customer._id));
            const found=ok(await http('GET','/partners?q=Shared'));assert.equal(found.entries[0].name,'Shared identity');assert.equal(found.entries.length,1);
            assert.equal((await Customer.findById(customer._id)).remainingMoney,15);assert.equal((await Customer.findById(customer._id)).storeCreditBalanceMinor,500);
        });
        await t.test('missing preparation blocks posting; confirmed preparation enables zero starting capital',async()=>{
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';assert.equal((await http('POST','/capital',data())).status,409);
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;const cutoffAt=new Date(Date.now()-60000).toISOString();
            for(const acc of [cash,bank])await tx(s=>accounts.recordOpeningBalance(a.actor,{requestKey:'opening-'+acc._id,accountId:String(acc._id),equityAccountId:String(equity._id),amountMinor:10000,occurredAt:cutoffAt,reason:'Owner confirmed existing cash',confirmation:'CONFIRM OPENING BALANCE'},s));
            await tx(s=>accounts.prepareCashBankCutover(a.actor,{clearingAccountId:String(control._id),cutoffAt,accounts:[{accountId:String(cash._id),confirmedBalanceMinor:10000},{accountId:String(bank._id),confirmedBalanceMinor:10000}],confirmation:'PREPARE CASH BANK CUTOVER'},s));
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';assert.equal((await capital()).balanceMinor,0);
        });
        await t.test('investment increases selected cash and partner equity, never revenue/expenses/debt',async()=>{
            investmentBody=data({createdBy:b.user._id,createdByName:'forged'});investment=ok(await http('POST','/capital',investmentBody)).event;
            assert.equal(investment.createdByName,'owner');assert.equal((await balance(cash)).balanceMinor,15000);assert.equal((await balance(bank)).balanceMinor,10000);
            assert.deepEqual(await capital(),{authoritative:true,contributionsMinor:5000,withdrawalsMinor:0,balanceMinor:5000});
            assert.equal(await Expense.countDocuments(),0);assert.equal(await Order.countDocuments(),0);assert.equal(await CustomerLedger.countDocuments(),0);
            const j=await BusinessTransaction.findOne({'source.referenceId':investment._id});assert.equal(j.postings.reduce((sum,p)=>sum+p.debitMinor-p.creditMinor,0),0);
        });
        await t.test('identical retries cannot double-post and different bodies conflict',async()=>{
            assert.equal(ok(await http('POST','/capital',investmentBody)).replayed,true);
            assert.equal((await http('POST','/capital',{...investmentBody,amountMinor:5001})).status,409);assert.equal((await balance(cash)).balanceMinor,15000);
        });
        await t.test('withdrawal reduces bank and capital; insufficient capital and cash are independent',async()=>{
            ok(await http('POST','/capital',data({direction:'WITHDRAWAL',amountMinor:2000,accountId:String(bank._id)})));
            assert.equal((await balance(bank)).balanceMinor,8000);assert.equal((await capital()).balanceMinor,3000);
            assert.equal((await http('POST','/capital',data({direction:'WITHDRAWAL',amountMinor:3001}))).status,409);
            assert.equal((await http('POST','/capital/'+investment._id+'/reverse',reverse())).status,409);
            const huge=ok(await http('POST','/capital',data({amountMinor:50000}))).event;
            assert.equal((await http('POST','/capital',data({direction:'WITHDRAWAL',amountMinor:9000,accountId:String(bank._id)}))).status,409);
            ok(await http('POST','/capital/'+huge._id+'/reverse',reverse()));assert.equal((await balance(cash)).balanceMinor,15000);
        });
        await t.test('safe inverse records remain immutable, linked and idempotent',async()=>{
            const withdrawal=await CapitalEvent.findOne({direction:'WITHDRAWAL',kind:'CAPITAL_WITHDRAWAL'}).lean(),request=reverse();
            assert.equal((await http('POST','/capital/'+withdrawal._id+'/reverse',reverse({confirmation:'NO'}))).status,400);
            const reversal=ok(await http('POST','/capital/'+withdrawal._id+'/reverse',request)).event;
            assert.equal(reversal.reversalOf,String(withdrawal._id));assert.equal((await balance(bank)).balanceMinor,10000);assert.equal((await capital()).balanceMinor,5000);
            assert.equal(ok(await http('POST','/capital/'+withdrawal._id+'/reverse',request)).replayed,true);
            assert.equal((await http('POST','/capital/'+withdrawal._id+'/reverse',reverse())).status,409);
            assert.equal((await http('POST','/capital/'+reversal._id+'/reverse',reverse())).status,404);
            await assert.rejects(CapitalEvent.updateOne({_id:investment._id},{$set:{amountMinor:1}}),/immutable/);
            await assert.rejects(tx(async s=>accounts.reverseBusinessJournal(a.actor,{transactionId:String((ok(await http('GET','/capital/'+withdrawal._id))).journal._id),requestKey:'generic-reversal',occurredAt:new Date().toISOString(),reason:'Unsafe'},s)),/./);
        });
        await t.test('OWNER only, active subscription and strict foreign partner/account boundaries',async()=>{
            for(const user of [cashier,admin])for(const [method,path,body] of [['GET','/partners'],['GET','/capital'],['POST','/capital',data()],['PATCH','/partners/'+partner._id,{expectedRevision:0,name:'X'}]])assert.equal((await http(method,path,body,user)).status,403);
            assert.equal((await http('POST','/capital',data(),b.user)).status,409); // foreign shop has no prepared cash cutover
            assert.equal((await http('POST','/partners',{entityId:partner._id,expectedRevision:0},b.user)).status,404);
            await Shop.updateOne({_id:a.shop._id},{$set:{subscriptionExpiry:new Date(0)}});try{assert.equal((await http('POST','/capital',data())).status,403);}finally{await Shop.updateOne({_id:a.shop._id},{$set:{subscriptionExpiry:a.shop.subscriptionExpiry}});}
        });
        await t.test('validation and chronological guards reject invalid or backdated events',async()=>{
            for(const amountMinor of [0,-1,1.5,'100',Number.MAX_SAFE_INTEGER+1])assert.equal((await http('POST','/capital',data({amountMinor}))).status,400);
            assert.equal((await http('POST','/capital',data({description:{}}))).status,400);
            assert.equal((await http('POST','/capital',data({occurredAt:new Date(Date.now()+86400000).toISOString()}))).status,400);
            assert.equal((await http('POST','/capital',data({occurredAt:new Date(Date.now()-86400000).toISOString()}))).status,409);
        });
        await t.test('journal failure rolls back capital event and all account claims',async()=>{
            const count=await CapitalEvent.countDocuments(),prior=await balance(cash),create=BusinessTransaction.create;
            BusinessTransaction.create=async()=>{throw new Error('Injected late capital failure');};
            try{assert.equal((await http('POST','/capital',data())).status,500);}finally{BusinessTransaction.create=create;}
            assert.equal(await CapitalEvent.countDocuments(),count);assert.equal((await balance(cash)).balanceMinor,prior.balanceMinor);
        });
        await t.test('concurrent duplicates and competing withdrawals cannot double spend capital',async()=>{
            const request=data({amountMinor:1000}),results=await Promise.all([http('POST','/capital',request),http('POST','/capital',request)]);
            assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));assert.equal(ok(await http('POST','/capital',request)).replayed,true);
            assert.equal((await capital()).balanceMinor,6000);
            const outcomes=await Promise.all([http('POST','/capital',data({direction:'WITHDRAWAL',amountMinor:5000})),http('POST','/capital',data({direction:'WITHDRAWAL',amountMinor:5000}))]);
            assert.equal(outcomes.filter(r=>r.status===200).length,1);assert.equal((await capital()).balanceMinor,1000);
        });
        await t.test('partner management preserves history and prevents archiving nonzero capital',async()=>{
            const current=(await partners()).entries.find(e=>e._id===partner._id);
            assert.equal((await http('PATCH','/partners/'+partner._id,{expectedRevision:current.revision,partnerActive:false})).status,409);
            const renamed=ok(await http('PATCH','/partners/'+partner._id,{expectedRevision:current.revision,name:'Updated Owner',phoneNo:'03333333333',address:'New address'}));
            assert.equal(renamed.name,'Updated Owner');assert.equal((await CapitalEvent.findById(investment._id)).partnerName,'Shop Owner');
            assert.equal((await http('PATCH','/partners/'+partner._id,{expectedRevision:current.revision,name:'Stale'})).status,409);
            const linked=(await partners()).entries.find(e=>e.customerId);const archived=ok(await http('PATCH','/partners/'+linked._id,{expectedRevision:linked.revision,partnerActive:false}));
            assert.equal((await http('POST','/capital',data({partnerId:linked._id}))).status,409);
            ok(await http('PATCH','/partners/'+linked._id,{expectedRevision:archived.revision,partnerActive:true}));
        });
        await t.test('history details, pagination, total capital and global register agree',async()=>{
            const all=ok(await http('GET','/capital?limit=1'));assert.equal(all.entries.length,1);assert.ok(all.pagination.recordCount>1);
            assert.equal((await http('GET','/capital?page=0')).status,400);
            const list=await partners();assert.equal(list.total.balanceMinor,1000);assert.equal(list.total.contributionsMinor-list.total.withdrawalsMinor,1000);
            const history=await tx(s=>accounts.getBusinessTransactions(a.actor,{type:'CAPITAL_CONTRIBUTION',q:investment.reference},s));assert.equal(history.entries.length,1);assert.equal(history.entries[0].sourceDocument.partnerName,'Shop Owner');
            const accountId=investment.capitalAccountId;const statement=await http('GET','/financial/'+accountId+'/history');assert.equal(statement.status,200);
        });
        await t.test('missing journal fails closed instead of showing invented balances',async()=>{
            const j=await BusinessTransaction.findOne({'source.referenceId':investment._id}).lean();await BusinessTransaction.collection.deleteOne({_id:j._id});
            try{assert.equal((await http('GET','/partners')).status,409);assert.equal((await http('POST','/capital',data())).status,409);}finally{await BusinessTransaction.collection.insertOne(j);}
        });
        await t.test('disabled and production accounting guards remain intact',async()=>{
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;assert.equal((await partners()).total,null);assert.equal((await http('POST','/capital',data())).status,409);
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';process.env.NODE_ENV='production';try{assert.equal((await http('POST','/capital',data())).status,409);}finally{process.env.NODE_ENV='test';}
        });
        await t.test('prepared foreign shops cannot access or post another shop capital',async()=>{
            const otherTx=work=>accounts.businessTransaction(b.actor,work);
            const acc=async(kind,code)=>otherTx(s=>accounts.createFinancialAccount(b.actor,{kind,code,name:code},s));
            const till=await acc('CASH','OTHER-TILL'),eq=await acc('OPENING_EQUITY','OTHER-EQUITY'),ctl=await acc('SETTLEMENT_CLEARING','OTHER-CONTROL'),cutoffAt=new Date(Date.now()-60000).toISOString();
            await otherTx(s=>accounts.recordOpeningBalance(b.actor,{requestKey:'other-opening-cash',accountId:String(till._id),equityAccountId:String(eq._id),amountMinor:1000,occurredAt:cutoffAt,reason:'Other shop funds confirmed',confirmation:'CONFIRM OPENING BALANCE'},s));
            await otherTx(s=>accounts.prepareCashBankCutover(b.actor,{clearingAccountId:String(ctl._id),cutoffAt,accounts:[{accountId:String(till._id),confirmedBalanceMinor:1000}],confirmation:'PREPARE CASH BANK CUTOVER'},s));
            assert.equal((await http('GET','/capital/'+investment._id,null,b.user)).status,404);
            assert.equal((await http('POST','/capital',data({accountId:String(till._id)}),b.user)).status,404);
            assert.equal((await http('POST','/capital',data({accountId:String(till._id)}))).status,404);
            assert.equal(ok(await http('GET','/partners',null,b.user)).entries.length,0);
        });
        await t.test('generic journals cannot inject capital or remove its permanent partner role',async()=>{
            const account=await FinancialAccount.findById(investment.capitalAccountId);
            const unprepared=await accountForTest();
            async function accountForTest(){return tx(s=>accounts.createFinancialAccount(a.actor,{kind:'CASH',code:'UNPREPARED-GUARD',name:'Unprepared guard account'},s));}
            await assert.rejects(tx(s=>accounts.postBusinessJournal(a.actor,{requestKey:'unsafe-manual-capital',reason:'Not a verified capital event',occurredAt:new Date().toISOString(),postings:[{accountId:String(unprepared._id),debitMinor:1,creditMinor:0},{accountId:String(account._id),debitMinor:0,creditMinor:1}]},s)),/verified capital/);
            const partnerRow=await BusinessEntity.findById(partner._id);
            await assert.rejects(tx(s=>accounts.setBusinessRoles(a.actor,String(partner._id),['OTHER'],partnerRow.revision,s)),/Capital history/);
        });
        await t.test('optional partner notes preserve balanced journals and reversal reasons remain required',async()=>{
            for(const description of ['',undefined,'  ','Owner note supplied']){
                const request=data({description,amountMinor:1,reference:''});const saved=ok(await http('POST','/capital',request)).event;
                assert.equal(saved.description,description?.trim()||'Partner capital contribution');assert.match(saved.reference,/^CA-|^CAP-/);
                assert.equal(ok(await http('POST','/capital',request)).replayed,true);
                assert.equal((await http('POST','/capital/'+saved._id+'/reverse',reverse({description:''}))).status,400);
            }
        });
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-capital-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
