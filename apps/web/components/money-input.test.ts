import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeMoneyInput, parseMoneyInput } from "../lib/money-input";

describe("money input", () => {
  it("adds a leading zero to decimal-first entries", () => {
    assert.equal(normalizeMoneyInput("."), "0.");
    assert.equal(normalizeMoneyInput(".5"), "0.5");
    assert.equal(normalizeMoneyInput(".50"), "0.50");
  });

  it("accepts decimal-first payment amounts", () => {
    assert.equal(parseMoneyInput(".5"), 50);
    assert.equal(parseMoneyInput(".50"), 50);
    assert.equal(parseMoneyInput("  .50  "), 50);
  });

  it("keeps existing whole and decimal amounts valid", () => {
    assert.equal(parseMoneyInput("1"), 100);
    assert.equal(parseMoneyInput("1."), 100);
    assert.equal(parseMoneyInput("12.34"), 1234);
  });

  it("rejects zero, excess precision, and malformed amounts", () => {
    assert.equal(parseMoneyInput("0"), null);
    assert.equal(parseMoneyInput("0.00"), null);
    assert.equal(parseMoneyInput(".005"), null);
    assert.equal(parseMoneyInput("1.234"), null);
    assert.equal(parseMoneyInput("$0.50"), null);
  });
});
