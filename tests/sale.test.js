import assert from "node:assert/strict";
import test from "node:test";
import { literalSearch, saleTotals, validateSale } from "../src/api/sale.js";
const cart = [
  {
    _id: "internal",
    name: "Cable",
    retailPrice: 50,
    wholesalePrice: 40,
    quantity: 2,
    stockQuantity: 10,
  },
];
test("retail/wholesale and both discounts calculate correctly", () => {
  assert.deepEqual(saleTotals(cart, "RETAIL", "NONE", 0), {
    subtotal: 100,
    discount: 0,
    total: 100,
  });
  assert.equal(saleTotals(cart, "WHOLESALE", "FIXED", 10).total, 70);
  assert.equal(saleTotals(cart, "RETAIL", "PERCENTAGE", 10).total, 90);
});
test("credit requires a customer; payment and quantity mistakes are blocked", () => {
  assert.match(validateSale(cart, "RETAIL", "NONE", 0, 40, null), /customer/);
  assert.equal(
    validateSale(cart, "RETAIL", "NONE", 0, 40, { name: "Buyer" }),
    "",
  );
  assert.match(
    validateSale(cart, "RETAIL", "NONE", 0, 101, null),
    /Amount paid/,
  );
  assert.match(
    validateSale(cart, "RETAIL", "NONE", 0, -1, null),
    /Amount paid/,
  );
  assert.match(
    validateSale(
      [{ ...cart[0], quantity: 1.5 }],
      "RETAIL",
      "NONE",
      0,
      100,
      null,
    ),
    /whole numbers/,
  );
  assert.match(
    validateSale(
      [{ ...cart[0], quantity: 11 }],
      "RETAIL",
      "NONE",
      0,
      100,
      null,
    ),
    /stock/,
  );
  assert.match(
    validateSale(cart, "RETAIL", "PERCENTAGE", 101, 100, null),
    /discount/,
  );
});
test("quotation does not require payment/customer/available stock and wholesale still needs a price", () => {
  assert.equal(
    validateSale(
      [{ ...cart[0], stockQuantity: 0 }],
      "RETAIL",
      "NONE",
      0,
      0,
      null,
      true,
    ),
    "",
  );
  assert.match(
    validateSale(
      [{ ...cart[0], wholesalePrice: 0 }],
      "WHOLESALE",
      "NONE",
      0,
      0,
      null,
      true,
    ),
    /wholesale price/,
  );
});
test("product search escapes regular expression characters", () => {
  assert.equal(literalSearch("a.*[b]"), "a\\.\\*\\[b\\]");
  assert.ok(new RegExp(literalSearch("a.*[b]")).test("a.*[b]"));
  assert.ok(!new RegExp(literalSearch("a.*[b]")).test("anythingb"));
});
test("non-finite payments and invalid discounts cannot create sales", () => {
  for (const paid of [NaN, Infinity, -Infinity])
    assert.match(
      validateSale(cart, "RETAIL", "NONE", 0, paid, null),
      /Amount paid/,
    );
  for (const discount of [-1, Infinity, NaN, 101])
    assert.match(
      validateSale(cart, "RETAIL", "FIXED", discount, 0, { name: "Buyer" }),
      /discount/,
    );
  assert.equal(validateSale(cart, "RETAIL", "FIXED", 100, 0, null), "");
});
