export function updatePollChoiceSelection(
  previous: string[],
  optionId: string,
  mode: "single" | "multiple",
  exclusive: boolean,
  exclusiveIds: string[],
) {
  if (mode === "single") return [optionId];
  if (exclusive) return previous.includes(optionId) ? [] : [optionId];
  const withoutExclusive = previous.filter((id) => !exclusiveIds.includes(id));
  return withoutExclusive.includes(optionId)
    ? withoutExclusive.filter((id) => id !== optionId)
    : [...withoutExclusive, optionId];
}
