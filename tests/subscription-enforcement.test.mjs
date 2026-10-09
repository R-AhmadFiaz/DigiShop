import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

// Real mounted routes and JWT/password handling; isolated persistence only.
process.env.ACCESS_TOKEN_SECRET = 'subscription-test-access';
process.env.REFRESH_TOKEN_SECRET = 'subscription-test-refresh';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.OPENAI_API_KEY = 'test-only';
const { app } = await import('../dist/app.js');
const { Shop } = await import('../dist/models/shop.model.js');
const { User } = await import('../dist/models/user.model.js');
const { verifyShopUser, verifyOwner } =
  await import('../dist/middleware/role.middleware.js');
const models = await Promise.all(
  [
    'product',
    'category',
    'customer',
    'order',
    'stockLog',
    'customerLedger',
  ].map(async (name) => {
    const module = await import(`../dist/models/${name}.model.js`);
    return Object.values(module)[0];
  })
);
const [Product, , , Order] = models;
const id = (n) => n.toString(16).padStart(24, '0');
const shopId = id(1),
  otherId = id(2),
  ownerId = id(3),
  cashierId = id(4),
  adminId = id(5),
  otherOwnerId = id(6),
  missingShopUserId = id(7);
const DAY = 86400000,
  SUB = 'Subscription expired or inactive',
  MANUAL = 'Shop has been deactivated. Contact administrator.';
const shops = new Map();
const users = new Map();
const passwordHash = await bcrypt.hash('test-password', 4);
for (const [userId, role, scope] of [
  [ownerId, 'OWNER', shopId],
  [cashierId, 'CASHIER', shopId],
  [adminId, 'ADMIN', null],
  [otherOwnerId, 'OWNER', otherId],
  [missingShopUserId, 'OWNER', id(99)],
]) {
  const user = new User({
    _id: userId,
    username: 'user' + userId,
    email: userId + '@example.test',
    password: passwordHash,
    role,
    ...(scope ? { shopId: scope } : {}),
  });
  user.save = async () => {
    if (!user.password.startsWith('$2'))
      user.password = await bcrypt.hash(user.password, 4);
    return user;
  };
  users.set(userId, user);
}
let operations = [],
  shopWrites = 0;
