import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_CURRENCIES, currencyLabel, currencySymbol, isSupportedCurrency } from "@commons/contracts";
import { UpdateCommonsDetailsRequestSchema } from "@commons/contracts";

test("supported currency labels keep USD first and include name, symbol and code", () => {
  assert.equal(SUPPORTED_CURRENCIES[0].code, "USD");
  assert.equal(currencyLabel("USD"), "$ United States Dollar (USD)");
  assert.equal(currencySymbol("EUR"), "€");
  assert.equal(currencySymbol("JPY"), "¥");
  assert.equal(new Set(SUPPORTED_CURRENCIES.map(option => option.code)).size, SUPPORTED_CURRENCIES.length);
  assert.equal(isSupportedCurrency("XYZ"), false);
});
test("trip currency changes require a supported selection and the previous saved currency", () => {
  const details = { commandId: "10000000-0000-4000-8000-000000000001", title: "Trip", startsOn: null, endsOn: null, locationName: null };
  assert.equal(UpdateCommonsDetailsRequestSchema.parse(details).currency, undefined);
  assert.equal(UpdateCommonsDetailsRequestSchema.safeParse({ ...details, currency: "EUR" }).success, false);
  assert.equal(UpdateCommonsDetailsRequestSchema.safeParse({ ...details, currency: "XYZ", expectedCurrency: "USD" }).success, false);
  assert.equal(UpdateCommonsDetailsRequestSchema.parse({ ...details, currency: "EUR", expectedCurrency: "USD" }).currency, "EUR");
});
