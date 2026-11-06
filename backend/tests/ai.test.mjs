import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import jwt from 'jsonwebtoken';
process.env.OPENAI_API_KEY='test-only'; process.env.ACCESS_TOKEN_SECRET='ai-test';
const {app}=await import('../dist/app.js');
const {aiClient}=await import('../dist/controllers/ai.controller.js');
const {processQuestion,periodBounds,literalRegex}=await import('../dist/utils/aiQuestions.js');
const {aiUserLimiter,aiIpLimiter}=await import('../dist/middleware/aiRateLimiter.middleware.js');
const {User}=await import('../dist/models/user.model.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {Product}=await import('../dist/models/product.model.js');
const {Customer}=await import('../dist/models/customer.model.js');
const {Order}=await import('../dist/models/order.model.js');
const {StockLog}=await import('../dist/models/stockLog.model.js');
const {CustomerLedger}=await import('../dist/models/customerLedger.model.js');
const id=n=>n.toString(16).padStart(24,'0'); const shopId=id(10), foreign=id(11);
const user=role=>({_id:id(role==='OWNER'?1:role==='CASHIER'?2:3),role,shopId,username:role.toLowerCase()});
let subscriptionActive=true, isActive=true, intent, providerFailure, malformed, transcribed='How many bulbs?', aiCalls=0, reads=[], writes=0;
const products=Array.from({length:25},(_,i)=>({_id:id(100+i),shopId,name:'Bulb '+i,brand:'Philips',unit:'pcs',stockQuantity:2,minStockThreshold:3,retailPrice:50,wholesalePrice:40,costPrice:20}));
products.push({_id:id(999),shopId:foreign,name:'Bulb foreign',brand:'Philips',unit:'pcs',stockQuantity:999,costPrice:999});
products.push({_id:id(998),shopId,name:'a.*[b]',brand:'Literal',unit:'pcs',stockQuantity:7});
const customers=Array.from({length:12},(_,i)=>({_id:id(200+i),shopId,name:'Ahmed '+i,phoneNo:'0300'+i,remainingMoney:10}));
customers.push({_id:id(997),shopId:foreign,name:'Ahmed foreign',remainingMoney:999});
function matches(doc,filter){return Object.entries(filter).every(([key,value])=>{
 if(key==='$or')return value.some(part=>matches(doc,part));
 if(key==='$expr')return doc.stockQuantity<=doc.minStockThreshold;
 if(value?.$regex!==undefined)return new RegExp(value.$regex,value.$options).test(doc[key]??'');
 return String(doc[key])===String(value);
});}
function query(rows){let result=structuredClone(rows);let fields;
 const q={select(value){fields=value.split(' ');return q;},sort(){return q;},limit(value){result=result.slice(0,value);return q;},maxTimeMS(value){assert.equal(value,5000);return q;},lean(){return q;},then(resolve,reject){let projected=result;
 if(fields && !fields[0].startsWith("-")) {const project=doc=>doc&&Object.fromEntries(Object.entries(doc).filter(([key])=>key==='_id'||fields.includes(key)));projected=Array.isArray(result)?result.map(project):project(result);}
 return Promise.resolve(projected).then(resolve,reject);}};return q;
}
User.findById=key=>query(user(String(key)===id(1)?'OWNER':String(key)===id(2)?'CASHIER':'ADMIN'));
Shop.findById=async()=>({isActive,subscriptionActive,subscriptionExpiry:new Date(Date.now()+86400000)});
Product.find=filter=>{reads.push({model:'Product',filter});return query(products.filter(p=>matches(p,filter)));};
Customer.find=filter=>{reads.push({model:'Customer',filter});return query(customers.filter(p=>matches(p,filter)));};
Order.findOne=filter=>{reads.push({model:'Order',filter});return query(filter.invoiceNo==='INV-102'?{invoiceNo:'INV-102',status:'DELIVERED',shopId}:null);};
Order.aggregate=pipeline=>{reads.push({model:'Order',pipeline});return {option({maxTimeMS}){assert.equal(maxTimeMS,5000);assert.equal(String(pipeline[0].$match.shopId),shopId);assert.deepEqual(pipeline[0].$match.status.$in,['PENDING','DELIVERED','CANCELLED']);assert.equal(pipeline[0].$match.type,'INVOICE');
 return Promise.resolve(pipeline.some(stage=>stage.$unwind)?[{name:'Bulb',unit:'pcs',quantity:2,revenue:100}]:[{originalSales:100,adjustments:-10,invoices:1,adjustmentCount:1}]);}};};
for(const Model of [Product,Customer,Order,StockLog,CustomerLedger,Shop,User])for(const method of ['create','updateOne','deleteOne','findOneAndUpdate'])Model[method]=async()=>{writes++;throw new Error('AI attempted a write');};
aiClient.chat.completions.create=async()=>{aiCalls++;if(providerFailure)throw new Error('SECRET provider details');if(malformed==='missing')return {choices:[]};return {choices:[{message:{content:malformed??JSON.stringify(intent)}}]};};
aiClient.audio.transcriptions.create=async({file})=>{aiCalls++;for await(const chunk of file){assert.ok(chunk.length);}if(providerFailure==='transcription')throw new Error('SECRET transcription');return {text:transcribed};};
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port+'/api/v2';
async function request(body,role='OWNER'){const response=await fetch(base+'/ai/query',{method:'POST',headers:{Authorization:'Bearer '+jwt.sign({_id:user(role)._id},process.env.ACCESS_TOKEN_SECRET),...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body)});return {status:response.status,body:await response.json()};}
function reset(action='checkStock'){intent={action,product:'Bulb',customer:'Ahmed',invoiceNo:'INV-102',period:'today'};providerFailure=false;malformed=null;subscriptionActive=true;isActive=true;reads=[];writes=0;aiCalls=0;aiUserLimiter.resetKey(id(1));aiUserLimiter.resetKey(id(2));aiIpLimiter.resetKey('127.0.0.1');}
const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WAVEfmt '),Buffer.alloc(32)]);
function audio(content=wav,type='audio/wav',name='question.wav'){const body=new FormData();body.append('audio',new Blob([content],{type}),name);return body;}
const directory=path.resolve('public/temp');await fs.mkdir(directory,{recursive:true});
try {
await test('voice/text stock questions share processing and keep product costs private',async()=>{
 reset();const before=await fs.readdir(directory);const voice=await request(audio());const text=await request({text:transcribed});assert.equal(voice.status,200);assert.equal(text.status,200);assert.equal(voice.body.data.answer,text.body.data.answer);assert.equal(voice.body.data.question,transcribed);assert.ok(!JSON.stringify(text.body.data).includes('costPrice'));assert.equal(text.body.data.data.length,20);assert.deepEqual(await fs.readdir(directory),before);
});
for(const role of ['OWNER','CASHIER'])for(const action of ['retailPrice','wholesalePrice','customerBalance'])await test(`${role} may ask ${action}`,async()=>{reset(action);const result=await request({text:'Question'},role);assert.equal(result.status,200);assert.match(result.body.data.answer,/PKR/);assert.ok(!JSON.stringify(result.body.data).includes('costPrice'));if(action==='customerBalance')assert.equal(result.body.data.data.length,10);});
for(const action of ['lowStock','sales','compareSales','unitsSold','topProducts','productRevenue','costPrice','invoiceStatus'])await test(`OWNER ${action} works, CASHIER denied before querying`,async()=>{
 reset(action);const result=await request({text:'Question'});assert.equal(result.status,200);if(action==='sales')assert.match(result.body.data.answer,/PKR 90.*not cash collected/);if(action==='productRevenue')assert.match(result.body.data.answer,/before order discounts/);if(action==='invoiceStatus')assert.match(result.body.data.answer,/delivered/);if(action==='costPrice')assert.equal(result.body.data.data[0].costPrice,20);
 reads=[];assert.equal((await request({text:'Question'},'CASHIER')).status,403);assert.equal(reads.length,0);
});
await test('profit is never fabricated and is denied to cashier',async()=>{reset('profit');const result=await request({text:'Profit?'});assert.match(result.body.data.answer,/not currently available/);assert.equal(reads.length,0);assert.equal((await request({text:'Profit?'},'CASHIER')).status,403);});
await test('mutations and incomplete purchase history have limitation answers, zero writes',async()=>{for(const action of ['readOnly','purchaseHistory']){reset(action);const result=await request({text:'Add stock or who bought it?'});assert.equal(result.status,200);assert.equal(writes,0);assert.equal(reads.length,0);}reset('createSale');assert.equal((await request({text:'Create sale'})).status,400);assert.equal(writes,0);});
await test('ADMIN, inactive subscription and manual deactivation stop before AI',async()=>{reset();assert.equal((await request({text:'Stock?'},'ADMIN')).status,403);assert.equal(aiCalls,0);for(const role of ['OWNER','CASHIER']){reset();subscriptionActive=false;assert.equal((await request({text:'Stock?'},role)).status,403);assert.equal(aiCalls,0);reset();isActive=false;subscriptionActive=false;const result=await request({text:'Stock?'},role);assert.equal(result.status,403);assert.match(result.body.message,/deactivated/);assert.equal(aiCalls,0);}});
await test('AI/body shop IDs, field projections and queries cannot change scope',async()=>{for(const action of ['checkStock','customerBalance','sales','invoiceStatus']){reset(action);intent.shopId=foreign;intent.projection={costPrice:1};intent.query={};const result=await request({text:'Question',shopId:foreign});assert.equal(result.status,200);assert.ok(!JSON.stringify(result.body).includes('foreign'));for(const read of reads)assert.equal(String(read.filter?.shopId??read.pipeline[0].$match.shopId),shopId);}});
await test('regex metacharacters are literal, parameter types and size bounded',async()=>{reset();intent.product='a.*[b]';const result=await request({text:'Question'});assert.equal(result.status,200);assert.equal(result.body.data.data.length,1);assert.equal(result.body.data.data[0].name,'a.*[b]');assert.equal(literalRegex('a.*[b]'),'a\\.\\*\\[b\\]');for(const value of [{},'x'.repeat(101)]){intent.product=value;assert.equal((await request({text:'Question'})).status,400);}});
await test('exactly one bounded question input required',async()=>{reset();for(const body of [{},{text:''},{text:{}},{text:'x'.repeat(1001)}])assert.equal((await request(body)).status,400);const form=audio();form.append('text','Question');const before=await fs.readdir(directory);assert.equal((await request(form)).status,400);assert.deepEqual(await fs.readdir(directory),before);});
await test('invalid model JSON, choices, types, action and period are controlled',async()=>{for(const value of ['{bad','missing','[]','null']){reset();malformed=value;const result=await request({text:'Question'});assert.equal(result.status,502);assert.ok(!JSON.stringify(result.body).includes('SECRET'));}reset('unknown');assert.equal((await request({text:'Question'})).status,400);reset('sales');intent.period='all';assert.equal((await request({text:'Question'})).status,400);});
await test('audio cleanup on transcription, provider, intent and database failure',async()=>{for(const stage of ['transcription','provider','intent','database']){reset();const before=await fs.readdir(directory);if(stage==='transcription')providerFailure='transcription';if(stage==='provider')providerFailure=true;if(stage==='intent')malformed='{bad';const find=Product.find;if(stage==='database')Product.find=()=>{throw new Error('SECRET database');};try{const result=await request(audio());assert.equal(result.status,502);assert.ok(!JSON.stringify(result.body).includes('SECRET'));assert.deepEqual(await fs.readdir(directory),before);}finally{Product.find=find;}}});
await test('invalid MIME, audio signature and oversize upload rejected and cleaned',async()=>{reset();const before=await fs.readdir(directory);for(const form of [audio(Buffer.from('bad audio')),audio(wav,'image/png','picture.png'),audio(Buffer.alloc(10*1024*1024+1))])assert.equal((await request(form)).status,400);assert.equal(aiCalls,0);assert.deepEqual(await fs.readdir(directory),before);});
await test('AI user rate limit stops provider calls and leaves unrelated APIs available',async()=>{reset('readOnly');for(let n=0;n<30;n++)assert.equal((await request({text:'Question'})).status,200);const calls=aiCalls;assert.equal((await request({text:'Question'})).status,429);assert.equal(aiCalls,calls);assert.equal((await request({text:'Question'},'CASHIER')).status,200);const response=await fetch(base+'/users/current-user',{method:'POST',headers:{Authorization:'Bearer '+jwt.sign({_id:id(1)},process.env.ACCESS_TOKEN_SECRET)}});assert.equal(response.status,200);});
await test('UTC date windows cover midnight, leap month and year boundaries',()=>{const now=new Date('2028-03-01T00:00:00Z');assert.equal(periodBounds('today',now).start.toISOString(),'2028-03-01T00:00:00.000Z');assert.equal(periodBounds('lastMonth',now).start.toISOString(),'2028-02-01T00:00:00.000Z');assert.equal(periodBounds('lastMonth',now).end.toISOString(),'2028-03-01T00:00:00.000Z');assert.equal(periodBounds('lastMonth',new Date('2027-01-01Z')).start.toISOString(),'2026-12-01T00:00:00.000Z');});
await test('summary pipelines use original prices plus dated movement prices, scoped names and bounded results',async()=>{for(const action of ['unitsSold','topProducts','productRevenue']){reset(action);await processQuestion('Question',user('OWNER'),async()=>intent);const pipeline=reads.find(read=>read.pipeline).pipeline;assert.deepEqual(pipeline.find(stage=>stage.$group).$group.revenue,{$sum:'$revenue'});assert.deepEqual(pipeline.find(stage=>stage.$project?.revenue).$project.revenue,{$multiply:['$items.quantity','$items.unitPrice']});assert.ok(JSON.stringify(pipeline).includes('$movements.unitPriceMinor'));assert.ok(JSON.stringify(pipeline).includes('occurredAt'));assert.equal(pipeline.at(-1).$limit,action==='unitsSold'?20:10);assert.ok(JSON.stringify(pipeline.find(stage=>stage.$lookup)).includes(shopId));assert.ok(!JSON.stringify(pipeline).includes('costPrice'));}});
} finally {await new Promise(resolve=>server.close(resolve));}
