import { z } from 'zod';
import { getCityLodgingBaseRate } from './city-lodging-rates';
import { BUDGET_EXCHANGE_RATES, calculateBudget, type BudgetInputs } from './budget-calculations';
// Keep raw fields, including unfinished/invalid numeric text, for analysis.
const amount = z.string().max(64);
export const BudgetCaptureSchema = z.object({
  id: z.uuid(), revision: z.number().int().min(1).max(1000), destination: z.string().max(60),
  lodgingEdited: z.boolean(),
  inputs: z.object({
    currency: z.string().length(3).refine(code => Object.hasOwn(BUDGET_EXCHANGE_RATES.rates, code)),
    travelers: amount, nights: amount, lodgingBasis: z.enum(['property','room']), lodgingPerNight: amount,
    rooms: amount, mealsPerPersonPerDay: amount, mealDays: amount, mealDaysFollowNights: z.boolean(),
    transportTotal: amount, activitiesTotal: amount, travelPerPerson: amount, bufferPercent: amount,
    optional: z.array(z.object({ label: z.string().max(500), perPerson: amount, participants: amount }).strict()).max(8),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (!getCityLodgingBaseRate(value.destination)) ctx.addIssue({code:'custom',message:'Unknown destination.'});
});
export type BudgetCapture = z.infer<typeof BudgetCaptureSchema>;
export function toCalculationInputs(inputs: BudgetCapture['inputs']): BudgetInputs {
  return {...inputs,optional:inputs.optional.map((o,i)=>({...o,id:String(i)}))};
}
export function captureInputs(inputs: BudgetInputs): BudgetCapture['inputs'] {
  return {...inputs,optional:inputs.optional.map(({label,perPerson,participants})=>({label,perPerson,participants}))};
}
export function budgetCaptureProperties(input: BudgetCapture) {
  const result=calculateBudget(toCalculationInputs(input.inputs));
  return {schemaVersion:2,revision:input.revision,destination:input.destination,currency:input.inputs.currency,
    lodgingEdited:input.lodgingEdited,startingNightlyUsd:getCityLodgingBaseRate(input.destination)!.nightlyUsd,
    inputs:JSON.stringify(input.inputs),estimateReady:result.ready,totalMinor:result.ready?result.totalMinor:null,shareMinor:result.ready?result.shareMinor:null,
    minorDigits:result.minorDigits,fxDate:BUDGET_EXCHANGE_RATES.date};
}
