import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

// All model operations are replaced below. These tests never connect to MongoDB.
process.env.ACCESS_TOKEN_SECRET = 'mvp-test-access';
process.env.REFRESH_TOKEN_SECRET = 'mvp-test-refresh';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.OPENAI_API_KEY = 'test-only';
const {app} = await import('../dist/app.js');
const {User} = await import('../dist/models/user.model.js');
const {Product} = await import('../dist/models/product.model.js');
const {StockLog} = await import('../dist/models/stockLog.model.js');
const {Customer} = await import('../dist/models/customer.model.js');
const {CustomerLedger} = await import('../dist/models/customerLedger.model.js');
const {Order} = await import('../dist/models/order.model.js');
const {Shop} = await import('../dist/models/shop.model.js');
const {Category} = await import('../dist/models/category.model.js');
const {listQuery} = await import('../dist/utils/listQuery.js');
const {createOrder} = await import('../dist/controllers/order.controller.js');
const id = n => n.toString(16).padStart(24, '0');
const shopId=id(1), otherShop=id(2), productId=id(3), customerId=id(4), orderId=id(5), userId=id(6);
let db, commits, aborts;
const clone=x=>structuredClone(x);
function reset({due=0, legacy=false, balance=due}={}) {
    commits=0; aborts=0;
    db={products:[{_id:productId,shopId,name:'Cable',brand:'Wire',slug:'cable-wire',category:id(30),unit:'m',costPrice:30,retailPrice:50,wholesalePrice:40,stockQuantity:10,minStockThreshold:10}],
        customers:[{_id:customerId,shopId,name:'Ahmad',phoneNo:'03001234567',address:'Shop road',remainingMoney:balance},{_id:id(7),shopId:otherShop,name:'Ahmad',phoneNo:'03001234567',remainingMoney:99}],
        orders:[{_id:orderId,shopId,type:'INVOICE',status:'PENDING',invoiceNo:'INV-1',saleType:'RETAIL',items:[{productId,quantity:2,unitPrice:50}],totalPrice:100,paidAmount:100-due,amountDue:due,...(!legacy?{customerId}:{})}],
        logs:[],ledgers:due?[{_id:id(8),shopId,customerId,referenceId:orderId,description:'PURCHASE',amount:due,invoiceNo:'INV-1'}]:[]};
}
function matches(doc, filter) {
    return Object.entries(filter).every(([key,value])=>{
        if(key==='$or')return value.some(f=>matches(doc,f));
        if(key==='$expr')return doc.stockQuantity<=doc.minStockThreshold;
        if(value&&typeof value==='object') {
            if('$gte' in value)return doc[key]>=value.$gte;
            if('$ne' in value)return String(doc[key])!==String(value.$ne);
            if('$regex' in value)return new RegExp(value.$regex,value.$options).test(doc[key]);
        }
        return String(doc[key])===String(value);
    });
}
function query(value) {
    let result=clone(value);
    if (result && !Array.isArray(result) && result.type === "QUOTATION") result.save=async()=>{db.orders.find(order=>order._id===result._id).status=result.status;};
    const q={sort(){return q},skip(n){result=result.slice(n);return q},limit(n){result=result.slice(0,n);return q},populate(){return q},session(){return q},
        select(fields){if(fields==='-costPrice')result=result.map(({costPrice,...rest})=>rest);return q},
        lean(){return q},then(resolve,reject){return Promise.resolve(result).then(resolve,reject)}};
    return q;
}
for(const [Model,key] of [[Product,'products'],[Customer,'customers'],[Order,'orders'],[CustomerLedger,'ledgers']]) {
    Model.find=filter=>query(db[key].filter(doc=>matches(doc,filter)));
    Model.findOne=filter=>query(db[key].find(doc=>matches(doc,filter))??null);
    Model.countDocuments=async filter=>db[key].filter(doc=>matches(doc,filter)).length;
    Model.findOneAndUpdate=async (filter,update)=>{
        const doc=db[key].find(doc=>matches(doc,filter));if(!doc)return null;
        Object.assign(doc,update.$set??{});
        for(const [field,delta]of Object.entries(update.$inc??{}))doc[field]+=delta;
        return clone(doc);
    };
    Model.create=async docs=>{const array=Array.isArray(docs); const entries=(array?docs:[docs]).map(d=>({_id:id(20+db[key].length),...d}));db[key].push(...clone(entries));return array?entries:entries[0];};
}
Product.findOne = filter => {
    const saved = db.products.find(doc => matches(doc, filter));
    if (!saved) return query(null);
    const product = clone(saved);
    product.save = async () => {
        const {save, populate, ...fields} = product;
        if (fields.category) fields.category = String(fields.category);
        fields.unit = fields.unit.trim().toLowerCase();
        await new Product(fields).validate();
        Object.assign(saved, fields);
        return product;
    };
    product.populate = async () => product;
    return Promise.resolve(product);
};
Category.findOne = filter => query([
    {_id: id(30), shopId}, {_id: id(31), shopId: otherShop},
].find(doc => matches(doc, filter)) ?? null);
StockLog.create=async docs=>{for(const doc of docs)await new StockLog(doc).validate();db.logs.push(...clone(docs));return docs;};
const ledgerCreate=CustomerLedger.create;
CustomerLedger.create=async docs=>{for(const doc of docs)await new CustomerLedger(doc).validate();return ledgerCreate(docs);};
Shop.find=()=>query([{_id:shopId,subscriptionActive:true}]);
Shop.findById=()=>query({subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000),invoiceCounter:db.invoiceCounter??1,referenceCounters:db.referenceCounters});
Shop.updateOne=async(filter,update)=>{for(const [field,value]of Object.entries(update.$set??{})){db.referenceCounters??=new Map();db.referenceCounters.set(field.split('.')[1],value);}if(update.$max?.invoiceCounter)db.invoiceCounter=Math.max(db.invoiceCounter??1,update.$max.invoiceCounter);};
Shop.findOneAndUpdate=async(filter,update)=>{db.referenceCounters??=new Map();for(const [field,value]of Object.entries(update.$inc??{})){const key=field.split('.')[1];db.referenceCounters.set(key,(db.referenceCounters.get(key)??0)+value);}return {referenceCounters:db.referenceCounters};};
Order.exists=filter=>query(db.orders.find(doc=>matches(doc,filter))??null);
Shop.findByIdAndUpdate=async()=>({invoiceCounter:2,subscriptionActive:true});
mongoose.startSession=async()=>{
    let snapshot;
    return {inTransaction(){return true},startTransaction(){snapshot=clone(db)},async commitTransaction(){commits++},async abortTransaction(){aborts++;db=snapshot},async endSession(){}};
};
let role, authenticatedName;
let creators = [];
User.findOne = filter => query(creators.find(user => matches(user, filter)) ?? null);
User.findById=()=>query({_id:role === "CASHIER" ? id(16) : userId,username:authenticatedName ?? (role === "CASHIER" ? "ali" : "rana usama fiaz"),shopId,role});
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
const base='http://127.0.0.1:'+server.address().port;
async function request(method,path,body,as='OWNER') {
    role=as;
    if (method === "GET" || method === "HEAD") body=undefined;
    const response=await fetch(base+'/api/v2'+path,{method,headers:{Authorization:'Bearer '+jwt.sign({_id:userId},process.env.ACCESS_TOKEN_SECRET),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
}
try {
await test('OWNER corrects product details and clears optional description without changing prices or stock', async () => {
    reset(); const before = clone(db.products[0]);
    const result = await request('PATCH', '/products/'+productId, {
        name: ' LED & Bulb ', brand: ' Philips ', category: id(30), unit: ' BOX ', description: '12W warm white',
    });
    assert.equal(result.status, 200);
    assert.equal(db.products[0].name, 'LED & Bulb'); assert.equal(db.products[0].brand, 'Philips');
    assert.equal(db.products[0].slug, 'led-and-bulb-philips');
    assert.equal(db.products[0].unit, 'box'); assert.equal(db.products[0].category, id(30));
    assert.equal(db.products[0].description, '12W warm white');
    for(const field of ['costPrice','retailPrice','wholesalePrice','stockQuantity','minStockThreshold']) assert.equal(db.products[0][field],before[field]);
    assert.equal((await request('PATCH','/products/'+productId,{description:''})).status,200);
    assert.equal(db.products[0].description,'');
    assert.equal((await request('PATCH','/products/'+productId,{name:'LED & Bulb',brand:'Philips'})).status,200);
});
await test('invalid details and foreign/missing category cannot mutate a product', async () => {
    for(const body of [{name:''},{brand:'  '},{unit:null},{name:12},{description:null},{category:id(31)},{category:id(99)},{category:'invalid'}]) {
        reset(); const before=clone(db);
        const result=await request('PATCH','/products/'+productId,body);
        assert.ok([400,404].includes(result.status)); assert.deepEqual(db,before);
    }
    reset(); db.products[0].shopId=otherShop; const before=clone(db);
    assert.equal((await request('PATCH','/products/'+productId,{name:'Foreign edit'})).status,404);
    assert.deepEqual(db,before);
});
await test('name/brand slug uniqueness excludes the current product and stays shop scoped', async () => {
    reset(); db.products.push({_id:id(32),shopId,name:'Bulb',brand:'Philips',slug:'bulb-philips'});
    const before=clone(db);
    assert.equal((await request('PATCH','/products/'+productId,{name:'Bulb',brand:'Philips'})).status,409);
    assert.deepEqual(db,before);
    db.products[1].shopId=otherShop;
    assert.equal((await request('PATCH','/products/'+productId,{name:'Bulb',brand:'Philips'})).status,200);
    assert.equal(db.products[0].slug,'bulb-philips');
    assert.equal((await request('PATCH','/products/'+productId,{brand:'Osram'})).status,200);
    assert.equal(db.products[0].slug,'bulb-osram');
});
await test('OWNER/CASHIER/ADMIN permissions are enforced through mounted routes',async()=>{
    reset();
    for(const [method,path]of [['POST','/products/create-product'],['PATCH','/products/'+productId],['PATCH','/products/'+productId+'/adjust-stock'],['POST','/categories/create-category'],['POST','/users/register-staff'],['PATCH','/orders/'+orderId+'/cancel'],['GET','/orders/stocklogs'],['GET','/orders/'],['GET','/orders/'+orderId]]) {
        for(const denied of ['CASHIER','ADMIN'])assert.equal((await request(method,path,{},denied)).status,403,path+' '+denied);
    }
    for(const [method,path]of [['GET','/products/search-product'],['GET','/products/low-stock'],['GET','/categories/'],['POST','/customers/create-customer'],['GET','/customers/'],['POST','/orders/create-order'],['POST','/orders/quotation'],['PATCH','/orders/'+orderId],['PATCH','/orders/'+orderId+'/status'],['POST','/ai/query']])assert.equal((await request(method,path,{},'ADMIN')).status,403,path);
    for(const denied of ['OWNER','CASHIER'])for(const [method,path]of [['GET','/admin/shops'],['PATCH','/admin/shops/'+shopId+'/activate'],['PATCH','/admin/shops/'+shopId+'/extend']])assert.equal((await request(method,path,{},denied)).status,403);
});
await test('cashier product and low-stock results never expose cost price',async()=>{
    reset();for(const path of ['/products/search-product','/products/low-stock']) {
        const result=await request('GET',path,undefined,'CASHIER');assert.equal(result.status,200);assert.ok(!JSON.stringify(result.body).includes('costPrice'));
        assert.ok(JSON.stringify((await request('GET',path)).body).includes('costPrice'));
    }
});
await test('manual adjustments commit stock and real non-sale audit records; insufficient stock aborts',async()=>{
    reset();let result=await request('PATCH','/products/'+productId+'/adjust-stock',{quantityDelta:5,reason:'Delivery received'});
    assert.equal(result.status,200);assert.equal(db.products[0].stockQuantity,15);assert.equal(commits,1);assert.equal(db.logs.length,1);assert.equal(db.logs[0].saleType,undefined);assert.equal(db.logs[0].invoiceNo,undefined);
    result=await request('PATCH','/products/'+productId+'/adjust-stock',{quantityDelta:-3,reason:'Damaged'});assert.equal(result.status,200);assert.equal(db.products[0].stockQuantity,12);assert.equal(commits,2);
    result=await request('PATCH','/products/'+productId+'/adjust-stock',{quantityDelta:-20,reason:'Invalid'});assert.equal(result.status,400);assert.equal(db.products[0].stockQuantity,12);assert.equal(db.logs.length,2);assert.equal(aborts,1);
    db.products[0].shopId=otherShop;assert.equal((await request('PATCH','/products/'+productId+'/adjust-stock',{quantityDelta:1,reason:'Wrong shop'})).status,404);
});
await test('fully paid cancellation restores stock with no debt mutation; repeated cancellation is blocked',async()=>{
    reset();assert.equal((await request('PATCH','/orders/'+orderId+'/cancel')).status,200);assert.equal(db.products[0].stockQuantity,12);assert.equal(db.orders[0].status,'CANCELLED');assert.equal(db.customers[0].remainingMoney,0);assert.equal(db.ledgers.length,0);assert.equal(commits,1);
    assert.equal((await request('PATCH','/orders/'+orderId+'/cancel')).status,404);assert.equal(db.products[0].stockQuantity,12);
});
await test('partial credit cancellation reverses only this invoice debt and preserves purchase audit',async()=>{
    for(const legacy of [false,true]) {
        reset({due:60,balance:100,legacy});assert.equal((await request('PATCH','/orders/'+orderId+'/cancel')).status,200);
        assert.equal(db.customers[0].remainingMoney,40);assert.equal(db.customers[1].remainingMoney,99);assert.equal(db.ledgers.length,2);assert.equal(db.ledgers[0].amount,60);assert.equal(db.ledgers[1].amount,-60);assert.equal(db.ledgers[1].description,'CANCELLATION');assert.equal(commits,1);
    }
});
await test('inconsistent balance, missing history, missing product and foreign invoice roll back cancellation',async()=>{
    for(const scenario of ['balance','ledger','product','shop']) {
        reset({due:60});if(scenario==='balance')db.customers[0].remainingMoney=20;if(scenario==='ledger')db.ledgers=[];if(scenario==='product')db.products=[];if(scenario==='shop')db.orders[0].shopId=otherShop;
        const before=clone(db);const result=await request('PATCH','/orders/'+orderId+'/cancel');assert.equal(result.status,scenario==='shop'?404:409);assert.deepEqual(db,before);assert.equal(commits,0);assert.equal(aborts,1);
    }
});
await test('direct sales validate payment, preserve zero discount and commit credit audit',async()=>{
    for(const amount of [-1,'50',null]) {reset();assert.equal((await request('POST','/orders/create-order',{items:[{productId,quantity:2}],saleType:'RETAIL',paidAmount:amount})).status,400);assert.equal(commits,0);}
    for(const amount of [NaN,Infinity,-Infinity]) {
        reset();let error;await createOrder({user:{_id:userId,shopId},body:{items:[{productId,quantity:2}],saleType:'RETAIL',paidAmount:amount}},{},e=>{error=e});assert.equal(error.statusCode,400);assert.equal(commits,0);
    }
    reset();assert.equal((await request('POST','/orders/create-order',{items:[{productId,quantity:2}],saleType:'RETAIL',paidAmount:101})).status,400);assert.equal(db.products[0].stockQuantity,10);assert.equal(aborts,1);
    for(const discountType of ['NONE','FIXED','PERCENTAGE']) {
        reset();const result=await request('POST','/orders/create-order',{items:[{productId,quantity:2}],saleType:'RETAIL',discountType,discountValue:0,paidAmount:40,customerId},'CASHIER');assert.equal(result.status,201);assert.equal(result.body.data.discountType,discountType);assert.equal(result.body.data.amountDue,60);assert.equal(db.customers[0].remainingMoney,60);assert.equal(db.logs.length,1);assert.equal(db.ledgers.length,1);assert.equal(commits,1);
    }
    reset();assert.equal((await request('POST','/orders/create-order',{items:[{productId,quantity:2}],saleType:'RETAIL',paidAmount:100})).status,201);
});
await test('customer name/phone searches and invoice list/detail are shop scoped',async()=>{
    reset();for(const search of ['Ahmad','0300']) {const result=await request('GET','/customers/?search='+search,undefined,'CASHIER');assert.equal(result.status,200);assert.equal(result.body.data.customers.length,1);assert.equal(result.body.data.customers[0]._id,customerId);}
    assert.equal((await request('GET','/customers/?limit=101')).status,400);
    db.orders.push({...clone(db.orders[0]),_id:id(9),shopId:otherShop});
    for(const path of ['/orders/?search=INV-1','/orders/?invoiceNo=INV-1']) {const result=await request('GET',path);assert.equal(result.status,200);assert.equal(result.body.data.orders.length,1);assert.equal(result.body.data.pagination.orderCount,1);}
    assert.equal((await request('GET','/orders/'+orderId)).status,200);assert.equal((await request('GET','/orders/'+id(9))).status,404);assert.equal((await request('GET','/orders/not-an-id')).status,400);
    const literal=listQuery({search:'a.*[b]'}).escapedSearch;assert.ok(new RegExp(literal).test('a.*[b]'));assert.ok(!new RegExp(literal).test('anythingb'));
});
await test('cashier POS quotation and delivery routes remain available; ADMIN shop list/activation remains available',async()=>{
    reset();assert.equal((await request('POST','/orders/quotation',{items:[{productId,quantity:2}],saleType:'RETAIL'},'CASHIER')).status,201);assert.equal(db.products[0].stockQuantity,10);
    reset();assert.equal((await request('PATCH','/orders/'+orderId+'/status',undefined,'CASHIER')).status,200);assert.equal(db.orders[0].status,'DELIVERED');assert.equal((await request('PATCH','/orders/'+orderId+'/cancel')).status,404);
    assert.equal((await request('GET','/admin/shops',undefined,'ADMIN')).status,200);assert.equal((await request('PATCH','/admin/shops/'+shopId+'/activate',undefined,'ADMIN')).status,200);
});
await test('quotation conversion preserves selling prices, stock logs and credit behavior',async()=>{
    for(const paidAmount of [100,40]) {
        reset();const created=await request('POST','/orders/quotation',{items:[{productId,quantity:2}],saleType:'RETAIL'},'CASHIER');assert.equal(created.status,201);
        const quotationId=created.body.data.quotation._id;
        const result=await request('PATCH','/orders/'+quotationId,{paidAmount,...(paidAmount<100?{customerId}:{})},'CASHIER');
        assert.equal(result.status,201);assert.equal(result.body.data.createOrder.amountDue,100-paidAmount);assert.equal(db.products[0].stockQuantity,8);assert.equal(db.orders.find(order=>order._id===quotationId).status,'CONVERTED');assert.equal(commits,1);assert.equal(db.customers[0].remainingMoney,100-paidAmount);assert.equal(db.logs.length,1);
    }
});

await test('owner and cashier sales ignore forged identity and store authenticated snapshots', async () => {
  for (const as of ['OWNER','CASHIER']) {
    reset(); const response = await request('POST','/orders/create-order',{items:[{productId,quantity:1}],saleType:'RETAIL',paidAmount:50,createdBy:id(99),createdByName:'Forged'},as);
    assert.equal(response.status,201);
    assert.equal(response.body.data.createdBy,as === 'OWNER' ? userId : id(16));
    assert.equal(response.body.data.createdByName,as === 'OWNER' ? 'rana usama fiaz' : 'ali');
    assert.equal(db.orders.at(-1).createdByName,response.body.data.createdByName);
  }
});
await test('quotation retains original creator while converted invoice records authenticated converter', async () => {
  reset(); const quote = (await request('POST','/orders/quotation',{items:[{productId,quantity:1}],saleType:'RETAIL',createdBy:id(99),createdByName:'Forged'},'OWNER')).body.data.quotation;
  assert.equal(quote.createdBy,userId); assert.equal(quote.createdByName,'rana usama fiaz');
  const response = await request('PATCH','/orders/'+quote._id,{paidAmount:50,createdBy:userId,createdByName:'Forged'},'CASHIER');
  assert.equal(response.status,201); assert.equal(response.body.data.createOrder.createdBy,id(16)); assert.equal(response.body.data.createOrder.createdByName,'ali');
  assert.equal(db.orders.find(order=>order._id===quote._id).createdByName,'rana usama fiaz');
  assert.equal(db.orders.find(order=>order._id===quote._id).createdBy,userId);
});
await test('cancellation and delivery preserve original attribution', async () => {
  for (const action of ['cancel','status']) {
    reset(); Object.assign(db.orders[0],{createdBy:id(16),createdByName:'ali'});
    assert.equal((await request('PATCH','/orders/'+orderId+'/'+action)).status,200);
    assert.equal(db.orders[0].createdBy,id(16)); assert.equal(db.orders[0].createdByName,'ali');
  }
});
await test('stored snapshot wins after username changes for list and detail', async () => {
  reset(); Object.assign(db.orders[0],{createdBy:id(16),createdByName:'ali'});
  creators=[{_id:id(16),shopId,username:'ali khan'}]; authenticatedName='different viewer';
  try {
    assert.equal((await request('GET','/orders/'+orderId)).body.data.order.createdByName,'ali');
    assert.equal((await request('GET','/orders/')).body.data.orders[0].createdByName,'ali');
  } finally {authenticatedName=undefined;}
});
await test('legacy names resolve only within own shop without rewriting stored orders', async () => {
  for (const scenario of ['valid','deleted','foreign','missing']) {
    reset(); if(scenario!=='missing')db.orders[0].createdBy=id(16);
    creators=scenario==='deleted'?[]:[{_id:id(16),shopId:scenario==='foreign'?otherShop:shopId,username:'ali'}];
    const before=clone(db.orders);
    const detail=await request('GET','/orders/'+orderId),list=await request('GET','/orders/');
    assert.equal(detail.status,200); assert.equal(list.status,200);
    assert.equal(detail.body.data.order.createdByName,scenario==='valid'?'ali':undefined);
    assert.equal(list.body.data.orders[0].createdByName,scenario==='valid'?'ali':undefined);
    assert.deepEqual(db.orders,before);
  }
});
await test('token lifetimes are 15 minutes and 7 days',()=>{
    const user=new User({_id:userId,username:'test',email:'test@example.com',role:'OWNER'});
    const access=jwt.decode(user.generateAccessToken()),refresh=jwt.decode(user.generateRefreshToken());assert.equal(access.exp-access.iat,900);assert.equal(refresh.exp-refresh.iat,604800);
});
} finally {await new Promise(resolve=>server.close(resolve));}