const businessData = {
  products: [
    {
      _id: id(10),
      shopId,
      name: 'Cable',
      brand: 'Wire',
      unit: 'm',
      stockQuantity: 10,
      costPrice: 20,
      retailPrice: 50,
    },
    {
      _id: id(11),
      shopId: otherId,
      name: 'Other shop cable',
      stockQuantity: 99,
    },
  ],
  orders: [
    {
      _id: id(12),
      shopId,
      type: 'QUOTATION',
      status: 'DRAFT',
      totalPrice: 100,
      items: [{ productId: id(10), quantity: 2, unitPrice: 50 }],
    },
  ],
  stockLogs: [],
  customers: [{ _id: id(13), shopId, remainingMoney: 25 }],
  ledgers: [],
};
function resetShop(fields = {}) {
  shops.set(shopId, {
    _id: shopId,
    isActive: true,
    subscriptionActive: true,
    subscriptionExpiry: new Date(Date.now() + 30 * DAY),
    ...fields,
  });
  shops.set(otherId, {
    _id: otherId,
    isActive: true,
    subscriptionActive: true,
    subscriptionExpiry: new Date(Date.now() + 30 * DAY),
  });
}
function query(value) {
  const q = {
    populate() {
      return q;
    },
    sort() {
      return q;
    },
    skip() {
      return q;
    },
    limit() {
      return q;
    },
    select(fields) {
      if (value instanceof User) {
        const safe = value.toObject();
        for (const field of fields.split(' '))
          if (field.startsWith('-')) delete safe[field.slice(1)];
        safe.generateAccessToken = value.generateAccessToken.bind(value);
        safe.generateRefreshToken = value.generateRefreshToken.bind(value);
        safe.save = async () => {
          value.refreshToken = safe.refreshToken;
        };
        return Promise.resolve(safe);
      }
      if (fields === '-costPrice')
        value = value.map(({ costPrice, ...rest }) => rest);
      return q;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  };
  return q;
}
User.findById = (key) => query(users.get(String(key)) || null);
User.findOne = async (filter) =>
  [...users.values()].find((user) =>
    filter.$or.some(
      (f) => f.username === user.username || f.email === user.email
    )
  ) || null;
User.findByIdAndUpdate = async (key) => {
  const user = users.get(String(key));
  user.refreshToken = undefined;
  return user;
};
Shop.findById = async (key) => {
  const shop = shops.get(String(key));
  return shop
    ? {
        ...structuredClone(shop),
        save: async function () {
          shopWrites++;
          const { save, ...fields } = this;
          shops.set(String(key), fields);
        },
      }
    : null;
};
Shop.find = () =>
  query([...shops.values()].map((shop) => structuredClone(shop)));
Shop.findByIdAndUpdate = async (key, update) => {
  shopWrites++;
  const shop = shops.get(String(key));
  if (!shop) return null;
  Object.assign(shop, update.$set || update);
  return structuredClone(shop);
};
for (const Model of models)
  for (const method of [
    'find',
    'findOne',
    'findById',
    'create',
    'findOneAndUpdate',
    'findByIdAndUpdate',
    'updateOne',
    'deleteOne',
    'countDocuments',
  ]) {
    Model[method] = () => {
      operations.push(Model.modelName + '.' + method);
      throw Error('Unexpected business persistence operation');
    };
  }
Product.find = (filter) => {
  operations.push('Product.find');
  return query(
    structuredClone(
      businessData.products.filter(
        (product) => product.shopId === String(filter.shopId)
      )
    )
  );
};
Order.findOne = (filter) => {
  operations.push('Order.findOne');
  return query(
    structuredClone(
      businessData.orders.find(
        (order) =>
          order._id === String(filter._id) &&
          order.shopId === String(filter.shopId) &&
          order.type === filter.type
      ) || null
    )
  );
};

// Discover every current shop-business method from actual Express route stacks.
const mounted = [];
for (const [prefix, file, exportName] of [
  ['/users', 'user.route', 'userRouter'],
  ['/products', 'product.route', 'productRouter'],
  ['/categories', 'category.route', 'categoryRouter'],
  ['/customers', 'customer.route', 'customerRouter'],
  ['/orders', 'order.routes', 'orderRouter'],
  ['/ai', 'ai.route', 'aiRouter'],
  ['/admin', 'admin.route', 'adminRouter'],
]) {
  const router = (await import(`../dist/routes/${file}.js`))[exportName];
  for (const layer of router.stack || router.router.stack)
    if (layer.route) {
      const route = layer.route;
      for (const method of Object.keys(route.methods))
        mounted.push({
          method: method.toUpperCase(),
          path: prefix + route.path,
          shop: route.stack.some(
            (handler) => handler.handle === verifyShopUser
          ),
          ownerOnly: route.stack.some(
            (handler) => handler.handle === verifyOwner
          ),
        });
    }
}
const businessRoutes = mounted.filter((route) => route.shop);
const pathFor = (path) => path.replace(/:(id|orderId|quotationId)/g, id(12));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/v2`;
async function request(method, path, userId = adminId, body, cookie) {
  const headers = cookie
    ? { Cookie: cookie }
    : {
        Authorization:
          'Bearer ' +
          jwt.sign({ _id: userId }, process.env.ACCESS_TOKEN_SECRET),
      };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookies: response.headers.getSetCookie(),
  };
}
async function assertBlocked(route, userId, message = SUB) {
  const before = structuredClone({ shops: [...shops], businessData });
  const callsBefore = operations.length,
    writesBefore = shopWrites;
  const result = await request(
    route.method,
    pathFor(route.path),
    userId,
    route.method === 'GET'
      ? undefined
      : {
          items: [{ productId: id(10), quantity: 2 }],
          saleType: 'RETAIL',
          paidAmount: 40,
          customerId: id(13),
        }
  );
  assert.equal(result.status, 403, route.method + ' ' + route.path);
  assert.equal(result.body.message, message, route.path);
  assert.equal(
    operations.length,
    callsBefore,
    'No business model reads or writes'
  );
  assert.equal(shopWrites, writesBefore, 'No shop/invoice-counter mutations');
  assert.deepEqual({ shops: [...shops], businessData }, before);
}
try {
  await test('all 24 paid routes use the centralized gate; auth/profile/account/Admin routes remain outside it', () => {
    assert.equal(mounted.length, 37);
    assert.equal(businessRoutes.length, 24);
    for (const route of mounted)
      assert.equal(
        route.shop,
        !route.path.startsWith('/admin/') &&
          (!route.path.startsWith('/users/') ||
            route.path === '/users/register-staff' || route.path === '/users/shop-details' || route.path.startsWith('/users/cashiers')),
        route.path
      );
  });
  for (const [userId, role] of [
    [ownerId, 'OWNER'],
    [cashierId, 'CASHIER'],
  ])
    for (const route of businessRoutes.filter(
      (route) => role === 'OWNER' || !route.ownerOnly
    )) {
      await test(`expired ${role} blocked: ${route.method} ${route.path}`, async () => {
        resetShop({ subscriptionExpiry: new Date(0) });
        await assertBlocked(route, userId);
      });
    }
  await test('never activated, missing expiry, inactive flag and exact-expiry boundary block every business route for both shop roles', async () => {
    for (const fields of [
      { subscriptionActive: false, subscriptionExpiry: null },
      { subscriptionExpiry: null },
      { subscriptionExpiry: undefined },
      { subscriptionActive: false },
      { subscriptionActive: undefined },
      { subscriptionExpiry: new Date(Date.now()) },
    ]) {
      resetShop(fields);
      for (const userId of [ownerId, cashierId])
        for (const route of businessRoutes) await assertBlocked(route, userId);
    }
  });
  await test('manual deactivation wins over both future and expired subscription on every paid route', async () => {
    for (const subscriptionExpiry of [
      new Date(Date.now() + DAY),
      new Date(0),
    ]) {
      resetShop({ isActive: false, subscriptionExpiry });
      for (const userId of [ownerId, cashierId])
        for (const route of businessRoutes)
          await assertBlocked(route, userId, MANUAL);
    }
  });
  await test('expired quotation creation and conversion cannot touch invoice, stock, logs, customer debt or ledger', async () => {
    resetShop({ subscriptionExpiry: new Date(0) });
    const before = structuredClone(businessData);
    for (const route of businessRoutes.filter(
      (route) =>
        route.path === '/orders/quotation' ||
        route.path === '/orders/:quotationId'
    ))
      await assertBlocked(route, cashierId);
    assert.deepEqual(businessData, before);
    assert.equal(businessData.orders[0].status, 'DRAFT');
  });
  await test('expired OWNER/CASHIER login, refresh, restoration, password change and logout remain available', async () => {
    resetShop({ subscriptionExpiry: new Date(0) });
    for (const userId of [ownerId, cashierId]) {
      const user = users.get(userId);
      const login = await request('POST', '/users/login', userId, {
        username: user.username,
        password: 'test-password',
      });
      assert.equal(login.status, 200);
      assert.equal(login.body.data.shopActive, true);
      let cookie = login.cookies.map((value) => value.split(';')[0]).join('; ');
      assert.equal(
        (
          await request(
            'POST',
            '/users/current-user',
            userId,
            undefined,
            cookie
          )
        ).status,
        200
      );
      const refreshed = await request(
        'POST',
        '/users/refresh-token',
        userId,
        undefined,
        cookie
      );
      assert.equal(refreshed.status, 200);
      cookie = refreshed.cookies.map((value) => value.split(';')[0]).join('; ');
      assert.equal(
        (
          await request(
            'POST',
            '/users/current-user',
            userId,
            undefined,
            cookie
          )
        ).status,
        200
      );
      assert.equal(
        (
          await request(
            'POST',
            '/users/change-password',
            userId,
            {
              oldPassword: 'test-password',
              newPassword: 'new-security-password',
            },
            cookie
          )
        ).status,
        200
      );
      assert.ok(await user.isPasswordCorrect('new-security-password'));
      user.password = passwordHash;
      assert.equal(
        (await request('POST', '/users/logout', userId, undefined, cookie))
          .status,
        200
      );
    }
    assert.equal(
      (await request('POST', '/users/register', ownerId, {})).status,
      400,
      'Public registration reaches ordinary body validation, not a subscription gate'
    );
    assert.equal(
      (
        await request('POST', '/users/change-password', adminId, {
          oldPassword: 'test-password',
          newPassword: 'admin-security-password',
        })
      ).status,
      200
    );
    users.get(adminId).password = passwordHash;
  });
  await test('active OWNER/CASHIER read their own shop; foreign invoices and missing shops stay inaccessible', async () => {
    resetShop();
    for (const userId of [ownerId, cashierId]) {
      const result = await request('GET', '/products/search-product', userId);
      assert.equal(result.status, 200);
      assert.equal(result.body.data.product.length, 1);
      assert.equal(result.body.data.product[0].shopId, shopId);
      assert.equal(
        'costPrice' in result.body.data.product[0],
        userId === ownerId
      );
    }
    assert.equal(
      (await request('GET', '/orders/' + id(12), otherOwnerId)).status,
      404
    );
    const missing = await request(
      'GET',
      '/products/search-product',
      missingShopUserId
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.message, 'Shop not found');
    resetShop({ subscriptionExpiry: new Date(0) });
    assert.equal(
      (await request('GET', '/products/search-product', otherOwnerId)).status,
      200,
      'Another subscribed shop is unaffected'
    );
  });
  await test('subscribed CASHIER owner-only restrictions and ADMIN shop-route denial remain intact', async () => {
    resetShop();
    for (const route of businessRoutes.filter((route) => route.ownerOnly)) {
      const result = await request(
        route.method,
        pathFor(route.path),
        cashierId,
        route.method === 'GET' ? undefined : {}
      );
      assert.equal(result.status, 403);
      assert.equal(result.body.message, 'Owner access required');
    }
    for (const route of businessRoutes) {
      const result = await request(
        route.method,
        pathFor(route.path),
        adminId,
        route.method === 'GET' ? undefined : {}
      );
      assert.equal(result.status, 403);
      assert.equal(result.body.message, 'Shop access required');
    }
    for (const userId of [ownerId, cashierId])
      for (const route of mounted.filter((route) =>
        route.path.startsWith('/admin/')
      )) {
        const result = await request(
          route.method,
          route.path.replace(':id', shopId),
          userId
        );
        assert.equal(result.status, 403);
        assert.equal(result.body.message, 'Admin Access Required');
      }
  });
  await test('ADMIN manages expired/deactivated shops; reactivation alone cannot renew, renewal preserves paid time and manual state', async () => {
    resetShop({ isActive: false, subscriptionExpiry: new Date(0) });
    const otherBefore = structuredClone(shops.get(otherId));
    assert.equal((await request('GET', '/admin/shops')).status, 200);
    assert.equal(
      (await request('PATCH', `/admin/shops/${shopId}/reactivate`)).status,
      200
    );
    assert.equal(shops.get(shopId).subscriptionExpiry.getTime(), 0);
    for (const userId of [ownerId, cashierId])
      await assertBlocked(
        businessRoutes.find(
          (route) => route.path === '/products/search-product'
        ),
        userId
      );
    const renewalStart = Date.now();
    assert.equal(
      (await request('PATCH', `/admin/shops/${shopId}/extend`)).status,
      200
    );
    assert.ok(
      shops.get(shopId).subscriptionExpiry.getTime() >= renewalStart + 30 * DAY
    );
    for (const userId of [ownerId, cashierId])
      assert.equal(
        (await request('GET', '/products/search-product', userId)).status,
        200
      );
    const paidExpiry = shops.get(shopId).subscriptionExpiry.getTime();
    assert.equal(
      (await request('PATCH', `/admin/shops/${shopId}/deactivate`)).status,
      200
    );
    assert.equal(shops.get(shopId).subscriptionExpiry.getTime(), paidExpiry);
    assert.equal(
      (await request('PATCH', `/admin/shops/${shopId}/extend`)).status,
      200
    );
    assert.equal(
      shops.get(shopId).subscriptionExpiry.getTime(),
      paidExpiry + 30 * DAY
    );
    assert.equal(shops.get(shopId).isActive, false);
    assert.equal(
      (await request('PATCH', `/admin/shops/${shopId}/activate`)).status,
      200
    );
    assert.equal(shops.get(shopId).isActive, false);
    await assertBlocked(
      businessRoutes.find((route) => route.path === '/products/search-product'),
      ownerId,
      MANUAL
    );
    assert.equal(
      (await request('PATCH', `/admin/shops/${shopId}/reactivate`)).status,
      200
    );
    assert.equal(
      (await request('GET', '/products/search-product', ownerId)).status,
      200
    );
    Object.assign(shops.get(shopId), {
      subscriptionActive: false,
      subscriptionExpiry: null,
    });
    assert.equal(
      (await request('PATCH', `/admin/shops/${shopId}/activate`)).status,
      200
    );
    for (const userId of [ownerId, cashierId])
      assert.equal(
        (await request('GET', '/products/search-product', userId)).status,
        200
      );
    assert.deepEqual(shops.get(otherId), otherBefore);
  });
} finally {
  await new Promise((resolve) => server.close(resolve));
}
