import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

// Isolated model persistence; no connection to or mutation of a real database.
process.env.ACCESS_TOKEN_SECRET='cashier-test';
process.env.REFRESH_TOKEN_SECRET='cashier-refresh-test';
process.env.ACCESS_TOKEN_EXPIRY='15m';
process.env.REFRESH_TOKEN_EXPIRY='7d';
process.env.OPENAI_API_KEY='test-only';
const {app}=await import('../dist/app.js');
const {User}=await import('../dist/models/user.model.js');
const {Shop}=await import('../dist/models/shop.model.js');
const {Order}=await import('../dist/models/order.model.js');
const id=n=>n.toString(16).padStart(24,'0');
const shopId=id(1),otherShop=id(2),ownerId=id(3),cashierId=id(4),adminId=id(5),foreignId=id(6);
const hash=await bcrypt.hash('old-password',4);
const refresh=jwt.sign({_id:cashierId},process.env.REFRESH_TOKEN_SECRET,{expiresIn:'7d'});
let db,failSnapshot,failDelete,failSave,commits,aborts;
function reset() {
  commits=aborts=0;failSnapshot=failDelete=failSave=false;
  db={users:[
    {_id:ownerId,username:'owner',email:'owner@example.test',role:'OWNER',shopId,password:hash},
    {_id:cashierId,username:'ali',email:'ali@example.test',role:'CASHIER',shopId,password:hash,refreshToken:refresh},
    {_id:adminId,username:'admin',email:'admin@example.test',role:'ADMIN',password:hash},
    {_id:foreignId,username:'foreign',email:'foreign@example.test',role:'CASHIER',shopId:otherShop,password:hash},
  ],orders:[
    {_id:id(10),shopId,createdBy:cashierId,type:'INVOICE'},
    {_id:id(11),shopId,createdBy:cashierId,type:'QUOTATION',createdByName:' '},
    {_id:id(12),shopId,createdBy:cashierId,createdByName:'Original Seller'},
    {_id:id(13),shopId:otherShop,createdBy:cashierId},
    {_id:id(14),shopId,createdBy:ownerId},
  ],logs:[{shopId,createdBy:cashierId}],ledgers:[{shopId,createdBy:cashierId}]};
}
function matches(row,filter) {
  return Object.entries(filter).every(([key,value])=>{
    if(key==='$or')return value.some(f=>matches(row,f));
    if(value instanceof RegExp)return typeof row[key]==='string'&&value.test(row[key]);
    if(value&&typeof value==='object') {
      if('$ne'in value)return String(row[key])!==String(value.$ne);
      if('$exists'in value)return (row[key]!==undefined)===value.$exists;
    }
    if(value===null)return row[key]===null||row[key]===undefined;
    return String(row[key])===String(value);
  });
}
function query(filter,many=false) {
  let session,fields;
  const q={session(s){session=s;return q;},select(s){fields=s;return q;},sort(){return q;},
    async then(resolve,reject){try{
      const source=session?.pending||db;
      const rows=source.users.filter(u=>matches(u,filter));
      const values=rows.map(row=>{
        if(fields) {
          const result=structuredClone(row);
          if(fields.startsWith('-'))for(const field of fields.split(' '))delete result[field.slice(1)];
          else for(const field of Object.keys(result))if(field!=='_id'&&!fields.split(' ').includes(field))delete result[field];
          return result;
        }
        const user=User.hydrate(row);
        user.save=async()=>{
          if(failSave){const e=new Error('Duplicate');e.code=11000;throw e;}
          await user.validate();
          await User.schema.s.hooks.execPre('save',user,[]);
          const saved=user.toObject(); saved._id=String(saved._id); if(saved.shopId)saved.shopId=String(saved.shopId);
          Object.keys(row).forEach(k=>delete row[k]);Object.assign(row,saved);
          return user;
        };
        return user;
      });
      return resolve(many?values:values[0]||null);
    }catch(e){return reject(e);}}
  };return q;
}
User.find=filter=>query(filter,true);
User.findOne=filter=>query(filter);
User.findById=key=>query({_id:String(key)});
Shop.findById=async key=>({_id:key,name:'Shop',isActive:true,subscriptionActive:true,subscriptionExpiry:new Date(Date.now()+86400000)});
mongoose.startSession=async()=>{
  const session={pending:null,startTransaction(){this.pending=structuredClone(db);},async commitTransaction(){db=this.pending;commits++;},async abortTransaction(){aborts++;},async endSession(){}};
  return session;
};
User.deleteOne=async(filter,{session})=>{
  assert.equal(filter.shopId.toString(),shopId);assert.equal(filter.role,'CASHIER');
  if(failDelete)throw new Error('Delete failure');
  const before=session.pending.users.length;
  session.pending.users=session.pending.users.filter(u=>!matches(u,filter));
  return {deletedCount:before-session.pending.users.length};
};
Order.updateMany=async(filter,update,{session})=>{
  assert.equal(filter.shopId.toString(),shopId);assert.equal(filter.createdBy.toString(),cashierId);
  if(failSnapshot)throw new Error('Snapshot failure');
  for(const order of session.pending.orders)if(matches(order,filter))Object.assign(order,update.$set);
};
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
async function request(method,path,body,userId=ownerId) {
  if(method==='GET')body=undefined;
  const r=await fetch(`http://127.0.0.1:${server.address().port}/api/v2/users${path}`,{
    method,headers:{...(userId?{Authorization:'Bearer '+jwt.sign({_id:userId},process.env.ACCESS_TOKEN_SECRET)}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json()};
}
const operations=[['GET','/cashiers'],['PATCH','/cashiers/'+cashierId],['PATCH','/cashiers/'+cashierId+'/reset-password'],['DELETE','/cashiers/'+cashierId]];
try {
  await test('OWNER lists only own cashiers and never receives password or refresh token',async()=>{
    reset();const r=await request('GET','/cashiers');assert.equal(r.status,200);
    assert.deepEqual(r.body.data.cashiers,[{_id:cashierId,username:'ali',email:'ali@example.test'}]);
  });
  await test('CASHIER/ADMIN and anonymous users cannot use owner management routes',async()=>{
    reset();const before=structuredClone(db);
    for(const [method,path]of operations)for(const userId of [cashierId,adminId,null])assert.equal((await request(method,path,{},userId)).status,userId?403:400);
    assert.deepEqual(db,before);
  });
  await test('foreign cashiers, OWNER and ADMIN cannot be targets; malformed IDs are rejected',async()=>{
    for(const target of [foreignId,ownerId,adminId,id(99),'invalid'])for(const [method,suffix]of [['PATCH',''],['PATCH','/reset-password'],['DELETE','']]){
      reset();const before=structuredClone(db);
      const r=await request(method,'/cashiers/'+target+suffix,{username:'new',email:'new@example.test',newPassword:'new-password'});
      assert.equal(r.status,target==='invalid'?400:404);assert.deepEqual(db,before);
    }
  });
  await test('cashier editing normalizes identity, ignores forged fields and enforces global uniqueness',async()=>{
    reset();const before=structuredClone(db.users);
    const r=await request('PATCH','/cashiers/'+cashierId,{username:' ALI UPDATED ',email:' ALI.UPDATED@EXAMPLE.TEST ',role:'ADMIN',shopId:otherShop,password:'forged'});
    assert.equal(r.status,200);assert.equal(r.body.data.cashier.username,'ali updated');assert.equal(r.body.data.cashier.email,'ali.updated@example.test');
    assert.equal(r.body.data.cashier.password,undefined);assert.equal(r.body.data.cashier.refreshToken,undefined);
    for(const key of ['role','shopId','password','refreshToken'])assert.equal(db.users[1][key],before[1][key]);
    for(const body of [{username:' ',email:'x@example.test'},{username:'x',email:'bad'},{username:'foreign',email:'x@example.test'},{username:'x',email:'admin@example.test'}])assert.ok([400,409].includes((await request('PATCH','/cashiers/'+cashierId,body)).status));
    failSave=true;assert.equal((await request('PATCH','/cashiers/'+cashierId,{username:'unique',email:'unique@example.test'})).status,409);
  });
  await test('password reset uses actual hashing hook, clears refresh, rejects old password/refresh and keeps access expiry behavior',async()=>{
    reset();assert.equal((await request('PATCH','/cashiers/'+cashierId+'/reset-password',{newPassword:'new-password'})).status,200);
    assert.notEqual(db.users[1].password,'new-password');assert.ok(await bcrypt.compare('new-password',db.users[1].password));assert.equal(await bcrypt.compare('old-password',db.users[1].password),false);
    assert.equal(db.users[1].refreshToken,undefined);
    assert.equal((await request('POST','/refresh-token',{refreshToken:refresh},null)).status,401);
    assert.equal((await request('POST','/current-user',{},cashierId)).status,200);
    assert.equal((await request('POST','/login',{username:'ali',password:'old-password'},null)).status,401);
    assert.equal((await request('POST','/login',{username:'ali',password:'new-password'},null)).status,200);
    for(const newPassword of ['', '  ', null, 123])assert.equal((await request('PATCH','/cashiers/'+cashierId+'/reset-password',{newPassword})).status,400);
  });
  await test('deletion preserves all history and snapshots only missing own-shop creator names; sessions stop immediately',async()=>{
    reset();const before=structuredClone(db);
    assert.equal((await request('DELETE','/cashiers/'+cashierId)).status,200);
    assert.deepEqual(db.users,before.users.filter(u=>u._id!==cashierId));
    before.orders[0].createdByName='ali';before.orders[1].createdByName='ali';
    assert.deepEqual(db.orders,before.orders);assert.deepEqual(db.logs,before.logs);assert.deepEqual(db.ledgers,before.ledgers);
    assert.equal(commits,1);assert.equal(aborts,0);
    assert.equal((await request('POST','/current-user',{},cashierId)).status,400);
    assert.equal((await request('GET','/cashiers',undefined,cashierId)).status,400);
    assert.equal((await request('POST','/refresh-token',{refreshToken:refresh},null)).status,400);
  });
  await test('transaction failure rolls back both account deletion and legacy attribution',async()=>{
    for(const stage of ['delete','snapshot']){
      reset();const before=structuredClone(db);failDelete=stage==='delete';failSnapshot=stage==='snapshot';
      assert.equal((await request('DELETE','/cashiers/'+cashierId)).status,500);
      assert.deepEqual(db,before);assert.equal(commits,0);assert.equal(aborts,1);
    }
  });
} finally {await new Promise(resolve=>server.close(resolve));}
