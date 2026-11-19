import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetMoneyValues, convertBudgetCurrency, calculateBudget, emptyBudgetInputs, formatMinor, parseAmount, startingBudgetInputs, type BudgetInputs } from './budget-calculations';
import { destinationCatalog } from '../destinations';
import { CITY_LODGING_BASE_RATES, getCityLodgingBaseRate } from './city-lodging-rates';
import { showsBudgetWorksheet } from './pilot';

const inputs = (overrides: Partial<BudgetInputs>): BudgetInputs => ({ ...emptyBudgetInputs(), ...overrides });

test('a complete four-person, three-night worksheet adds every shared category exactly', () => {
  const result = calculateBudget(inputs({
    travelers: '4', nights: '3', lodgingBasis: 'property', lodgingPerNight: '450',
    mealsPerPersonPerDay: '60.25', transportTotal: '180', activitiesTotal: '320.10', travelPerPerson: '210', bufferPercent: '10',
  }));
  assert.equal(result.ready, true);
  assert.deepEqual(result.errors, {});
  assert.equal(result.mealDays, 4, 'meal days default to nights + 1');
  const byKey = Object.fromEntries(result.lines.map(l => [l.key, l.amountMinor]));
  assert.deepEqual(byKey, { lodging: 135000, meals: 96400, transport: 18000, activities: 32010, travel: 84000 });
  assert.equal(result.sharedSubtotalMinor, 365410);
  assert.equal(result.bufferMinor, 36541);
  assert.equal(result.totalMinor, 401951);
  assert.equal(result.shareMinor, 100487);
  assert.equal(result.shareRemainderMinor, 3, 'three travelers cover one extra cent each so shares reach the total');
  assert.equal(result.shareMinor * 4 + result.shareRemainderMinor, result.totalMinor);
});

test('per-room lodging multiplies by rooms and requires a room count', () => {
  const missing = calculateBudget(inputs({ travelers: '6', nights: '2', lodgingBasis: 'room', lodgingPerNight: '189.99' }));
  assert.equal(missing.ready, false);
  assert.match(missing.errors.rooms ?? '', /how many rooms/);
  const withRooms = calculateBudget(inputs({ travelers: '6', nights: '2', lodgingBasis: 'room', lodgingPerNight: '189.99', rooms: '3' }));
  assert.equal(withRooms.ready, true);
  assert.equal(withRooms.lines[0].amountMinor, 18999 * 3 * 2);
  assert.match(withRooms.lines[0].detail, /per room per night × 3 rooms × 2 nights/);
  const wholePlace = calculateBudget(inputs({ travelers: '6', nights: '2', lodgingBasis: 'property', lodgingPerNight: '189.99', rooms: '3' }));
  assert.equal(wholePlace.lines[0].amountMinor, 18999 * 2, 'a stale room count is ignored for whole-place pricing');
});

test('blank costs are reported as not added and never produce a free total', () => {
  const nothing = calculateBudget(inputs({ travelers: '4', nights: '3' }));
  assert.equal(nothing.ready, false, 'no total until at least one shared cost is entered');
  assert.deepEqual(nothing.notAdded, ['Lodging', 'Meals', 'Local transport', 'Shared activities', 'Travel to get there']);
  const partial = calculateBudget(inputs({ travelers: '4', nights: '3', lodgingPerNight: '300' }));
  assert.equal(partial.ready, true);
  assert.deepEqual(partial.notAdded, ['Meals', 'Local transport', 'Shared activities', 'Travel to get there']);
  assert.equal(partial.lines[1].detail, 'Not added');
});

test('an explicit zero is kept distinct from a blank entry', () => {
  const result = calculateBudget(inputs({ travelers: '2', nights: '1', lodgingPerNight: '0', transportTotal: '40' }));
  assert.equal(result.lines[0].status, 'zero');
  assert.equal(result.lines[0].detail, 'Entered as 0');
  assert.equal(result.lines[0].amountMinor, 0);
  assert.ok(!result.notAdded.includes('Lodging'));
  assert.equal(result.totalMinor, 4000);
});

test('invalid, negative and out-of-range entries block the total with specific messages', () => {
  const result = calculateBudget(inputs({
    travelers: '0', nights: '2.5', lodgingPerNight: '-20', mealsPerPersonPerDay: 'about 50', transportTotal: '12.345', bufferPercent: '75',
  }));
  assert.equal(result.ready, false);
  assert.match(result.errors.travelers ?? '', /at least 1 traveler/);
  assert.match(result.errors.nights ?? '', /whole number/);
  assert.match(result.errors.lodgingPerNight ?? '', /0 or more/);
  assert.match(result.errors.mealsPerPersonPerDay ?? '', /using numbers/);
  assert.match(result.errors.transportTotal ?? '', /up to 2 decimal places/);
  assert.match(result.errors.bufferPercent ?? '', /50% or less/);
  assert.match(calculateBudget(inputs({ travelers: '201' })).errors.travelers ?? '', /200 or fewer/);
});

