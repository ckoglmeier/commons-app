/** Match only event identity already visible on the surface. Never inspect private
 * profiles, conversations, candidate destinations, or infer weather from dates. */
export const coverSketchIds = ["mountains", "hills", "coast", "lake", "forest", "desert", "countryside", "city", "table", "garden", "celebration", "together"] as const;
export type CoverSketchId = typeof coverSketchIds[number];
export type CoverSketchContext = { name: string; locationName?: string | null };
const themes: [CoverSketchId, RegExp][] = [
  ["mountains", /\b(ski|skiing|snow|snowy|snowboard|snowboarding|winter)\b/i],
  ["hills", /\b(hike|hiking|trail|trails|mountain|mountains|hill|hills)\b/i],
  ["coast", /\b(beach|coast|coastal|ocean|seaside|surf|surfing)\b/i],
  ["lake", /\b(lake|lakes|lakeside|canoe|canoeing|kayak|kayaking)\b/i],
  ["forest", /\b(forest|woods|woodland|cabin|camping|campground)\b/i],
  ["desert", /\b(desert|canyon|canyons)\b/i],
  ["countryside", /\b(countryside|farm|vineyard|winery|rural)\b/i],
  ["city", /\b(city|downtown|neighborhood|urban)\b/i],
  ["table", /\b(dinner|supper|brunch|potluck|meal|restaurant)\b/i],
  ["garden", /\b(garden|park|picnic)\b/i],
  ["celebration", /\b(birthday|anniversary|wedding|celebration)\b/i],
];
export function coverSketchId(context: CoverSketchContext): CoverSketchId {
  const text = `${context.name} ${context.locationName ?? ""}`;
  // Tentative identities should not visually settle an unresolved choice.
  if (/\b(or|maybe|possibly|tbd|undecided)\b|\?/i.test(text)) return "together";
  let matches = themes.filter(([, pattern]) => pattern.test(text)).map(([id]) => id);
  if (matches.includes("mountains")) matches = matches.filter((id) => id !== "hills");
  return matches.length === 1 ? matches[0]! : "together";
}
export function coverSketchUrl(context: CoverSketchContext): string {
  return `/covers/${coverSketchId(context)}.svg`;
}
