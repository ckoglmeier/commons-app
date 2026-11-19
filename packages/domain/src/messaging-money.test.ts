import assert from "node:assert/strict";
import test from "node:test";
import { equalShares, matchPerson, parseAmount, parseMoneyMessage, resolveCurrency } from "./messaging-money";

const expense = (body: string) => { const parsed = parseMoneyMessage(body); assert.equal(parsed?.kind, "expense", body); return parsed as Extract<NonNullable<typeof parsed>, { kind: "expense" }>; };
const payment = (body: string) => { const parsed = parseMoneyMessage(body); assert.equal(parsed?.kind, "payment", body); return parsed as Extract<NonNullable<typeof parsed>, { kind: "payment" }>; };

test("amounts keep the currency the person wrote", () => {
  assert.deepEqual(parseAmount("$120")?.amountCents, 12000);
  assert.deepEqual(parseAmount("$1,200.50")?.amountCents, 120050);
  assert.equal(parseAmount("€40")?.currency, "EUR");
  assert.equal(parseAmount("40 euros")?.currency, "EUR");
  assert.equal(parseAmount("120 bucks")?.currency, "USD");
  assert.equal(parseAmount("dinner at 7"), null, "a bare number isn't an amount unless one is expected");
  assert.equal(parseAmount("$0"), null);
  assert.equal(parseAmount("$99999999"), null, "over the expense limit");
});

test("a payment to a person", () => {
  for (const body of ["I paid Sam $40", "paid sam 40", "just paid Sam $40", "Venmoed Sam $40", "sent sam $40"]) {
    const parsed = payment(body);
    assert.equal(parsed.toName?.toLowerCase(), "sam", body); assert.equal(parsed.amountCents, 4000, body);
  }
  assert.equal(payment("I paid Sam").amountCents, null, "the amount can be asked for");
  assert.equal(payment("paid him $20").toName, null, "a person who isn't named can be asked for");
});

test("a cost the sender paid", () => {
  const dinner = expense("I covered dinner, $120, me and Alex");
  assert.equal(dinner.description, "Dinner"); assert.equal(dinner.amountCents, 12000); assert.deepEqual(dinner.included, { names: ["Alex"], includesSender: true });
  assert.equal(expense("paid $80 for gas").description, "Gas");
  assert.equal(expense("I bought groceries $64.20 for everyone").included, "everyone");
  assert.equal(expense("I bought groceries $64.20").included, "unstated", "silence isn't agreement about who shares it");
  assert.deepEqual(expense("paid $30 for parking with Alex and Sam").included, { names: ["Alex", "Sam"], includesSender: true });
  assert.deepEqual(expense("got tickets $50 for Alex").included, { names: ["Alex"], includesSender: false }, "paying for someone doesn't include the payer");
  assert.equal(expense("dinner was $120").amountCents, 12000);
  assert.equal(expense("dinner was $120").description, "Dinner");
  assert.equal(expense("expense: taxi €18").currency, "EUR");
  assert.equal(expense("paid $20 for lunch yesterday").dateWord, "yesterday");
  assert.equal(expense("paid $20 for lunch on friday").dateWord, "friday");
  assert.equal(expense("paid $20 for lunch on friday").description, "Lunch");
  assert.equal(expense("I covered dinner").amountCents, null, "the amount can be asked for");
  assert.equal(expense("paid $40").description, null, "what it was for can be asked for");
});

