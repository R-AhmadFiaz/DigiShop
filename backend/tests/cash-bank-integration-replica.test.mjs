import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
process.env.ACCESS_TOKEN_EXPIRY='15m';process.env.REFRESH_TOKEN_EXPIRY='7d';
const service=await import('../dist/utils/businessAccounts.js');
const {settleInvoice,changeStoreCredit}=await import('../dist/utils/invoiceSettlement.js');
const {moneyMinor,moneyMajor}=await import('../dist/utils/invoiceAccounting.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {User}=await import('../dist/models/user.model.js');
const {Customer}=await import('../dist/models/customer.model.js');
const {CustomerLedger}=await import('../dist/models/customerLedger.model.js');
const {Order}=await import('../dist/models/order.model.js');
const {InvoiceAdjustment}=await import('../dist/models/invoiceAdjustment.model.js');
const {Product}=await import('../dist/models/product.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const {BusinessTransaction}=await import('../dist/models/businessTransaction.model.js');
import {mongodBinary} from './mongod-binary.mjs';
const binary=mongodBinary;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// Internal adapter harness, NOT a claim that public controllers post cash yet.
// Starts a new loopback-only database; never loads dotenv or any configured URI.
await test('Phase 2A cash/bank primitives on disposable real replica set',{skip:!existsSync(binary)},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-cash-bank-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','cashBankTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/cash_bank_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(error){if(n>40)throw error;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'cashBankTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const M of [Shop,User,Customer,CustomerLedger,Order,InvoiceAdjustment,Product,FinancialAccount,BusinessTransaction]){await M.createCollection();await M.createIndexes();}
        const actorId=new mongoose.Types.ObjectId(),otherId=new mongoose.Types.ObjectId();
        const shop=await Shop.create({ownerId:actorId,name:'Cash integration',address:'Test',contactNo:'03111111111',subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)});
        const otherShop=await Shop.create({ownerId:otherId,name:'Other shop',address:'Test',contactNo:'03222222222',subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)});
        await User.create([{_id:actorId,shopId:shop._id,role:'OWNER',username:'cashowner',email:'cash@integration.test',password:'testing123'},
            {_id:otherId,shopId:otherShop._id,role:'OWNER',username:'otherowner',email:'other@integration.test',password:'testing123'}]);
        const actor={_id:actorId,shopId:shop._id,role:'OWNER',username:'cashowner'},other={_id:otherId,shopId:otherShop._id,role:'OWNER',username:'otherowner'};
        const run=(fn,a=actor)=>service.businessTransaction(a,fn);
        const createAccount=(code,kind)=>run(s=>service.createFinancialAccount(actor,{code,name:code,kind},s));
        const cash=await createAccount('CASH','CASH'),bank=await createAccount('BANK','BANK'),zero=await createAccount('EMPTY-TILL','CASH'),equity=await createAccount('EQUITY','OPENING_EQUITY'),clearing=await createAccount('SETTLEMENT','SETTLEMENT_CLEARING');
        const cutoffAt=new Date(Date.now()-3600000).toISOString();
        const opening=(account,amount,key)=>({requestKey:key,accountId:String(account._id),equityAccountId:String(equity._id),amountMinor:amount,occurredAt:cutoffAt,reason:'Owner verified money at cutoff',confirmation:'CONFIRM OPENING BALANCE'});
        const cashOpening=await run(s=>service.recordOpeningBalance(actor,opening(cash,100000,'initial-cash'),s));
        await run(s=>service.recordOpeningBalance(actor,opening(bank,50000,'initial-bank'),s));
        const preparation={clearingAccountId:String(clearing._id),cutoffAt,accounts:[{accountId:String(cash._id),confirmedBalanceMinor:100000},{accountId:String(bank._id),confirmedBalanceMinor:50000},{accountId:String(zero._id),confirmedBalanceMinor:0}],confirmation:'PREPARE CASH BANK CUTOVER'};
        const balance=account=>run(s=>service.getAccountBalance(actor,String(account._id),s));
        const report=(args={})=>run(s=>service.reconcileCashBank(actor,{clearingAccountId:String(clearing._id),...args},s));
        const product=await Product.create({shopId:shop._id,name:'Test Cable',slug:'cash-cable',brand:'Test',category:new mongoose.Types.ObjectId(),unit:'m',stockQuantity:100,costPrice:10,retailPrice:50,wholesalePrice:45});
        let sequence=0;
        async function invoice({paid=20,customer,credit=0,preCutover=true}={}){
            const n=++sequence;
            customer??=await Customer.create({shopId:shop._id,name:'Customer '+n,phoneNo:String(33000000000+n)});
            return run(async session=>{
                const due=100-paid-credit;
                const order=await Order.create([{shopId:shop._id,customerId:customer._id,createdBy:actorId,createdByName:'Original seller',invoiceNo:'CASH-'+n,type:'INVOICE',saleType:'RETAIL',status:'PENDING',
                    items:[{productId:product._id,quantity:2,unitPrice:50,name:'Test Cable',brand:'Test',unit:'m'}],subtotal:100,totalPrice:100,discountType:'NONE',discountValue:0,discountAmount:0,paidAmount:paid+credit,amountDue:due,
                    createdAt:new Date(+new Date(cutoffAt)+(preCutover?-86400000:1000)),
                    ...(credit?{settlementState:{openingCashMinor:paid*100,openingCreditMinor:credit*100,cashNetMinor:paid*100,creditNetMinor:credit*100}}:{})}],{session}).then(rows=>rows[0]);
                if(due){await Customer.updateOne({_id:customer._id,shopId:shop._id},{$inc:{remainingMoney:due}},{session});await CustomerLedger.create([{shopId:shop._id,customerId:customer._id,referenceId:order._id,invoiceNo:order.invoiceNo,description:'PURCHASE',amount:due}],{session});}
                if(credit){const eventId=new mongoose.Types.ObjectId();await changeStoreCredit(customer._id,order,-credit*100,'CREDIT_REDEEMED',actor,eventId,session);
                    const snapshot={items:order.items,subtotalMinor:10000,discountMinor:0,totalMinor:10000,discountType:'NONE',discountValue:0};
                    await InvoiceAdjustment.create([{_id:eventId,shopId:shop._id,orderId:order._id,invoiceNo:order.invoiceNo,kind:'SALE',requestKey:'credit-sale-'+n,requestHash:'fixture',revisionBefore:0,revisionAfter:0,createdBy:actorId,createdByName:actor.username,reason:'POS credit-funded payment',occurredAt:order.createdAt,
                        before:{...snapshot,settledMinor:0,dueMinor:10000},after:{...snapshot,settledMinor:(paid+credit)*100,dueMinor:due*100},movements:[],creditCustomerId:customer._id,
                        financial:{cashReceivedMinor:paid*100,creditRedeemedMinor:credit*100,debtDeltaMinor:due*100,salesDeltaMinor:0}}],{session});}
                return {order,customer};
            });
        }
        // Compose existing settlement utility + actual Order/event writes in ONE
        // transaction, then invoke the cash adapter. Controllers remain untouched.
        async function settle(session,orderId,input={},total,occurredAt=new Date()){
            const order=await Order.findOne({_id:orderId,shopId:shop._id}).session(session);
            const eventId=new mongoose.Types.ObjectId(),kind=total===undefined?'PAYMENT':'ADJUSTMENT';
            const next=total===undefined?moneyMinor(order.totalPrice):moneyMinor(total);
            const before={items:order.items,subtotalMinor:moneyMinor(order.subtotal),discountMinor:moneyMinor(order.discountAmount),totalMinor:moneyMinor(order.totalPrice),settledMinor:moneyMinor(order.paidAmount),dueMinor:moneyMinor(order.amountDue),discountType:order.discountType,discountValue:order.discountValue};
            // Use a valid owner discount reduction to exercise refund funding;
            // product-return planning remains covered by the existing core suite.
            const discountMinor=before.subtotalMinor-next;assert.ok(discountMinor>=0);
            const discountType=discountMinor?'FIXED':'NONE',discountValue=moneyMajor(discountMinor);
            const result=await settleInvoice(order,next,input,actor,eventId,session,kind);
            const revision=order.revision??0;
            const updated=await Order.updateOne({_id:order._id,shopId:shop._id,revision},{$set:{totalPrice:moneyMajor(next),discountAmount:discountValue,discountType,discountValue,paidAmount:moneyMajor(result.settledMinor),amountDue:moneyMajor(result.dueMinor),settlementState:result.settlementState},$inc:{revision:1}},{session});assert.equal(updated.modifiedCount,1);
            const [event]=await InvoiceAdjustment.create([{_id:eventId,shopId:shop._id,orderId:order._id,invoiceNo:order.invoiceNo,kind,requestKey:'settlement-'+eventId,requestHash:'fixture',revisionBefore:revision,revisionAfter:revision+1,createdBy:actorId,createdByName:actor.username,reason:'Test settlement',occurredAt,
                before,after:{...before,discountMinor,discountType,discountValue,totalMinor:next,settledMinor:result.settledMinor,dueMinor:result.dueMinor},movements:[],creditRecipientId:result.creditIssuedMinor?order.customerId:undefined,
                financial:{salesDeltaMinor:next-before.totalMinor,debtDeltaMinor:result.debtDeltaMinor,cashReceivedMinor:result.cashReceivedMinor,cashRefundMinor:result.cashRefundMinor,creditRedeemedMinor:result.creditRedeemedMinor,creditIssuedMinor:result.creditIssuedMinor,creditRestoredMinor:result.creditRestoredMinor}}],{session});
            return event;
        }
        const post=(session,event,account=cash,direction='RECEIPT',requestKey='post-'+event._id+'-'+direction)=>service.postInvoiceCashMovement(actor,{eventId:String(event._id),cashAccountId:String(account._id),direction,requestKey},session);
        let partial,partialEvent,fullEvent;
        await t.test('cutover requires confirmation, correct opening evidence and same-shop cash accounts',async()=>{
            await assert.rejects(run(s=>service.prepareCashBankCutover(actor,{...preparation,confirmation:''},s)),/Confirm/);
            await assert.rejects(run(s=>service.prepareCashBankCutover(actor,{...preparation,accounts:[{accountId:String(cash._id),confirmedBalanceMinor:1}]},s)),/does not match/);
            assert.equal((await FinancialAccount.findById(cash._id)).cashCutoverId,undefined);
            const prepared=await run(s=>service.prepareCashBankCutover(actor,preparation,s));assert.equal(prepared.cashIntegration.state,'PREPARED');
            await run(s=>service.prepareCashBankCutover(actor,preparation,s));
            assert.equal((await balance(zero)).balanceMinor,0);assert.equal(await BusinessTransaction.countDocuments({'source.kind':'OPENING'}),2);
            await assert.rejects(run(s=>service.reverseBusinessJournal(actor,{transactionId:String(cashOpening._id),requestKey:'reverse-cutoff',occurredAt:new Date().toISOString(),reason:'bad'},s)),/Prepared opening/);
        });
        await t.test('account selection never falls back to another account or exposes another shop',async()=>{
            assert.equal((await run(s=>service.selectCashBankAccounts(actor,s))).length,3);
            assert.deepEqual(await run(s=>service.selectCashBankAccounts(other,s),other),[]);
            await assert.rejects(run(s=>service.postInvoiceCashMovement(other,{eventId:String(new mongoose.Types.ObjectId()),cashAccountId:String(cash._id),direction:'RECEIPT',requestKey:'foreign-post'},s),other),/not found/);
            await assert.rejects(run(s=>service.selectCashBankAccounts({...actor,role:'CASHIER'},s)),/Owner/);
        });
        await t.test('foreign source events and customer records cannot be used with this shop accounts',async()=>{
            const foreignOrder=await Order.create({shopId:otherShop._id,createdBy:otherId,invoiceNo:'FOREIGN',items:[{productId:new mongoose.Types.ObjectId(),quantity:1,unitPrice:1}],totalPrice:1,subtotal:1,paidAmount:1,amountDue:0});
            const snapshot={items:foreignOrder.items,subtotalMinor:100,discountMinor:0,totalMinor:100,settledMinor:100,dueMinor:0,discountType:'NONE',discountValue:0};
            const event=await InvoiceAdjustment.create({shopId:otherShop._id,orderId:foreignOrder._id,invoiceNo:'FOREIGN',requestKey:'foreign-event',requestHash:'fixture',kind:'SALE',revisionBefore:0,revisionAfter:0,createdBy:otherId,createdByName:'Other owner',reason:'Other shop receipt',before:snapshot,after:snapshot,movements:[],financial:{cashReceivedMinor:100},occurredAt:new Date()});
            const before=await BusinessTransaction.countDocuments();
            await assert.rejects(run(s=>post(s,event)),/not found in shop/);
            const foreignCustomer=await Customer.create({shopId:otherShop._id,name:'Other customer',phoneNo:'03999999999'});
            await assert.rejects(run(s=>service.reconcileBusinessCustomer(actor,String(foreignCustomer._id),s)),/not found in shop/);
            assert.equal(await BusinessTransaction.countDocuments(),before);
        });
        await t.test('pre-cutover invoice receives partial cash payment atomically without posting old cash',async()=>{
            partial=await invoice();
            partialEvent=await run(async s=>{const event=await settle(s,partial.order._id,{cashReceivedAmount:30});await post(s,event);return event;});
            assert.equal((await balance(cash)).balanceMinor,103000);assert.equal((await balance(clearing)).balanceMinor,3000);
            assert.equal((await Customer.findById(partial.customer._id)).remainingMoney,50);assert.equal((await Order.findById(partial.order._id)).paidAmount,50);
            assert.equal(await BusinessTransaction.countDocuments({'source.kind':'INVOICE_RECEIPT'}),1);
            const reconciliation=await run(s=>service.reconcileBusinessCustomer(actor,String(partial.customer._id),s));assert.equal(reconciliation.reconciled,true);assert.equal(reconciliation.debtMinor,5000);
        });
        await t.test('full remaining payment to bank clears debt without counting revenue or cash twice',async()=>{
            fullEvent=await run(async s=>{const event=await settle(s,partial.order._id,{cashReceivedAmount:50});await post(s,event,bank);return event;});
            assert.equal((await balance(bank)).balanceMinor,55000);assert.equal((await balance(cash)).balanceMinor,103000);
            assert.equal((await Customer.findById(partial.customer._id)).remainingMoney,0);
            const journal=await BusinessTransaction.findOne({'source.referenceId':fullEvent._id});assert.equal(journal.source.kind,'INVOICE_RECEIPT');assert.equal(journal.postings.some(row=>String(row.accountId)===String(clearing._id)),true);
        });
        await t.test('duplicate keys and alternate keys/accounts cannot post the same payment again',async()=>{
            const before=(await balance(cash)).balanceMinor;
            const replay=await run(s=>post(s,partialEvent));assert.equal(replay.posted,true);
            await assert.rejects(run(s=>post(s,partialEvent,cash,'RECEIPT','different-key-same-payment')));
            await assert.rejects(run(s=>post(s,partialEvent,bank)),/different transaction/);
            assert.equal((await balance(cash)).balanceMinor,before);
            await assert.rejects(run(s=>service.reverseBusinessJournal(actor,{transactionId:String(replay.transaction._id),requestKey:'reverse-payment',occurredAt:new Date().toISOString(),reason:'bad correction'},s)),/verified settlement event/);
        });
        await t.test('cash refund reduces bank by actual refund only; invoice funding and history remain authoritative',async()=>{
            const f=await invoice({paid:100});
            await run(async s=>{const e=await settle(s,f.order._id,{cashRefundAmount:50},50);await post(s,e,bank,'REFUND');});
            assert.equal((await balance(bank)).balanceMinor,50000);assert.equal((await Order.findById(f.order._id)).paidAmount,50);
            assert.equal((await Customer.findById(f.customer._id)).storeCreditBalanceMinor,0);
        });
        await t.test('combined cash/store-credit refund posts only physical cash, not the full invoice reduction',async()=>{
            const f=await invoice({paid:100});const before=(await balance(cash)).balanceMinor;
            await run(async s=>{const e=await settle(s,f.order._id,{cashRefundAmount:60,creditIssueAmount:40},0);await post(s,e,cash,'REFUND');});
            assert.equal((await balance(cash)).balanceMinor,before-6000);assert.equal((await Customer.findById(f.customer._id)).storeCreditBalanceMinor,4000);
            assert.equal((await Order.findById(f.order._id)).amountDue,0);
        });
        await t.test('store-credit issuance and credit-funded refund restoration do not count as physical cash',async()=>{
            const f=await invoice({paid:100});
            const cashBefore=(await balance(cash)).balanceMinor;
            await run(async s=>{const e=await settle(s,f.order._id,{creditIssueAmount:20},80);assert.equal((await post(s,e,cash,'REFUND')).posted,false);});
            assert.equal((await balance(cash)).balanceMinor,cashBefore);assert.equal((await Customer.findById(f.customer._id)).storeCreditBalanceMinor,2000);
            const creditSale=await invoice({paid:80,credit:20,customer:f.customer});
            await run(async s=>{const e=await settle(s,creditSale.order._id,{cashRefundAmount:80},0);await post(s,e,cash,'REFUND');assert.equal(e.financial.creditRestoredMinor,2000);});
            assert.equal((await balance(cash)).balanceMinor,cashBefore-8000);assert.equal((await Customer.findById(f.customer._id)).storeCreditBalanceMinor,2000);
            assert.equal((await run(s=>service.reconcileBusinessCustomer(actor,String(f.customer._id),s))).reconciled,true);
        });
        await t.test('credit-only payment clears debt without cash posting',async()=>{
            const donor=await invoice({paid:100});
            await run(async s=>{await settle(s,donor.order._id,{creditIssueAmount:20},80);});
            const f=await invoice({paid:80,customer:donor.customer});
            const before=(await balance(cash)).balanceMinor;
            await run(async s=>{const e=await settle(s,f.order._id,{creditRedeemedAmount:20});assert.equal((await post(s,e)).posted,false);});
            assert.equal((await balance(cash)).balanceMinor,before);assert.equal((await Customer.findById(f.customer._id)).remainingMoney,0);
        });
        await t.test('pre-cutover payment events cannot be reposted even if invoice is still open',async()=>{
            const f=await invoice();
            const old=await run(s=>settle(s,f.order._id,{cashReceivedAmount:5},undefined,new Date(+new Date(cutoffAt)-1000)));
            await assert.rejects(run(s=>post(s,old)),/Pre-cutover/);
        });
        await t.test('missing persisted dates or cash amounts are rejected, not filled from schema defaults',async()=>{
            const f=await invoice();const e=await run(s=>settle(s,f.order._id,{cashReceivedAmount:1}));const before=await BusinessTransaction.countDocuments();
            try{
                await InvoiceAdjustment.collection.updateOne({_id:e._id},{$unset:{occurredAt:''}});
                await assert.rejects(run(s=>post(s,e)),/verified actual date/);
                const r=await report({limit:100});assert.ok(r.undatedEvents.entries.some(row=>String(row._id)===String(e._id)));
                assert.equal((await InvoiceAdjustment.collection.findOne({_id:e._id})).occurredAt,undefined);
                await InvoiceAdjustment.collection.updateOne({_id:e._id},{$set:{occurredAt:e.occurredAt},$unset:{'financial.cashReceivedMinor':''}});
                await assert.rejects(run(s=>post(s,e)),/verified monetary evidence/);
                const mismatch=await report({limit:100});assert.ok(mismatch.entries.find(row=>row.eventId===String(e._id)).issues.includes('INVALID_INVOICE_RECEIPT_EVIDENCE'));
                assert.equal(await BusinessTransaction.countDocuments(),before);
            }finally{await InvoiceAdjustment.collection.updateOne({_id:e._id},{$set:{occurredAt:e.occurredAt,'financial.cashReceivedMinor':100}});}
        });
        await t.test('transfers preserve total money, reject overdrafts and replay safely',async()=>{
            const input={fromAccountId:String(cash._id),toAccountId:String(bank._id),amountMinor:1000,requestKey:'cash-bank-transfer',occurredAt:new Date().toISOString(),reason:'Till deposit'};
            const beforeCash=(await balance(cash)).balanceMinor,beforeBank=(await balance(bank)).balanceMinor;
            await run(s=>service.transferCashBank(actor,input,s));await run(s=>service.transferCashBank(actor,input,s));
            assert.equal((await balance(cash)).balanceMinor,beforeCash-1000);assert.equal((await balance(bank)).balanceMinor,beforeBank+1000);
            await assert.rejects(run(s=>service.transferCashBank(actor,{...input,requestKey:'overdraft-transfer',amountMinor:beforeCash+1},s)),/Insufficient/);
            await assert.rejects(run(s=>service.transferCashBank(actor,{...input,requestKey:'same-account',toAccountId:String(cash._id)},s)),/distinct/);
        });
        await t.test('prepared accounts cannot bypass source linking through ordinary manual journals',async()=>{
            const rows=[{accountId:String(cash._id),debitMinor:1,creditMinor:0},{accountId:String(clearing._id),debitMinor:0,creditMinor:1}];
            await assert.rejects(run(s=>service.postBusinessJournal(actor,{requestKey:'unlinked-cash',reason:'Not allowed',occurredAt:new Date().toISOString(),postings:rows},s)),/source-linked|verified invoice/);
            await assert.rejects(run(s=>service.prepareCashBankCutover(actor,{...preparation,cutoffAt:new Date(+new Date(cutoffAt)+1).toISOString()},s)),/different details/);
            await run(s=>service.prepareCashBankCutover(actor,preparation,s));
        });
        await t.test('reconciliation reports missing receipts and unsupported cash-only sales without inventing them',async()=>{
            const f=await invoice({preCutover:false});
            const event=await run(s=>settle(s,f.order._id,{cashReceivedAmount:1}));
            const before=await BusinessTransaction.countDocuments();const r=await report({limit:100});
            assert.equal(r.livePostingEnabled,false);assert.equal(r.state,'PREPARED');assert.ok(r.missingInitialEvents.recordCount>=1);
            assert.ok(r.entries.find(row=>row.eventId===String(event._id)).issues.includes('MISSING_INVOICE_RECEIPT'));
            assert.equal(await BusinessTransaction.countDocuments(),before);
            const invalid=await run(s=>service.reconcileBusinessCustomer(actor,String(f.customer._id),s));assert.equal(invalid.reconciled,true);
            await Customer.updateOne({_id:f.customer._id},{$inc:{remainingMoney:1}});
            const mismatch=await run(s=>service.reconcileBusinessCustomer(actor,String(f.customer._id),s));assert.equal(mismatch.reconciled,false);assert.ok(mismatch.issues.some(row=>row.code==='CUSTOMER_LEDGER_MISMATCH'));
        });
        await t.test('insufficient cash rolls back a composed refund, credit/debt changes and event history',async()=>{
            const f=await invoice({paid:100});const revision=f.order.revision;
            await assert.rejects(run(async s=>{const e=await settle(s,f.order._id,{cashRefundAmount:100},0);await post(s,e,zero,'REFUND');}),/Insufficient/);
            const saved=await Order.findById(f.order._id);assert.equal(saved.revision,revision);assert.equal(saved.totalPrice,100);assert.equal(saved.paidAmount,100);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId:saved._id}),0);assert.equal((await Customer.findById(f.customer._id)).remainingMoney,0);
        });
        await t.test('late DB failure rolls back actual settlement, invoice, stock, ledger and cash atomically',async()=>{
            const f=await invoice();const cashBefore=(await balance(cash)).balanceMinor,stockBefore=(await Product.findById(product._id)).stockQuantity;
            await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{requestKey:{$ne:'force-cash-rollback'}}});
            try{await assert.rejects(run(async s=>{await Product.updateOne({_id:product._id,shopId:shop._id},{$inc:{stockQuantity:1}},{session:s});const e=await settle(s,f.order._id,{cashReceivedAmount:10});await post(s,e,cash,'RECEIPT','force-cash-rollback');}));}
            finally{await mongoose.connection.db.command({collMod:BusinessTransaction.collection.collectionName,validator:{}});}
            assert.equal((await balance(cash)).balanceMinor,cashBefore);assert.equal((await Product.findById(product._id)).stockQuantity,stockBefore);
            assert.equal((await Customer.findById(f.customer._id)).remainingMoney,80);assert.equal((await Order.findById(f.order._id)).revision,0);
            assert.equal(await CustomerLedger.countDocuments({referenceId:f.order._id}),1);assert.equal(await InvoiceAdjustment.countDocuments({orderId:f.order._id}),0);
        });
        await t.test('concurrent duplicate posting permits one movement and an identical retry',async()=>{
            const f=await invoice();const e=await run(s=>settle(s,f.order._id,{cashReceivedAmount:2}));const before=(await balance(cash)).balanceMinor;
            const outcomes=await Promise.allSettled([run(s=>post(s,e)),run(s=>post(s,e))]);assert.ok(outcomes.some(row=>row.status==='fulfilled'));
            await run(s=>post(s,e));assert.equal((await balance(cash)).balanceMinor,before+200);assert.equal(await BusinessTransaction.countDocuments({'source.kind':'INVOICE_RECEIPT','source.referenceId':e._id}),1);
        });
        await t.test('concurrent complete invoice payments cannot collect the same debt twice',async()=>{
            const f=await invoice();const before=(await balance(cash)).balanceMinor;
            const outcomes=await Promise.allSettled([1,2].map(()=>run(async s=>{const e=await settle(s,f.order._id,{cashReceivedAmount:80});await post(s,e);})));
            assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);
            assert.equal((await balance(cash)).balanceMinor,before+8000);assert.equal((await Customer.findById(f.customer._id)).remainingMoney,0);
            assert.equal(await InvoiceAdjustment.countDocuments({orderId:f.order._id}),1);
        });
        await t.test('concurrent withdrawals cannot overdraw a bank balance',async()=>{
            const before=(await balance(bank)).balanceMinor;
            const input={fromAccountId:String(bank._id),toAccountId:String(zero._id),amountMinor:before,occurredAt:new Date().toISOString(),reason:'Move all bank funds'};
            const outcomes=await Promise.allSettled(['withdraw-one','withdraw-two'].map(requestKey=>run(s=>service.transferCashBank(actor,{...input,requestKey},s))));
            assert.equal(outcomes.filter(row=>row.status==='fulfilled').length,1);assert.equal((await balance(bank)).balanceMinor,0);
        });
    }finally{
        await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-cash-bank-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
