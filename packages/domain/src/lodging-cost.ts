import { formatEstimate, type PollProperty } from "@commons/contracts";
/** Integer minor-unit estimates. Unknown quantities never become defaults. */
export function lodgingCost(pricing: PollProperty["pricing"], quantities: { nights: number | null; rooms: number | null; travelers: number | null }) {
  const valid = (n: number | null): n is number => n !== null && Number.isSafeInteger(n) && n > 0 && n <= 10000;
  const periods = pricing.period === "nightly" ? valid(quantities.nights) ? quantities.nights : null : 1;
  const units = pricing.basis === "per_room" ? valid(quantities.rooms) ? quantities.rooms : null : pricing.basis === "per_person" ? valid(quantities.travelers) ? quantities.travelers : null : 1;
  const calculated = periods !== null && units !== null && pricing.minCents !== null && pricing.maxCents !== null ? [pricing.minCents * periods * units, pricing.maxCents * periods * units] as const : null;
  const total = calculated?.every(Number.isSafeInteger) ? calculated : null;
  const perPerson = total && valid(quantities.travelers) ? total.map(cents => Math.round(cents / quantities.travelers!)) : pricing.basis === "per_person" && periods !== null && pricing.minCents !== null && pricing.maxCents !== null ? [pricing.minCents * periods, pricing.maxCents * periods] : null;
  const money = (cents: number) => new Intl.NumberFormat("en-US", {style:"currency",currency:pricing.currency,minimumFractionDigits:cents % 100 ? 2 : 0,maximumFractionDigits:2}).format(cents/100);
  const range = (values: readonly number[]) => values[0] === values[1] ? money(values[0]) : `${money(values[0])}–${money(values[1])}`;
  const assumptions=[valid(quantities.rooms) ? `${quantities.rooms} rooms` : null,valid(quantities.nights) ? `${quantities.nights} nights` : null,valid(quantities.travelers) ? `${quantities.travelers} people` : null].filter(Boolean).join(", ");
  const rate=pricing.minCents !== null && pricing.maxCents !== null ? range([pricing.minCents,pricing.maxCents]) : "unknown";
  const compactDescription=`Est. ${pricing.currency} ${rate}/${{per_room:"room",per_person:"person",total:"group"}[pricing.basis]}/${pricing.period==="nightly" ? "night" : "stay"}; ${assumptions ? `${assumptions}: ` : ""}${total ? `${range(total)} group total` : "group total unknown"}; ${perPerson ? `${range(perPerson)} per person` : "per-person total unknown"}. Fees ${pricing.fees}; not a quote.`;
  return { totalCents: total, perPersonCents: perPerson, compactDescription, description: `${formatEstimate(pricing)} ${total ? `${range(total)} group total.` : "Group total unknown."} ${perPerson ? `${range(perPerson)} per person for the stay (rounded to cents).` : "Per-person total unknown."}` };
}
