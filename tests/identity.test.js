import assert from "node:assert/strict";
import test from "node:test";
import { displayName } from "../src/utils/identity.js";

test("usernames get readable display capitalization without changing stored data", () => {
  const username = "rana usama fiaz";
  assert.equal(displayName(username), "Rana Usama Fiaz");
  assert.equal(username, "rana usama fiaz");
  assert.equal(displayName("  ali   ahmad "), "Ali Ahmad");
  assert.equal(displayName("McDonald"), "McDonald");
  assert.equal(displayName("علی"), "علی");
  assert.equal(displayName(), "");
});
