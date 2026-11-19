'use client';
import { useId, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { SUPPORTED_CURRENCIES } from '@commons/contracts';
import {
  BUDGET_LIMITS, BUDGET_EXCHANGE_RATES, budgetMoneyValues, convertBudgetCurrency, calculateBudget, formatMinor, startingBudgetInputs,
  type BudgetField, type BudgetInputs, type LodgingBasis, type CurrencyOriginals,
} from './budget-calculations';
import type { CityLodgingBaseRate } from './city-lodging-rates';
import css from './budget-worksheet.module.css';

export type GroupBudgetWorksheetProps = {
  /** Destination display name, e.g. "Sedona". */
  destinationName?: string;
  embedded?: boolean;
  summaryActions?: ReactNode;
  summarySupplement?: ReactNode;
  /** Controlled trip worksheet. */
  value?: BudgetInputs;
  onChange?: (inputs: BudgetInputs) => void;
  readOnly?: boolean;
  title?: string;
  storageNotice?: ReactNode;
  lodgingReferenceLabel?: ReactNode;
  /** ISO 4217 code selected initially and after reset. Defaults to USD. */
  defaultCurrency?: string;
  /** Editable USD nightly base, converted locally and restored by Clear worksheet. */
  startingLodging?: CityLodgingBaseRate;
};

type TextField = Exclude<keyof BudgetInputs, 'currency' | 'lodgingBasis' | 'mealDaysFollowNights' | 'optional'>;

export function GroupBudgetWorksheet({ destinationName, defaultCurrency = 'USD', startingLodging, value, onChange, readOnly = false, title = 'Estimate your group budget', embedded = false, summaryActions, summarySupplement, storageNotice, lodgingReferenceLabel }: GroupBudgetWorksheetProps) {
  const uid = useId();
  const id = (field: string) => `${uid}-${field.replace(/\./g, '-')}`;
  const [localInputs, setLocalInputs] = useState<BudgetInputs>(() => startingBudgetInputs(defaultCurrency, startingLodging?.nightlyUsd));
  const inputs = value ?? localInputs;
  const setInputsState = (next: BudgetInputs | ((previous: BudgetInputs) => BudgetInputs)) => {
    const updated = typeof next === 'function' ? next(inputs) : next;
    if (value !== undefined) onChange?.(updated);
    else setLocalInputs(updated);
  };
  const [usingStartingPrice, setUsingStartingPrice] = useState(!!startingLodging);
  const showingPrefill = usingStartingPrice && inputs.lodgingBasis === 'property';
  const [currencyError, setCurrencyError] = useState('');
  const [originals, setOriginals] = useState<CurrencyOriginals>(startingLodging ? { lodgingPerNight: { amount: String(startingLodging.nightlyUsd), currency: 'USD' } } : {});
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [announcement, setAnnouncement] = useState('');
  // Any edit replaces a one-off announcement (cleared, removed) with the live total.
  const setInputs: typeof setInputsState = next => {
    setAnnouncement('');
    setCurrencyError('');
    const value = typeof next === 'function' ? next(inputs) : next;
    const before = budgetMoneyValues(inputs);
    const references = { ...originals };
    for (const [key, amount] of Object.entries(budgetMoneyValues(value))) {
      if (before[key] !== amount) delete references[key];
    }
    setOriginals(references);
    setInputsState(value);
  };
  const switchCurrency = (currency: string) => {
    const references = { ...originals };
    for (const [key, amount] of Object.entries(budgetMoneyValues(inputs))) {
      references[key] ??= { amount, currency: inputs.currency };
    }
    const converted = convertBudgetCurrency(inputs, currency, references);
    if (!converted) {
      setCurrencyError('Check the money amounts before converting. An amount is invalid or too large in the selected currency.');
      return;
    }
    setOriginals(references);
    setInputsState(converted);
    setCurrencyError('');
    setAnnouncement(`Amounts converted to ${currency}.`);
  };
  const nextExtra = useRef(2);
  const firstField = useRef<HTMLInputElement>(null);
  const result = useMemo(() => calculateBudget(inputs), [inputs]);
  const code = inputs.currency;
  const money = (minor: number) => formatMinor(minor, code, result.minorDigits);

  const set = (field: TextField, value: string) => setInputs(prev => ({ ...prev, [field]: value }));
  const touch = (field: string) => setTouched(prev => prev.has(field) ? prev : new Set(prev).add(field));
  const errorFor = (field: BudgetField, value: string) => {
    const message = result.errors[field];
    return message && (value.trim() !== '' || touched.has(field)) ? message : undefined;
  };

  const labels: Partial<Record<BudgetField, string>> = {
    travelers: 'Travelers', nights: 'Nights',
    lodgingPerNight: 'Lodging price', rooms: 'Rooms', mealsPerPersonPerDay: 'Meals per person, per day', mealDays: 'Days of meals',
    transportTotal: 'Local transport', activitiesTotal: 'Shared activities', travelPerPerson: 'Travel to get there', bufferPercent: 'Cushion',
  };
  const issueLabel = (field: string) => {
    const match = /^optional\.(.+)\.(perPerson|participants)$/.exec(field);
    if (!match) return labels[field as BudgetField] ?? field;
    const index = inputs.optional.findIndex(o => o.id === match[1]);
    const name = inputs.optional[index]?.label.trim() || `Optional extra ${index + 1}`;
    return `${name}: ${match[2] === 'perPerson' ? 'cost per person' : 'people joining'}`;
  };
  const issues = Object.entries(result.errors) as [string, string][];

  const mealDaysValue = inputs.mealDaysFollowNights ? (result.nights !== null ? String(result.nights + 1) : '') : inputs.mealDays;

  const reset = () => {
    setOriginals(startingLodging ? { lodgingPerNight: { amount: String(startingLodging.nightlyUsd), currency: 'USD' } } : {});
    setUsingStartingPrice(!!startingLodging);
    setInputsState(startingBudgetInputs(defaultCurrency, startingLodging?.nightlyUsd));
    setCurrencyError('');
    setTouched(new Set());
    nextExtra.current = 2;
    setAnnouncement('Worksheet cleared.');
    firstField.current?.focus();
  };

  const field = (name: TextField, label: ReactNode, opts: { hint?: ReactNode; numeric?: boolean; value?: string; onChange?: (v: string) => void; inputRef?: Ref<HTMLInputElement>; after?: ReactNode } = {}) => {
    const value = opts.value ?? inputs[name];
    const error = errorFor(name, value);
    const hintId = opts.hint ? `${id(name)}-hint` : undefined;
    const errorId = error ? `${id(name)}-error` : undefined;
    return (
      <div className={css.field}>
        <label htmlFor={id(name)}>{label}</label>
        {opts.hint && <p id={hintId} className={css.hint}>{opts.hint}</p>}
        <input
          ref={opts.inputRef}
          id={id(name)}
          type="text"
          maxLength={64}
          inputMode={opts.numeric ? 'numeric' : 'decimal'}
          autoComplete="off"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          onChange={e => (opts.onChange ?? (v => set(name, v)))(e.target.value)}
          onBlur={() => touch(name)}
        />
        {error && <p id={errorId} className={css.error}>{error}</p>}
        {opts.after}
      </div>
    );
  };

  const updateExtra = (extraId: string, key: 'label' | 'perPerson' | 'participants', value: string) =>
    setInputs(prev => ({ ...prev, optional: prev.optional.map(o => o.id === extraId ? { ...o, [key]: value } : o) }));
  const addExtra = () => {
    let extraId = `extra-${nextExtra.current++}`;
    while (inputs.optional.some(extra => extra.id === extraId)) extraId = `extra-${nextExtra.current++}`;
    setInputs(prev => ({ ...prev, optional: [...prev.optional, { id: extraId, label: '', perPerson: '', participants: '' }] }));
    requestAnimationFrame(() => document.getElementById(id(`optional.${extraId}.label`))?.focus());
  };
  const removeExtra = (extraId: string, index: number) => {
    setInputs(prev => ({ ...prev, optional: prev.optional.filter(o => o.id !== extraId) }));
    setAnnouncement(`Optional extra ${index + 1} removed.`);
    requestAnimationFrame(() => document.getElementById(id('add-extra'))?.focus());
  };

  const place = destinationName ? `a trip to ${destinationName}` : 'your trip';
  const status = !result.ready
    ? issues.length ? `Check ${issues.length === 1 ? '1 entry' : `${issues.length} entries`} to see the total.`
      : result.travelers === null || result.nights === null ? 'Add travelers and nights to start.'
        : 'Add at least one shared cost to see a total.'
    : `Shared total ${money(result.totalMinor)}, about ${money(result.shareMinor)} each.`;

  return (
    <section className={`${css.worksheet} ${embedded ? css.embedded : ""}`} aria-labelledby={id('title')}>
      <div className={css.heading}><h2 id={id('title')}>{title}</h2>            <div className={`${css.field} ${css.currency}`}>
              <select disabled={readOnly} id={id('currency')} value={code} aria-label="Currency" title="Approximate conversion rates from November 6, 2026" aria-describedby={currencyError ? `${id('currency')}-error` : undefined} aria-invalid={currencyError ? true : undefined} onChange={e => switchCurrency(e.target.value)}>
                {SUPPORTED_CURRENCIES.filter(c => Object.hasOwn(BUDGET_EXCHANGE_RATES.rates, c.code) && c.code !== 'ZWL').map(c => <option key={c.code} value={c.code}>{`${c.symbol} ${c.code}`}</option>)}
              </select>
              {currencyError && <p id={`${id('currency')}-error`} className={css.error} role="alert">{currencyError}</p>}
            </div></div>
      <p className={css.intro}>{!embedded && <>Plan what {place} could cost. </>} {startingLodging ? 'Start with a local lodging estimate and adjust it for your group. ' : ''}{storageNotice ?? 'Your entries stay in this browser.'}</p>
      <div className={css.layout} data-readonly={readOnly || undefined}>
        {!readOnly && <form className={css.form} aria-label="Budget worksheet" noValidate onSubmit={e => e.preventDefault()}>
          <fieldset>
            <legend>Your group</legend>
            <div className={css.row}>
              {field('travelers', 'Travelers', { numeric: true, inputRef: firstField })}
              {field('nights', 'Nights', { numeric: true })}
            </div>

          </fieldset>

          <fieldset>
            <legend>Lodging</legend>
            <fieldset className={css.choice}>
              <legend>How is the price quoted?</legend>
              {([['property', 'Whole place'], ['room', 'Per room']] as [LodgingBasis, string][]).map(([basis, text]) => (
                <label key={basis} className={css.radio}>
                  <input type="radio" name={id('basis')} value={basis} checked={inputs.lodgingBasis === basis}
                    onChange={() => {
                      setUsingStartingPrice(false);
                      setInputs(prev => ({ ...prev, lodgingBasis: basis, lodgingPerNight: basis === 'room' && usingStartingPrice ? '' : prev.lodgingPerNight }));
                    }} />
                  {text}
                </label>
              ))}
            </fieldset>
            <div className={css.row}>
              {field('lodgingPerNight', inputs.lodgingBasis === 'room' ? `Price per room, per night` : `Price per night`, {
                onChange: value => { setUsingStartingPrice(false); set('lodgingPerNight', value); },
                hint: showingPrefill && startingLodging ? (
                  lodgingReferenceLabel ?? 'Commons Index for Trailing 12 Months'
                ) : undefined,
              })}
              {inputs.lodgingBasis === 'room' && field('rooms', 'Rooms', { numeric: true,  })}
            </div>
          </fieldset>

          <fieldset>
            <legend>Meals</legend>
            <div className={css.row}>
              {field('mealsPerPersonPerDay', `Per person, per day`)}
              {field('mealDays', 'Days of meals', {
                numeric: true,
                value: mealDaysValue,
                onChange: v => setInputs(prev => ({ ...prev, mealDaysFollowNights: false, mealDays: v })),

                after: !inputs.mealDaysFollowNights && (
                  <button type="button" className={css.textButton} onClick={() => setInputs(prev => ({ ...prev, mealDaysFollowNights: true, mealDays: '' }))}>
                    Use nights + 1
                  </button>
                ),
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend>Other shared costs</legend>
            <div className={css.row}>
              {field('transportTotal', `Local transport, group total`, {  })}
              {field('activitiesTotal', `Shared activities, group total`, {  })}
            </div>
            {field('travelPerPerson', `Travel to get there, per person`, { hint: 'Optional. Flights or the drive are left out unless you add them here.' })}
            {field('bufferPercent', 'Cushion for surprises (%)', { hint: `Optional. Added to the shared costs, up to ${BUDGET_LIMITS.bufferPercent}%.` })}
          </fieldset>

          <fieldset>
            <legend>Optional extras</legend>
            <p className={css.hint}>Things only some people will do. They stay out of the shared total and equal share.</p>
            {inputs.optional.map((extra, index) => {
              const perField = `optional.${extra.id}.perPerson` as const;
              const countField = `optional.${extra.id}.participants` as const;
              const perError = errorFor(perField, extra.perPerson);
              const countError = errorFor(countField, extra.participants);
              return (
                <div key={extra.id} className={css.extra} role="group" aria-label={`Optional extra ${index + 1}`}>
                  <div className={css.field}>
                    <label htmlFor={id(`optional.${extra.id}.label`)}>What is it?</label>
                    <input id={id(`optional.${extra.id}.label`)} type="text" maxLength={500} autoComplete="off" value={extra.label}
                      placeholder="Spa visit, guided tour" onChange={e => updateExtra(extra.id, 'label', e.target.value)} />
                  </div>
                  <div className={css.row}>
                    <div className={css.field}>
                      <label htmlFor={id(perField)}>Cost per person</label>
                      <input id={id(perField)} type="text" maxLength={64} inputMode="decimal" autoComplete="off" value={extra.perPerson}
                        aria-invalid={perError ? true : undefined} aria-describedby={perError ? `${id(perField)}-error` : undefined}
                        onChange={e => updateExtra(extra.id, 'perPerson', e.target.value)} onBlur={() => touch(perField)} />
                      {perError && <p id={`${id(perField)}-error`} className={css.error}>{perError}</p>}
                    </div>
                    <div className={css.field}>
                      <label htmlFor={id(countField)}>People joining</label>
                      <input id={id(countField)} type="text" maxLength={64} inputMode="numeric" autoComplete="off" value={extra.participants}
                        aria-invalid={countError ? true : undefined} aria-describedby={countError ? `${id(countField)}-error` : undefined}
                        onChange={e => updateExtra(extra.id, 'participants', e.target.value)} onBlur={() => touch(countField)} />
                      {countError && <p id={`${id(countField)}-error`} className={css.error}>{countError}</p>}
                    </div>
                  </div>
                  <button type="button" className={css.textButton} onClick={() => removeExtra(extra.id, index)}>
                    Remove<span className={css.visuallyHidden}> {extra.label.trim() || `optional extra ${index + 1}`}</span>
                  </button>
                </div>
              );
            })}
            {inputs.optional.length < BUDGET_LIMITS.optionalExtras && (
              <button type="button" id={id('add-extra')} className={css.secondary} onClick={addExtra}>Add an optional extra</button>
            )}
          </fieldset>

          <button type="button" className={css.secondary} onClick={reset}>Clear worksheet</button>
        </form>}

        <aside className={css.summary} aria-labelledby={id('summary')}>
          <h3 id={id('summary')}>{embedded ? "Worksheet breakdown" : "Planning estimate"}</h3>
          <p className={css.visuallyHidden} aria-live="polite">{announcement || status}</p>
          {!result.ready && <p className={css.status}>{status}</p>}
          {issues.length > 0 && (
            <ul className={css.issues}>
              {issues.map(([key, message]) => <li key={key}>{readOnly ? issueLabel(key) : <a href={`#${id(key)}`} onClick={e => { const target = document.getElementById(id(key)); if (target) { e.preventDefault(); target.focus(); } }}>{issueLabel(key)}</a>}: {message}</li>)}
            </ul>
          )}
          <dl className={css.lines}>
            {result.lines.map(line => (
              <div key={line.key} data-status={line.status}>
                <dt>{line.label}<span className={css.detail}>{line.detail}</span></dt>
                <dd>{line.amountMinor === null ? '—' : money(line.amountMinor)}</dd>
              </div>
            ))}
            {result.bufferMinor > 0 && <div><dt>Cushion</dt><dd>{money(result.bufferMinor)}</dd></div>}
          </dl>
          {result.ready && (
            <div className={css.totals}>
              <p><span>{embedded ? "Worksheet total" : "Shared total"}</span><strong>{money(result.totalMinor)}</strong></p>
              <p><span>Equal share{result.travelers === 1 ? '' : ` for ${result.travelers} people`}</span><strong>{money(result.shareMinor)}</strong></p>
              {result.shareRemainderMinor > 0 && (
                <p className={css.detail}>
                  {result.shareRemainderMinor === 1 ? '1 person pays' : `${result.shareRemainderMinor} people pay`} {money(1)} more so the shares add up to the total.
                </p>
              )}
              {result.totalMinor === 0 && <p className={css.detail}>These entries add up to nothing. Add the costs you expect to share.</p>}
            </div>
          )}
          {result.ready && result.notAdded.length > 0 && (
            <p className={css.detail}>Not included yet: {result.notAdded.join(', ').toLowerCase().replace(/^./, c => c.toUpperCase())}.</p>
          )}
          {result.optional.length > 0 && (
            <div className={css.optional}>
              <h4>Optional extras, paid by those joining</h4>
              <ul>
                {result.optional.map(o => (
                  <li key={o.id}>
                    <span>{o.label}<span className={css.detail}>{money(o.perPersonMinor)} × {o.participants} {o.participants === 1 ? 'person' : 'people'}</span></span>
                    <span>{money(o.totalMinor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {embedded && <p className={css.note}>This worksheet is part of your forecast, not your recorded spending or balance.</p>}
          {summaryActions}
          {summarySupplement}
          <p className={css.note}>Adjust the lodging estimate for the size of your group and include any taxes or fees. Actual prices will vary.</p>
        </aside>
      </div>
    </section>
  );
}
