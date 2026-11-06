import assert from "node:assert/strict";
import test from "node:test";
import { literalSearch, salePayment, saleTotals, validateSale } from "../src/api/sale.js";
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
test("untouched payment follows cart, quantity, price type and discount totals", () => {
  for (const total of [
    saleTotals([], "RETAIL", "NONE", 0).total,
    saleTotals(cart, "RETAIL", "NONE", 0).total,
    saleTotals([{ ...cart[0], quantity: 3 }], "RETAIL", "NONE", 0).total,
    saleTotals(cart, "WHOLESALE", "NONE", 0).total,
    saleTotals(cart, "RETAIL", "FIXED", 10).total,
    saleTotals(cart, "RETAIL", "PERCENTAGE", 10).total,
  ]) assert.deepEqual(salePayment(null, total), { value: total, amount: total });
});
test("manual blank stays blank and checkout rejects it rather than assuming payment", () => {
  for (const total of [100, 150]) {
    const payment = salePayment("", total);
    assert.equal(payment.value, "");
    assert.ok(Number.isNaN(payment.amount));
    assert.match(validateSale(cart, "RETAIL", "NONE", 0, payment.amount, null), /Amount paid/);
  }
});
test("manual zero, partial and full payments retain their exact input across total changes", () => {
  for (const paid of ["0", "40", "100", "040.00"])
    for (const total of [100, 150, 80])
      assert.deepEqual(salePayment(paid, total), { value: paid, amount: Number(paid) });
});
test("full payment allows walk-in sales; positive due still requires a customer", () => {
  assert.equal(validateSale(cart, "RETAIL", "NONE", 0, salePayment(null, 100).amount, null), "");
  assert.equal(validateSale(cart, "RETAIL", "NONE", 0, salePayment("100", 100).amount, null), "");
  for (const paid of ["0", "40"]) {
    const amount = salePayment(paid, 100).amount;
    assert.match(validateSale(cart, "RETAIL", "NONE", 0, amount, null), /customer/);
    assert.equal(validateSale(cart, "RETAIL", "NONE", 0, amount, { name: "Buyer" }), "");
  }
});
test("draft restoration distinguishes automatic, blank, zero and partial payment; reset restores automatic", () => {
  for (const paid of [null, "", "0", "40"]) {
    const draft = JSON.parse(JSON.stringify({ paid }));
    assert.deepEqual(salePayment(draft.paid ?? null, 125), salePayment(paid, 125));
  }
  assert.deepEqual(salePayment(undefined, 125), { value: 125, amount: 125 });
  assert.deepEqual(salePayment(null, 50), { value: 50, amount: 50 });
});
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
test("POS store credit supplements cash, requires customer, and never overpays", () => {
  const customer = { _id: "buyer", storeCreditBalanceMinor: 4000 };
  assert.equal(validateSale(cart, "RETAIL", "NONE", 0, 60, customer, false, 40), "");
  assert.equal(validateSale(cart, "RETAIL", "NONE", 0, 0, customer, false, 100), "");
  assert.match(validateSale(cart, "RETAIL", "NONE", 0, 60, null, false, 40), /customer/);
  assert.match(validateSale(cart, "RETAIL", "NONE", 0, 70, customer, false, 40), /Amount paid/);
  assert.match(validateSale(cart, "RETAIL", "NONE", 0, 0, customer, false, -1), /store-credit/);
  assert.equal(salePayment(null, 100 - 40).amount, 60);
  assert.equal(salePayment("25", 100 - 40).amount, 25);
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

test('invoice-only selling prices and per-unit discounts precede invoice discount',()=>{
 const lines=[{_id:'a',quantity:2,stockQuantity:10,retailPrice:4000,wholesalePrice:3500,unitPrice:'3900',itemDiscount:'200'}];
 assert.deepEqual(saleTotals(lines,'RETAIL','PERCENTAGE','10'),{subtotal:7400,discount:740,total:6660});
 assert.equal(validateSale(lines,'RETAIL','FIXED','60',5000,{_id:'c'}),'');
 for(const patch of [{unitPrice:''},{unitPrice:-1},{unitPrice:1.001},{itemDiscount:4000},{itemDiscount:-1}])assert.match(validateSale([{...lines[0],...patch}],'RETAIL','NONE',0,0,{_id:'c'}),/prices|discounts/);
 assert.equal(lines[0].retailPrice,4000);
});
