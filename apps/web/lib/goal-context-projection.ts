/** Bounded JSON, not a character slice through JSON syntax or a constraint.
 * The canonical trip projection remains the source for linked plan facts.
 */
export function boundedGoalContext(value: Record<string, unknown>, maxChars: number): string {
  const result = structuredClone(value), omitted: string[] = [];
  const json = () => JSON.stringify({ ...result, coverage: { omitted, complete: omitted.length === 0 } });
  for (const key of ["tripReview", "reports", "tasks", "nextSteps"]) {
    const rows = result[key];
    if (!Array.isArray(rows)) continue;
    while (rows.length && json().length > maxChars) { rows.pop(); if (!omitted.includes(key)) omitted.push(key); }
  }
  const goal = result.goal;
  if (goal && typeof goal === "object" && !Array.isArray(goal)) {
    const scoped = goal as Record<string, unknown>;
    for (const key of ["outcome", "linkedPlanFacts"]) if (json().length > maxChars && key in scoped) { delete scoped[key]; omitted.push(`goal.${key}`); }
  }
  if (json().length > maxChars) return JSON.stringify({ coverage: { complete: false, budgetExceeded: true }, authority: "No task context fits. Do not infer its brief or outcome." });
  return json();
}
