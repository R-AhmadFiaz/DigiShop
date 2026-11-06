import assert from "node:assert/strict";
import test from "node:test";
import {
  api,
  setSubscriptionBlockedHandler,
  setShopDeactivatedHandler,
} from "../src/api/client.js";
import {
  subscriptionPayment,
  paymentPrice,
  paymentProofLink,
} from "../src/config/subscriptionPayment.js";

test("payment receiving details and WhatsApp text come from one public configuration", () => {
  assert.equal(paymentPrice(), "PKR 8,000");
  assert.equal(subscriptionPayment.durationDays, 30);
  assert.equal(subscriptionPayment.bankName, "Meezan Bank");
  assert.equal(subscriptionPayment.accountTitle, "RANA AHMAD FIAZ");
  assert.equal(subscriptionPayment.accountNumber, "00300111791703");
  assert.equal(subscriptionPayment.qrAsset, "/subscription-payment-qr.jpg");
  const link = new URL(paymentProofLink());
  assert.equal(link.origin, "https://wa.me");
  assert.equal(link.pathname, "/923004061677");
  assert.equal(
    link.searchParams.get("text"),
    "Hello, I have paid PKR 8,000 for my shop subscription. Shop Name:",
  );
});

test("subscription rejection signals its own blocked state without refresh or replay", async () => {
  const original = globalThis.fetch;
  let subscription = 0,
    manual = 0,
    calls = 0;
  setSubscriptionBlockedHandler(() => subscription++);
  setShopDeactivatedHandler(() => manual++);
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      JSON.stringify({ message: "Subscription expired or inactive" }),
      { status: 403 },
    );
  };
  try {
    await assert.rejects(
      api("/orders/create-order", { method: "POST", body: {} }),
    );
    assert.equal(subscription, 1);
    assert.equal(manual, 0);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
    setSubscriptionBlockedHandler(() => {});
    setShopDeactivatedHandler(() => {});
  }
});

test("subscription rejection after the single refresh retry also blocks", async () => {
  const original = globalThis.fetch;
  let blocked = 0,
    refreshed = false,
    calls = 0;
  setSubscriptionBlockedHandler(() => blocked++);
  globalThis.fetch = async (url) => {
    calls++;
    if (url.endsWith("/refresh-token")) {
      refreshed = true;
      return new Response(JSON.stringify({ data: {} }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        message: refreshed
          ? "Subscription expired or inactive"
          : "Access token expired",
      }),
      { status: refreshed ? 403 : 401 },
    );
  };
  try {
    await assert.rejects(
      api("/orders/create-order", { method: "POST", body: {} }),
    );
    assert.equal(blocked, 1);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = original;
    setSubscriptionBlockedHandler(() => {});
  }
});
