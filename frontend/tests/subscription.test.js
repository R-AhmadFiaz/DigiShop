import assert from "node:assert/strict";
import test from "node:test";
import { subscriptionWarning } from "../src/api/subscription.js";

const DAY = 86400000;
const now = new Date(2026, 9, 1, 12).getTime();
const warning = (offset) =>
  subscriptionWarning(new Date(now + offset).toISOString(), now);

test("warning appears only in the final 72 hours with day-appropriate text", () => {
  assert.equal(warning(3 * DAY + 1), "");
  assert.equal(warning(4 * DAY), "");
  assert.equal(
    warning(3 * DAY),
    "Subscription expires in 3 days. Renew soon to avoid interruption.",
  );
  assert.equal(
    warning(2 * DAY),
    "Subscription expires in 2 days. Renew soon to avoid interruption.",
  );
  assert.equal(
    warning(DAY),
    "Subscription expires tomorrow. Renew soon to avoid interruption.",
  );
  assert.equal(
    warning(60 * 60 * 1000),
    "Subscription expires today. Renew soon to avoid interruption.",
  );
});
test("exact expiry, past expiry and missing/invalid dates do not show a renewal countdown", () => {
  assert.equal(warning(0), "");
  assert.equal(warning(-1), "");
  assert.equal(subscriptionWarning(null, now), "");
  assert.equal(subscriptionWarning("invalid", now), "");
});
test("local midnight changes today/tomorrow without changing the exact expiry boundary", () => {
  const beforeMidnight = new Date(2026, 9, 1, 23, 59, 59).getTime();
  const expiry = new Date(2026, 9, 2, 0, 1).toISOString();
  assert.match(subscriptionWarning(expiry, beforeMidnight), /tomorrow/);
  assert.match(subscriptionWarning(expiry, beforeMidnight + 1000), /today/);
  assert.equal(subscriptionWarning(expiry, new Date(expiry).getTime()), "");
});
test("DST boundaries use local calendar dates while the warning window remains 72 hours", () => {
  const previous = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    for (const [month, day] of [
      [2, 7],
      [9, 31],
    ]) {
      const start = new Date(2026, month, day, 12).getTime();
      const expiry = new Date(2026, month, day + 1, 12).toISOString();
      assert.match(subscriptionWarning(expiry, start), /tomorrow/);
      assert.equal(
        subscriptionWarning(new Date(start + 3 * DAY + 1).toISOString(), start),
        "",
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
