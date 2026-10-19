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
const binary='C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

await test('expenses: real HTTP and disposable loopback replica set',{skip:!existsSync(binary)},async t=>{
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
        const a=await fixture('owner','03111111111'),b=await fixture('other','03222222222');
        const cashier=await User.create({shopId:a.shop._id,username:'cashier',email:'cashier@purchase.test',password:'testing123',role:'CASHIER'}),admin=await User.create({username:'admin',email:'admin@purchase.test',password:'testing123',role:'ADMIN'});
        server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
        assert.equal(mongoose.connection.host,'127.0.0.1');assert.equal(mongoose.connection.name,'expense_test');
        let n=0;
        async function http(method,url,body,user=a.user){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2/accounts/expenses${url}`,{method,headers:{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};}
        const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
        const tx=work=>accounts.businessTransaction(a.actor,work);
        async function account(kind,code){return tx(s=>accounts.createFinancialAccount(a.actor,{kind,code,name:code},s));}
        const cash=await account('CASH','TILL'),bank=await account('BANK','BANK'),equity=await account('OPENING_EQUITY','EQUITY'),control=await account('SETTLEMENT_CLEARING','CONTROL');
        const balance=()=>tx(s=>accounts.getAccountBalance(a.actor,String(cash._id),s));
        let category,original,originalBody;
        const body=(extra={})=>({requestKey:'expense-request-'+(++n),amountMinor:1250,categoryId:String(category._id),accountId:String(cash._id),occurredAt:new Date().toISOString(),description:'Electricity bill',reference:'BILL-'+n,...extra});
        const reverse=(extra={})=>({requestKey:'expense-reverse-'+(++n),occurredAt:new Date().toISOString(),description:'Payment cancelled and original funds returned',confirmation:'CONFIRM EXPENSE REVERSAL',...extra});
        await t.test('disabled accounting cannot claim an expense was paid; categories are shop scoped',async()=>{
            category=ok(await http('POST','/categories',{name:'Electricity'}));
            assert.equal(ok(await http('POST','/categories',{name:'electricity'}))._id,category._id);
            assert.equal(ok(await http('GET','/setup')).available,false);
            assert.equal((await http('POST','',body())).status,409);assert.equal(await Expense.countDocuments(),0);
            assert.equal(ok(await http('GET','/categories',null,b.user)).entries.length,0);
        });
        await t.test('missing cash preparation blocks financial posting',async()=>{
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';assert.equal((await http('POST','',body())).status,409);assert.equal(await Expense.countDocuments(),0);
            delete process.env.BUSINESS_ACCOUNTING_ENABLED;
            const cutoffAt=new Date(Date.now()-60000).toISOString();
            for(const selected of [cash,bank])await tx(s=>accounts.recordOpeningBalance(a.actor,{requestKey:'opening-'+selected._id,accountId:String(selected._id),equityAccountId:String(equity._id),amountMinor:10000,occurredAt:cutoffAt,reason:'Owner confirmed available funds',confirmation:'CONFIRM OPENING BALANCE'},s));
            await tx(s=>accounts.prepareCashBankCutover(a.actor,{clearingAccountId:String(control._id),cutoffAt,accounts:[{accountId:String(cash._id),confirmedBalanceMinor:10000},{accountId:String(bank._id),confirmedBalanceMinor:10000}],confirmation:'PREPARE CASH BANK CUTOVER'},s));
            process.env.BUSINESS_ACCOUNTING_ENABLED='true';
            assert.equal(ok(await http('GET','/setup')).accounts.length,2);
        });
        await t.test('posted expense decreases cash exactly once through a balanced dedicated expense journal',async()=>{
            originalBody=body({createdBy:b.user._id,createdByName:'forged'});original=ok(await http('POST','',originalBody)).expense;
            assert.equal((await balance()).balanceMinor,8750);assert.equal(original.createdByName,'owner');
            const journal=await BusinessTransaction.findOne({'source.kind':'EXPENSE','source.referenceId':original._id});
            assert.equal(journal.postings.reduce((n,p)=>n+p.debitMinor-p.creditMinor,0),0);
            assert.equal(journal.postings.find(p=>String(p.accountId)===original.expenseAccountId).debitMinor,1250);
            assert.equal(await CustomerLedger.countDocuments(),0);
        });
        await t.test('idempotent retries return the existing expense; changed requests conflict',async()=>{
            assert.equal(ok(await http('POST','',originalBody)).replayed,true);
            assert.equal((await http('POST','',{...originalBody,amountMinor:1200})).status,409);
            assert.equal((await balance()).balanceMinor,8750);
        });
        await t.test('invalid precision, blank fields, future dates and insufficient funds write nothing',async()=>{
            for(const amountMinor of [0,-1,1.5,'100',Number.MAX_SAFE_INTEGER+1])assert.equal((await http('POST','',body({amountMinor}))).status,400);
            assert.equal((await http('POST','',body({description:{}}))).status,400);
            assert.equal((await http('POST','',body({occurredAt:new Date(Date.now()+86400000).toISOString()}))).status,400);
            assert.equal((await http('POST','',body({amountMinor:10001}))).status,409);
            assert.equal(await Expense.countDocuments(),1);assert.equal((await balance()).balanceMinor,8750);
        });
        await t.test('OWNER only and all category/account/document references remain shop scoped',async()=>{
            for(const user of [cashier,admin])for(const [method,url,payload] of [['GET',''],['GET','/categories'],['POST','',body()],['POST','/'+original._id+'/reverse',reverse()]])assert.equal((await http(method,url,payload,user)).status,403);
            assert.equal((await http('GET','/'+original._id,null,b.user)).status,404);
            assert.equal((await http('POST','',body(),b.user)).status,404);
            assert.equal((await http('POST','/'+original._id+'/reverse',reverse(),b.user)).status,404);
        });
        await t.test('search, pagination and monthly categories use actual records, not supplier activity',async()=>{
            const result=ok(await http('GET','?q=Electricity&limit=1'));assert.equal(result.entries.length,1);assert.equal(result.totalMinor,1250);assert.equal(result.breakdown[0].netMinor,1250);
            assert.equal(ok(await http('GET','?q=missing')).totalMinor,0);
            assert.equal((await http('GET','?page=0')).status,400);assert.equal((await http('GET','?month=2026-13')).status,400);
            const month=new Date(Date.now()+5*3600000).toISOString().slice(0,7);assert.equal(ok(await http('GET','?month='+month)).totalMinor,1250);
        });
        await t.test('history is immutable and reversal restores original cash without deleting the expense',async()=>{
            await assert.rejects(Expense.updateOne({_id:original._id},{$set:{amountMinor:1}}),/immutable/);
            assert.equal((await http('POST','/'+original._id+'/reverse',reverse({confirmation:'NO'}))).status,400);
            const request=reverse();const result=ok(await http('POST','/'+original._id+'/reverse',request));assert.equal(result.expense.reversalOf,original._id);
            assert.equal((await balance()).balanceMinor,10000);assert.equal(ok(await http('GET','')).totalMinor,0);
            assert.equal(ok(await http('POST','/'+original._id+'/reverse',request)).replayed,true);
            assert.equal((await http('POST','/'+original._id+'/reverse',reverse())).status,409);
            const details=ok(await http('GET','/'+original._id));assert.equal(details.expense.amountMinor,1250);assert.ok(details.reversal);assert.ok(details.journal);
        });
        await t.test('late journal failure rolls back expense and account changes',async()=>{
            const prior=await Expense.countDocuments(),create=BusinessTransaction.create;
            BusinessTransaction.create=async()=>{throw new Error('injected late journal failure');};
            try{assert.equal((await http('POST','',body())).status,500);}finally{BusinessTransaction.create=create;}
            assert.equal(await Expense.countDocuments(),prior);assert.equal((await balance()).balanceMinor,10000);
        });
        await t.test('concurrent duplicate submissions cannot double spend',async()=>{
            const request=body({amountMinor:8000});const results=await Promise.all([http('POST','',request),http('POST','',request)]);
            assert.ok(results.some(r=>r.status===200));assert.ok(results.every(r=>[200,409].includes(r.status)));
            assert.equal(ok(await http('POST','',request)).replayed,true);assert.equal((await balance()).balanceMinor,2000);
            const outcomes=await Promise.all([http('POST','',body({amountMinor:1500})),http('POST','',body({amountMinor:1500}))]);
            assert.equal(outcomes.filter(r=>r.status===200).length,1);assert.equal((await balance()).balanceMinor,500);
        });
        await t.test('bank payments do not change cash and both source journals reconcile',async()=>{
            ok(await http('POST','',body({accountId:String(bank._id),amountMinor:1000})));
            assert.equal((await tx(s=>accounts.getAccountBalance(a.actor,String(bank._id),s))).balanceMinor,9000);
            assert.equal((await balance()).balanceMinor,500);
            const report=ok(await http('GET','/reconciliation'));assert.equal(report.orphanedJournalCount,0);assert.ok(report.entries.every(e=>e.issues.length===0));
            const result=await tx(s=>accounts.getBusinessTransactions(a.actor,{type:'EXPENSE'},s));assert.ok(result.entries.length>=3);
            const journalId=ok(await http('GET','/'+original._id)).journal._id;const detail=await tx(s=>accounts.getBusinessTransaction(a.actor,String(journalId),s));assert.ok(detail.transaction.reversedBy.length);
        });
        await t.test('missing source journal is reported and prevents unsafe reversal',async()=>{
            const event=await Expense.findOne({kind:'EXPENSE',amountMinor:1000});const journal=await BusinessTransaction.findOne({'source.referenceId':event._id,'source.kind':'EXPENSE'}).lean();
            await BusinessTransaction.collection.deleteOne({_id:journal._id});
            try{assert.equal((await http('POST','/'+event._id+'/reverse',reverse())).status,409);assert.ok(ok(await http('GET','/reconciliation')).entries.some(e=>e.issues.length));}finally{await BusinessTransaction.collection.insertOne(journal);}
        });
        await t.test('production accounting guard remains closed',async()=>{
            process.env.NODE_ENV='production';try{assert.equal((await http('POST','',body())).status,409);}finally{process.env.NODE_ENV='test';}
        });
        await t.test('Pakistan monthly boundaries and dated reversals keep historical months unchanged',async()=>{
            const now=new Date(Date.now()+5*3600000),boundary=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)-5*3600000);
            const before=new Date(+boundary-1),after=new Date(+boundary+1),cutoffAt=new Date(+boundary-86400000).toISOString();
            const otherTx=work=>accounts.businessTransaction(b.actor,work);
            const otherAccount=async(kind,code)=>otherTx(s=>accounts.createFinancialAccount(b.actor,{kind,code,name:code},s));
            const till=await otherAccount('CASH','OTHER-CASH'),eq=await otherAccount('OPENING_EQUITY','OTHER-EQUITY'),ctl=await otherAccount('SETTLEMENT_CLEARING','OTHER-CONTROL');
            await otherTx(s=>accounts.recordOpeningBalance(b.actor,{requestKey:'other-opening-100',accountId:String(till._id),equityAccountId:String(eq._id),amountMinor:10000,occurredAt:cutoffAt,reason:'Verified other shop funds',confirmation:'CONFIRM OPENING BALANCE'},s));
            await otherTx(s=>accounts.prepareCashBankCutover(b.actor,{clearingAccountId:String(ctl._id),cutoffAt,accounts:[{accountId:String(till._id),confirmedBalanceMinor:10000}],confirmation:'PREPARE CASH BANK CUTOVER'},s));
            const cat=ok(await http('POST','/categories',{name:'Rent'},b.user));
            const first=ok(await http('POST','',body({categoryId:cat._id,accountId:String(till._id),amountMinor:100,occurredAt:before.toISOString()}),b.user)).expense;
            ok(await http('POST','',body({categoryId:cat._id,accountId:String(till._id),amountMinor:200,occurredAt:boundary.toISOString()}),b.user));
            ok(await http('POST','/'+first._id+'/reverse',reverse({occurredAt:after.toISOString()}),b.user));
            const thisMonth=now.toISOString().slice(0,7),lastMonth=new Date(+before+5*3600000).toISOString().slice(0,7);
            assert.equal(ok(await http('GET','?month='+lastMonth,null,b.user)).totalMinor,100);
            assert.equal(ok(await http('GET','?month='+thisMonth,null,b.user)).totalMinor,100);
            assert.equal((await http('POST','',body({categoryId:cat._id}))).status,404);
            assert.equal((await http('POST','',body({accountId:String(till._id)}))).status,404);
        });
        await t.test('optional expense descriptions keep generated audit labels and references',async()=>{
            for(const description of ['',undefined,'  ','Actual shop note']){
                const request=body({description,amountMinor:1,reference:''}),before=(await balance()).balanceMinor;
                const saved=ok(await http('POST','',request)).expense;
                assert.equal(saved.description,description?.trim()||'Shop expense');assert.match(saved.reference,/^EX-/);
                assert.equal(ok(await http('POST','',request)).replayed,true);assert.equal((await balance()).balanceMinor,before-1);
                assert.equal((await http('POST','/'+saved._id+'/reverse',reverse({description:''}))).status,400);
            }
        });
    }finally{
        delete process.env.BUSINESS_ACCOUNTING_ENABLED;
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-expenses-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
