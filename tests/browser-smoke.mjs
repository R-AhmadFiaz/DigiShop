let nextSubscriptionFailure = false;
let ownerDisplayName = "owner";
// Optional browser smoke test. Requires installed Chrome and a frontend at localhost:5173.
// Authenticated workflows use isolated contract responses. The final anonymous check contacts the live backend without modifying shop records.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = path.resolve("node_modules/.cache/store-browser");
fs.mkdirSync(profile, { recursive: true });
const chrome = spawn(
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=9223",
    "--user-data-dir=" + profile,
    "about:blank",
  ],
  { windowsHide: true, stdio: "ignore" },
);
let socket;
const pending = new Map();
let sequence = 0,
  role = null;
let expireAccess = false,
  failRefresh = false,
  nextFailure = null;
const calls = [],
  errors = [],
  liveResponses = [];
const product = {
  _id: "product-one",
  name: "Copper Cable",
  brand: "Local Wire",
  category: { _id: "category-one", name: "Wiring" },
  unit: "meter",
  costPrice: 30,
  retailPrice: 50,
  wholesalePrice: 40,
  stockQuantity: 20,
  minStockThreshold: 5,
};
const customer = {
  _id: "customer-one",
  name: "Ali",
  phoneNo: "03001234567",
  address: "Market",
  remainingMoney: 10,
};
let invoice = {
  _id: "invoice-one",
  type: "INVOICE",
  invoiceNo: "INV-1",
  createdByName: "ali",
  items: [{ productId: product._id, quantity: 1, unitPrice: 50 }],
  subtotal: 50,
  discountAmount: 0,
  totalPrice: 50,
  paidAmount: 50,
  amountDue: 0,
  saleType: "RETAIL",
  status: "PENDING",
  createdAt: new Date().toISOString(),
};
let quotation;
const stockLogs = [];
const shops = [
  {
    _id: "shop-one",
    name: "Hardware Shop",
    ownerId: { username: "owner", email: "owner@example.test" },
    contactNo: "03001234567",
    address: "Market",
    subscriptionActive: false,
    subscriptionExpiry: null,
  },
];
function send(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function mock(event) {
  const request = event.request,
    url = new URL(request.url),
    endpoint = url.pathname.replace("/api/v2", "");
  calls.push({
    role,
    method: request.method,
    endpoint,
    query: url.search,
    body: request.postData,
  });
  let status = 200,
    data = {},
    message = "";
  const body = request.postData?.startsWith("{")
    ? JSON.parse(request.postData)
    : {};
  if (request.method === "OPTIONS") status = 204;
  else if (nextSubscriptionFailure && endpoint === "/categories/") {
    status = 403;
    message = "Subscription expired or inactive";
  } else if (nextFailure === endpoint) {
    nextFailure = null;
    status = 403;
    message = "Subscription inactive";
  } else if (endpoint === "/users/current-user" && expireAccess) {
    status = 401;
    message = "Access token expired";
  } else if (
    role &&
    role !== "ADMIN" &&
    shops[0].isActive === false &&
    (!endpoint.startsWith("/users/") || endpoint === "/users/register-staff")
  ) {
    status = 403;
    message = "Shop has been deactivated. Contact administrator.";
  } else if (endpoint === "/users/current-user") {
    if (role)
      data = {
        shopActive: role === "ADMIN" || shops[0].isActive !== false,
        ...(role !== "ADMIN" ? { shopName: shops[0].name, shopAddress: shops[0].address, shopContactNo: shops[0].contactNo } : {}),
        ...(role === "OWNER"
          ? { subscriptionExpiry: shops[0].subscriptionExpiry }
          : {}),
        user: {
          username:
            role === "OWNER"
              ? ownerDisplayName
              : role === "CASHIER"
                ? "ali"
                : role.toLowerCase(),
          email: "counter@example.test",
          role,
        },
      };
    else {
      status = 400;
      message = "Token is not provided";
    }
  } else if (endpoint === "/users/refresh-token") {
    if (role && !failRefresh) expireAccess = false;
    else {
      status = 400;
      message = "Could not recieve Refresh Token";
    }
  } else if (endpoint === "/users/login") {
    role = (body.username || "").toUpperCase();
    data = {
      shopActive: role === "ADMIN" || shops[0].isActive !== false,
      ...(role !== "ADMIN" ? { shopName: shops[0].name, shopAddress: shops[0].address, shopContactNo: shops[0].contactNo } : {}),
      ...(role === "OWNER"
        ? { subscriptionExpiry: shops[0].subscriptionExpiry }
        : {}),
      user: {
        username: role === "CASHIER" ? "ali" : body.username,
        role,
        email: "counter@example.test",
      },
    };
  } else if (endpoint === "/users/register") {
    role = "OWNER";
    data = {
      username: "registered",
      email: "registered@example.test",
      role,
      shopName: "Registered shop",
    };
  } else if (endpoint === "/users/logout") {
    role = null;
  } else if (endpoint === "/products/search-product") {
    data = {
      product: [
        role === "CASHIER"
          ? Object.fromEntries(
              Object.entries(product).filter(([k]) => k !== "costPrice"),
            )
          : product,
      ],
    };
  } else if (endpoint === "/products/low-stock")
    data = {
      counts: product.stockQuantity <= product.minStockThreshold ? 1 : 0,
      Products:
        product.stockQuantity <= product.minStockThreshold ? [product] : [],
    };
  else if (endpoint === "/categories/")
    data = { categories: [product.category] };
  else if (endpoint === "/customers/")
    data = {
      customers: [customer],
      pagination: { currentPage: 1, totalPages: 1 },
    };
  else if (endpoint === "/customers/create-customer") {
    await sleep(250);
    data = { customer: { ...customer, ...body } };
  } else if (endpoint === "/orders/create-order") {
    assert.ok(["NONE", "FIXED", "PERCENTAGE"].includes(body.discountType));
    assert.ok(Number.isFinite(body.paidAmount));
    invoice = {
      ...invoice,
      items: body.items.map((item) => ({
        ...item,
        unitPrice: body.saleType === "WHOLESALE" ? 40 : 50,
      })),
      saleType: body.saleType,
      subtotal: body.items.reduce(
        (sum, i) =>
          sum + i.quantity * (body.saleType === "WHOLESALE" ? 40 : 50),
        0,
      ),
      createdByName: role === "CASHIER" ? "ali" : ownerDisplayName,
      paidAmount: body.paidAmount,
      customerId: body.customerId,
    };
    invoice.discountAmount =
      body.discountType === "FIXED"
        ? body.discountValue
        : body.discountType === "PERCENTAGE"
          ? (invoice.subtotal * body.discountValue) / 100
          : 0;
    invoice.totalPrice = invoice.subtotal - invoice.discountAmount;
    invoice.amountDue = invoice.totalPrice - invoice.paidAmount;
    data = invoice;
  } else if (endpoint === "/orders/")
    data = { orders: [invoice], pagination: { currentPage: 1, totalPages: 1 } };
  else if (endpoint === "/orders/" + invoice._id)
    data = {
      order: {
        ...invoice,
        items: invoice.items.map((item) => ({ ...item, productId: product })),
        customerId: invoice.customerId ? customer : null,
      },
    };
  else if (endpoint === "/orders/" + invoice._id + "/cancel") {
    invoice.status = "CANCELLED";
    data = { orderInDb: invoice };
  } else if (endpoint === "/orders/" + invoice._id + "/status") {
    invoice.status = "DELIVERED";
    data = invoice;
  } else if (endpoint === "/orders/quotation") {
    quotation = {
      ...invoice,
      _id: "quote-one",
      type: "QUOTATION",
      createdByName: role === "CASHIER" ? "ali" : ownerDisplayName,
      invoiceNo: "",
      status: "DRAFT",
      paidAmount: 0,
      amountDue: 0,
    };
    data = { quotation };
  } else if (endpoint === "/orders/quote-one") {
    invoice = {
      ...quotation,
      _id: "invoice-two",
      type: "INVOICE",
      invoiceNo: "INV-2",
      status: "PENDING",
      paidAmount: body.paidAmount,
      amountDue: quotation.totalPrice - body.paidAmount,
    };
    data = { createOrder: invoice };
  } else if (endpoint === "/orders/stocklogs")
    data = {
      logs: stockLogs,
      pagination: {
        currentPage: Number(url.searchParams.get("page") || 1),
        totalPages: 2,
      },
    };
  else if (endpoint.endsWith("/adjust-stock")) {
    product.stockQuantity += body.quantityDelta;
    stockLogs.push({
      _id: "log-" + stockLogs.length,
      productId: product,
      quantityDelta: body.quantityDelta,
      reason: body.reason,
      createdAt: new Date().toISOString(),
    });
    data = { updatestock: product, stockLog: [] };
  } else if (endpoint === "/products/create-product") {
    data = { product: { ...product, ...body, _id: "new-product" } };
  } else if (endpoint === "/products/product-one") {
    Object.assign(product, body);
    data = { updatedProduct: product };
  } else if (endpoint === "/categories/create-category")
    data = { category: { ...body, _id: "new-category" } };
  else if (endpoint === "/users/register-staff")
    data = { cashier: { username: "newcounter" } };
  else if (endpoint === "/ai/query") {
    await sleep(300);
    data = { action: "checkStock", question: body.text || "Copper cable stock", answer: "Copper Cable has 20 meters in stock.", data: [] };
  }
  else if (endpoint === "/users/change-password") data = {};
  else if (endpoint === "/admin/shops") data = { shops };
  else if (
    /^\/admin\/shops\/[^/]+\/(activate|extend|deactivate|reactivate)$/.test(
      endpoint,
    )
  ) {
    const parts = endpoint.split("/"),
      target = shops.find((shop) => shop._id === parts[3]),
      action = parts[4];
    if (action === "deactivate" || action === "reactivate")
      target.isActive = action === "reactivate";
    else {
      const base =
        action === "extend"
          ? Math.max(
              Date.now(),
              new Date(target.subscriptionExpiry || 0).getTime(),
            )
          : Date.now();
      target.subscriptionActive = true;
      target.subscriptionExpiry = new Date(base + 2592000000).toISOString();
    }
    data = { shop: { ...target, ownerId: "unpopulated-owner" } };
  } else {
    status = 404;
    message = "Unknown test endpoint";
  }
  await send("Fetch.fulfillRequest", {
    requestId: event.requestId,
    responseCode: status,
    responseHeaders: [
      { name: "Content-Type", value: "application/json" },
      { name: "Access-Control-Allow-Origin", value: "http://localhost:5173" },
      { name: "Access-Control-Allow-Credentials", value: "true" },
      { name: "Access-Control-Allow-Headers", value: "Content-Type" },
      { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,OPTIONS" },
    ],
    body:
      status === 204
        ? ""
        : Buffer.from(
            JSON.stringify(
              status >= 400 ? { message } : { data, messege: "OK" },
            ),
          ).toString("base64"),
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (result.exceptionDetails)
    throw Error(
      result.exceptionDetails.text +
        " " +
        JSON.stringify(result.exceptionDetails.exception),
    );
  return result.result.value;
}
async function wait(expression) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(expression)) return;
    await sleep(80);
  }
  throw Error(
    "Timed out: " +
      expression +
      "\n" +
      (await evaluate("document.body.innerText")),
  );
}
async function assertReceiptShop() {
  const identity = await evaluate(`(() => {
    const header = document.querySelector(".receipt").firstElementChild;
    return {
      name: header.querySelector("h2")?.textContent,
      details: [...header.querySelectorAll("p")].map(p => p.textContent),
      visible: getComputedStyle(header).visibility,
      isShopHeader: header.classList.contains("receipt-shop")
    };
  })()`);
  assert.deepEqual(identity, {
    name: shops[0].name,
    details: [shops[0].address, "Phone: " + shops[0].contactNo],
    visible: "visible",
    isShopHeader: true,
  });
}
const click = async (text) => {
  await wait(
    '(()=>{const el=[...document.querySelectorAll("button,a")].find(e=>e.textContent.trim()===' +
      JSON.stringify(text) +
      "&&e.getClientRects().length&&!e.disabled);if(!el)return false;el.click();return true;})()",
  );
};
const fill = async (selector, value) => {
  await wait("!!document.querySelector(" + JSON.stringify(selector) + ")");
  return evaluate(
    "(()=>{const el=document.querySelector(" +
      JSON.stringify(selector) +
      ');const proto=el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,"value").set.call(el,' +
      JSON.stringify(value) +
      ');el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
};
async function fillLabel(label, value) {
  const selector = await evaluate(
    '(()=>{const el=[...document.querySelectorAll("label")].find(e=>e.textContent.trim().startsWith(' +
      JSON.stringify(label) +
      '));const input=el.querySelector("input");input.id="smoke-field";return "#smoke-field";})()',
  );
  await fill(selector, value);
  await evaluate(
    'document.querySelector("#smoke-field").removeAttribute("id")',
  );
}
async function screenshot(name) {
  fs.mkdirSync("tests/artifacts", { recursive: true });
  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(
    "tests/artifacts/" + name + ".png",
    Buffer.from(shot.data, "base64"),
  );
}
async function login(as) {
  await wait('!!document.querySelector("[name=identity]")');
  await fill("[name=identity]", as.toLowerCase());
  await fill("[name=password]", "test-password");
  await click("Sign in");
  await wait('!!document.querySelector(".sidebar")');
}
try {
  let pages;
  for (let i = 0; i < 100; i++) {
    try {
      pages = await (await fetch("http://localhost:9223/json")).json();
      break;
    } catch {
      await sleep(100);
    }
  }
  socket = new WebSocket(
    pages.find((p) => p.type === "page").webSocketDebuggerUrl,
  );
  await new Promise((resolve) =>
    socket.addEventListener("open", resolve, { once: true }),
  );
  socket.addEventListener("message", async (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const promise = pending.get(message.id);
      if (promise) {
        pending.delete(message.id);
        message.error
          ? promise.reject(Error(message.error.message))
          : promise.resolve(message.result);
      }
    } else if (message.method === "Fetch.requestPaused") {
      try {
        await mock(message.params);
      } catch (error) {
        // Route changes abort GETs; Chrome can discard their interception first.
        if (/Invalid InterceptionId/i.test(error.message)) return;
        errors.push(error.message);
        try {
          await send("Fetch.failRequest", {
            requestId: message.params.requestId,
            errorReason: "Failed",
          });
        } catch (failure) {
          if (!/Invalid InterceptionId/i.test(failure.message))
            errors.push(failure.message);
        }
      }
    } else if (message.method === "Network.responseReceived") {
      if (
        message.params.response.url.startsWith("http://localhost:3000/api/v2/")
      )
        liveResponses.push(message.params.response);
    } else if (message.method === "Runtime.exceptionThrown")
      errors.push(message.params.exceptionDetails.text);
    else if (
      message.method === "Runtime.consoleAPICalled" &&
      message.params.type === "error"
    )
      errors.push(message.params.args.map((a) => a.value).join(" "));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Fetch.enable", {
    patterns: [{ urlPattern: "http://localhost:3000/api/v2/*" }],
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Page.navigate", { url: "http://localhost:5173" });
  await login("CASHIER");
  await wait('!!document.querySelector(".product-result")');
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll(".sidebar nav a")].map(e=>e.textContent)',
    ),
    ["POS", "Customers", "Quotations", "AI Assistant"],
  );
  assert.ok(
    !(await evaluate(
      '/cost|profit|margin/i.test(document.querySelector(".workspace").innerText)',
    )),
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".cashier-welcome .text-body-secondary").textContent',
    ),
    "Hardware Shop",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".sidebar-account,.sidebar-identity")',
    ),
    null,
  );
  await screenshot("cashier-pos");
  assert.equal(
    await evaluate('document.querySelector(".brand-name").textContent'),
    "DigiShop",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".cashier-welcome strong").textContent',
    ),
    "Ali",
  );
  assert.equal(
    await evaluate('document.querySelector(".header-actions a").textContent'),
    "Account",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".cashier-welcome strong").textContent',
    ),
    "Ali",
  );
  assert.ok(
    !(await evaluate(
      'document.querySelector(".cashier-welcome").textContent.includes("Owner")',
    )),
  );
  expireAccess = true;
  await send("Page.reload");
  await sleep(300);
  await wait('!!document.querySelector(".product-result")');
  assert.ok(
    calls.some(
      (c) => c.role === "CASHIER" && c.endpoint === "/users/refresh-token",
    ),
  );
  await fill('[aria-label="Search products by name or brand"]', "Cable");
  await evaluate(
    `document.querySelector('[aria-label="Search products by name or brand"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`,
  );
  assert.equal(
    await evaluate('document.querySelectorAll(".cart-table .quantity").length'),
    0,
    "Stale results must not be added with Enter",
  );
  await sleep(350);
  await send("Page.navigate", { url: "http://localhost:5173/owner/products" });
  await wait(
    'location.pathname === "/cashier/pos" && !!document.querySelector(".product-result")',
  );
  await evaluate('document.querySelector(".product-result").click()');
  const paymentInput = '[...document.querySelectorAll("label")].find(e=>e.textContent.includes("Amount paid")).querySelector("input")';
  assert.equal(await evaluate(paymentInput + '.value'), "50");
  await fill('[aria-label="Quantity for Copper Cable"]', "2");
  assert.equal(await evaluate(paymentInput + '.value'), "100");
  await fillLabel("Amount paid", "");
  assert.equal(await evaluate(paymentInput + '.value'), "");
  const beforeBlankCheckout = calls.filter(c => c.endpoint === "/orders/create-order").length;
  await click("Complete sale");
  await wait('document.body.innerText.includes("Amount paid must be between zero and the sale total.")');
  assert.equal(calls.filter(c => c.endpoint === "/orders/create-order").length, beforeBlankCheckout);
  await click("Customers");
  await click("POS");
  await wait('!!document.querySelector(".cart-table .quantity")');
  assert.equal(await evaluate(paymentInput + '.value'), "", "Manual blank survives navigation");
  await fillLabel("Amount paid", "0");
  await fill('[aria-label="Quantity for Copper Cable"]', "1");
  assert.equal(await evaluate(paymentInput + '.value'), "0");
  await evaluate("window.confirm = () => false");
  await click("Customers");
  await wait('location.pathname === "/cashier/customers"');
  await click("POS");
  await wait('!!document.querySelector(".cart-table .quantity")');
  assert.equal(
    await evaluate('document.querySelector(".cart-table .quantity").value'),
    "1",
    "Counter cart survives navigation",
  );
  await fillLabel("Amount paid", "20");
  await click("Customers");
  await click("POS");
  await wait('!!document.querySelector(".cart-table .quantity")');
  assert.equal(await evaluate(paymentInput + '.value'), "20", "Manual partial payment survives navigation");
  await wait('!!document.querySelector(".customer-result")');
  await click("New customer");
  await fill("[name=name]", "New buyer");
  await fill("[name=phoneNo]", "03001234567");
  await click("Save customer");
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Complete sale").disabled',
    ),
    true,
    "Sale must wait for customer creation",
  );
  await wait('document.body.innerText.includes("New buyer")');
  assert.equal(
    calls.filter((c) => c.endpoint === "/orders/create-order").length,
    0,
    "Customer form must not submit sale",
  );
  await click("Complete sale");
  await wait('document.body.innerText.includes("Sale completed.")');
  assert.equal(invoice.paidAmount, 20);
  assert.equal(invoice.amountDue, 30);
  assert.ok(
    await evaluate(
      'document.querySelector(".receipt").innerText.includes("New buyer")',
    ),
  );
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  await screenshot("receipt");
  await send("Emulation.setEmulatedMedia", { media: "print" });
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".sidebar")).display',
    ),
    "none",
  );
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".receipt")).visibility',
    ),
    "visible",
  );
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  const printed = await send("Page.printToPDF", { printBackground: false });
  fs.writeFileSync(
    "tests/artifacts/receipt-print.pdf",
    Buffer.from(printed.data, "base64"),
  );
  assert.ok(Buffer.from(printed.data, "base64").length > 1500);
  await send("Emulation.setEmulatedMedia", { media: "" });
  await evaluate("window.print = () => { window.auditPrinted = true; }");
  await click("Print receipt");
  assert.equal(await evaluate("window.auditPrinted"), true);
  for (const [saleType, discountType, discountValue, expected] of [
    ["RETAIL", "NONE", 0, 50],
    ["WHOLESALE", "NONE", 0, 40],
    ["RETAIL", "FIXED", 10, 40],
    ["RETAIL", "PERCENTAGE", 10, 45],
  ]) {
    await click("Next sale");
    await wait('!!document.querySelector(".product-result")');
    await fill('[aria-label="Sale type"]', saleType);
    await evaluate('document.querySelector(".product-result").click()');
    await evaluate(
      'document.querySelector(".row select").id = "discount-test"',
    );
    await fill("#discount-test", discountType);
    if (discountType !== "NONE")
      await fillLabel(
        discountType === "PERCENTAGE" ? "Percent" : "Amount",
        String(discountValue),
      );
    await click("Complete sale");
    await wait('document.body.innerText.includes("Sale completed.")');
    assert.equal(invoice.totalPrice, expected);
    assert.equal(invoice.paidAmount, expected);
    assert.equal(invoice.amountDue, 0);
  }
  await click("Next sale");
  await evaluate('document.querySelector(".product-result").click()');
  await fillLabel("Amount paid", "0");
  const writesBefore = calls.filter(
    (c) => c.endpoint === "/orders/create-order",
  ).length;
  await click("Complete sale");
  await wait('document.body.innerText.includes("Select or create a customer")');
  assert.equal(
    calls.filter((c) => c.endpoint === "/orders/create-order").length,
    writesBefore,
  );
  await evaluate('document.querySelector(".customer-result").click()');
  nextFailure = "/orders/create-order";
  await click("Complete sale");
  await wait('document.body.innerText.includes("active subscription")');
  assert.ok(
    await evaluate('!!document.querySelector(".cart-table .quantity")'),
    "Rejected sales keep the cart",
  );
  await click("Complete sale");
  await wait('document.body.innerText.includes("Sale completed.")');
  await click("Customers");
  await wait('!!document.querySelector("table")');
  await fill('[aria-label="Search customer by name or phone"]', "0300");
  await sleep(350);
  assert.ok(
    calls.some(
      (c) =>
        c.role === "CASHIER" &&
        c.endpoint === "/customers/" &&
        c.query.includes("search=0300"),
    ),
  );
  await screenshot("cashier-customers");
  await click("POS");
  await wait('!!document.querySelector(".receipt")');
  await click("AI Assistant");
  await wait('document.body.innerText.includes("Speak")');
  assert.equal(await evaluate('document.querySelector("input[type=file]")'), null);
  await evaluate('navigator.mediaDevices.getUserMedia = async () => { throw new Error("Permission denied"); }');
  await click("Speak");
  await wait('document.body.innerText.includes("Microphone access was not available")');
  await fill('[aria-label="Ask about your shop"]', "How many bulbs?");
  await click("Send");
  await wait('document.body.innerText.includes("Processing...")');
  await wait('document.body.innerText.includes("Copper Cable has 20 meters")');
  assert.ok(calls.some(c=>c.endpoint==="/ai/query" && c.method==="POST" && c.body && JSON.parse(c.body).text==="How many bulbs?"));
  await fill('[aria-label="Ask about your shop"]', "Stock again?");
  await wait('document.querySelector("input[placeholder]").value === "Stock again?" && !document.querySelector("input[placeholder]").disabled');
  await evaluate('document.querySelector("input[placeholder]").focus()');
  await send("Input.dispatchKeyEvent", {type:"keyDown", key:"Enter", code:"Enter", windowsVirtualKeyCode:13, nativeVirtualKeyCode:13, text:"\r", unmodifiedText:"\r"});
  await send("Input.dispatchKeyEvent", {type:"keyUp", key:"Enter", code:"Enter", windowsVirtualKeyCode:13});
  await wait('document.querySelectorAll(".assistant-exchange").length===2');
  nextFailure = "/ai/query";
  await fill('[aria-label="Ask about your shop"]', "Stock?");
  await click("Send");
  await wait('!!document.querySelector("[role=alert]")');
  await evaluate('navigator.mediaDevices.getUserMedia = async () => { window.aiAudioContext = new AudioContext(); const destination=window.aiAudioContext.createMediaStreamDestination(); const oscillator=window.aiAudioContext.createOscillator(); oscillator.connect(destination); oscillator.start(); await window.aiAudioContext.resume(); window.aiRecordedStream=destination.stream; return destination.stream; }');
  await click("Speak");
  await wait('document.body.innerText.includes("Listening...")');
  await sleep(250);
  await click("Stop and send");
  await wait('document.querySelectorAll(".assistant-exchange").length===3');
  assert.ok(await evaluate('window.aiRecordedStream.getTracks().every(track=>track.readyState==="ended")'));
  await evaluate('window.aiAudioContext.close()');
  assert.ok(calls.some(c=>c.endpoint==="/ai/query" && c.body?.includes('name="audio"')));
  await screenshot("voice-stock");
  await click("Quotations");
  await wait('!!document.querySelector(".product-result")');
  await evaluate('document.querySelector(".product-result").click()');
  await click("Create quotation");
  await wait('document.body.innerText.includes("Quotation saved")');
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Created by: Ali")'));
  await assertReceiptShop();
  await click("Make sale");
  await wait('!!document.querySelector("dialog[open]")');
  await click("Close");
  await click("This session (1)");
  await click("Make sale");
  await wait('!!document.querySelector("dialog[open]")');
  await click("Complete sale");
  await wait('!document.querySelector("dialog[open]")');
  await wait('document.body.innerText.includes("INV-2")');
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  assert.ok(
    !calls.some(
      (c) =>
        c.role === "CASHIER" &&
        (c.endpoint === "/orders/" ||
          c.endpoint === "/orders/stocklogs" ||
          c.endpoint.startsWith("/admin/")),
    ),
  );
  await click("Account");
  await wait('!!document.querySelector("[name=oldPassword]")');
  await click("Sign out");
  await login("OWNER");
  await wait('!!document.querySelector(".owner-welcome")');
  assert.equal(
    await evaluate('document.querySelector(".owner-welcome p").textContent'),
    "Welcome, Owner",
  );
  assert.equal(
    await evaluate('document.querySelector(".owner-welcome h1").textContent'),
    "Hardware Shop",
  );
  assert.equal(
    await evaluate("document.documentElement.dataset.bsTheme"),
    "light",
  );
  assert.equal(
    await evaluate("getComputedStyle(document.body).backgroundColor"),
    "rgb(247, 250, 249)",
  );
  assert.equal(
    await evaluate(
      'getComputedStyle(document.querySelector(".panel")).backgroundColor',
    ),
    "rgb(255, 255, 255)",
  );
  await screenshot("owner-dashboard-light");
  assert.equal(
    await evaluate('document.querySelector(".header-actions a").textContent'),
    "Account",
  );
  ownerDisplayName = "rana usama fiaz";
  const previousShopName = shops[0].name;
  shops[0].name = "Rana Electric Store";
  await send("Page.reload");
  await wait(
    'document.querySelector(".owner-welcome strong")?.textContent==="Rana Usama Fiaz"',
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".owner-welcome strong").textContent',
    ),
    "Rana Usama Fiaz",
  );
  assert.equal(
    await evaluate('document.querySelector(".owner-welcome h1").textContent'),
    "Rana Electric Store",
  );
  assert.ok(!(await evaluate('document.body.innerText.includes("Your shop")')));
  assert.equal(
    await evaluate(
      'document.querySelector(".sidebar-account,.sidebar-identity")',
    ),
    null,
  );
  assert.equal(
    await evaluate(
      '[...document.querySelectorAll(".sidebar a")].some(e=>e.textContent==="Account")',
    ),
    false,
  );
  const headerBoxes = await evaluate(
    '(()=>{const name=document.querySelector(".owner-welcome p").getBoundingClientRect(), buttons=[...document.querySelectorAll(".header-actions .btn")].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,left:r.left,height:r.height};});return {name:{top:name.top,right:name.right},buttons};})()',
  );
  assert.equal(headerBoxes.buttons[0].top, headerBoxes.buttons[1].top);
  assert.equal(headerBoxes.buttons[0].height, headerBoxes.buttons[1].height);
  assert.ok(headerBoxes.buttons[0].left >= headerBoxes.name.right);
  await screenshot("owner-identity");
  shops[0].name = previousShopName;
  ownerDisplayName = "owner";
  await click("Products");
  await wait('document.body.innerText.includes("Copper Cable")');
  const frozenNow = await evaluate("new Date(2026,9,1,12).getTime()");
  const clockScript = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "Date.now = () => " + frozenNow,
  });
  for (const [days, expected] of [
    [4, ""],
    [3, "in 3 days"],
    [2, "in 2 days"],
    [1, "tomorrow"],
    [0.05, "today"],
    [-1, ""],
  ]) {
    shops[0].subscriptionExpiry = new Date(
      frozenNow + days * 86400000,
    ).toISOString();

    await send("Page.reload");
    await sleep(300);
    if (days < 0) {
      await wait('document.body.innerText.includes("Renew Subscription")');
      await wait('document.querySelector("section.panel img")?.naturalWidth>0');
      await screenshot("expired-owner-renewal-qr");
      assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
      assert.ok(
        await evaluate('document.body.innerText.includes("PKR 8,000")'),
      );
      await send("Page.bringToFront");
      await send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await send("Browser.grantPermissions", {
        origin: "http://localhost:5173",
        permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
      });
      const blockedCalls = calls.length;
      await click("Copy");
      await wait('document.body.innerText.includes("Copied")');
      assert.equal(
        calls.length,
        blockedCalls,
        "Expired Owner payment view makes no business requests",
      );
      await click("Sign out");
      await wait('!!document.querySelector("[name=identity]")');
      await fill("[name=identity]", "owner");
      await fill("[name=password]", "test-password");
      await click("Sign in");
      await wait('document.body.innerText.includes("Renew Subscription")');
      assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
      continue;
    }
    await wait('document.body.innerText.includes("Copper Cable")');
    if (expected) {
      await wait(
        'document.querySelector(".alert-warning")?.innerText.includes(' +
          JSON.stringify(expected) +
          ")",
      );
      assert.ok(
        await evaluate(
          '[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Add product"&&!e.disabled)',
        ),
        "Warning must not block owner actions",
      );
    } else
      assert.equal(
        await evaluate('document.querySelector(".alert-warning")'),
        null,
      );
  }
  await send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: clockScript.identifier,
  });
  shops[0].subscriptionExpiry = new Date(
    Date.now() + 2 * 86400000,
  ).toISOString();
  await send("Page.reload");
  await sleep(300);
  await wait(
    'document.querySelector(".alert-warning")?.innerText.includes("in 2 days")',
  );
  await screenshot("owner-subscription-warning");
  const paymentCallsStart = calls.length,
    expiryBeforePayment = shops[0].subscriptionExpiry;
  await click("Renew Subscription");
  await wait('location.pathname==="/owner/renew"');
  for (const text of [
    "PKR 8,000",
    "30 Days",
    "Meezan Bank",
    "RANA AHMAD FIAZ",
    "00300111791703",
    "Shop Name",
  ])
    assert.ok(
      await evaluate(
        "document.body.innerText.includes(" + JSON.stringify(text) + ")",
      ),
    );
  const paymentLink = new URL(
    await evaluate(
      '[...document.querySelectorAll("a")].find(e=>e.textContent==="Send Payment Proof on WhatsApp").href',
    ),
  );
  assert.equal(paymentLink.pathname, "/923004061677");
  assert.ok(paymentLink.searchParams.get("text").includes("Shop Name:"));
  await send("Browser.grantPermissions", {
    origin: "http://localhost:5173",
    permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"],
  });
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await click("Copy");
  await wait('document.body.innerText.includes("Copied")');
  assert.equal(
    await evaluate("navigator.clipboard.readText()"),
    "00300111791703",
  );
  assert.ok(fs.existsSync("public/subscription-payment-qr.jpg"));
  await wait('document.querySelector("section.panel img")?.naturalWidth>0');
  await evaluate(
    '[...document.querySelectorAll("a")].find(e=>e.textContent==="Send Payment Proof on WhatsApp").addEventListener("click", e=>e.preventDefault(), {once:true})',
  );
  await click("Send Payment Proof on WhatsApp");
  assert.equal(shops[0].subscriptionExpiry, expiryBeforePayment);
  assert.equal(
    calls.length,
    paymentCallsStart,
    "Payment view and Copy make no API requests",
  );
  await screenshot("owner-renewal");

  await click("Sign out");
  await login("CASHIER");
  await wait('!!document.querySelector(".product-result")');
  assert.equal(
    await evaluate('document.querySelector(".alert-warning")'),
    null,
    "Cashier POS has no renewal warning",
  );
  await click("Sign out");
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  for (const [id, name, days, manual, owner, contact] of [
    ["expired", "Expired Electrical", -1, true, "renewowner", "111222"],
    ["soon", "Soon Hardware", 2, true, "soonowner", "333444"],
    ["healthy", "Healthy Electrical", 18, false, "healthyowner", "555666"],
  ])
    shops.push({
      _id: id,
      name,
      contactNo: contact,
      ownerId: { username: owner, email: owner + "@example.test" },
      isActive: manual,
      subscriptionActive: true,
      subscriptionExpiry: new Date(Date.now() + days * 86400000).toISOString(),
    });
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  await login("ADMIN");
  await wait('document.body.innerText.includes("Hardware Shop")');
  assert.equal(
    await evaluate('document.querySelector(".alert-warning")'),
    null,
    "Admin has no renewal warning",
  );
  await click("Sign out");
  shops[0].subscriptionExpiry = new Date(
    Date.now() + 30 * 86400000,
  ).toISOString();
  await login("OWNER");
  await click("Products");
  await wait('document.body.innerText.includes("Copper Cable")');
  assert.ok(await evaluate('document.body.innerText.includes("Cost")'));
  await screenshot("owner-products");
  await click("Categories");
  await fill('[aria-label="New category name"]', "Switches");
  await click("Add category");
  await wait('document.body.innerText.includes("Category added.")');
  await fill('[aria-label="Category filter"]', "category-one");
  await sleep(350);
  assert.ok(
    calls.some(
      (c) => c.role === "OWNER" && c.query.includes("category=category-one"),
    ),
  );
  await click("Add product");
  await wait('!!document.querySelector("dialog[open]")');
  await fill("dialog [name=name]", "Switch");
  await fill("dialog [name=brand]", "Local");
  await fill("dialog [name=category]", "category-one");
  await click("Save product");
  await wait('!document.querySelector("dialog[open]")');
  assert.ok(calls.some((c) => c.endpoint === "/products/create-product"));
  await click("Edit");
  await wait('!!document.querySelector("dialog[open]")');
  await fill("[name=retailPrice]", "55");
  await click("Save product");
  await wait('!document.querySelector("dialog[open]")');
  assert.equal(product.retailPrice, 55);
  await click("Stock");
  await wait('document.body.innerText.includes("Copper Cable")');
  await click("Adjust");
  await fill("[name=quantityDelta]", "5");
  await fill("[name=reason]", "Delivery");
  await click("Save adjustment");
  await wait('!document.querySelector("dialog[open]")');
  assert.equal(product.stockQuantity, 25);
  await click("Adjust");
  await fill("[name=quantityDelta]", "-22");
  await fill("[name=reason]", "Damaged goods");
  await click("Save adjustment");
  await wait('!document.querySelector("dialog[open]")');
  await wait('document.body.innerText.includes("Low stock")');
  await evaluate('document.querySelector("input[type=checkbox]").click()');
  await wait('document.body.innerText.includes("Copper Cable")');
  await screenshot("owner-stock");
  await click("Sales");
  await click("Invoice history");
  await wait('document.body.innerText.includes("INV-2")');
  await fill('[aria-label="Search invoice number"]', "INV-2");
  await sleep(350);
  assert.ok(
    calls.some(
      (c) =>
        c.role === "OWNER" &&
        c.endpoint === "/orders/" &&
        c.query.includes("search=INV-2"),
    ),
  );
  await click("INV-2");
  await wait('!!document.querySelector(".receipt")');
  await send("Page.reload");
  await sleep(300);
  await wait('!!document.querySelector(".receipt")');
  assert.ok(await evaluate('location.pathname.includes("invoice-two")'));
  assert.ok(await evaluate('document.querySelector(".receipt").innerText.includes("Sold by: Ali")'));
  await assertReceiptShop();
  await click("Cancel invoice");
  await click("Confirm cancellation");
  await wait('document.body.innerText.includes("Status: cancelled")');
  assert.equal(invoice.status, "CANCELLED");
  await click("Back to sales");
  await wait(
    `!!document.querySelector('[aria-label="Search invoice number"]')`,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[aria-label="Search invoice number"]').value`,
    ),
    "INV-2",
  );
  invoice.status = "PENDING";
  await click("INV-2");
  await wait('document.body.innerText.includes("Status: pending")');
  await click("Mark delivered");
  await wait('document.body.innerText.includes("Status: delivered")');
  assert.ok(
    !(await evaluate(
      '[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Cancel invoice")',
    )),
  );
  await click("Back to sales");
  await click("Create Cashier");
  await fill("[name=username]", "newcounter");
  await fill("[name=email]", "newcounter@example.test");
  await fill("[name=password]", "new-password");
  await evaluate(
    '(()=>{const input=document.querySelector("input[type=file]");const dt=new DataTransfer();dt.items.add(new File(["image"],"avatar.png",{type:"image/png"}));input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  await click("Create cashier account");
  await wait('document.body.innerText.includes("Cashier account created")');
  await click("Stock");
  await click("Stock history");
  await wait('document.body.innerText.includes("Damaged goods")');
  await fill("[name=productId]", "product-one");
  await fill("[name=startDate]", "2026-10-02");
  await fill("[name=endDate]", "2026-10-01");
  await click("Filter");
  await wait(
    'document.body.innerText.includes("end date must be on or after")',
  );
  await fill("[name=startDate]", "2000-01-01");
  await fill("[name=endDate]", "2100-01-01");
  await click("Filter");
  await wait('document.body.innerText.includes("Damaged goods")');
  await click("Next");
  await wait('document.body.innerText.includes("Page 2 of 2")');
  assert.ok(
    calls.some(
      (c) =>
        c.endpoint === "/orders/stocklogs" &&
        c.query.includes("productId=product-one") &&
        c.query.includes("startDate=") &&
        c.query.includes("page=2"),
    ),
  );
  await screenshot("stock-history");
  await click("Customers");
  await wait('document.body.innerText.includes("Customer balance")');
  await click("AI Assistant");
  await wait('document.body.innerText.includes("Speak")');
  await fill('[aria-label="Ask about your shop"]', "How many bulbs?");
  await click("Send");
  await wait('document.body.innerText.includes("Copper Cable has 20 meters")');
  await click("Quotations");
  await wait('document.body.innerText.includes("New quotation")');
  await click("Account");
  await fill("[name=oldPassword]", "test-password");
  await fill("[name=newPassword]", "changed-password");
  await fill("[name=confirm]", "changed-password");
  await click("Change password");
  await wait('document.body.innerText.includes("Password changed.")');
  await click("Sign out");
  shops[0].subscriptionExpiry = null;
  shops[0].subscriptionActive = false;
  await login("ADMIN");
  await wait('document.body.innerText.includes("Hardware Shop")');
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll(".sidebar nav a")].map(e=>e.textContent)',
    ),
    ["Shops"],
  );
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll("thead th")].map(e=>e.textContent)',
    ),
    [
      "Shop",
      "Owner",
      "Contact",
      "Manual Access",
      "Subscription",
      "Expiry",
      "Time Left",
      "Actions",
    ],
  );
  assert.deepEqual(
    await evaluate(
      '[...document.querySelectorAll("tbody tr td:first-child strong")].map(e=>e.textContent)',
    ),
    [
      "Expired Electrical",
      "Hardware Shop",
      "Soon Hardware",
      "Healthy Electrical",
    ],
  );
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("tbody tr")].find(e=>e.textContent.includes("Healthy Electrical")).textContent.includes("18 days")',
    ),
  );
  assert.ok(
    await evaluate(
      '[...document.querySelectorAll("tbody tr")].find(e=>e.textContent.includes("Healthy Electrical")).textContent.includes("Deactivated")',
    ),
  );
  for (const [term, expected] of [
    ["333444", "Soon Hardware"],
    ["healthyowner@example.test", "Healthy Electrical"],
    ["hardware shop", "Hardware Shop"],
  ]) {
    await fill('[aria-label="Search shops"]', term);
    await wait('document.querySelectorAll("tbody tr").length===1');
    assert.equal(
      await evaluate(
        'document.querySelector("tbody tr td strong").textContent',
      ),
      expected,
    );
  }
  await evaluate("window.confirm=()=>true");
  await fill('[aria-label="Search shops"]', "Expired Electrical");
  await wait('document.body.innerText.includes("Renew 30 Days")');
  const renewalStart = Date.now();
  await click("Renew 30 Days");
  await wait('document.body.innerText.includes("renewed for 30 days")');
  const renewed = shops.find((shop) => shop._id === "expired");
  assert.ok(
    new Date(renewed.subscriptionExpiry).getTime() >= renewalStart + 2592000000,
  );
  assert.ok(
    new Date(renewed.subscriptionExpiry).getTime() <= Date.now() + 2592000000,
  );
  assert.equal(renewed.isActive, true);
  assert.ok(
    await evaluate(
      'document.body.innerText.includes("renewowner@example.test")',
    ),
  );
  await fill('[aria-label="Search shops"]', "Hardware Shop");
  await wait('document.body.innerText.includes("Activate 30 Days")');
  await click("Activate 30 Days");
  await wait('document.body.innerText.includes("activated for 30 days")');
  assert.ok(
    await evaluate('document.body.innerText.includes("owner@example.test")'),
  );
  const expiryBeforeExtend = new Date(shops[0].subscriptionExpiry).getTime();
  await click("Extend 30 Days");
  await wait('document.body.innerText.includes("extended by 30 days")');
  assert.equal(
    new Date(shops[0].subscriptionExpiry).getTime(),
    expiryBeforeExtend + 2592000000,
  );
  const expiryBeforeManual = shops[0].subscriptionExpiry;
  await evaluate("window.confirm = () => false");
  await click("Deactivate");
  assert.notEqual(
    shops[0].isActive,
    false,
    "Cancelled confirmation keeps access active",
  );
  await evaluate("window.confirm = () => true");
  await click("Deactivate");
  await wait('document.body.innerText.includes("Reactivate")');
  assert.equal(shops[0].isActive, false);
  assert.equal(shops[0].subscriptionExpiry, expiryBeforeManual);
  assert.ok(
    !(await evaluate(
      '[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="Deactivate")',
    )),
  );
  await screenshot("admin-shop-deactivated");
  await click("Extend 30 Days");
  await wait(
    '!![...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="Reactivate"&&!e.disabled)',
  );
  assert.equal(shops[0].isActive, false);
  const expiryBeforeReactivate = shops[0].subscriptionExpiry;
  await click("Reactivate");
  await wait('document.body.innerText.includes("Deactivate")');
  assert.equal(shops[0].isActive, true);
  assert.equal(shops[0].subscriptionExpiry, expiryBeforeReactivate);
  await fill('[aria-label="Search shops"]', "");
  await wait('document.querySelectorAll("tbody tr").length===4');
  await screenshot("admin-shops");
  assert.equal(
    await evaluate('document.querySelector(".brand-name").textContent'),
    "DigiShop",
  );
  assert.equal(
    await evaluate('document.querySelector(".header-actions a").textContent'),
    "Account",
  );
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  assert.ok(
    await evaluate("document.documentElement.scrollWidth <= 390"),
    "Admin layout should fit a small screen outside the responsive table",
  );
  await click("Account");
  await wait('!!document.querySelector("[name=oldPassword]")');
  await send("Page.navigate", { url: "http://localhost:5173/cashier/pos" });
  await wait('location.pathname === "/admin/shops"');
  assert.ok(
    !calls.some(
      (c) =>
        c.role === "ADMIN" &&
        /^\/(products|orders|customers|categories|ai)\//.test(c.endpoint),
    ),
  );
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  await login("CASHIER");
  await wait('document.body.innerText.includes("Point of sale")');
  await send("Page.navigate", { url: "http://localhost:5173/owner/renew" });
  await wait('location.pathname==="/cashier/pos"');
  await evaluate("window.__paymentRoleCheck=true");
  nextSubscriptionFailure = true;
  await send("Page.reload");
  await wait(
    'document.body.innerText.includes("Please contact the shop owner")',
  );
  assert.ok(
    !(await evaluate('document.body.innerText.includes("Meezan Bank")')),
  );
  assert.ok(
    !(await evaluate('document.body.innerText.includes("00300111791703")')),
  );
  assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  nextSubscriptionFailure = true;
  await fill("[name=identity]", "cashier");
  await fill("[name=password]", "test-password");
  await click("Sign in");
  await wait(
    'document.body.innerText.includes("Please contact the shop owner")',
  );
  assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  nextSubscriptionFailure = false;
  for (const as of ["OWNER", "CASHIER"]) {
    const subscriptionBeforeManualBlock = shops[0].subscriptionExpiry;
    shops[0].subscriptionExpiry = new Date(Date.now() - 86400000).toISOString();
    shops[0].isActive = false;
    const beforeCalls = calls.length;
    await fill("[name=identity]", as.toLowerCase());
    await fill("[name=password]", "test-password");
    await click("Sign in");
    await wait(
      'document.body.innerText.includes("This shop has been deactivated")',
    );
    assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
    assert.ok(
      !calls
        .slice(beforeCalls)
        .some((c) =>
          /^\/(products|orders|customers|categories|ai)\//.test(c.endpoint),
        ),
      "Blocked login must not request shop data",
    );
    await send("Page.reload");
    await sleep(300);
    await wait(
      'document.body.innerText.includes("This shop has been deactivated")',
    );
    await screenshot("blocked-" + as.toLowerCase());
    await click("Sign out");
    await wait('!!document.querySelector("[name=identity]")');
    shops[0].isActive = true;
    shops[0].subscriptionExpiry = subscriptionBeforeManualBlock;
    await login(as);
    if (as === "OWNER") {
      await click("Products");
      await wait('document.body.innerText.includes("Copper Cable")');
    } else await wait('!!document.querySelector(".product-result")');
    shops[0].isActive = false;
    await click("Customers");
    await wait(
      'document.body.innerText.includes("This shop has been deactivated")',
    );
    assert.equal(await evaluate('document.querySelector(".sidebar")'), null);
    await click("Sign out");
    await wait('!!document.querySelector("[name=identity]")');
  }
  shops[0].isActive = true;
  await login("CASHIER");
  await wait('!!document.querySelector(".product-result")');
  await click("Sign out");
  await wait('!!document.querySelector("[name=identity]")');
  await click("Register your shop");
  await wait('!!document.querySelector("[name=shopName]")');
  await fill("[name=shopName]", "Registered shop");
  await fill("[name=contactNo]", "03001234567");
  await fill("[name=address]", "Market");
  await fill("[name=username]", "registered");
  await fill("[name=email]", "registered@example.test");
  await fill("[name=password]", "test-password");
  await evaluate(
    '(()=>{const input=document.querySelector("input[type=file]");const dt=new DataTransfer();dt.items.add(new File(["image"],"avatar.png",{type:"image/png"}));input.files=dt.files;input.dispatchEvent(new Event("change",{bubbles:true}));})()',
  );
  await click("Create shop");
  await wait('location.pathname === "/owner"');
  await wait(
    'document.querySelector(".owner-welcome h1")?.textContent==="Registered shop"',
  );
  expireAccess = true;
  failRefresh = true;
  await send("Page.reload");
  await sleep(300);
  await wait('location.pathname === "/login"');
  assert.deepEqual(errors, []);
  // Read-only live check: no intercepted response and no real account or shop mutation.
  liveResponses.length = 0;
  await send("Fetch.disable");
  await send("Page.reload");
  await sleep(300);
  await wait('!!document.querySelector("[name=identity]")');
  assert.equal(await evaluate("location.pathname"), "/login");
  assert.ok(
    liveResponses.some(
      (r) => r.url.endsWith("/users/current-user") && r.status === 400,
    ),
    "Live missing-cookie contract",
  );
  assert.ok(
    liveResponses.some(
      (r) => r.url.endsWith("/users/refresh-token") && r.status === 400,
    ),
    "Live missing-refresh contract",
  );
  assert.ok(
    liveResponses.every(
      (r) =>
        (r.headers["Access-Control-Allow-Origin"] ||
          r.headers["access-control-allow-origin"]) === "http://localhost:5173",
    ),
    "Live credentialed CORS origin",
  );
  console.log(
    "Browser smoke passed: all routes/roles, retail/wholesale, all discounts, full/credit payments, rejection recovery, customers, quotation conversion, category/product/stock writes, invoice reload/search/back/cancellation, staff/avatar and owner registration, AI upload/denied microphone, subscription actions, manual deactivation/reactivation and both roles blocked login/restoration/mid-session/logout/recovery, password, refresh/session expiry, owner 3-day subscription warning boundaries/role isolation, renewal payment details/clipboard/WhatsApp/no writes, expired Owner and Cashier login/restoration, printing/responsive layout. Write workflows use isolated contract responses; anonymous initialization also checked against the live backend.",
  );
} finally {
  if (socket?.readyState === 1) {
    try {
      await send("Browser.close");
    } catch {
      socket.close();
    }
  }
  chrome.kill();
}