test("what the review caught: amounts and people that would have read plausibly and been wrong", () => {
  assert.equal(parseAmount("$2k")?.amountCents, 200000);
  assert.equal(expense("paid $2k for the house").description, "House");
  assert.equal(parseAmount("€1.200,50"), null, "read short, this would be €1.20");
  assert.equal(parseAmount("$40.123"), null);
  assert.equal(parseAmount("dinner at 7", { allowBare: true }), null, "a number has to be the whole reply");
  assert.equal(parseAmount("85.50", { allowBare: true })?.amountCents, 8550);
  const each = expense("Tickets were $25 each");
  assert.equal(each.amountCents, null, "not the total, so it's asked"); assert.equal(each.description, "Tickets");
  assert.equal(parseMoneyMessage("I got $40 from Sam"), null, "money coming in isn't a cost");
  assert.equal(payment("I paid $40 to Sam").toName, "Sam");
  assert.equal(payment("I paid $40 to Sam").amountCents, 4000);
  assert.equal(expense("paid $120 for dinner with Sam at the Lodge").included, "unclear");
  assert.equal(expense("paid $50 for Sam's ticket").included, "unclear");
  assert.equal(parseMoneyMessage("Sent Sam 3 photos"), null);
  assert.equal(parseMoneyMessage("sent sam the link"), null);
  assert.equal(payment("paid Sam back").amountCents, null);
});

test("a dollar sign means the trip's dollars, and says so unless they're US dollars", () => {
  const dollars = { currency: null, dollarSign: true };
  assert.deepEqual(resolveCurrency(dollars, "USD"), { currency: "USD", currencyAssumed: false });
  assert.deepEqual(resolveCurrency(dollars, "CAD"), { currency: "CAD", currencyAssumed: true });
  assert.deepEqual(resolveCurrency(dollars, "EUR"), { currency: "USD", currencyAssumed: false });
  assert.deepEqual(resolveCurrency({ currency: "EUR", dollarSign: false }, "USD"), { currency: "EUR", currencyAssumed: false });
  assert.deepEqual(resolveCurrency({ currency: null, dollarSign: false }, "CAD"), { currency: "CAD", currencyAssumed: true });
});

test("someone else paying goes to the Money page rather than being recorded on the sender's word", () => {
  assert.deepEqual(parseMoneyMessage("Sam paid for dinner $120"), { kind: "someone_else" });
  assert.deepEqual(parseMoneyMessage("we paid $40 for the boat"), { kind: "someone_else" });
});

test("ordinary chat and questions are left alone", () => {
  for (const body of ["how much was dinner?", "did you pay for dinner", "yes", "2", "SAVE 4K7", "dinner was great", "the hike was amazing", "see you at 7", "what's the address", "sam paid", "I love this trip", "was it $40?", "I got here at 5", "I got it, thanks", "just got in", "I bought it", ""]) {
    assert.equal(parseMoneyMessage(body), null, body);
  }
  // Reads as a payment to someone called Attention. Nobody on the trip has that name and there's no amount, so the conversation layer lets it pass.
  assert.deepEqual(parseMoneyMessage("I paid attention"), { kind: "payment", amountCents: null, currency: null, dollarSign: false, toName: "attention" });
  assert.equal(payment("I paid Anna $5").toName, "Anna", "a name that starts like a filler word is still a name");
});

test("names match exactly one person or get asked about", () => {
  const people = [{ id: "a", name: "Alex Rivera" }, { id: "b", name: "Alex Chen" }, { id: "c", name: "Sam Park" }];
  assert.deepEqual(matchPerson("Sam", people), { kind: "one", person: people[2] });
  assert.deepEqual(matchPerson("alex chen", people), { kind: "one", person: people[1] });
  assert.equal(matchPerson("Alex", people).kind, "ambiguous");
  assert.equal(matchPerson("Jordan", people).kind, "none");
  assert.equal(matchPerson("Sa", people).kind, "none", "never the closest guess");
});

test("equal shares always add up to the total", () => {
  assert.deepEqual(equalShares(10000, ["a", "b", "c"]), [{ personId: "a", amountCents: 3334 }, { personId: "b", amountCents: 3333 }, { personId: "c", amountCents: 3333 }]);
  for (const amount of [1, 2, 99, 100, 101, 12345]) assert.equal(equalShares(amount, ["a", "b", "c", "d", "e", "f", "g"]).reduce((sum, share) => sum + share.amountCents, 0), amount);
});
