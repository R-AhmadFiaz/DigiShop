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
process.env.DOTENV_CONFIG_PATH=path.join(os.tmpdir(),'digishop-no-pagination-env');
process.env.NODE_ENV='test';delete process.env.BUSINESS_ACCOUNTING_ENABLED;
process.env.ACCESS_TOKEN_SECRET='pagination-test';process.env.REFRESH_TOKEN_SECRET='pagination-refresh-test';
process.env.ACCESS_TOKEN_EXPIRY='15m';process.env.REFRESH_TOKEN_EXPIRY='7d';process.env.OPENAI_API_KEY='test-only';
const {app}=await import('../dist/app.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {User}=await import('../dist/models/user.model.js');
const {Product}=await import('../dist/models/product.model.js');
const {Category}=await import('../dist/models/category.model.js');
const {FinancialAccount}=await import('../dist/models/financialAccount.model.js');
const {Customer}=await import('../dist/models/customer.model.js');
const {Order}=await import('../dist/models/order.model.js');
// Disposable loopback replica set; never a configured or shared database.
import {mongodBinary} from './mongod-binary.mjs';
const binary=mongodBinary;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const DAY=86400000;

await test('opt-in server pagination: disposable loopback replica set',{skip:!binary},async t=>{
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'digishop-pagination-'));
    const finder=net.createServer();await new Promise(r=>finder.listen(0,'127.0.0.1',r));const port=finder.address().port;await new Promise(r=>finder.close(r));
    const mongo=spawn(binary,['--dbpath',temp,'--bind_ip','127.0.0.1','--port',String(port),'--replSet','paginationTest','--logpath',path.join(temp,'mongo.log')],{windowsHide:true,stdio:'ignore'});
    let server;
    try{
        for(let n=0;;n++){try{await mongoose.connect(`mongodb://127.0.0.1:${port}/pagination_test?directConnection=true`,{serverSelectionTimeoutMS:500,autoCreate:false,autoIndex:false});break;}catch(e){if(n>40)throw e;await sleep(100);}}
        await mongoose.connection.db.admin().command({replSetInitiate:{_id:'paginationTest',members:[{_id:0,host:`127.0.0.1:${port}`}]}});
        for(let n=0;!(await mongoose.connection.db.admin().command({hello:1})).isWritablePrimary;n++){if(n>200)throw Error('No primary');await sleep(100);}
        for(const M of Object.values(mongoose.models)){await M.createCollection();await M.createIndexes();}
        async function fixture(label,phone,extra={}){const _id=new mongoose.Types.ObjectId(),shop=await Shop.create({ownerId:_id,name:label,address:'Test',contactNo:phone,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+30*DAY),...extra}),user=await User.create({_id,shopId:shop._id,username:label,email:label+'@pagination.test',password:'testing123',role:'OWNER'});return {shop,user};}
        const a=await fixture('alpha-owner','03100000001'),b=await fixture('beta-owner','03100000002');
        const cashier=await User.create({shopId:a.shop._id,username:'zz-cashier',email:'zz@pagination.test',password:'testing123',role:'CASHIER'});
        const admin=await User.create({username:'pagination-admin',email:'admin@pagination.test',password:'testing123',role:'ADMIN'});
        const wires=await Category.create({shopId:a.shop._id,name:'Wires',slug:'wires'}),fans=await Category.create({shopId:a.shop._id,name:'Ceiling Fans',slug:'fans'});
        const foreignCategory=await Category.create({shopId:b.shop._id,name:'Wires',slug:'wires'});
        let n=0;const make=(shop,category,extra={})=>({shopId:shop._id,name:'Item '+(++n),slug:'item-'+n,brand:'Eagle',category:category._id,unit:'pcs',costPrice:10,retailPrice:15,wholesalePrice:12,stockQuantity:50,minStockThreshold:5,...extra});
        const rows=[];
        for(let i=0;i<45;i++)rows.push(make(a.shop,i%3?wires:fans,{brand:i%2?'Eagle':' eagle ',stockQuantity:i%4===0?2:50,...(i===7?{name:'Copper (3.5mm) cable',description:'Heavy duty'}:{}),...(i===8?{brand:'Pak Fan',description:'Copper winding'}:{})}));
        for(let i=0;i<5;i++)rows.push(make(b.shop,foreignCategory,{name:'Copper foreign '+i,stockQuantity:1}));
        await Product.insertMany(rows);
        const lowInA=rows.filter(r=>String(r.shopId)===String(a.shop._id)&&r.stockQuantity<=r.minStockThreshold).length;
        server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
        async function http(url,user=a.user){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v2${url}`,{headers:{Authorization:'Bearer '+jwt.sign({_id:user._id},process.env.ACCESS_TOKEN_SECRET)}});return {status:response.status,body:await response.json()};}
        const ok=async(url,user)=>{const r=await http(url,user);assert.equal(r.status,200,url+' '+JSON.stringify(r.body));return r.body.data;};

        await t.test('product search without page/limit keeps the complete legacy response',async()=>{
            const data=await ok('/products/search-product');
            assert.deepEqual(Object.keys(data),['product']);assert.equal(data.product.length,45);
            assert.ok(data.product.every(p=>String(p.shopId)===String(a.shop._id)));
        });
        await t.test('paged products: accurate totals, stable non-overlapping pages, shop isolation',async()=>{
            const seen=new Set();
            for(let page=1;page<=3;page++){const data=await ok('/products/search-product?page='+page+'&limit=20');
                assert.deepEqual(data.pagination,{currentPage:page,limit:20,recordCount:45,totalPages:3});
                assert.equal(data.product.length,page<3?20:5);
                for(const p of data.product){assert.equal(String(p.shopId),String(a.shop._id));assert.ok(!seen.has(String(p._id)));seen.add(String(p._id));}}
            assert.equal(seen.size,45);
            // Same order users saw before paging: the legacy query's slug-index order.
            const legacySlugs=(await ok('/products/search-product')).product.map(p=>p.slug);
            const pagedSlugs=[];for(let page=1;page<=3;page++)pagedSlugs.push(...(await ok('/products/search-product?page='+page+'&limit=20')).product.map(p=>p.slug));
            assert.deepEqual(pagedSlugs,legacySlugs);assert.deepEqual(pagedSlugs,[...pagedSlugs].sort());
            const beyond=await ok('/products/search-product?page=9&limit=20');assert.equal(beyond.product.length,0);assert.equal(beyond.pagination.recordCount,45);
        });
        await t.test('paged search matches every word literally across name, brand, description and category name',async()=>{
            assert.deepEqual((await ok('/products/search-product?page=1&limit=20&search='+encodeURIComponent('(3.5mm)'))).product.map(p=>p.name),['Copper (3.5mm) cable']);
            const copper=(await ok('/products/search-product?page=1&limit=20&search=copper')).product.map(p=>p.name).sort();
            assert.deepEqual(copper,['Copper (3.5mm) cable','Item 9']);
            const multi=await ok('/products/search-product?page=1&limit=50&search='+encodeURIComponent('ceiling item'));
            assert.equal(multi.pagination.recordCount,rows.filter((r,i)=>i<45&&!(i%3)&&/item/i.test(r.name)).length);
            assert.equal((await ok('/products/search-product?page=1&limit=20&search=.*')).pagination.recordCount,0);
        });
        await t.test('paged brand, category and low-stock filters; brands list is shop- and category-scoped',async()=>{
            const eagle=await ok('/products/search-product?page=1&limit=50&brand=EAGLE');assert.equal(eagle.pagination.recordCount,44);
            const fan=await ok('/products/search-product?page=1&limit=50&category='+fans._id);assert.equal(fan.pagination.recordCount,15);
            assert.deepEqual(fan.brands,[{value:'eagle',label:fan.brands[0].label}]);
            const all=await ok('/products/search-product?page=1&limit=5');assert.deepEqual(all.brands.map(x=>x.value),['eagle','pak fan']);
            assert.equal((await ok('/products/search-product?page=1&limit=50&lowStock=true')).pagination.recordCount,lowInA);
            assert.equal((await http('/products/search-product?page=1&limit=20&category=not-an-id')).status,400);
        });
        await t.test('cashiers never receive cost prices in paged results',async()=>{
            const data=await ok('/products/search-product?page=1&limit=5',cashier);
            assert.equal(data.product.length,5);assert.ok(data.product.every(p=>p.costPrice===undefined));
        });
        await t.test('invalid paging is rejected rather than silently truncated',async()=>{
            for(const q of ['page=0','limit=101','page=abc','limit=0'])assert.equal((await http('/products/search-product?'+q)).status,400,q);
        });
        await t.test('low stock keeps its legacy response and adds paging with a full total count',async()=>{
            const legacy=await ok('/products/low-stock');assert.equal(legacy.counts,lowInA);assert.equal(legacy.Products.length,lowInA);assert.equal(legacy.pagination,undefined);
            const paged=await ok('/products/low-stock?page=2&limit=5');
            assert.equal(paged.counts,lowInA);assert.deepEqual(paged.pagination,{currentPage:2,limit:5,recordCount:lowInA,totalPages:Math.ceil(lowInA/5)});
            assert.equal(paged.Products.length,Math.min(5,lowInA-5));assert.ok(paged.Products.every(p=>p.stockQuantity<=p.minStockThreshold&&String(p.shopId)===String(a.shop._id)));
        });
        await t.test('cashier list pages per shop, sorted by username, owner only',async()=>{
            for(let i=0;i<23;i++)await User.collection.insertOne({shopId:a.shop._id,username:'cashier-'+String(i).padStart(2,'0'),email:`c${i}@pagination.test`,password:'x',role:'CASHIER'});
            await User.collection.insertOne({shopId:b.shop._id,username:'aaa-foreign',email:'foreign@pagination.test',password:'x',role:'CASHIER'});
            const legacy=await ok('/users/cashiers');assert.equal(legacy.cashiers.length,24);assert.equal(legacy.pagination,undefined);
            const first=await ok('/users/cashiers?page=1&limit=20'),second=await ok('/users/cashiers?page=2&limit=20');
            assert.deepEqual(first.pagination,{currentPage:1,limit:20,recordCount:24,totalPages:2});
            assert.equal(first.cashiers[0].username,'cashier-00');assert.equal(second.cashiers.at(-1).username,'zz-cashier');
            assert.ok([...first.cashiers,...second.cashiers].every(c=>c.username!=='aaa-foreign'&&c.password===undefined));
            assert.equal((await http('/users/cashiers?page=1&limit=20',cashier)).status,403);
        });
        await t.test('admin shops: legacy list unchanged; paged list keeps urgency order, search and totals; admin only',async()=>{
            const owner=async(label,phone,expiry,active=true)=>fixture(label,phone,{subscriptionActive:active,subscriptionExpiry:expiry});
            await owner('expired-two','03100000010',new Date(Date.now()-2*DAY));
            await owner('expired-one','03100000011',new Date(Date.now()-5*DAY));
            await owner('never-activated','03100000012',null,false);
            await owner('soon','03100000013',new Date(Date.now()+DAY));
            await owner('later','03100000014',new Date(Date.now()+60*DAY));
            const legacy=await ok('/admin/shops',admin);assert.equal(legacy.shops.length,7);assert.equal(legacy.pagination,undefined);
            const paged=await ok('/admin/shops?page=1&limit=100',admin);
            assert.deepEqual(paged.shops.map(s=>s.name),['expired-one','expired-two','never-activated','soon','alpha-owner','beta-owner','later']);
            assert.equal(paged.shops[0].ownerId.username,'expired-one');assert.equal(paged.shops[0].ownerId.password,undefined);
            const two=await ok('/admin/shops?page=2&limit=3',admin);assert.deepEqual(two.pagination,{currentPage:2,limit:3,recordCount:7,totalPages:3});
            assert.deepEqual(two.shops.map(s=>s.name),['soon','alpha-owner','beta-owner']);
            assert.deepEqual((await ok('/admin/shops?page=1&limit=20&search=SOON%40pagination',admin)).shops.map(s=>s.name),['soon']);
            assert.deepEqual((await ok('/admin/shops?page=1&limit=20&search=03100000012',admin)).shops.map(s=>s.name),['never-activated']);
            assert.equal((await ok('/admin/shops?page=1&limit=20&search=.*',admin)).pagination.recordCount,0);
            assert.equal((await http('/admin/shops?page=1&limit=20')).status,403);
        });
        await t.test('invoice lists can include each row customer name from the same shop only',async()=>{
            const ownCustomer=new mongoose.Types.ObjectId(),foreignCustomer=new mongoose.Types.ObjectId();
            await Customer.collection.insertMany([{_id:ownCustomer,shopId:a.shop._id,name:'Customer 101',phoneNo:'03210000101'},{_id:foreignCustomer,shopId:b.shop._id,name:'Foreign buyer',phoneNo:'03210000999'}]);
            const order=(n,customerId)=>({shopId:a.shop._id,type:'INVOICE',invoiceNo:'INV-'+n,status:'DELIVERED',items:[],totalPrice:10,paidAmount:10,amountDue:0,createdAt:new Date(Date.now()-n*1000),...(customerId?{customerId}:{})});
            await Order.collection.insertMany([order(1,ownCustomer),order(2,null),order(3,foreignCustomer)]);
            const legacy=await ok('/orders/?page=1&limit=20');assert.ok(legacy.orders.every(o=>!('customerSummary' in o)));
            const rows=(await ok('/orders/?page=1&limit=20&includeCustomer=true')).orders;
            assert.deepEqual(rows.map(o=>[o.invoiceNo,o.customerSummary]),[['INV-1',{name:'Customer 101',phoneNo:'03210000101'}],['INV-2',null],['INV-3',null]]);
            assert.equal((await http('/orders/?page=1&limit=20&includeCustomer=yes')).status,400);
        });
        await t.test('financial accounts filter by kind and readiness before paging, within the shop',async()=>{
            const account=(shop,code,kind,extra={})=>({shopId:shop._id,code,name:code,kind,normalSide:'DEBIT',authority:'JOURNAL',isActive:true,...extra});
            const docs=[];for(let i=0;i<25;i++)docs.push(account(a.shop,'INV_'+String(i).padStart(2,'0'),'INVENTORY'));
            docs.push(account(a.shop,'CASH_1','CASH',{cashCutoverId:new mongoose.Types.ObjectId()}),account(a.shop,'CASH_2','CASH'),account(a.shop,'BANK_1','BANK',{cashCutoverId:new mongoose.Types.ObjectId(),isActive:false}),account(b.shop,'CASH_FOREIGN','CASH'));
            await FinancialAccount.collection.insertMany(docs);
            const unfiltered=await ok('/accounts/financial?page=1&limit=20');assert.equal(unfiltered.pagination.recordCount,28);
            const cash=await ok('/accounts/financial?page=1&limit=20&kind=CASH,BANK');
            assert.deepEqual(cash.pagination,{currentPage:1,limit:20,recordCount:3,totalPages:1});assert.deepEqual(cash.entries.map(e=>e.code),['BANK_1','CASH_1','CASH_2']);
            assert.deepEqual((await ok('/accounts/financial?page=1&limit=20&kind=CASH,BANK&ready=true')).entries.map(e=>e.code),['CASH_1']);
            for(const q of ['kind=NOPE','kind=','kind=CASH,toString','ready=yes'])assert.equal((await http('/accounts/financial?'+q)).status,400,q);
        });
    }finally{
        if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();mongo.kill();await new Promise(r=>mongo.exitCode!==null?r():mongo.once('exit',r));
        if(path.dirname(temp)===os.tmpdir()&&path.basename(temp).startsWith('digishop-pagination-'))await fs.rm(temp,{recursive:true,force:true});
    }
});
