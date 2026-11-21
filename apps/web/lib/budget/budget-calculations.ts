/**
 * Group budget worksheet arithmetic. Every amount is user-entered; nothing here
 * supplies, infers or looks up local prices. Money is handled in integer minor
 * units (cents, yen, fils) so totals and shares are exact.
 */

export type LodgingBasis = 'property' | 'room';

export type OptionalExtraInput = { id: string; label: string; perPerson: string; participants: string };

export type BudgetInputs = {
  /** Always the trip's currency. Saved worksheets keep the field so stored rows stay readable; see withTripCurrency. */
  currency: string;
  travelers: string;
  nights: string;
  lodgingBasis: LodgingBasis;
  lodgingPerNight: string;
  rooms: string;
  mealsPerPersonPerDay: string;
  /** Used only when mealDaysFollowNights is false. */
  mealDays: string;
  mealDaysFollowNights: boolean;
  transportTotal: string;
  activitiesTotal: string;
  travelPerPerson: string;
  bufferPercent: string;
  optional: OptionalExtraInput[];
};

export type BudgetField =
  | 'travelers' | 'nights' | 'lodgingPerNight' | 'rooms' | 'mealsPerPersonPerDay' | 'mealDays'
  | 'transportTotal' | 'activitiesTotal' | 'travelPerPerson' | 'bufferPercent'
  | `optional.${string}.perPerson` | `optional.${string}.participants`;

export type LineKey = 'lodging' | 'meals' | 'transport' | 'activities' | 'travel';
export type LineStatus = 'added' | 'zero' | 'not-added';
export type BudgetLine = { key: LineKey; label: string; status: LineStatus; amountMinor: number | null; detail: string };
export type OptionalLine = { id: string; label: string; perPersonMinor: number; participants: number; totalMinor: number };

export type BudgetResult = {
  currency: string;
  minorDigits: number;
  errors: Partial<Record<BudgetField, string>>;
  travelers: number | null;
  nights: number | null;
  mealDays: number | null;
  lines: BudgetLine[];
  /** Labels of shared categories left blank, so a total never reads as complete when it is not. */
  notAdded: string[];
  /** True when the group basics are valid, nothing is invalid, and at least one shared cost was entered. */
  ready: boolean;
  sharedSubtotalMinor: number;
  bufferMinor: number;
  totalMinor: number;
  /** Equal share rounded down to the minor unit; `shareRemainderMinor` people pay one more minor unit. */
  shareMinor: number;
  shareRemainderMinor: number;
  optional: OptionalLine[];
  optionalTotalMinor: number;
};

export const BUDGET_LIMITS = {
  travelers: 200,
  nights: 90,
  rooms: 200,
  bufferPercent: 50,
  optionalExtras: 8,
  /** Largest single entry in minor units ($10,000,000.00; ¥1,000,000,000). */
  amountMinor: 1_000_000_000,
} as const;

export const SHARED_LINE_LABELS: Record<LineKey, string> = {
  lodging: 'Lodging',
  meals: 'Meals',
  transport: 'Local transport',
  activities: 'Shared activities',
  travel: 'Travel to get there',
};

export function emptyBudgetInputs(currency = 'USD'): BudgetInputs {
  return {
    currency,
    travelers: '',
    nights: '',
    lodgingBasis: 'property',
    lodgingPerNight: '',
    rooms: '',
    mealsPerPersonPerDay: '',
    mealDays: '',
    mealDaysFollowNights: true,
    transportTotal: '',
    activitiesTotal: '',
    travelPerPerson: '',
    bufferPercent: '',
    optional: [{ id: 'extra-1', label: '', perPerson: '', participants: '' }],
  };
}

/**
 * The worksheet works in the trip's currency, as the rest of Money does. A worksheet saved while the old
 * currency selector existed may name another currency; that value is read without error and replaced.
 */
export function withTripCurrency(inputs: BudgetInputs, currency = 'USD'): BudgetInputs {
  return inputs.currency === currency ? inputs : { ...inputs, currency };
}

/** Empty worksheet. A nightly lodging reference is in US dollars, so it seeds only a USD worksheet. */
export function startingBudgetInputs(currency = 'USD', startingLodgingUsd?: number): BudgetInputs {
  const inputs = emptyBudgetInputs(currency);
  if (startingLodgingUsd !== undefined && currency === 'USD') inputs.lodgingPerNight = String(startingLodgingUsd);
  return inputs;
}

/** Number of minor-unit digits for a currency (USD 2, JPY 0, KWD 3). */
export function currencyMinorDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

type Parsed<T> = { kind: 'blank' } | { kind: 'ok'; value: T } | { kind: 'error'; message: string };

const AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/** Parses a typed amount into exact minor units. Accepts "1200", "1,200.50", ".5"; rejects negatives and other text. */
export function parseAmount(text: string, minorDigits: number, currency = 'this currency'): Parsed<number> {
  const raw = text.trim();
  if (raw === '') return { kind: 'blank' };
  if (/^[-−]/.test(raw)) return { kind: 'error', message: 'Enter 0 or more.' };
  const match = AMOUNT_PATTERN.exec(raw);
  if (!match || raw === '.' || raw === ',') return { kind: 'error', message: 'Enter an amount using numbers, like 120 or 120.50.' };
  const [whole = '', fraction = ''] = raw.replace(/,/g, '').split('.');
  if (fraction.length > minorDigits) {
    return { kind: 'error', message: minorDigits === 0 ? `${currency} amounts use whole numbers.` : `${currency} amounts use up to ${minorDigits} decimal places.` };
  }
  const minor = BigInt(whole || '0') * 10n ** BigInt(minorDigits) + BigInt((fraction + '0'.repeat(minorDigits)).slice(0, minorDigits) || '0');
  if (minor > BigInt(BUDGET_LIMITS.amountMinor)) return { kind: 'error', message: 'That amount is too large for this worksheet.' };
  return { kind: 'ok', value: Number(minor) };
}

/** Parses a whole-number count within [min, max]. */
export function parseCount(text: string, min: number, max: number, noun: string): Parsed<number> {
  const raw = text.trim();
  if (raw === '') return { kind: 'blank' };
  if (/^[-−]/.test(raw)) return { kind: 'error', message: min > 0 ? `Enter at least ${min}.` : 'Enter 0 or more.' };
  if (!/^\d+$/.test(raw)) return { kind: 'error', message: 'Enter a whole number.' };
  const value = Number(raw);
  if (value < min) return { kind: 'error', message: `Enter at least ${min} ${min === 1 ? noun : `${noun}s`}.` };
  if (value > max) return { kind: 'error', message: `Use ${max} or fewer.` };
  return { kind: 'ok', value };
}

