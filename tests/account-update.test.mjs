import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
process.env.ACCESS_TOKEN_SECRET = 'account-test';
process.env.REFRESH_TOKEN_SECRET = 'account-refresh-test';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.OPENAI_API_KEY = 'test-only';
const { app } = await import('../dist/app.js');
const { User } = await import('../dist/models/user.model.js');
const { Shop } = await import('../dist/models/shop.model.js');
const id = n => n.toString(16).padStart(24, '0');
const shopId = id(1), otherId = id(2);
const password = await bcrypt.hash('test-password', 4);
let users, shops, userConflict, shopConflict;
function reset() {
  userConflict = shopConflict = false;
  users = [
    new User({_id:id(3),username:'owner',email:'owner@example.test',password,refreshToken:'stored-refresh',role:'OWNER',shopId}),
    new User({_id:id(4),username:'cashier',email:'cashier@example.test',password,role:'CASHIER',shopId}),
    new User({_id:id(5),username:'admin',email:'admin@example.test',password,role:'ADMIN'}),
    new User({_id:id(6),username:'other',email:'other@example.test',password,role:'OWNER',shopId:otherId}),
  ];
  shops = [new Shop({_id:shopId,ownerId:id(3),name:'First',address:'Market',contactNo:'03001111111',subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000),invoiceCounter:10}),
    new Shop({_id:otherId,ownerId:id(6),name:'Second',address:'Road',contactNo:'03002222222'})];
}
function matches(row, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(f => matches(row, f));
    if (value && typeof value === 'object' && '$ne' in value) return String(row[key]) !== String(value.$ne);
    return String(row[key]) === String(value);
  });
}
const query = value => ({
  select(fields) {
    const safe = value?.toObject();
    if (safe) for (const field of fields.split(' ')) if (field.startsWith('-')) delete safe[field.slice(1)];
    return Promise.resolve(safe || null);
  },
  then(resolve,reject) { return Promise.resolve(value).then(resolve,reject); },
});
User.findById = key => query(users.find(u=>String(u._id)===String(key)) || null);
User.findOne = filter => query(users.find(u=>matches(u,filter)) || null);
User.findByIdAndUpdate = (key, update, options) => {
  assert.equal(options.runValidators,true);
  if (userConflict) { const error=new Error('Duplicate'); error.code=11000; throw error; }
  const user=users.find(u=>String(u._id)===String(key));
  if (user) Object.assign(user, update.$set);
  return query(user || null);
};
Shop.findById = async key => shops.find(s=>String(s._id)===String(key)) || null;
Shop.findOne = async filter => {
  const shop=shops.find(s=>matches(s,filter));
  if (!shop) return null;
  const doc=Shop.hydrate(shop.toObject());
  doc.save=async()=> {
    if(shopConflict) {const error=new Error('Duplicate');error.code=11000;throw error;}
    await doc.validate(); Object.assign(shop, {name:doc.name,address:doc.address,contactNo:doc.contactNo});
    return doc;
  };
  return doc;
};
const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
async function request(path,body,userId=id(3)) {
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v2/users${path}`,{
    method:'PATCH',headers:{'Content-Type':'application/json',...(userId?{Authorization:'Bearer '+jwt.sign({_id:userId,username:'old-name'},process.env.ACCESS_TOKEN_SECRET)}:{})},body:JSON.stringify(body),
  });
  return {status:r.status,body:await r.json()};
}
try {
  await test('all roles update only themselves; normalize values and preserve credentials, role, shop and session',async()=>{
    for(const n of [3,4,5]) {
      reset();const before=users.map(u=>u.toObject());
      const r=await request('/profile',{username:' Updated '+n+' ',email:` UPDATED${n}@EXAMPLE.TEST `,_id:id(6),role:'ADMIN',shopId:otherId,password:'forged',refreshToken:'forged'},id(n));
      assert.equal(r.status,200); assert.equal(r.body.data.user.username,'updated '+n); assert.equal(r.body.data.user.email,`updated${n}@example.test`);
      assert.equal(r.body.data.user.password,undefined); assert.equal(r.body.data.user.refreshToken,undefined);
      for(const [index,u] of users.entries()) {
        if(String(u._id)!==id(n)) assert.deepEqual(u.toObject(),before[index]);
        else for(const field of ['password','refreshToken','role','shopId']) assert.equal(String(u[field]),String(before[index][field]));
      }
      if(n!==5) assert.equal(r.body.data.shopName,'First');
    }
  });
  await test('blank/invalid profile values and duplicate username/email are rejected without writes',async()=>{
    for(const change of [{username:' '},{username:4},{email:'bad'},{email:''},{username:'OTHER'},{email:'OTHER@EXAMPLE.TEST'}]) {
      reset();const before=users.map(u=>u.toObject());
      const r=await request('/profile',{username:'owner',email:'owner@example.test',...change});
      assert.ok([400,409].includes(r.status));assert.deepEqual(users.map(u=>u.toObject()),before);
    }
    reset();assert.equal((await request('/profile',{username:'owner',email:'owner@example.test'})).status,200);
    userConflict=true;assert.equal((await request('/profile',{username:'unique',email:'unique@example.test'})).status,409);
  });
  await test('profile editing remains available with expired or manually deactivated shop and valid existing JWT',async()=>{
    for(const manual of [false,true]) {
      reset();shops[0].subscriptionExpiry=new Date(0);shops[0].isActive=!manual;
      assert.equal((await request('/profile',{username:'updated',email:'updated@example.test'})).status,200);
    }
    reset();assert.equal((await request('/profile',{username:'x',email:'x@example.test'},null)).status,400);
  });
  await test('OWNER updates only owned shop identity and returned session; subscription/counter and other shops unchanged',async()=>{
    reset();const before=shops.map(s=>s.toObject());
    const r=await request('/shop-details',{shopName:' New Store ',address:' New Market ',contactNo:'03003333333',shopId:otherId,isActive:false,subscriptionActive:false});
    assert.equal(r.status,200);assert.equal(r.body.data.shopName,'New Store');assert.equal(r.body.data.shopAddress,'New Market');assert.equal(r.body.data.shopContactNo,'03003333333');
    assert.equal(r.body.data.user.password,undefined);assert.equal(r.body.data.user.refreshToken,undefined);
    assert.deepEqual(shops[1].toObject(),before[1]);
    for(const field of ['isActive','subscriptionActive','invoiceCounter','ownerId']) assert.equal(String(shops[0][field]),String(before[0][field]));
    assert.equal(shops[0].subscriptionExpiry.getTime(),before[0].subscriptionExpiry.getTime());
  });
  await test('shop updates enforce OWNER, membership, subscription and manual access gates',async()=>{
    const body={shopName:'New',address:'Road',contactNo:'03003333333'};
    for(const n of [4,5]) {reset();assert.equal((await request('/shop-details',body,id(n))).status,403);}
    reset();shops[0].ownerId=id(6);assert.equal((await request('/shop-details',body)).status,404);
    reset();shops[0].subscriptionExpiry=new Date(0);assert.equal((await request('/shop-details',body)).status,403);
    reset();shops[0].isActive=false;const r=await request('/shop-details',body);assert.equal(r.status,403);assert.match(r.body.message,/deactivated/);
  });
  await test('shop identity validation, contact uniqueness and index conflicts return controlled errors',async()=>{
    for(const change of [{shopName:' '},{address:''},{contactNo:'123'},{contactNo:3001111111},{contactNo:'0300abc1234'},{contactNo:'03002222222'}]) {
      reset();const before=shops.map(s=>s.toObject());
      const r=await request('/shop-details',{shopName:'First',address:'Market',contactNo:'03001111111',...change});
      assert.ok([400,409].includes(r.status));assert.deepEqual(shops.map(s=>s.toObject()),before);
    }
    reset();assert.equal((await request('/shop-details',{shopName:'Second',address:'Road',contactNo:'03001111111'})).status,200);
    shopConflict=true;assert.equal((await request('/shop-details',{shopName:'New',address:'Road',contactNo:'03003333333'})).status,409);
  });
} finally {await new Promise(resolve=>server.close(resolve));}
