/** Deliberately narrow operation routing. Task context never permanently upgrades a conversation. */
export function itineraryOperation(text: string, hasDraft: boolean): "construct" | "refine" | null {
  const value = text.trim().replace(/[’‘]/g, "'");
  if (/^(?:should|what|why|how|when|where|is|are|do|does)\b/i.test(value)) return null;
  const lead = /^(?:(?:please|now|okay|ok|let's|lets)[,\s]+)*(?:(?:can|could|would) you\s+)?/i;
  const request = value.replace(lead, "");
  // A later constraint ("Do not create tasks") must not negate the opening edit request.
  if (/^(?:don't|do not|never|maybe|perhaps)\b/i.test(request)) return null;
  if (/^(?:help (?:shape|build|draft)|review|build|create|draft|prepare|put together)\b[^.!?\n]{0,100}\b(?:itinerary|plan I already have)\b/i.test(request)) return "construct";
  if (hasDraft && /^(?:(?:rewrite|revise|refine|update|adjust|change|simplify|shorten|rework)\b[^.!?\n]{0,90}\b(?:itinerary|draft)|less driving\b|keep\b[^.!?\n]{0,90}\b(?:downtime|optional|itinerary)|make (?:the |this )?(?:itinerary|draft)\b)/i.test(request)) return "refine";
  if (hasDraft && /^rewrite\s+(?:this|it|the (?:itinerary|draft)|our (?:itinerary|draft))\b/i.test(request)) return "refine";
  if (hasDraft && !/\b(?:poll|ballot|question)s?\b/i.test(request) && /^(?:simplify|shorten|rework|remove|drop|skip|move|replace|add|change|update|adjust|make)\b[^.!?\n]{0,160}\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|opening|closing|day description|stop|itinerary item)\b/i.test(request)) return "refine";
  return null;
}

export type TaskOperation = { kind: "create"; title: string } | { kind: "include" | "rename"; text: string };
export function tripTaskOperation(text: string): TaskOperation | null {
  const value = text.trim().replace(/[’‘]/g, "'").replace(/^(?:please\s+|(?:can|could|would) you\s+)/i, "");
  const create = /^(?:create|add|make|prepare)\s+(?:a |an |one )?(?:task|todo|to-do)(?: for me)?\s*(?:to\s+|:\s*)?(.+)$/i.exec(value);
  if (create) {
    const title = create[1].split(/(?:[.!]\s+|\n)/)[0].trim().replace(/[.!]$/, "");
    return title && title.length <= 160 ? { kind: "create", title } : null;
  }
  const include = /^(?:make|update) (?:the |this )?task (?:include|to include)\s+(.+?)(?:\.\s|$)/i.exec(value);
  if (include) return { kind: "include", text: include[1].trim() };
  const rename = /^(?:rename|retitle) (?:the |this )?task (?:to|as)\s+(.+?)(?:\.\s|$)/i.exec(value);
  return rename ? { kind: "rename", text: rename[1].trim() } : null;
}

/** The optional composer disclosure enables explicit drafting, not every future turn or retained attachment. */
export function itineraryComposerRequest(text: string, hasDraft: boolean, selected: boolean) {
  if (tripTaskOperation(text)) return false;
  if (itineraryOperation(text, hasDraft)) return true;
  if (!selected || /^(?:what|why|how|when|where|which|who|should|is|are|do|does)\b/i.test(text.trim()) || text.includes("?")) return false;
  if (hasDraft && !/\b(?:poll|ballot|question)s?\b/i.test(text) && /^make\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?:the|this|our)\s+(?:morning|afternoon|evening|day|weekend|trip)\b)/i.test(text.trim())) return true;
  return !hasDraft || /^(?:keep|replace|remove|skip|drop|add|move|revise|refine|adjust|shorten|simplify|update)\b/i.test(text.trim());
}
