import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

// Isolated persistence and transaction simulation: never connects to a real database.
process.env.ACCESS_TOKEN_SECRET = 'deletion-test';
process.env.REFRESH_TOKEN_SECRET = 'deletion-refresh-test';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.OPENAI_API_KEY = 'test-only';
const { app } = await import('../dist/app.js');
const { Shop } = await import('../dist/models/shop.model.js');
const { User } = await import('../dist/models/user.model.js');
const { Category } = await import('../dist/models/category.model.js');
const { Product } = await import('../dist/models/product.model.js');
const { Order } = await import('../dist/models/order.model.js');
const { Customer } = await import('../dist/models/customer.model.js');
const { StockLog } = await import('../dist/models/stockLog.model.js');
const { CustomerLedger } = await import('../dist/models/customerLedger.model.js');
const { InvoiceAdjustment } = await import('../dist/models/invoiceAdjustment.model.js');
const {BusinessEntity} = await import('../dist/models/businessEntity.model.js');
const {FinancialAccount} = await import('../dist/models/financialAccount.model.js');
const {BusinessTransaction} = await import('../dist/models/businessTransaction.model.js');
const {BusinessBrand, ProductBrandLink} = await import('../dist/models/businessBrand.model.js');
const {PurchaseOrder}=await import('../dist/models/purchaseOrder.model.js');
const {SupplierSettlement}=await import('../dist/models/supplierSettlement.model.js');
const {SupplierCutover}=await import('../dist/models/supplierCutover.model.js');
const {GoodsReceipt}=await import('../dist/models/goodsReceipt.model.js');
const id = n => n.toString(16).padStart(24, '0');
const shopId = id(1), otherId = id(2), adminId = id(3), ownerId = id(4), cashierId = id(5);
let db, commits, aborts, ends, failure, concurrentReactivation;
function reset(isActive = false) {
  commits = aborts = ends = 0;
  failure = null; concurrentReactivation = false;
  db = {
    shops: [{ _id: shopId, name: 'Delete Shop', isActive }, { _id: otherId, name: 'Keep Shop', isActive: true }],
    users: [{ _id: adminId, role: 'ADMIN', shopId }, { _id: ownerId, role: 'OWNER', shopId },
      { _id: cashierId, role: 'CASHIER', shopId }, { _id: id(6), role: 'OWNER', shopId: otherId }],
  };
  for (const key of ['categories', 'products', 'customers', 'logs', 'ledgers', 'adjustments', 'entities', 'accounts', 'journals', 'brands', 'brandlinks', 'purchases', 'receipts', 'suppliercutovers', 'suppliersettlements'])
    db[key] = [{ _id: id(10), shopId }, { _id: id(11), shopId: otherId }];
  db.orders = [{ _id: id(12), shopId, type: 'INVOICE' }, { _id: id(13), shopId, type: 'QUOTATION' },
    { _id: id(14), shopId: otherId, type: 'INVOICE' }];
}
mongoose.startSession = async () => {
  let pending;
  const session = {
    startTransaction() { pending = structuredClone(db); },
    async commitTransaction() { db = pending; commits++; },
    async abortTransaction() { aborts++; },
    async endSession() { ends++; },
    get pending() { return pending; },
  };
  return session;
};
User.findById = key => ({ select: async () => db.users.find(u => u._id === String(key)) || null });
Shop.findById = key => ({ session: async session => {
  const shop = session.pending.shops.find(s => s._id === String(key));
  return shop ? { ...shop } : null;
} });
Shop.deleteOne = async (filter, { session }) => {
  assert.deepEqual(filter, { _id: shopId, isActive: false });
  if (concurrentReactivation) {
    db.shops[0].isActive = true;
    const error = new Error('Write conflict'); error.statusCode = 409; throw error;
  }
  const count = session.pending.shops.length;
  session.pending.shops = session.pending.shops.filter(s => !(s._id === String(filter._id) && s.isActive === false));
  return { deletedCount: count - session.pending.shops.length };
};
for (const [Model, key] of [[Category, 'categories'], [Product, 'products'], [Order, 'orders'],
  [Customer, 'customers'], [StockLog, 'logs'], [CustomerLedger, 'ledgers'], [InvoiceAdjustment, 'adjustments'], [User, 'users'], [BusinessEntity, 'entities'], [FinancialAccount, 'accounts'], [BusinessBrand, 'brands'], [ProductBrandLink, 'brandlinks'], [BusinessTransaction.collection, 'journals'],[PurchaseOrder,'purchases'],[GoodsReceipt.collection,'receipts'],[SupplierCutover.collection,'suppliercutovers'],[SupplierSettlement.collection,'suppliersettlements']]) {
  Model.deleteMany = async (filter, { session }) => {
    assert.equal(String(filter.shopId), shopId);
    assert.ok(session?.pending, 'every deletion participates in the transaction');
    if (key === 'users') assert.deepEqual(filter.role, { $in: ['OWNER', 'CASHIER'] });
    if (failure === key) throw new Error('Injected deletion failure');
    session.pending[key] = session.pending[key].filter(row => row.shopId !== String(filter.shopId) ||
      (filter.role && !filter.role.$in.includes(row.role)));
    return { acknowledged: true };
  };
}
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
async function remove(userId = adminId, target = shopId) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/shops/${target}`, {
    method: 'DELETE', headers: userId ? { Authorization: 'Bearer ' + jwt.sign({ _id: userId }, process.env.ACCESS_TOKEN_SECRET) } : {},
  });
  return { status: response.status, body: await response.json() };
}
try {
  await test('ADMIN deletes deactivated shop and every associated collection; other shops and ADMIN survive', async () => {
    reset(); const before = structuredClone(db);
    assert.equal((await remove()).status, 200);
    assert.equal(db.shops.some(s => s._id === shopId), false);
    for (const key of ['categories', 'products', 'orders', 'customers', 'logs', 'ledgers', 'adjustments', 'entities', 'accounts', 'journals', 'brands', 'brandlinks', 'purchases', 'receipts']) {
      assert.equal(db[key].some(row => row.shopId === shopId), false, key);
      assert.deepEqual(db[key], before[key].filter(row => row.shopId === otherId));
    }
    assert.deepEqual(db.users, before.users.filter(u => u.role === 'ADMIN' || u.shopId === otherId));
    assert.deepEqual(db.shops, before.shops.filter(s => s._id === otherId));
    assert.equal(commits, 1); assert.equal(aborts, 0); assert.equal(ends, 1);
  });
  await test('OWNER/CASHIER and unauthenticated callers cannot delete a shop', async () => {
    for (const userId of [ownerId, cashierId, null]) {
      reset(); const before = structuredClone(db);
      const result = await remove(userId);
      assert.equal(result.status, userId ? 403 : 400);
      assert.deepEqual(db, before); assert.equal(commits, 0); assert.equal(ends, 0);
    }
  });
  await test('active and legacy shops require explicit deactivation before deletion', async () => {
    for (const state of [true, undefined]) {
      reset(state); if (state === undefined) delete db.shops[0].isActive;
      const before = structuredClone(db), result = await remove();
      assert.equal(result.status, 403); assert.match(result.body.message, /Deactivate/);
      assert.deepEqual(db, before); assert.equal(aborts, 1); assert.equal(ends, 1);
    }
  });
  await test('invalid and missing shop IDs return controlled errors without deleting records', async () => {
    reset(); const before = structuredClone(db);
    assert.equal((await remove(adminId, 'invalid')).status, 400);
    assert.equal((await remove(adminId, id(99))).status, 404);
    assert.deepEqual(db, before); assert.equal(commits, 0);
  });
  await test('failure at any cascade step rolls back the shop and all associated deletions', async () => {
    for (const key of ['ledgers', 'adjustments', 'logs', 'orders', 'customers', 'products', 'categories', 'users', 'entities', 'accounts', 'journals', 'brands', 'brandlinks', 'purchases', 'receipts']) {
      reset(); failure = key; const before = structuredClone(db);
      assert.equal((await remove()).status, 500);
      assert.deepEqual(db, before); assert.equal(commits, 0); assert.equal(aborts, 1); assert.equal(ends, 1);
    }
  });
  await test('concurrent reactivation write conflict aborts deletion and preserves business records', async () => {
    reset(); concurrentReactivation = true; const before = structuredClone(db);
    assert.equal((await remove()).status, 409);
    before.shops[0].isActive = true;
    assert.deepEqual(db, before); assert.equal(commits, 0); assert.equal(aborts, 1); assert.equal(ends, 1);
  });
} finally { await new Promise(resolve => server.close(resolve)); }
