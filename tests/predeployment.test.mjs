import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v2 as cloudinary } from 'cloudinary';

// Isolated models/provider; each test file has its own process and temp directory.
process.env.NODE_ENV = 'production';
process.env.ACCESS_TOKEN_SECRET = 'predeploy-test-access';
process.env.REFRESH_TOKEN_SECRET = 'predeploy-test-refresh';
process.env.ACCESS_TOKEN_EXPIRY = '15m';
process.env.REFRESH_TOKEN_EXPIRY = '7d';
process.env.OPENAI_API_KEY = 'test-only';
const originalDirectory = process.cwd();
const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'digishop-predeploy-'));
process.chdir(temporaryDirectory);
const { app } = await import('../dist/app.js');
const { apiError } = await import('../dist/utils/apiError.js');
const { User } = await import('../dist/models/user.model.js');
const { Shop } = await import('../dist/models/shop.model.js');
const { registrationLimiter, refreshLimiter, loginLimiter } = await import('../dist/middleware/rateLimiter.middleware.js');
const uploadDirectory = path.join(temporaryDirectory, 'public', 'temp');
const id = value => value.toString(16).padStart(24, '0');
const shopId = id(1), ownerId = id(2);
const password = 'test-password';
const passwordHash = await bcrypt.hash(password, 4);
let users, failure, providerCalls, commits;
function reset() {
  users = new Map([[ownerId, new User({_id: ownerId, username: 'owner', email: 'owner@example.test', password: passwordHash, role: 'OWNER', shopId})]]);
  failure = null; providerCalls = 0; commits = 0;
  for (const limiter of [registrationLimiter, refreshLimiter, loginLimiter]) limiter.resetKey('127.0.0.1');
}
function documentQuery(value) {
  let selected = value;
  const query = {
    select(fields) {
      if (value) {
        selected = value.toObject();
        for (const field of fields.split(' ')) if (field.startsWith('-')) delete selected[field.slice(1)];
        selected.generateAccessToken = value.generateAccessToken.bind(value);
        selected.generateRefreshToken = value.generateRefreshToken.bind(value);
        selected.save = async () => { value.refreshToken = selected.refreshToken; };
        selected.toObject = () => ({...selected});
      }
      return query;
    },
    session() { return query; },
    then(resolve, reject) { return Promise.resolve(selected).then(resolve, reject); }
  };
  return query;
}
User.findOne = async filter => {
  if (failure === 'lookup') throw new Error('PRIVATE database lookup details');
  const found = [...users.values()].find(user => filter.$or.some(part => part.username === user.username || part.email === user.email));
  if (found) found.save = async () => {};
  return found ?? null;
};
User.findById = key => documentQuery(users.get(String(key)) ?? null);
User.create = async payload => {
  if (failure === 'database') throw new Error('PRIVATE database insertion details');
  const create = fields => {
    const user = new User({_id: id(10 + users.size), ...fields});
    user.save = async () => {};
    users.set(String(user._id), user);
    return user;
  };
  return Array.isArray(payload) ? payload.map(create) : create(payload);
};
Shop.findById = async () => ({_id: shopId, name: 'Registered Shop', isActive: true, subscriptionActive: true, subscriptionExpiry: new Date(Date.now() + 86400000)});
Shop.create = async () => [{_id: shopId, name: 'Registered Shop'}];
Shop.findByIdAndUpdate = async () => ({});
mongoose.startSession = async () => {
  if (failure === 'session') throw new Error('PRIVATE database session details');
  return {startTransaction() {}, async commitTransaction() {commits++;}, async abortTransaction() {}, async endSession() {}};
};
cloudinary.uploader.upload = async file => {
  providerCalls++;
  assert.ok((await fs.stat(file)).size > 0);
  if (failure === 'cloudinary') throw new Error('PRIVATE provider details');
  return {url: 'https://images.example.test/avatar.png'};
};
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/api/v2';
async function request(route, body, {authenticated = false, cookie} = {}) {
  const response = await fetch(base + '/users/' + route, {method: 'POST', headers: {
    ...(body instanceof FormData ? {} : {'Content-Type': 'application/json'}),
    ...(authenticated ? {Authorization: 'Bearer ' + jwt.sign({_id: ownerId}, process.env.ACCESS_TOKEN_SECRET)} : {}),
    ...(cookie ? {Cookie: cookie} : {})
  }, ...(body === undefined ? {} : {body: body instanceof FormData ? body : JSON.stringify(body)})});
  return {status: response.status, body: await response.json(), cookies: response.headers.getSetCookie()};
}
function assertSafeJSON(result) {
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.notEqual(key, 'password'); assert.notEqual(key, 'refreshToken'); inspect(child);
    }
  }
  inspect(result.body);
}
function avatarForm(fields) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('avatar', new Blob([Buffer.from('test image')], {type: 'image/png'}), 'avatar-' + randomUUID() + '.png');
  return form;
}
const ownerFields = {username: 'newowner', email: 'newowner@example.test', password, shopName: 'Registered Shop', contactNo: '03001234567', address: 'Market'};
const staffFields = {username: 'cashier', email: 'cashier@example.test', password};
async function assertNoAvatars() { assert.deepEqual(await fs.readdir(uploadDirectory), []); }
try {
  await test('login, current-user and refresh responses exclude credential fields; cookies still rotate', async () => {
    reset(); const login = await request('login', {username: 'owner', password});
    assert.equal(login.status, 200); assertSafeJSON(login);
    assert.equal(login.cookies.length, 2);
    for (const cookie of login.cookies) {assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/);}
    const cookie = login.cookies.map(value => value.split(';')[0]).join('; ');
    const current = await request('current-user', {}, {cookie});
    assert.equal(current.status, 200); assertSafeJSON(current);
    const refreshed = await request('refresh-token', {}, {cookie});
    assert.equal(refreshed.status, 200); assertSafeJSON(refreshed);
    assert.equal(refreshed.cookies.length, 2); assert.ok(users.get(ownerId).refreshToken);
    assert.equal(decodeURIComponent(refreshed.cookies.find(value => value.startsWith('refreshToken=')).split(';')[0].slice('refreshToken='.length)), users.get(ownerId).refreshToken);
  });
  await test('production keeps expected application errors but hides all internal server details', async () => {
    const handler = app.router.stack.find(layer => layer.handle.length === 4).handle;
    const fixture = express();
    fixture.get('/error/:kind', (req, res, next) => next(req.params.kind === 'expected' ? new apiError(403, 'Shop has been deactivated. Contact administrator.') : req.params.kind === 'wrapped' ? new apiError(500, 'PRIVATE MongoDB /filesystem/path') : new Error('PRIVATE MongoDB /filesystem/path')));
    fixture.use(handler);
    const fixtureServer = fixture.listen(0, '127.0.0.1');
    await new Promise(resolve => fixtureServer.once('listening', resolve));
    const fixtureURL = 'http://127.0.0.1:' + fixtureServer.address().port;
    try {
      for (const kind of ['unexpected', 'wrapped']) {
        const response = await fetch(fixtureURL + '/error/' + kind);
        assert.equal(response.status, 500); assert.deepEqual(await response.json(), {success: false, message: 'Internal server error'});
      }
      const expected = await fetch(fixtureURL + '/error/expected');
      assert.equal(expected.status, 403); assert.equal((await expected.json()).message, 'Shop has been deactivated. Contact administrator.');
      process.env.NODE_ENV = 'development';
      const development = await fetch(fixtureURL + '/error/unexpected');
      assert.match((await development.json()).message, /PRIVATE MongoDB/);
    } finally {process.env.NODE_ENV = 'production'; await new Promise(resolve => fixtureServer.close(resolve));}
  });
  await test('registration limiter blocks the eleventh attempt before avatar upload', async () => {
    reset(); for (let count = 0; count < 10; count++) assert.equal((await request('register', {})).status, 400);
    const limited = await request('register', avatarForm(ownerFields));
    assert.equal(limited.status, 429); assert.equal(limited.body.success, false); assert.match(limited.body.message, /registration attempts/);
    assert.equal(providerCalls, 0); await assertNoAvatars();
  });
  await test('refresh limiter returns controlled 429 without affecting current-user', async () => {
    reset(); for (let count = 0; count < 120; count++) assert.equal((await request('refresh-token', {})).status, 400);
    const limited = await request('refresh-token', {}); assert.equal(limited.status, 429); assert.match(limited.body.message, /refresh attempts/);
    assert.equal((await request('current-user', {}, {authenticated: true})).status, 200);
  });
  await test('existing production login limit remains five attempts per fifteen minutes', async () => {
    reset(); for (let count = 0; count < 5; count++) assert.equal((await request('login', {username: 'owner', password: 'wrong'})).status, 401);
    const response = await fetch(base + '/users/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'owner', password})});
    assert.equal(response.status, 429); assert.equal(await response.text(), 'Too many Login attampts, Try Again');
    assert.equal((await request('current-user', {}, {authenticated: true})).status, 200);
  });
  await test('registration cleanup covers validation, duplicate, lookup, session, Cloudinary and database failures', async () => {
    for (const scenario of ['validation', 'duplicate', 'lookup', 'session', 'cloudinary', 'database']) {
      reset(); failure = scenario;
      const fields = scenario === 'validation' ? {} : scenario === 'duplicate' ? {...ownerFields, username: 'owner'} : ownerFields;
      const result = await request('register', avatarForm(fields));
      assert.equal(result.status, scenario === 'validation' ? 400 : scenario === 'duplicate' ? 409 : 500, scenario);
      if (result.status === 500) assert.equal(result.body.message, 'Internal server error');
      await assertNoAvatars();
    }
  });
  await test('staff cleanup covers early validation, Cloudinary and database failures', async () => {
    for (const scenario of ['validation', 'cloudinary', 'database']) {
      reset(); failure = scenario;
      const result = await request('register-staff', avatarForm(scenario === 'validation' ? {} : staffFields), {authenticated: true});
      assert.equal(result.status, scenario === 'validation' ? 400 : scenario === 'cloudinary' ? 201 : 500);
      // Preserve existing staff behavior on a null provider result; only local cleanup changes.
      await assertNoAvatars();
    }
  });
  await test('successful owner registration and staff creation preserve avatar and safe response behavior', async () => {
    reset(); const owner = await request('register', avatarForm(ownerFields));
    assert.equal(owner.status, 201); assertSafeJSON(owner); assert.equal(owner.body.data.avatar, 'https://images.example.test/avatar.png');
    assert.equal(owner.body.data.shopName, 'Registered Shop'); assert.equal(commits, 1); assert.equal(owner.cookies.length, 2); await assertNoAvatars();
    const staff = await request('register-staff', avatarForm(staffFields), {authenticated: true});
    assert.equal(staff.status, 201); assertSafeJSON(staff); assert.equal(staff.body.data.cashier.avatar, 'https://images.example.test/avatar.png');
    assert.equal(staff.body.data.cashier.role, 'CASHIER'); await assertNoAvatars();
  });
} finally {
  await new Promise(resolve => server.close(resolve));
  process.chdir(originalDirectory);
  await fs.rmdir(uploadDirectory); await fs.rmdir(path.dirname(uploadDirectory)); await fs.rmdir(temporaryDirectory);
}
