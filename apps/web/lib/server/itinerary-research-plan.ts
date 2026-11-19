import type { DecisionRequirement, TripContextSnapshot } from "@commons/contracts";
import { sanitizeTypedResearchQuery } from "./coordinator-research-query";

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Names are only matching hints. Every emitted name/constraint comes from the checked public query. */
function candidateRanges(query: string, labels: string[]) {
  // Explicit lists also work on first construction, before a saved shortlist exists.
  const list = /\bat\s+(.+?)(?=\s+(?:for|on|in|near|during)\b|$)/i.exec(query)?.[1];
  const explicit = list?.split(/,\s*(?:and\s+)?|\s+(?:and|versus|vs\.?)\s+/i).map(name => name.trim()).filter(Boolean) ?? [];
  const hints = [...labels, ...(explicit.length >= 2 && explicit.every(name => /^[\p{Lu}]/u.test(name) && name.length <= 100) ? explicit : [])];
  const ranges: { start: number; end: number; name: string }[] = [];
  for (const label of hints) {
    const words = label.replace(/[’‘]/g, "'").trim().split(/\s+/);
    // A typed shortened venue name may match a saved label prefix; never send the unsupplied remainder.
    for (let length = words.length; length > 0; length--) {
      const prefix = words.slice(0, length).join(" ");
      if (prefix.length < 4) continue;
      const match = new RegExp(`(?<![\\p{L}\\p{N}])${escape(prefix)}(?![\\p{L}\\p{N}])`, "iu").exec(query);
      if (match) { ranges.push({ start: match.index, end: match.index + match[0].length, name: match[0] }); break; }
    }
  }
  // Longest matching span wins; overlapping hints cannot create duplicate searches.
  const unique: typeof ranges = [];
  for (const range of ranges.sort((a, b) => (b.end - b.start) - (a.end - a.start))) {
    if (!unique.some(other => range.start < other.end && other.start < range.end)) unique.push(range);
  }
  return unique.sort((a, b) => a.start - b.start);
}

/** Public query only. One request, at most three searches; no saved label or private prose is appended. */
export function itineraryResearchPlan(publicQuery: string, context: TripContextSnapshot, missing?: DecisionRequirement[], candidateLabels: string[] = []): string[] {
  const checked = sanitizeTypedResearchQuery(publicQuery, context);
  if (!checked || checked.changed || missing?.length === 0) return [];
  const scopes = ["official supplier group size capacity limits and appointments", "official opening days restrictions and eligible alternatives"];
  if (/\b(?:transport|shuttle|van|driver|airport|transfer)\b/i.test(publicQuery)) scopes.push("official transport passenger capacity service area and pickup restrictions");
  else scopes.push("official published rates inclusions and material unknowns");
  const required = missing ? scopes.filter((_, index) => index === 0 ? missing.some(key => key === "group_policy" || key === "capacity") : index === 1 ? missing.includes("eligible_day") : missing.includes("price_basis")) : scopes;
  if (!required.length) return [];
  const candidates = candidateRanges(publicQuery, candidateLabels);
  let planned: string[];
  if (candidates.length) {
    // Remove only matched names/connectors; retain the public party, day, product and destination scope.
    let scope = publicQuery;
    for (const range of [...candidates].reverse()) scope = scope.slice(0, range.start) + "\uE000" + scope.slice(range.end);
    scope = scope.replace(/\uE000(?:[\s,;]*(?:(?:and|or)\b)?[\s,;]*\uE000)*/gi, " ").replace(/\s+/g, " ").trim()
      .replace(/\s+(?:at|between|for|on|in|near)$/i, "");
    planned = candidates.slice(0, 3).map(candidate => {
      const material = required.length === 1 ? required[0] : /\bgaller(?:y|ies)\b/i.test(candidate.name)
        ? "official individual gallery websites visiting hours admission group visits"
        : /\bmuseum\b/i.test(candidate.name)
          ? "official museum tickets admission prices ordinary adult general admission group threshold opening hours"
          : "official website visits group policy opening days hours published rates";
      return `${candidate.name} ${scope} ${material}`;
    });
  } else planned = required.map(scope => `${publicQuery} ${scope}`);
  // No clipping of constraints or privacy-changing repair to make a plan fit.
  return planned.flatMap(query => {
    if (query.length > 500) return [];
    const safe = sanitizeTypedResearchQuery(query, context);
    return safe && !safe.changed ? [safe.query] : [];
  }).slice(0, 3);
}
