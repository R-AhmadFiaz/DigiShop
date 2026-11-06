import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
try {
  const { default: Receipt, receiptFrom } = await server.ssrLoadModule("/src/components/Receipt.jsx");
  const order = { type: "INVOICE", invoiceNo: "INV-1", items: [], createdByName: "ali", totalPrice: 50, paidAmount: 50, amountDue: 0 };
  const render = (value) => renderToStaticMarkup(createElement(Receipt, { receipt: receiptFrom(value) }));
  await test("immediate and reopened invoices display historical seller without viewer identity", () => {
    assert.match(render(order), /Sold by: Ali/);
    assert.match(render(JSON.parse(JSON.stringify(order))), /Sold by: Ali/);
    assert.doesNotMatch(render(order), /Sold by: Owner/);
  });
  await test("quotation displays creator and converted invoice displays converter", () => {
    assert.match(render({ ...order, type: "QUOTATION", createdByName: "owner" }), /Created by: Owner/);
    assert.match(render(order), /Sold by: Ali/);
  });
  await test("missing or empty creator name displays Unavailable", () => {
    for (const createdByName of [undefined, "", "   "]) assert.match(render({ ...order, createdByName }), /Sold by: Unavailable/);
  });
  await test("revision receipt retains item snapshots and separate cash/credit settlement", () => {
    const value = { ...order, revision: 2, returnState: "FULL", items: [{ name: "Original cable", brand: "Original brand", unit: "meter", quantity: 1, unitPrice: 50, productId: { name: "Renamed product", brand: "Changed", unit: "box" } }], settlementState: { cashNetMinor: 2000, creditNetMinor: 3000 } };
    const html = render(value);
    assert.match(html, /Original cable/); assert.doesNotMatch(html, /Renamed product/);
    assert.match(html, /Fully returned/); assert.match(html, /Net cash settlement/);
    assert.match(html, /Net store-credit settlement/); assert.match(html, /Sold by: Ali/);
  });
} finally { await server.close(); }
