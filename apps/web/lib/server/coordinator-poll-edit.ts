/** Resolve a narrowly named wording target from this human request alone.
 * Preservation/scope clauses do not broaden an introduction-only edit. */
export function pollIntroductionOnly(text: string) {
  const clauses = text.replace(/[’‘]/g, "'").split(/[.!;\n]+\s*/).map(value => value.trim()).filter(Boolean);
  const requested = clauses.filter(clause => !/^(?:please\s+)?(?:keep|preserve|leave|don't|do not|never)\b/i.test(clause));
  return requested.length > 0 && requested.every(clause =>
    /^(?:(?:please|now)[,\s]+)*(?:(?:can|could|would) you\s+)?(?:make|shorten|lengthen|trim|tighten|edit|revise|rewrite|reword|set|change|update|simplify)\b/i.test(clause)
    && /\bintro(?:duction)?\b/i.test(clause)
    && !/\b(?:and|also|then)\s+(?:(?:the|this|its|poll's)\s+)?(?:title|message|delivery|questions?|options?)\b/i.test(clause));
}
