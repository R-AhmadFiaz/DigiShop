import assert from "node:assert/strict";
import test from "node:test";
import {
  adminShopRows,
  shopSubscription,
  subscriptionWarning,
} from "../src/api/subscription.js";
const DAY = 86400000,
  now = new Date(2026, 9, 1, 12).getTime();
const shop = (days, fields = {}) => ({
  _id: "internal",
  name: "Electrical Store",
  contactNo: "03001234567",
  ownerId: { username: "counterowner", email: "owner@example.test" },
  isActive: true,
  subscriptionActive: true,
  subscriptionExpiry:
    days === null ? null : new Date(now + days * DAY).toISOString(),
  ...fields,
});
test("subscription states select exactly one appropriate payment-period action", () => {
  for (const [days, status, action, label] of [
    [null, "Never Activated", "activate", "Activate 30 Days"],
    [24, "Active", "extend", "Extend 30 Days"],
    [3, "Expiring Soon", "extend", "Extend 30 Days"],
    [-1, "Expired", "extend", "Renew 30 Days"],
    [0, "Expired", "extend", "Renew 30 Days"],
  ]) {
    const result = shopSubscription(shop(days), now);
    assert.equal(result.status, status);
    assert.equal(result.action, action);
    assert.equal(result.actionLabel, label);
  }
});
test("72-hour cutoff and near-expiry wording match the Owner warning", () => {
  assert.equal(shopSubscription(shop(3 + 1 / DAY), now).status, "Active");
  for (const [days, text] of [
    [3, "3 days"],
    [2, "2 days"],
    [1, "Tomorrow"],
    [0.05, "Today"],
  ]) {
    const item = shop(days),
      summary = shopSubscription(item, now);
    assert.equal(summary.status, "Expiring Soon");
    assert.equal(summary.timeLeft, text);
    assert.ok(
      subscriptionWarning(item.subscriptionExpiry, now)
        .toLowerCase()
        .includes(text.toLowerCase()),
    );
  }
  assert.equal(shopSubscription(shop(23.1), now).timeLeft, "24 days");
});
test("attention order is expired, never activated, soon, active; nearer expiry wins", () => {
  const input = [
    shop(30, { _id: "healthy" }),
    shop(2, { _id: "soon2" }),
    shop(null, { _id: "new" }),
    shop(-1, { _id: "expired" }),
    shop(1, { _id: "soon1" }),
    shop(10, { _id: "healthy10" }),
  ];
  const snapshot = structuredClone(input);
  assert.deepEqual(
    adminShopRows(input, "", now).map((r) => r.shop._id),
    ["expired", "new", "soon1", "soon2", "healthy10", "healthy"],
  );
  assert.deepEqual(input, snapshot);
});
test("manual deactivation never changes subscription display or ordering", () => {
  const active = shop(18),
    disabled = { ...active, isActive: false };
  assert.deepEqual(
    shopSubscription(disabled, now),
    shopSubscription(active, now),
  );
  assert.equal(shopSubscription(disabled, now).timeLeft, "18 days");
});
test("search matches shop, contact, username and email without missing-owner metadata", () => {
  const item = shop(24);
  for (const term of [
    "electrical",
    "0300123",
    "COUNTEROWNER",
    " OWNER@EXAMPLE.TEST ",
  ])
    assert.equal(adminShopRows([item], term, now).length, 1);
  assert.equal(adminShopRows([item], "unknown", now).length, 0);
  assert.equal(
    adminShopRows(
      [shop(null, { ownerId: null, contactNo: null })],
      "undefined",
      now,
    ).length,
    0,
  );
});
test("subscription period display derives from expiry independently of legacy flags", () => {
  const summary = shopSubscription(
    shop(18, { subscriptionActive: false }),
    now,
  );
  assert.equal(summary.status, "Active");
  assert.equal(summary.action, "extend");
  assert.equal(summary.timeLeft, "18 days");
});
test("invalid expiry cannot offer an action that overwrites an unknown paid period", () => {
  const summary = shopSubscription(
    shop(1, { subscriptionExpiry: "invalid" }),
    now,
  );
  assert.equal(summary.status, "Unavailable");
  assert.equal(summary.action, null);
});