test('a single traveler pays the whole total and per-person costs are not doubled', () => {
  const result = calculateBudget(inputs({ travelers: '1', nights: '2', lodgingPerNight: '99.99', mealsPerPersonPerDay: '40', travelPerPerson: '150' }));
  assert.equal(result.ready, true);
  assert.equal(result.totalMinor, 9999 * 2 + 4000 * 3 + 15000);
  assert.equal(result.shareMinor, result.totalMinor);
  assert.equal(result.shareRemainderMinor, 0);
});

test('meal days can be set explicitly and are bounded by the trip length', () => {
  const custom = calculateBudget(inputs({ travelers: '3', nights: '2', mealsPerPersonPerDay: '50', mealDaysFollowNights: false, mealDays: '2' }));
  assert.equal(custom.mealDays, 2);
  assert.equal(custom.lines[1].amountMinor, 5000 * 3 * 2);
  const tooMany = calculateBudget(inputs({ travelers: '3', nights: '2', mealsPerPersonPerDay: '50', mealDaysFollowNights: false, mealDays: '4' }));
  assert.match(tooMany.errors.mealDays ?? '', /A 2-night trip has at most 3 days/);
  const blank = calculateBudget(inputs({ travelers: '3', nights: '2', mealsPerPersonPerDay: '50', mealDaysFollowNights: false, mealDays: '' }));
  assert.match(blank.errors.mealDays ?? '', /how many days/);
});

test('optional extras stay out of the shared total and equal share', () => {
  const result = calculateBudget(inputs({
    travelers: '5', nights: '2', lodgingPerNight: '500',
    optional: [
      { id: 'a', label: 'Balloon ride', perPerson: '300', participants: '2' },
      { id: 'b', label: '', perPerson: '45.50', participants: '0' },
    ],
  }));
  assert.equal(result.ready, true);
  assert.equal(result.totalMinor, 100000);
  assert.equal(result.shareMinor, 20000);
  assert.deepEqual(result.optional.map(o => [o.label, o.totalMinor]), [['Balloon ride', 60000], ['Optional extra 2', 0]]);
  assert.equal(result.optionalTotalMinor, 60000);
  const over = calculateBudget(inputs({ travelers: '5', nights: '2', lodgingPerNight: '500', optional: [{ id: 'a', label: 'Spa', perPerson: '200', participants: '6' }] }));
  assert.match(over.errors['optional.a.participants'] ?? '', /no more than the 5 travelers/);
  const unsure = calculateBudget(inputs({ travelers: '5', nights: '2', lodgingPerNight: '500', optional: [{ id: 'a', label: 'Spa', perPerson: '200', participants: '' }] }));
  assert.match(unsure.errors['optional.a.participants'] ?? '', /how many people/);
});

test('currencies use their own minor units without float drift', () => {
  assert.deepEqual(parseAmount('0.1', 2), { kind: 'ok', value: 10 });
  assert.deepEqual(parseAmount('1,234.5', 2), { kind: 'ok', value: 123450 });
  assert.equal(parseAmount('1,23', 2).kind, 'error');
  const yen = calculateBudget(inputs({ currency: 'JPY', travelers: '3', nights: '2', lodgingPerNight: '20000' }));
  assert.equal(yen.minorDigits, 0);
  assert.equal(yen.totalMinor, 40000);
  assert.equal(yen.shareMinor, 13333);
  assert.equal(yen.shareRemainderMinor, 1);
  assert.match(calculateBudget(inputs({ currency: 'JPY', travelers: '1', nights: '1', lodgingPerNight: '12.5' })).errors.lodgingPerNight ?? '', /whole numbers/);
  assert.equal(formatMinor(401951, 'USD'), '$4,019.51');
  assert.equal(formatMinor(40000, 'JPY'), '¥40,000');
  assert.equal(formatMinor(1234567, 'KWD').replace(/\s/g, ' '), 'KWD 1,234.567');
  // 0.1 + 0.2 style sums stay exact.
  const cents = calculateBudget(inputs({ travelers: '1', nights: '1', transportTotal: '0.10', activitiesTotal: '0.20' }));
  assert.equal(cents.totalMinor, 30);
  assert.equal(formatMinor(cents.totalMinor, 'USD'), '$0.30');
});

test('the buffer rounds half up to the nearest cent and supports one decimal place', () => {
  const result = calculateBudget(inputs({ travelers: '2', nights: '1', transportTotal: '0.05', bufferPercent: '10' }));
  assert.equal(result.bufferMinor, 1, '10% of 5 cents rounds 0.5 up to 1 cent');
  assert.equal(calculateBudget(inputs({ travelers: '2', nights: '1', transportTotal: '100', bufferPercent: '12.5%' })).bufferMinor, 1250);
  assert.match(calculateBudget(inputs({ travelers: '2', nights: '1', transportTotal: '100', bufferPercent: '12.55' })).errors.bufferPercent ?? '', /percentage/);
});

