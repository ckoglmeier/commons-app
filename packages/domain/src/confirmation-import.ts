import { ConfirmationDraftSchema, type ConfirmationDraft } from "@commons/contracts";
import { readFlightItinerary, readLocalDate, readLocalTime } from "./flight-itinerary";

function labelled(text: string, labels: string[], max = 180) {
  const label = labels.map(value => value.replace(/[.*+?^\x24{}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp("\\b(?:" + label + ")\\b[ \\t]*[:#-]?[ \\t]*([^\\n\\r]{2," + max + "})", "i"));
  return match?.[1]?.trim() ?? null;
}

function money(text: string) {
  // A seat, deposit or nightly amount is not the booking total.
  for (const labels of ["grand total|total paid|amount paid|trip total|rental total|booking total", "total"]) {
    const matches = [...text.matchAll(new RegExp("(?:^|\\n)[ \\t]*(?:" + labels + ")[ \\t]*[:-]?[ \\t]*(?:(USD|EUR|GBP|CAD|AUD)[ \\t]*)?([$€£])?[ \\t]*([\\d,]+(?:\\.\\d{2})?)(?:[ \\t]*(USD|EUR|GBP|CAD|AUD))?(?=[ \\t]*(?:\\n|$))", "gi"))];
    if (!matches.length) continue;
    const values = matches.map(match => ({ totalCents: Math.round(Number(match[3].replaceAll(",", "")) * 100), currency: match[1]?.toUpperCase() ?? match[4]?.toUpperCase() ?? (match[2] === "€" ? "EUR" : match[2] === "£" ? "GBP" : "USD") }));
    if (values.some(value => value.totalCents !== values[0].totalCents || value.currency !== values[0].currency)) return null;
    return values[0].totalCents > 0 && values[0].totalCents <= 100_000_000 ? values[0] : null;
  }
  return null;
}

function confirmationCode(text: string) {
  const match = text.match(/(?:^|\n)\s*(?:airline\s+)?(?:confirmation(?: number| code)?|reservation(?: number| code| id)?|booking(?: number| reference| code| id)?|record locator)[ \t]*[:#-]?[ \t]*(?:\n[ \t]*)?([A-Z0-9][A-Z0-9-]{3,19})[ \t]*(?:\n|$)/i);
  const code = match?.[1]?.toUpperCase();
  return code && !/^(?:NUMBER|CONFIRMED|CONFIRMATION|RECEIPT|DETAILS|ITINERARY|REFERENCE)$/.test(code) ? code : null;
}

export function parseConfirmationText(input: { text: string; sourceLabel: string }): ConfirmationDraft {
  const text = input.text.slice(0, 100_000).replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
  const stayScore = (text.match(/\b(check[- ]?in|check[- ]?out|hotel|lodging|property|room)\b/gi) ?? []).length;
  const rentalScore = (text.match(/\b(rental car|vehicle|pick[- ]?up|drop[- ]?off|mileage|rental agreement)\b/gi) ?? []).length;
  const flightScore = (text.match(/\b(flight|airline|boarding|departure|arrival|seat|airport)\b/gi) ?? []).length;
  const kind: ConfirmationDraft["kind"] = rentalScore > stayScore && rentalScore >= flightScore ? "car_rental" : stayScore > flightScore ? "stay" : "flight";
  const total = money(text);
  const travelSegments = kind === "flight" ? readFlightItinerary(text) : undefined;
  const first = travelSegments?.[0]?.connections?.[0];
  const last = travelSegments?.at(-1)?.connections?.at(-1);
  const startLabels = kind === "stay" ? ["check-in", "check in"] : ["pick-up", "pickup", "pick up"];
  const endLabels = kind === "stay" ? ["check-out", "check out"] : ["drop-off", "dropoff", "drop off", "return"];
  const date = (labels: string[]) => readLocalDate(labelled(text, labels.map(label => label + " date")) ?? labelled(text, labels) ?? undefined);
  const time = (labels: string[]) => readLocalTime(labelled(text, labels.map(label => label + " time")) ?? labelled(text, labels) ?? undefined);
  const startsOn = kind === "flight" ? first?.departureDate ?? null : date(startLabels);
  const endsOn = kind === "flight" ? last?.arrivalDate ?? null : date(endLabels);
  const startTime = kind === "flight" ? first?.departureTime ?? null : time(startLabels);
  const endTime = kind === "flight" ? first?.arrivalTime ?? null : time(endLabels);
  const pickup = kind === "car_rental" ? labelled(text, ["pick-up location", "pickup location", "pick up location"], 80) : null;
  const dropoff = kind === "car_rental" ? labelled(text, ["drop-off location", "dropoff location", "return location"], 80) : null;
  const route = kind === "flight" ? travelSegments?.[0]?.route ?? null : pickup ? (pickup + (dropoff ? " → " + dropoff : "")).slice(0, 120) : null;
  const code = confirmationCode(text);
  const warnings: string[] = [];
  if (/\b(?:0?[1-9]|1[0-2])\/(?:0?[1-9]|1[0-2])\/\d{2,4}\b/.test(text)) warnings.push("Numeric dates were read as month/day/year. Check them against the original.");
  if (kind === "flight" && !travelSegments?.length) warnings.push("This itinerary has more groups or connections than this editor supports. Nothing was extracted; review it manually.");
  if (!startsOn) warnings.push(kind === "stay" ? "Check-in date needs review." : kind === "flight" ? "Departure date needs review." : "Pick-up date needs review.");
  if (kind === "stay" && !endsOn) warnings.push("Check-out date needs review.");
  if (kind !== "stay" && !route) warnings.push("Route needs review.");
  if (!total) warnings.push("No unambiguous booking total was found. Check the total, not a deposit or seat fee.");
  if (!code) warnings.push("Confirmation number needs review.");
  if (travelSegments?.some(segment => !segment.time || !segment.date)) warnings.push("A flight date or time is missing. Check each endpoint; departure and arrival are different.");
  if (travelSegments?.some(segment => (segment.connections?.length ?? 0) > 1)) warnings.push("Connections found. Check the grouping into flights there and home.");
  const travelerNames = [...text.matchAll(/(?:^|\n)\s*(?:passenger|traveler)(?: name)?\s*:\s*([^\n]{1,100})/gi)].map(match => match[1].trim()).slice(0, 30);
  return ConfirmationDraftSchema.parse({
    kind, sourceLabel: input.sourceLabel.slice(0, 180),
    name: kind === "stay" ? labelled(text, ["property", "hotel", "accommodation"], 160) : kind === "car_rental" ? labelled(text, ["rental company", "company", "provider"], 160) : labelled(text, ["airline"], 160),
    address: kind === "stay" ? labelled(text, ["property address", "hotel address", "address"], 240) : null,
    startsOn, endsOn, startTime, endTime, route,
    note: kind === "car_rental" ? labelled(text, ["vehicle", "car class"], 80) : null,
    confirmationCode: code, totalCents: total?.totalCents ?? null, currency: total?.currency ?? "USD",
    includesTaxesAndFees: /(?:taxes? and fees?|all taxes|fees included)/i.test(text) ? true : null,
    travelSegments, travelerNames, warnings: warnings.slice(0, 8),
  });
}
