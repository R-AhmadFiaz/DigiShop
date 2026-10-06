import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Mounted Express routes, actual password/JWT handling; isolated model persistence.
// No connection to or changes in a real shop database.
process.env.ACCESS_TOKEN_SECRET = 'shop-access-test';
process.env.REFRESH_TOKEN_SECRET = 'shop-refresh-test';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.OPENAI_API_KEY = 'test-only';
const {app} = await import('../dist/app.js');
const {Shop} = await import('../dist/models/shop.model.js');
const {User} = await import('../dist/models/user.model.js');
const {Product} = await import('../dist/models/product.model.js');
const {checkSubscription} = await import('../dist/middleware/subscription.middleware.js');
const id = n => n.toString(16).padStart(24, '0');
const shopId = id(1), otherId = id(2), expiry = new Date(Date.now() + 86400000 * 30);
const shops = new Map([
  [shopId, {_id: shopId, name: 'First', address: 'First Market', contactNo: '03001111111', subscriptionActive: true, subscriptionExpiry: expiry}],
  [otherId, {_id: otherId, name: 'Second', address: 'Second Market', contactNo: '03002222222', isActive: true, subscriptionActive: true, subscriptionExpiry: expiry}],
]);
const hash = await bcrypt.hash('test-password', 4);
const users = new Map();
for (const [n, role, scope] of [[3,'OWNER',shopId],[4,'CASHIER',shopId],[5,'ADMIN',null],[6,'OWNER',otherId]]) {
  const user = new User({_id:id(n),username:role.toLowerCase()+n,email:`user${n}@example.test`,password:hash,role,...(scope?{shopId:scope}:{})});
  user.save = async () => user;
  users.set(id(n), user);
}
const query = value => ({populate(){return this;}, select(fields){
  if (value instanceof User) {
    const safe = value.toObject();
    for (const field of fields.split(' ')) if (field.startsWith('-')) delete safe[field.slice(1)];
    safe.generateAccessToken = value.generateAccessToken.bind(value);
    safe.generateRefreshToken = value.generateRefreshToken.bind(value);
    safe.save = async () => { value.refreshToken = safe.refreshToken; };
    return Promise.resolve(safe);
  }
  return this;
}, then(resolve,reject){return Promise.resolve(value).then(resolve,reject);}});
Shop.find = () => query([...shops.values()].map(s => ({...s})));
Shop.findById = async key => {
  const saved = shops.get(String(key));
  if (!saved) return null;
  return {...saved, save: async function(){ const {save,...fields}=this; shops.set(String(key),fields); }};
};
Shop.findByIdAndUpdate = async (key, update) => {
  const shop = shops.get(String(key));
  if (!shop) return null;
  Object.assign(shop, update.$set || update);
  return {...shop};
};
User.findOne = async filter => [...users.values()].find(u => filter.$or.some(f => f.username === u.username || f.email === u.email)) || null;
User.findById = key => query(users.get(String(key)) || null);
User.findByIdAndUpdate = async key => { const user = users.get(String(key)); user.refreshToken = undefined; return user; };
let productReads = 0;
Product.find = () => { productReads++; return query([]); };
const server = app.listen(0,'127.0.0.1');
await new Promise(resolve => server.once('listening',resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v2`;
async function request(method,path,userId=id(5),body, cookie) {
  const headers = cookie ? {Cookie:cookie} : {Authorization:'Bearer '+jwt.sign({_id:userId},process.env.ACCESS_TOKEN_SECRET)};
  if (body !== undefined) headers['Content-Type']='application/json';
  const response = await fetch(base+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {status:response.status, body:await response.json(), cookies:response.headers.getSetCookie()};
}
const businessRoutes = [
  ['GET','/products/search-product'], ['GET','/products/low-stock'], ['POST','/products/create-product'],
  ['PATCH','/products/'+id(10)], ['PATCH','/products/'+id(10)+'/adjust-stock'],
  ['GET','/categories/'], ['POST','/categories/create-category'],
  ['GET','/customers/'], ['POST','/customers/create-customer'],
  ['GET','/orders/'], ['GET','/orders/stocklogs'], ['GET','/orders/'+id(10)],
  ['POST','/orders/create-order'], ['POST','/orders/quotation'], ['PATCH','/orders/'+id(10)],
  ['PATCH','/orders/'+id(10)+'/cancel'], ['PATCH','/orders/'+id(10)+'/status'],
  ['POST','/ai/query'], ['POST','/users/register-staff'],
];
try {
await test('new and legacy shops default to active without migration', async () => {
  assert.equal(new Shop().isActive,true);
  assert.equal(Shop.hydrate({_id:shopId}).isActive,true);
  assert.equal((await request('GET','/products/search-product',id(3))).status,200);
});
await test('OWNER/CASHIER receipt identity comes only from their own shop; supplied shop IDs are ignored and ADMIN shape stays unchanged', async () => {
  const before=structuredClone([...shops]);
  for(const [userId,expectedName] of [[id(3),'First'],[id(4),'First'],[id(6),'Second']]) {
    const user=users.get(userId);
    const login=await request('POST','/users/login',userId,{username:user.username,password:'test-password',shopId:otherId});
    assert.equal(login.status,200);assert.equal(login.body.data.shopName,expectedName);
    const cookie=login.cookies.map(c=>c.split(';')[0]).join('; ');
    const current=await request('POST',`/users/current-user?shopId=${otherId}`,userId,{shopId:otherId},cookie);
    assert.equal(current.status,200);assert.equal(current.body.data.shopName,expectedName);
    const ownShop = shops.get(String(user.shopId));
    for (const session of [login.body.data, current.body.data]) {
      assert.equal(session.shopAddress, ownShop.address);
      assert.equal(session.shopContactNo, ownShop.contactNo);
    }
    assert.deepEqual(Object.keys(current.body.data).sort(),userId===id(4)?['shopActive','shopAddress','shopContactNo','shopName','user']:['shopActive','shopAddress','shopContactNo','shopName','subscriptionExpiry','user']);
  }
  const admin=await request('POST','/users/current-user',id(5),{shopId});
  assert.deepEqual(Object.keys(admin.body.data).sort(),['shopActive','user']);
  assert.deepEqual([...shops],before);
});
await test('ADMIN manual deactivation is idempotent, isolated, preserves subscription and business data', async () => {
  const beforeOther = structuredClone(shops.get(otherId));
  const beforeUser = [...users.values()].map(u=>u.toObject());
  for(let n=0;n<2;n++) {
    const result = await request('PATCH',`/admin/shops/${shopId}/deactivate`);
    assert.equal(result.status,200); assert.equal(result.body.data.shop.isActive,false);
    assert.equal(shops.get(shopId).subscriptionExpiry.getTime(),expiry.getTime());
    assert.equal(shops.get(shopId).subscriptionActive,true);
  }
  assert.deepEqual(shops.get(otherId),beforeOther);
  assert.deepEqual([...users.values()].map(u=>u.toObject()),beforeUser);
  for (const roleId of [id(3),id(4)]) for (const action of ['deactivate','reactivate'])
    assert.equal((await request('PATCH',`/admin/shops/${shopId}/${action}`,roleId)).status,403);
  assert.equal((await request('PATCH','/admin/shops/invalid/deactivate')).status,400);
  assert.equal((await request('PATCH',`/admin/shops/${id(99)}/reactivate`)).status,404);
});
await test('deactivated OWNER and CASHIER authenticate, restore session and logout; every shop route blocks before controllers', async () => {
  const readsBefore=productReads;
  for(const userId of [id(3),id(4)]) {
    const user=users.get(userId);
    const login=await request('POST','/users/login',userId,{username:user.username,password:'test-password'});
    assert.equal(login.status,200); assert.equal(login.body.data.shopActive,false);
    assert.ok(!('password' in login.body.data.user));
    const cookie=login.cookies.map(c=>c.split(';')[0]).join('; ');
    const current=await request('POST','/users/current-user',userId,undefined,cookie);
    assert.equal(current.status,200); assert.equal(current.body.data.shopActive,false);
    assert.equal((await request('POST','/users/refresh-token',userId,undefined,cookie)).status,200);
    for(const [method,path] of businessRoutes) {
      const result=await request(method,path,userId,method==='GET'?undefined:{},cookie);
      assert.equal(result.status,403,path);
      assert.equal(result.body.message,'Shop has been deactivated. Contact administrator.',path);
    }
    assert.equal((await request('POST','/users/logout',userId,undefined,cookie)).status,200);
  }
  assert.equal(productReads,readsBefore);
  assert.equal((await request('GET','/products/search-product',id(6))).status,200);
});
await test('ADMIN still lists and extends deactivated shops without restoring manual access', async () => {
  const list=await request('GET','/admin/shops');
  assert.equal(list.status,200); assert.equal(list.body.data.shops.find(s=>s._id===shopId).isActive,false);
  assert.equal((await request('PATCH',`/admin/shops/${shopId}/extend`)).status,200);
  assert.equal(shops.get(shopId).isActive,false);
  assert.equal(shops.get(shopId).subscriptionExpiry.getTime(),expiry.getTime()+30*86400000);
  assert.equal((await request('PATCH',`/admin/shops/${shopId}/activate`)).status,200);
  assert.equal(shops.get(shopId).isActive,false);
});
await test('reactivation is idempotent and does not reset expiry; both shop roles regain access', async () => {
  const before=shops.get(shopId).subscriptionExpiry.getTime();
  for(let n=0;n<2;n++) {
    assert.equal((await request('PATCH',`/admin/shops/${shopId}/reactivate`)).status,200);
    assert.equal(shops.get(shopId).subscriptionExpiry.getTime(),before);
  }
  for(const userId of [id(3),id(4)]) {
    assert.equal((await request('GET','/products/search-product',userId)).status,200);
    assert.equal((await request('POST','/users/current-user',userId)).body.data.shopActive,true);
  }
});
await test('subscription expiry remains independent of manual access and manual block takes priority', async () => {
  shops.get(shopId).subscriptionExpiry=new Date(0);
  for(const userId of [id(3),id(4)]) {
    const result=await request('GET','/categories/',userId);
    assert.equal(result.status,403); assert.equal(result.body.message,'Subscription expired or inactive');
  }
  await request('PATCH',`/admin/shops/${shopId}/deactivate`);
  assert.equal((await request('GET','/categories/',id(3))).body.message,'Shop has been deactivated. Contact administrator.');
  await request('PATCH',`/admin/shops/${shopId}/reactivate`);
  assert.equal(shops.get(shopId).subscriptionExpiry.getTime(),0);
});
await test('owner session exposes only its unchanged expiry; warning window never changes subscription enforcement or manual state', async () => {
  const now = Date.now();
  shops.get(shopId).isActive = true;
  for (const days of [4,3,2,1,0.25,0,-1]) {
    const expiry = new Date(now + days * 86400000);
    shops.get(shopId).subscriptionExpiry = expiry;
    const before = structuredClone(shops.get(shopId));
    for (const userId of [id(3),id(4),id(5)]) {
      const result = await request('POST','/users/current-user',userId);
      assert.equal(result.status,200);
      if (userId === id(3)) assert.equal(result.body.data.subscriptionExpiry,expiry.toISOString());
      else assert.ok(!('subscriptionExpiry' in result.body.data));
    }
    let passed = false;
    const check = () => checkSubscription({user:users.get(id(3))},{},()=>{passed=true;});
    if (days <= 0) await assert.rejects(check(),error=>error.statusCode===403 && error.message==='Subscription expired or inactive');
    else { await check(); assert.equal(passed,true); }
    assert.deepEqual(shops.get(shopId),before);
  }
  const login = await request('POST','/users/login',id(3),{username:users.get(id(3)).username,password:'test-password'});
  assert.equal(login.status,200);
  assert.equal(login.body.data.subscriptionExpiry,shops.get(shopId).subscriptionExpiry.toISOString());
  shops.get(shopId).subscriptionExpiry=null;
  assert.equal((await request('POST','/users/current-user',id(3))).body.data.subscriptionExpiry,null);
});
} finally { await new Promise(resolve=>server.close(resolve)); }