/** Parses a percentage with at most one decimal place, returned in tenths of a percent. */
export function parsePercentTenths(text: string, max: number): Parsed<number> {
  const raw = text.trim().replace(/%$/, '').trim();
  if (raw === '') return { kind: 'blank' };
  if (/^[-−]/.test(raw)) return { kind: 'error', message: 'Enter 0 or more.' };
  if (!/^\d*(?:\.\d?)?$/.test(raw) || raw === '.') return { kind: 'error', message: 'Enter a percentage like 10 or 12.5.' };
  const [whole = '', fraction = ''] = raw.split('.');
  const tenths = Number(whole || '0') * 10 + Number(fraction || '0');
  if (tenths > max * 10) return { kind: 'error', message: `Use ${max}% or less.` };
  return { kind: 'ok', value: tenths };
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export function calculateBudget(inputs: BudgetInputs): BudgetResult {
  const currency = inputs.currency;
  const minorDigits = currencyMinorDigits(currency);
  const errors: BudgetResult['errors'] = {};
  const take = <T,>(field: BudgetField, parsed: Parsed<T>): T | null => {
    if (parsed.kind === 'error') { errors[field] = parsed.message; return null; }
    return parsed.kind === 'ok' ? parsed.value : null;
  };
  const amount = (field: BudgetField, text: string) => {
    const parsed = parseAmount(text, minorDigits, currency);
    return { blank: parsed.kind === 'blank', value: take(field, parsed) };
  };

  const travelers = take('travelers', parseCount(inputs.travelers, 1, BUDGET_LIMITS.travelers, 'traveler'));
  const nights = take('nights', parseCount(inputs.nights, 1, BUDGET_LIMITS.nights, 'night'));

  const lodging = amount('lodgingPerNight', inputs.lodgingPerNight);
  const perRoom = inputs.lodgingBasis === 'room';
  const rooms = perRoom ? take('rooms', parseCount(inputs.rooms, 1, BUDGET_LIMITS.rooms, 'room')) : null;
  if (perRoom && !lodging.blank && inputs.rooms.trim() === '') errors.rooms = 'Enter how many rooms the group needs.';

  const meals = amount('mealsPerPersonPerDay', inputs.mealsPerPersonPerDay);
  let mealDays: number | null = null;
  if (inputs.mealDaysFollowNights) {
    mealDays = nights === null ? null : nights + 1;
  } else {
    const maxDays = nights === null ? BUDGET_LIMITS.nights + 1 : nights + 1;
    mealDays = take('mealDays', parseCount(inputs.mealDays, 0, maxDays, 'day'));
    if (!meals.blank && inputs.mealDays.trim() === '') errors.mealDays = 'Enter how many days to count meals for.';
    if (errors.mealDays?.startsWith('Use ') && nights !== null) errors.mealDays = `A ${nights}-night trip has at most ${plural(nights + 1, 'day')}.`;
  }

  const transport = amount('transportTotal', inputs.transportTotal);
  const activities = amount('activitiesTotal', inputs.activitiesTotal);
  const travel = amount('travelPerPerson', inputs.travelPerPerson);
  const bufferTenths = take('bufferPercent', parsePercentTenths(inputs.bufferPercent, BUDGET_LIMITS.bufferPercent));

  const money = (minor: number) => formatMinor(minor, currency, minorDigits);
  const line = (key: LineKey, entry: { blank: boolean; value: number | null }, compute: () => number | null, detail: (unit: number) => string): BudgetLine => {
    if (entry.blank) return { key, label: SHARED_LINE_LABELS[key], status: 'not-added', amountMinor: null, detail: 'Not added' };
    if (entry.value === null) return { key, label: SHARED_LINE_LABELS[key], status: 'not-added', amountMinor: null, detail: 'Check this entry' };
    const total = compute();
    if (total === null) return { key, label: SHARED_LINE_LABELS[key], status: 'not-added', amountMinor: null, detail: 'Needs the group details above' };
    return { key, label: SHARED_LINE_LABELS[key], status: entry.value === 0 ? 'zero' : 'added', amountMinor: total, detail: entry.value === 0 ? 'Entered as 0' : detail(entry.value) };
  };
  const product = (...factors: (number | null)[]) => factors.some(f => f === null) ? null : Number(factors.reduce<bigint>((acc, f) => acc * BigInt(f as number), 1n));

  const lines: BudgetLine[] = [
    line('lodging', lodging, () => perRoom ? product(lodging.value, rooms, nights) : product(lodging.value, nights),
      unit => perRoom && rooms !== null && nights !== null
        ? `${money(unit)} per room per night × ${plural(rooms, 'room')} × ${plural(nights, 'night')}`
        : `${money(unit)} per night for the whole place × ${plural(nights ?? 0, 'night')}`),
    line('meals', meals, () => product(meals.value, travelers, mealDays),
      unit => `${money(unit)} per person per day × ${plural(travelers ?? 0, 'person', 'people')} × ${plural(mealDays ?? 0, 'day')}`),
    line('transport', transport, () => transport.value, () => 'Group total'),
    line('activities', activities, () => activities.value, () => 'Group total'),
    line('travel', travel, () => product(travel.value, travelers), unit => `${money(unit)} per person × ${plural(travelers ?? 0, 'person', 'people')}`),
  ];

  const optional: OptionalLine[] = [];
  inputs.optional.forEach((extra, index) => {
    const label = extra.label.trim() || `Optional extra ${index + 1}`;
    const perField = `optional.${extra.id}.perPerson` as const;
    const countField = `optional.${extra.id}.participants` as const;
    const per = amount(perField, extra.perPerson);
    const count = take(countField, parseCount(extra.participants, 0, travelers ?? BUDGET_LIMITS.travelers, 'person'));
    if (errors[countField]?.startsWith('Use ') && travelers !== null) errors[countField] = `Use no more than the ${plural(travelers, 'traveler')} in the group.`;
    if (!per.blank && extra.participants.trim() === '') errors[countField] = 'Enter how many people expect to join.';
    if (per.value !== null && count !== null) {
      optional.push({ id: extra.id, label, perPersonMinor: per.value, participants: count, totalMinor: per.value * count });
    }
  });

  const shared = lines.filter(l => l.amountMinor !== null);
  const sharedSubtotal = shared.reduce((sum, l) => sum + BigInt(l.amountMinor as number), 0n);
  // Round the buffer half up to the nearest minor unit.
  const buffer = bufferTenths ? (sharedSubtotal * BigInt(bufferTenths) + 500n) / 1000n : 0n;
  const total = sharedSubtotal + buffer;
  const hasErrors = Object.keys(errors).length > 0;
  const ready = !hasErrors && travelers !== null && nights !== null && shared.length > 0;
  const share = ready && travelers ? total / BigInt(travelers) : 0n;
  const remainder = ready && travelers ? total % BigInt(travelers) : 0n;

  return {
    currency,
    minorDigits,
    errors,
    travelers,
    nights,
    mealDays,
    lines,
    notAdded: lines.filter(l => l.status === 'not-added').map(l => l.label),
    ready,
    sharedSubtotalMinor: Number(sharedSubtotal),
    bufferMinor: Number(buffer),
    totalMinor: Number(total),
    shareMinor: Number(share),
    shareRemainderMinor: Number(remainder),
    optional,
    optionalTotalMinor: optional.reduce((sum, o) => sum + o.totalMinor, 0),
  };
}

/** Formats exact minor units without passing through floating point. */
export function formatMinor(minor: number, currency: string, minorDigits = currencyMinorDigits(currency)): string {
  const negative = minor < 0;
  const digits = String(Math.abs(minor)).padStart(minorDigits + 1, '0');
  const decimal = minorDigits ? `${digits.slice(0, -minorDigits)}.${digits.slice(-minorDigits)}` : digits;
  let formatter: Intl.NumberFormat;
  try {
    formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: minorDigits, maximumFractionDigits: minorDigits });
  } catch {
    return `${negative ? '-' : ''}${currency} ${decimal}`;
  }
  // Intl accepts exact decimal strings (ES2023); the cast keeps older lib typings happy.
  return formatter.format(`${negative ? '-' : ''}${decimal}` as unknown as number);
}