test('the largest permitted entries stay exact', () => {
  const result = calculateBudget(inputs({ currency: 'KWD', travelers: '200', nights: '90', lodgingBasis: 'room', lodgingPerNight: '1000000', rooms: '200', mealsPerPersonPerDay: '1000000', bufferPercent: '50' }));
  assert.equal(result.ready, true);
  assert.ok(Number.isSafeInteger(result.totalMinor));
  assert.equal(result.lines[0].amountMinor, 1_000_000_000 * 200 * 90);
  assert.match(calculateBudget(inputs({ travelers: '1', nights: '1', lodgingPerNight: '10000001' })).errors.lodgingPerNight ?? '', /too large/);
});

test('a starting USD lodging price fills the lodging line and converts locally', () => {
  const usd = calculateBudget({ ...startingBudgetInputs('USD', 336), travelers: '4', nights: '3' });
  assert.equal(usd.ready, true);
  assert.equal(usd.lines.find(l => l.key === 'lodging')?.amountMinor, 100800);
  assert.equal(usd.totalMinor, 100800);
  assert.equal(usd.shareMinor, 25200);

  const eur = calculateBudget({ ...startingBudgetInputs('EUR', 336), travelers: '4', nights: '3' });
  assert.equal(eur.lines.find(l => l.key === 'lodging')?.amountMinor, 89760);
  assert.equal(eur.ready, true);
});

test('every destination has exactly one sourced, positive USD starting rate and a worksheet', () => {
  assert.equal(destinationCatalog.length, 50);
  assert.equal(CITY_LODGING_BASE_RATES.length, 50);
  assert.equal(new Set(CITY_LODGING_BASE_RATES.map(r => r.slug)).size, 50);
  for (const city of destinationCatalog) {
    const rate = getCityLodgingBaseRate(city.slug);
    assert.ok(rate, city.slug);
    assert.ok(rate.nightlyUsd > 0 && Number.isInteger(rate.nightlyUsd));
    assert.equal(rate.name, city.name);
    assert.equal(rate.sourceCurrency, 'USD');
    assert.equal(new URL(rate.sourceUrl).protocol, 'https:');
    assert.ok(rate.checkedAt && rate.asOf && rate.marketName);
    assert.equal(showsBudgetWorksheet(city.slug), true);
  }
  assert.equal(showsBudgetWorksheet('not-a-destination'), false);
});

test('currency changes convert every money field, leaving people, nights and cushion intact', () => {
  const original = inputs({ travelers: '4', nights: '3', lodgingBasis: 'room', rooms: '2', lodgingPerNight: '100', mealsPerPersonPerDay: '25', transportTotal: '0', activitiesTotal: '1,200.50', travelPerPerson: '', bufferPercent: '10', optional: [{ id: 'x', label: 'Spa', perPerson: '15', participants: '2' }] });
  const converted = convertBudgetCurrency(original, 'EUR')!;
  assert.equal(converted.lodgingPerNight, '89.05');
  assert.equal(converted.mealsPerPersonPerDay, '22.26');
  assert.equal(converted.transportTotal, '0.00');
  assert.equal(converted.activitiesTotal, '1069.02');
  assert.equal(converted.travelPerPerson, '');
  assert.equal(converted.optional[0].perPerson, '13.36');
  for (const key of ['travelers', 'nights', 'rooms', 'bufferPercent', 'mealDays', 'mealDaysFollowNights', 'lodgingBasis'] as const) assert.equal(converted[key], original[key]);
  assert.equal(converted.optional[0].participants, '2');
  assert.equal(original.lodgingPerNight, '100');
});

test('JPY and KWD use the right precision; original values prevent repeated-switch rounding drift', () => {
  const original = inputs({ lodgingPerNight: '0.01', transportTotal: '100' });
  const references = Object.fromEntries(Object.entries(budgetMoneyValues(original)).map(([key, amount]) => [key, { amount, currency: 'USD' }]));
  const yen = convertBudgetCurrency(original, 'JPY', references)!;
  assert.equal(yen.transportTotal, '15784');
  assert.equal(yen.lodgingPerNight, '2');
  const kwd = convertBudgetCurrency(yen, 'KWD', references)!;
  assert.equal(kwd.transportTotal, '31.027');
  const restored = convertBudgetCurrency(kwd, 'USD', references)!;
  assert.equal(restored.lodgingPerNight, '0.01');
  assert.equal(restored.transportTotal, '100.00');
});

test('invalid, unavailable and over-limit conversions leave the worksheet unchanged', () => {
  for (const value of ['abc', '-1', '12.345']) assert.equal(convertBudgetCurrency(inputs({ lodgingPerNight: value }), 'EUR'), null);
  assert.equal(convertBudgetCurrency(inputs({ lodgingPerNight: '10000000' }), 'JPY'), null);
  assert.equal(convertBudgetCurrency(inputs({ lodgingPerNight: '100' }), 'XXX'), null);
});
