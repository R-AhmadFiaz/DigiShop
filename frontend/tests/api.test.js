import assert from "node:assert/strict";
import test from "node:test";
import {
  api,
  query,
  setSessionExpiredHandler,
  setShopDeactivatedHandler,
  SHOP_DEACTIVATED_MESSAGE,
} from "../src/api/client.js";
const originalFetch = globalThis.fetch;
test("manual deactivation signals blocked state without refresh or retry; subscription expiry does not", async () => {
  let blocked = 0,
    calls = 0;
  setShopDeactivatedHandler(() => blocked++);
  try {
    for (const message of [
      SHOP_DEACTIVATED_MESSAGE,
      "Subscription expired or inactive",
    ]) {
      globalThis.fetch = async () => {
        calls++;
        return response(403, { message });
      };
      await assert.rejects(api("/products/search-product"));
    }
    assert.equal(blocked, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    setShopDeactivatedHandler(() => {});
  }
});
test("deactivation on the single authenticated retry also signals blocked state", async () => {
  let blocked = 0,
    calls = 0,
    refreshed = false;
  setShopDeactivatedHandler(() => blocked++);
  globalThis.fetch = async (url) => {
    calls++;
    if (url.endsWith("/refresh-token")) {
      refreshed = true;
      return response(200, { data: {} });
    }
    return refreshed
      ? response(403, { message: SHOP_DEACTIVATED_MESSAGE })
      : response(401, { message: "Access token expired" });
  };
  try {
    await assert.rejects(api("/products/search-product"));
    assert.equal(calls, 3);
    assert.equal(blocked, 1);
  } finally {
    globalThis.fetch = originalFetch;
    setShopDeactivatedHandler(() => {});
  }
});
function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
test("cookie requests share one refresh and retry once", async () => {
  const calls = [];
  let refreshed = false;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.credentials, "include");
    if (url.endsWith("/refresh-token")) {
      await new Promise((r) => setTimeout(r, 10));
      refreshed = true;
      return response(200, {
        data: { user: { refreshToken: "must-not-store" } },
      });
    }
    return refreshed
      ? response(200, { data: { value: "ok" }, messege: "Success" })
      : response(401, { message: "Access token expired" });
  };
  try {
    const results = await Promise.all([
      api("/products/search-product"),
      api("/customers/"),
    ]);
    assert.equal(results[0].value, "ok");
    assert.equal(
      calls.filter((c) => c.url.endsWith("/refresh-token")).length,
      1,
    );
    assert.equal(calls.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("missing access cookie during initialization refreshes successfully", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return url.endsWith("/refresh-token")
      ? response(200, { data: {} })
      : calls === 1
        ? response(400, { message: "Token is not provided" })
        : response(200, { data: { user: { role: "CASHIER" } } });
  };
  try {
    assert.equal(
      (await api("/users/current-user", { method: "POST" })).user.role,
      "CASHIER",
    );
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("refresh failure ends session without replaying sale", async () => {
  let expired = 0,
    calls = 0;
  setSessionExpiredHandler(() => expired++);
  globalThis.fetch = async (url) => {
    calls++;
    return response(url.endsWith("/refresh-token") ? 500 : 401, {
      message: "Access token expired",
    });
  };
  try {
    await assert.rejects(
      api("/orders/create-order", { method: "POST", body: { items: [] } }),
      /session has ended/,
    );
    assert.equal(expired, 1);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    setSessionExpiredHandler(() => {});
  }
});
test("ordinary authorization, wrong password and network errors never replay writes", async () => {
  for (const [status, message] of [
    [403, "Owner access required"],
    [401, "password is incorrect"],
  ]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return response(status, { message });
    };
    await assert.rejects(
      api("/users/change-password", { method: "POST", body: {} }),
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new TypeError("Offline");
  };
  try {
    await assert.rejects(
      api("/orders/create-order", { method: "POST", body: {} }),
      /Cannot confirm/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("FormData boundary stays browser-managed and response errors remain readable", async () => {
  const body = new FormData();
  body.append("avatar", new Blob(["image"]), "photo.png");
  globalThis.fetch = async (_, options) => {
    assert.equal(options.body, body);
    assert.equal(options.headers.has("Content-Type"), false);
    return response(201, { data: { cashier: { username: "counter" } } });
  };
  try {
    assert.equal(
      (await api("/users/register-staff", { method: "POST", body })).cashier
        .username,
      "counter",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(
    query({ search: "Wire & Cable", page: 2, category: "" }),
    "?search=Wire+%26+Cable&page=2",
  );
});
test("invoice errors are classified for the operation that failed", async () => {
  globalThis.fetch = async () => response(409, {
    message: "Customer debt history requires verified reconciliation",
  });
  try {
    await assert.rejects(
      api("/orders/012345678901234567890123/adjustments/preview", { method: "POST", body: {} }),
      error => {
        assert.match(error.message, /payment or customer balance records need review/i);
        assert.doesNotMatch(error.message, /cannot be cancelled/i);
        return true;
      },
    );
    await assert.rejects(
      api("/orders/012345678901234567890123/cancellations/preview", { method: "POST", body: {} }),
      /cannot be cancelled safely/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test("adjustment stock and stale-revision failures have distinct guidance", async () => {
  for (const [message, expected] of [
    ["Product missing or insufficient sellable stock", /available stock changed/i],
    ["Invoice changed; reload before adjusting", /invoice changed while you were editing/i],
  ]) {
    globalThis.fetch = async () => response(409, { message });
    try {
      await assert.rejects(
        api("/orders/012345678901234567890123/adjustments/preview", { method: "POST", body: {} }),
        expected,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});
test("an interrupted or unreadable sale response is never replayed", async () => {
  for (const result of [
    {
      ok: true,
      text: async () => {
        throw new TypeError("Connection reset");
      },
    },
    new Response("<html>Proxy response</html>", { status: 200 }),
    new Response("{}", { status: 200 }),
    new Response("null", { status: 200 }),
  ]) {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return result;
    };
    try {
      await assert.rejects(
        api("/orders/create-order", { method: "POST", body: {} }),
        /Cannot confirm/,
      );
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
});
test("a second authentication failure ends the session after exactly one retry", async () => {
  let calls = 0,
    expired = 0;
  setSessionExpiredHandler(() => expired++);
  globalThis.fetch = async (url) => {
    calls++;
    return url.endsWith("/refresh-token")
      ? response(200, { data: {} })
      : response(401, { message: "Access token expired" });
  };
  try {
    await assert.rejects(api("/customers/"));
    assert.equal(calls, 3);
    assert.equal(expired, 1);
  } finally {
    globalThis.fetch = originalFetch;
    setSessionExpiredHandler(() => {});
  }
});
